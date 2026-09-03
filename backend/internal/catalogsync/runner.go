package catalogsync

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tencorp/real-estate-platform/backend/internal/importer"
)

const (
	providerSourcePrefix = "live-catalog/"
	maximumStagingFiles  = 1024
	maximumStagingBytes  = int64(512 << 20)
)

type ProviderResult struct {
	Provider     string `json:"provider"`
	Status       string `json:"status"`
	FailureCode  string `json:"failureCode,omitempty"`
	SyncRunID    int64  `json:"syncRunId,omitempty"`
	Projects     int    `json:"projects,omitempty"`
	RecordsRead  int    `json:"recordsRead,omitempty"`
	RecordsSaved int    `json:"recordsSaved,omitempty"`
}

type Runner struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
	now    func() time.Time
}

func NewRunner(pool *pgxpool.Pool, logger *slog.Logger) *Runner {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return &Runner{pool: pool, logger: logger, now: time.Now}
}

func ProviderSource(provider string) string {
	return providerSourcePrefix + provider
}

func (runner *Runner) Run(ctx context.Context, config Config, selected map[string]struct{}, dryRun bool) []ProviderResult {
	results := make([]ProviderResult, 0, len(config.Providers))
	for _, provider := range config.Providers {
		if len(selected) > 0 {
			if _, ok := selected[provider.Name]; !ok {
				continue
			}
		}
		result := runner.runProvider(ctx, config.WorkDirectory, provider, dryRun)
		results = append(results, result)
		fields := []any{"provider", result.Provider, "status", result.Status}
		if result.FailureCode != "" {
			fields = append(fields, "failureCode", result.FailureCode)
		}
		if result.Status == "succeeded" || result.Status == "validated" {
			fields = append(fields, "projects", result.Projects, "records", result.RecordsSaved)
		}
		runner.logger.Info("catalog provider sync finished", fields...)
		if ctx.Err() != nil {
			break
		}
	}
	return results
}

func (runner *Runner) runProvider(ctx context.Context, workDirectory string, provider ProviderConfig, dryRun bool) ProviderResult {
	result := ProviderResult{Provider: provider.Name}
	if runner.pool.Config().MaxConns < 3 {
		result.Status, result.FailureCode = "failed", "database_pool_too_small"
		return result
	}
	connection, err := runner.pool.Acquire(ctx)
	if err != nil {
		result.Status, result.FailureCode = "failed", "database_unavailable"
		return result
	}
	defer connection.Release()

	locked, err := tryProviderLock(ctx, connection, provider.Name)
	if err != nil {
		result.Status, result.FailureCode = "failed", "lock_failed"
		return result
	}
	if !locked {
		result.Status, result.FailureCode = "skipped", "overlap_prevented"
		return result
	}
	defer releaseProviderLock(connection, provider.Name)

	attemptAt := runner.now().UTC()
	if !dryRun {
		result.SyncRunID, err = startAttempt(ctx, connection, provider, attemptAt)
		if err != nil {
			result.Status, result.FailureCode = "failed", "attempt_start_failed"
			return result
		}
	}

	fail := func(code string, guard *GuardError) ProviderResult {
		result.Status, result.FailureCode = "failed", code
		if !dryRun && result.SyncRunID != 0 {
			if err := finishFailed(ctx, connection, provider, result.SyncRunID, runner.now().UTC(), code, guard); err != nil {
				result.FailureCode = "status_write_failed"
			}
		}
		return result
	}

	if err := ensurePrivateDirectory(workDirectory); err != nil {
		return fail("work_directory_unavailable", nil)
	}
	stageRoot, err := os.MkdirTemp(workDirectory, "."+provider.Name+"-")
	if err != nil {
		return fail("staging_unavailable", nil)
	}
	defer removeStagingDirectory(workDirectory, stageRoot)
	outputDirectory := filepath.Join(stageRoot, "data")
	temporaryDirectory := filepath.Join(stageRoot, "tmp")
	if err := os.MkdirAll(outputDirectory, 0o700); err != nil {
		return fail("staging_unavailable", nil)
	}
	if err := os.MkdirAll(temporaryDirectory, 0o700); err != nil {
		return fail("staging_unavailable", nil)
	}

	captureCtx, cancelCapture := context.WithTimeout(ctx, provider.CaptureTimeout())
	err = runCaptureCommand(captureCtx, provider, outputDirectory, temporaryDirectory)
	captureTimedOut := errors.Is(captureCtx.Err(), context.DeadlineExceeded)
	cancelCapture()
	if err != nil {
		if captureTimedOut {
			return fail("capture_timeout", nil)
		}
		return fail("capture_failed", nil)
	}
	if err := validateStagingTree(stageRoot); err != nil {
		return fail("unsafe_capture_output", nil)
	}

	prepared, err := importer.PrepareCatalogDirectory(outputDirectory)
	if err != nil {
		return fail("candidate_invalid", nil)
	}
	result.Projects, result.RecordsRead, result.RecordsSaved = preparedCounts(prepared)
	if !dryRun {
		tag, err := connection.Exec(ctx, `
			UPDATE sync_runs SET records_read=$2
			WHERE id=$1 AND source=$3 AND status='running'`, result.SyncRunID, result.RecordsRead, ProviderSource(provider.Name))
		if err != nil || tag.RowsAffected() != 1 {
			return fail("status_write_failed", nil)
		}
	}
	baselines, err := loadAcceptedProjects(ctx, connection, ProviderSource(provider.Name))
	if err != nil {
		return fail("baseline_unavailable", nil)
	}
	if err := ValidatePreparedCatalog(provider, prepared, baselines, runner.now().UTC()); err != nil {
		var guard *GuardError
		if errors.As(err, &guard) {
			return fail("completeness_guard_failed", guard)
		}
		return fail("completeness_guard_failed", nil)
	}
	if dryRun {
		result.Status = "validated"
		return result
	}

	importResult, err := importer.ImportPreparedCatalog(ctx, runner.pool, prepared, importer.CatalogImportOptions{
		Source:    ProviderSource(provider.Name),
		SyncRunID: result.SyncRunID,
		Finalize: func(ctx context.Context, tx pgx.Tx, _ importer.CatalogImportResult) error {
			return finalizeSuccess(ctx, tx, provider, prepared, result.SyncRunID, runner.now().UTC())
		},
	})
	if err != nil {
		return fail("import_failed", nil)
	}
	result.Status = "succeeded"
	result.Projects = importResult.Projects
	result.RecordsRead = importResult.RecordsRead
	result.RecordsSaved = importResult.RecordsSaved
	return result
}

func tryProviderLock(ctx context.Context, connection *pgxpool.Conn, provider string) (bool, error) {
	var locked bool
	err := connection.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtextextended($1,0))`, "catalog_provider_sync:"+provider).Scan(&locked)
	return locked, err
}

func releaseProviderLock(connection *pgxpool.Conn, provider string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var unlocked bool
	_ = connection.QueryRow(ctx, `SELECT pg_advisory_unlock(hashtextextended($1,0))`, "catalog_provider_sync:"+provider).Scan(&unlocked)
}

func startAttempt(ctx context.Context, connection *pgxpool.Conn, provider ProviderConfig, attemptAt time.Time) (int64, error) {
	tx, err := connection.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	source := ProviderSource(provider.Name)
	if _, err := tx.Exec(ctx, `
		UPDATE sync_runs
		SET status='failed',finished_at=$2,error='interrupted'
		WHERE source=$1 AND status='running'`, source, attemptAt); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE catalog_sync_providers
		SET last_attempt_status='failed',error_code='interrupted',updated_at=$2
		WHERE provider=$1 AND last_attempt_status='running'`, provider.Name, attemptAt); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE catalog_sync_projects
		SET last_attempt_status='failed',error_code='interrupted',updated_at=$2
		WHERE provider=$1 AND last_attempt_status='running'`, provider.Name, attemptAt); err != nil {
		return 0, err
	}

	var runID int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO sync_runs(source,status,started_at)
		VALUES($1,'running',$2)
		RETURNING id`, source, attemptAt).Scan(&runID); err != nil {
		return 0, err
	}
	freshnessSeconds := int(provider.FreshnessDuration() / time.Second)
	if _, err := tx.Exec(ctx, `
		INSERT INTO catalog_sync_providers(
			provider,source,freshness_window_seconds,project_count,last_attempt_at,
			last_attempt_run_id,last_attempt_status,error_code,updated_at
		) VALUES($1,$2,$3,$4,$5,$6,'running','',$5)
		ON CONFLICT(provider) DO UPDATE SET
			source=EXCLUDED.source,
			freshness_window_seconds=EXCLUDED.freshness_window_seconds,
			project_count=EXCLUDED.project_count,
			last_attempt_at=EXCLUDED.last_attempt_at,
			last_attempt_run_id=EXCLUDED.last_attempt_run_id,
			last_attempt_status='running',error_code='',updated_at=EXCLUDED.updated_at`,
		provider.Name, source, freshnessSeconds, len(provider.Projects), attemptAt, runID); err != nil {
		return 0, err
	}
	projectSlugs := provider.ProjectSlugs()
	if _, err := tx.Exec(ctx, `
		DELETE FROM catalog_sync_projects
		WHERE provider=$1 AND NOT (project_slug = ANY($2::text[]))`, provider.Name, projectSlugs); err != nil {
		return 0, err
	}
	for _, slug := range projectSlugs {
		policy := provider.Projects[slug]
		if _, err := tx.Exec(ctx, `
			INSERT INTO catalog_sync_projects(
				project_slug,provider,minimum_records,maximum_record_drop_percent,
				last_attempt_at,last_attempt_run_id,last_attempt_status,error_code,updated_at
			) VALUES($1,$2,$3,$4,$5,$6,'running','',$5)
			ON CONFLICT(project_slug) DO UPDATE SET
				last_success_at=CASE WHEN catalog_sync_projects.provider=EXCLUDED.provider THEN catalog_sync_projects.last_success_at END,
				last_success_run_id=CASE WHEN catalog_sync_projects.provider=EXCLUDED.provider THEN catalog_sync_projects.last_success_run_id END,
				last_captured_at=CASE WHEN catalog_sync_projects.provider=EXCLUDED.provider THEN catalog_sync_projects.last_captured_at END,
				last_record_count=CASE WHEN catalog_sync_projects.provider=EXCLUDED.provider THEN catalog_sync_projects.last_record_count END,
				fresh_until=CASE WHEN catalog_sync_projects.provider=EXCLUDED.provider THEN catalog_sync_projects.fresh_until END,
				provider=EXCLUDED.provider,minimum_records=EXCLUDED.minimum_records,
				maximum_record_drop_percent=EXCLUDED.maximum_record_drop_percent,
				last_attempt_at=EXCLUDED.last_attempt_at,
				last_attempt_run_id=EXCLUDED.last_attempt_run_id,
				last_attempt_status='running',error_code='',updated_at=EXCLUDED.updated_at`,
			slug, provider.Name, policy.MinimumRecords, provider.MaximumDropPercent(), attemptAt, runID); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return runID, nil
}

func finishFailed(ctx context.Context, connection *pgxpool.Conn, provider ProviderConfig, runID int64, finishedAt time.Time, code string, guard *GuardError) error {
	tx, err := connection.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err := tx.Exec(ctx, `
		UPDATE sync_runs SET status='failed',finished_at=$3,error=$4
		WHERE id=$1 AND source=$2 AND status='running'`, runID, ProviderSource(provider.Name), finishedAt, code); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE catalog_sync_providers
		SET last_attempt_status='failed',error_code=$3,updated_at=$4
		WHERE provider=$1 AND last_attempt_run_id=$2`, provider.Name, runID, code, finishedAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE catalog_sync_projects
		SET last_attempt_status='failed',error_code=$3,updated_at=$4
		WHERE provider=$1 AND last_attempt_run_id=$2`, provider.Name, runID, code, finishedAt); err != nil {
		return err
	}
	if guard != nil && guard.ProjectSlug != "" {
		if _, err := tx.Exec(ctx, `
			UPDATE catalog_sync_projects SET error_code=$3,updated_at=$4
			WHERE provider=$1 AND project_slug=$2 AND last_attempt_run_id=$5`,
			provider.Name, guard.ProjectSlug, guard.Code, finishedAt, runID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func finalizeSuccess(ctx context.Context, tx pgx.Tx, provider ProviderConfig, prepared importer.PreparedCatalogImport, runID int64, successAt time.Time) error {
	projects := make(map[string]importer.CatalogProject, len(provider.Projects))
	var providerFreshUntil time.Time
	for _, bundle := range prepared.Bundles {
		for _, project := range bundle.Projects {
			projects[project.Slug] = project
			projectFreshUntil := project.CapturedAt.Add(provider.FreshnessDuration())
			if providerFreshUntil.IsZero() || projectFreshUntil.Before(providerFreshUntil) {
				providerFreshUntil = projectFreshUntil
			}
		}
	}
	tag, err := tx.Exec(ctx, `
		UPDATE catalog_sync_providers SET
			last_attempt_status='succeeded',last_success_at=$3,last_success_run_id=$2,
			fresh_until=$4,error_code='',updated_at=$3
		WHERE provider=$1 AND last_attempt_run_id=$2 AND last_attempt_status='running'`,
		provider.Name, runID, successAt, providerFreshUntil)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("provider status no longer belongs to this run")
	}
	for _, slug := range provider.ProjectSlugs() {
		project := projects[slug]
		freshUntil := project.CapturedAt.Add(provider.FreshnessDuration())
		tag, err := tx.Exec(ctx, `
			UPDATE catalog_sync_projects SET
				last_attempt_status='succeeded',last_success_at=$4,last_success_run_id=$3,
				last_captured_at=$5,last_record_count=$6,fresh_until=$7,
				error_code='',updated_at=$4
			WHERE provider=$1 AND project_slug=$2 AND last_attempt_run_id=$3
			  AND last_attempt_status='running'`,
			provider.Name, slug, runID, successAt, project.CapturedAt, len(project.Units), freshUntil)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return fmt.Errorf("project status for %s no longer belongs to this run", slug)
		}
	}
	return nil
}

func loadAcceptedProjects(ctx context.Context, connection *pgxpool.Conn, source string) (map[string]AcceptedProject, error) {
	rows, err := connection.Query(ctx, `
		SELECT DISTINCT ON (snapshots.project_slug)
			snapshots.project_slug,snapshots.record_count,snapshots.captured_at,
			COALESCE(NULLIF(snapshots.content_checksum_sha256,''),snapshots.checksum_sha256)
		FROM source_snapshots AS snapshots
		JOIN sync_runs AS runs ON runs.id=snapshots.sync_run_id
		WHERE snapshots.source=$1 AND runs.status='succeeded'
		ORDER BY snapshots.project_slug,snapshots.imported_at DESC,snapshots.id DESC`, source)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]AcceptedProject)
	for rows.Next() {
		var slug string
		var item AcceptedProject
		if err := rows.Scan(&slug, &item.Records, &item.CapturedAt, &item.Checksum); err != nil {
			return nil, err
		}
		result[slug] = item
	}
	return result, rows.Err()
}

func preparedCounts(prepared importer.PreparedCatalogImport) (projects, recordsRead, recordsSaved int) {
	for _, bundle := range prepared.Bundles {
		projects += len(bundle.Projects)
		for _, project := range bundle.Projects {
			recordsRead += len(project.Units) + project.DuplicateUnits
			recordsSaved += len(project.Units)
		}
	}
	return projects, recordsRead, recordsSaved
}

func runCaptureCommand(ctx context.Context, provider ProviderConfig, outputDirectory, temporaryDirectory string) error {
	command := exec.CommandContext(ctx, provider.Command[0], provider.Command[1:]...) // #nosec G204 -- executable is an absolute path from root-owned configuration.
	command.Dir = provider.WorkingDirectory
	command.Env = captureEnvironment(provider.Name, outputDirectory, temporaryDirectory)
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.WaitDelay = 5 * time.Second
	command.Cancel = func() error {
		if command.Process == nil {
			return os.ErrProcessDone
		}
		return syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	}
	return command.Run()
}

func captureEnvironment(provider, outputDirectory, temporaryDirectory string) []string {
	allowed := []string{
		"DBUS_SESSION_BUS_ADDRESS", "DISPLAY", "HOME", "LANG", "LC_ALL", "NODE_PATH",
		"PATH", "PLAYWRIGHT_BROWSERS_PATH", "TZ", "XAUTHORITY", "XDG_RUNTIME_DIR",
		"LIVE_SYNC_CAPTURE_DIR", "LIVE_SYNC_CDP_ALEMICA_URL", "LIVE_SYNC_CDP_HUMAN2HUMAN_URL",
		"LIVE_SYNC_CDP_KAYAN_URL", "LIVE_SYNC_CDP_MBC_URL", "LIVE_SYNC_CDP_NRG_BI_URL",
		"LIVE_SYNC_CDP_UYSOT_URL",
	}
	result := make([]string, 0, len(allowed)+3)
	for _, name := range allowed {
		if value, ok := os.LookupEnv(name); ok {
			result = append(result, name+"="+value)
		}
	}
	result = append(result,
		"CATALOG_OUTPUT_DIR="+outputDirectory,
		"CATALOG_PROVIDER="+provider,
		"TMPDIR="+temporaryDirectory,
	)
	sort.Strings(result)
	return result
}

func ensurePrivateDirectory(path string) error {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return errors.New("work directory is not a real directory")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return errors.New("work directory permissions are not private")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Geteuid()) {
		return errors.New("work directory is not owned by the service user")
	}
	return nil
}

func validateStagingTree(root string) error {
	files := 0
	var bytes int64
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("capture output contains a symbolic link")
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return errors.New("capture output contains a non-regular file")
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		files++
		bytes += info.Size()
		if files > maximumStagingFiles || bytes > maximumStagingBytes {
			return errors.New("capture output exceeds its safety limit")
		}
		return nil
	})
	return err
}

func removeStagingDirectory(parent, target string) {
	cleanParent := filepath.Clean(parent)
	cleanTarget := filepath.Clean(target)
	if filepath.Dir(cleanTarget) != cleanParent || !strings.HasPrefix(filepath.Base(cleanTarget), ".") {
		return
	}
	_ = os.RemoveAll(cleanTarget)
}
