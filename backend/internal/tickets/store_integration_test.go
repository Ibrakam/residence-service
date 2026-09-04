package tickets

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tencorp/real-estate-platform/backend/internal/database"
)

func openTicketIntegrationStore(t *testing.T) (*Store, *pgxpool.Pool) {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	pool, err := database.Open(t.Context(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	migrationsDir, err := filepath.Abs(filepath.Join("..", "..", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Migrate(t.Context(), pool, migrationsDir); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `
		TRUNCATE ticket_messages,ticket_attachments,tickets,ticket_automation_updates,
			ticket_automation_offsets,ticket_worker_lease RESTART IDENTITY CASCADE;
		INSERT INTO ticket_worker_lease (lease_key) VALUES (true);`); err != nil {
		t.Fatal(err)
	}
	return NewStore(pool), pool
}

func TestStoreQueueLifecycleIntegration(t *testing.T) {
	store, pool := openTicketIntegrationStore(t)
	now := time.Now().UTC()
	first, err := store.ApplyUpdate(t.Context(), "integration", MessageInput{
		UpdateID: 1, ChatID: -100, MessageID: 10, MediaGroupID: "album",
		Body: "first", ProjectKey: ProjectMarketMap,
		ReadyAfter: now.Add(-time.Second), Accept: true, ExplicitFix: true,
	})
	if err != nil || !first.Created || first.TicketID == 0 {
		t.Fatalf("first ingest = %#v, %v", first, err)
	}
	second, err := store.ApplyUpdate(t.Context(), "integration", MessageInput{
		UpdateID: 2, ChatID: -100, MessageID: 11, MediaGroupID: "album",
		Body: "second", ReadyAfter: now.Add(-time.Second), Accept: true,
	})
	if err != nil || second.Created || second.TicketID != first.TicketID {
		t.Fatalf("album ingest = %#v, %v", second, err)
	}
	duplicate, err := store.ApplyUpdate(t.Context(), "integration", MessageInput{UpdateID: 2})
	if err != nil || !duplicate.Duplicate {
		t.Fatalf("update dedupe = %#v, %v", duplicate, err)
	}
	claim, err := store.Claim(t.Context(), "integration-worker", "lease-token", time.Minute)
	if err != nil || claim.Ticket == nil || claim.Ticket.ID != first.TicketID {
		t.Fatalf("claim = %#v, %v", claim, err)
	}
	if claim.Ticket.Body != "first\n\nsecond" || claim.Ticket.AttemptCount != 1 || claim.Ticket.ProjectKey != ProjectMarketMap {
		t.Fatalf("claimed ticket = %#v", claim.Ticket)
	}
	if err := store.UpdateProgress(t.Context(), first.TicketID, "integration-worker", claim.LeaseToken, "testing"); err != nil {
		t.Fatal(err)
	}
	completion := Completion{
		Summary: "done", ProductionURL: "https://example.test",
	}
	if err := store.Complete(t.Context(), first.TicketID, claim.LeaseToken, completion); err != nil {
		t.Fatal(err)
	}
	if err := store.Complete(t.Context(), first.TicketID, claim.LeaseToken, completion); err != nil {
		t.Fatalf("idempotent completion retry: %v", err)
	}
	if err := store.Complete(t.Context(), first.TicketID, claim.LeaseToken, Completion{Summary: "different"}); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("mismatched completion retry = %v", err)
	}
	view, err := store.StatusView(context.Background(), first.TicketID)
	if err != nil || view.Status != StatusCompleted || view.ResultSummary != "done" {
		t.Fatalf("completion view = %#v, %v", view, err)
	}
	if err := store.SaveStatusMessage(t.Context(), first.TicketID, 700, FormatStatus(view), view.UpdatedAt); err != nil {
		t.Fatal(err)
	}
	replyTo := int64(700)
	followUp, err := store.ApplyUpdate(t.Context(), "integration", MessageInput{
		UpdateID: 3, ChatID: -100, MessageID: 12, ReplyToMessage: &replyTo,
		Body: "follow-up", ReadyAfter: now.Add(-time.Second), Accept: true,
	})
	if err != nil || !followUp.Created || followUp.TicketID == first.TicketID {
		t.Fatalf("terminal follow-up = %#v, %v", followUp, err)
	}
	var followUpProject string
	if err := pool.QueryRow(t.Context(), `SELECT project_key FROM tickets WHERE id=$1`, followUp.TicketID).Scan(&followUpProject); err != nil {
		t.Fatal(err)
	}
	if followUpProject != ProjectMarketMap {
		t.Fatalf("terminal follow-up project = %q", followUpProject)
	}
	var ticketCountBefore int64
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM tickets`).Scan(&ticketCountBefore); err != nil {
		t.Fatal(err)
	}
	unknownBotMessage := int64(999999)
	ignoredReply, err := store.ApplyUpdate(t.Context(), "integration", MessageInput{
		UpdateID: 4, ChatID: -100, MessageID: 13, ReplyToMessage: &unknownBotMessage,
		Body: "reply to /help", ReadyAfter: now, Accept: true,
	})
	if err != nil || ignoredReply.Accepted || ignoredReply.TicketID != 0 {
		t.Fatalf("unknown bot reply = %#v, %v", ignoredReply, err)
	}
	var ticketCountAfter int64
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM tickets`).Scan(&ticketCountAfter); err != nil {
		t.Fatal(err)
	}
	if ticketCountAfter != ticketCountBefore {
		t.Fatalf("unknown bot reply created a ticket: before=%d after=%d", ticketCountBefore, ticketCountAfter)
	}

	unauthorized := ParseTelegramUpdate(TelegramUpdate{UpdateID: 9, Message: &TelegramMessage{
		MessageID: 90, Chat: TelegramChat{ID: -100}, From: &TelegramUser{ID: 999}, Text: "/status",
	}}, -100, TelegramUserIDSet{5: {}}, time.Second, now)
	rejected, err := store.ApplyUpdate(t.Context(), "integration", unauthorized.Input)
	if err != nil || rejected.Accepted {
		t.Fatalf("unauthorized update = %#v, %v", rejected, err)
	}
	lastUpdateID, found, err := store.LastUpdateID(t.Context(), "integration")
	if err != nil || !found || lastUpdateID != 9 {
		t.Fatalf("offset after unauthorized update = %d, %v, %v", lastUpdateID, found, err)
	}
	duplicate, err = store.ApplyUpdate(t.Context(), "integration", unauthorized.Input)
	if err != nil || !duplicate.Duplicate {
		t.Fatalf("unauthorized update dedupe = %#v, %v", duplicate, err)
	}

	invalid, err := store.ApplyUpdate(t.Context(), "integration", MessageInput{
		UpdateID: 10, ChatID: 0, MessageID: 0, Body: "invalid", Accept: true,
	})
	if err != nil || invalid.Accepted {
		t.Fatalf("invalid update = %#v, %v", invalid, err)
	}
	lastUpdateID, found, err = store.LastUpdateID(t.Context(), "integration")
	if err != nil || !found || lastUpdateID != 10 {
		t.Fatalf("offset after invalid update = %d, %v, %v", lastUpdateID, found, err)
	}

	failedClaim, err := store.Claim(t.Context(), "integration-worker", "failure-lease-token", time.Minute)
	if err != nil || failedClaim.Ticket == nil || failedClaim.Ticket.ID != followUp.TicketID {
		t.Fatalf("follow-up claim = %#v, %v", failedClaim, err)
	}
	if err := store.Fail(t.Context(), followUp.TicketID, failedClaim.LeaseToken, "could not verify"); err != nil {
		t.Fatal(err)
	}
	if err := store.Fail(t.Context(), followUp.TicketID, failedClaim.LeaseToken, "could not verify"); err != nil {
		t.Fatalf("idempotent failure retry: %v", err)
	}
	if err := store.Fail(t.Context(), followUp.TicketID, failedClaim.LeaseToken, "different"); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("mismatched failure retry = %v", err)
	}
}

func TestRepliesInheritParentProjectIntegration(t *testing.T) {
	store, pool := openTicketIntegrationStore(t)
	now := time.Now().UTC().Add(-time.Second)
	created, err := store.ApplyUpdate(t.Context(), "reply-project", MessageInput{
		UpdateID: 1, ChatID: -150, MessageID: 15, Body: "market task",
		ProjectKey: ProjectMarketMap, ReadyAfter: now, Accept: true, ExplicitFix: true,
	})
	if err != nil || !created.Created {
		t.Fatalf("create = %#v, %v", created, err)
	}
	const statusMessageID int64 = 715
	if _, err := pool.Exec(t.Context(), `UPDATE tickets SET status_message_id=$2 WHERE id=$1`, created.TicketID, statusMessageID); err != nil {
		t.Fatal(err)
	}
	replyTo := statusMessageID
	queuedReply, err := store.ApplyUpdate(t.Context(), "reply-project", MessageInput{
		UpdateID: 2, ChatID: -150, MessageID: 16, ReplyToMessage: &replyTo,
		Body: "queued note", ProjectKey: ProjectResidence, ReadyAfter: now, Accept: true, ExplicitFix: true,
	})
	if err != nil || queuedReply.Created || queuedReply.TicketID != created.TicketID {
		t.Fatalf("queued reply = %#v, %v", queuedReply, err)
	}
	var queuedProject string
	if err := pool.QueryRow(t.Context(), `SELECT project_key FROM tickets WHERE id=$1`, created.TicketID).Scan(&queuedProject); err != nil {
		t.Fatal(err)
	}
	if queuedProject != ProjectMarketMap {
		t.Fatalf("queued reply changed project to %q", queuedProject)
	}
	claim, err := store.Claim(t.Context(), "reply-worker", "reply-lease", time.Minute)
	if err != nil || claim.Ticket == nil {
		t.Fatalf("claim = %#v, %v", claim, err)
	}
	if err := store.Complete(t.Context(), created.TicketID, claim.LeaseToken, Completion{Summary: "done"}); err != nil {
		t.Fatal(err)
	}
	followUp, err := store.ApplyUpdate(t.Context(), "reply-project", MessageInput{
		UpdateID: 3, ChatID: -150, MessageID: 17, ReplyToMessage: &replyTo,
		Body: "terminal follow-up", ProjectKey: ProjectResidence, ReadyAfter: now, Accept: true, ExplicitFix: true,
	})
	if err != nil || !followUp.Created || followUp.TicketID == created.TicketID {
		t.Fatalf("terminal follow-up = %#v, %v", followUp, err)
	}
	var followUpProject string
	if err := pool.QueryRow(t.Context(), `SELECT project_key FROM tickets WHERE id=$1`, followUp.TicketID).Scan(&followUpProject); err != nil {
		t.Fatal(err)
	}
	if followUpProject != ProjectMarketMap {
		t.Fatalf("terminal follow-up project = %q", followUpProject)
	}
}

func TestDelayedMediaAlbumCreatesFollowUpAfterClaimAndCompletionIntegration(t *testing.T) {
	store, pool := openTicketIntegrationStore(t)
	now := time.Now().UTC().Add(-time.Second)
	first, err := store.ApplyUpdate(t.Context(), "delayed-album", MessageInput{
		UpdateID: 1, ChatID: -200, MessageID: 20, MediaGroupID: "late-album",
		Body: "original", ProjectKey: ProjectMarketMap, ReadyAfter: now, Accept: true, ExplicitFix: true,
	})
	if err != nil || !first.Created {
		t.Fatalf("first album part = %#v, %v", first, err)
	}
	claim, err := store.Claim(t.Context(), "album-worker", "album-lease", time.Minute)
	if err != nil || claim.Ticket == nil || claim.Ticket.ID != first.TicketID {
		t.Fatalf("album claim = %#v, %v", claim, err)
	}
	workingFollowUp, err := store.ApplyUpdate(t.Context(), "delayed-album", MessageInput{
		UpdateID: 2, ChatID: -200, MessageID: 21, MediaGroupID: "late-album",
		Body: "arrived while working", ReadyAfter: now, Accept: true,
	})
	if err != nil || !workingFollowUp.Created || workingFollowUp.TicketID == first.TicketID {
		t.Fatalf("working delayed part = %#v, %v", workingFollowUp, err)
	}
	var workingFollowUpProject string
	if err := pool.QueryRow(t.Context(), `SELECT project_key FROM tickets WHERE id=$1`, workingFollowUp.TicketID).Scan(&workingFollowUpProject); err != nil {
		t.Fatal(err)
	}
	if workingFollowUpProject != ProjectMarketMap {
		t.Fatalf("working delayed project = %q", workingFollowUpProject)
	}
	var originalBody, originalStatus string
	if err := pool.QueryRow(t.Context(), `SELECT body,status FROM tickets WHERE id=$1`, first.TicketID).Scan(&originalBody, &originalStatus); err != nil {
		t.Fatal(err)
	}
	if originalBody != "original" || originalStatus != StatusWorking {
		t.Fatalf("working original mutated: body=%q status=%q", originalBody, originalStatus)
	}
	if err := store.Complete(t.Context(), first.TicketID, claim.LeaseToken, Completion{Summary: "done"}); err != nil {
		t.Fatal(err)
	}
	completedFollowUp, err := store.ApplyUpdate(t.Context(), "delayed-album", MessageInput{
		UpdateID: 3, ChatID: -200, MessageID: 22, MediaGroupID: "late-album",
		Body: "arrived after completion", ReadyAfter: now, Accept: true,
	})
	if err != nil || !completedFollowUp.Created || completedFollowUp.TicketID == first.TicketID || completedFollowUp.TicketID == workingFollowUp.TicketID {
		t.Fatalf("completed delayed part = %#v, %v", completedFollowUp, err)
	}
	var completedFollowUpProject string
	if err := pool.QueryRow(t.Context(), `SELECT project_key FROM tickets WHERE id=$1`, completedFollowUp.TicketID).Scan(&completedFollowUpProject); err != nil {
		t.Fatal(err)
	}
	if completedFollowUpProject != ProjectMarketMap {
		t.Fatalf("completed delayed project = %q", completedFollowUpProject)
	}
	if err := pool.QueryRow(t.Context(), `SELECT body,status FROM tickets WHERE id=$1`, first.TicketID).Scan(&originalBody, &originalStatus); err != nil {
		t.Fatal(err)
	}
	if originalBody != "original" || originalStatus != StatusCompleted {
		t.Fatalf("completed original mutated: body=%q status=%q", originalBody, originalStatus)
	}
}

func TestHeartbeatAndFinalizationUseConsistentLockOrderIntegration(t *testing.T) {
	store, pool := openTicketIntegrationStore(t)
	if _, err := pool.Exec(t.Context(), `
		CREATE OR REPLACE FUNCTION ticket_test_delay_finalization()
		RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF OLD.status='working' AND NEW.status IN ('completed','failed') THEN
				PERFORM pg_sleep(0.75);
			END IF;
			RETURN NEW;
		END;
		$$;
		CREATE TRIGGER ticket_test_delay_finalization_trigger
		BEFORE UPDATE OF status ON tickets
		FOR EACH ROW EXECUTE FUNCTION ticket_test_delay_finalization();`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `
			DROP TRIGGER IF EXISTS ticket_test_delay_finalization_trigger ON tickets;
			DROP FUNCTION IF EXISTS ticket_test_delay_finalization();`)
	})

	created, err := store.ApplyUpdate(t.Context(), "deadlock", MessageInput{
		UpdateID: 1, ChatID: -300, MessageID: 30, Body: "lock order",
		ReadyAfter: time.Now().UTC().Add(-time.Second), Accept: true, ExplicitFix: true,
	})
	if err != nil || !created.Created {
		t.Fatalf("create = %#v, %v", created, err)
	}
	claim, err := store.Claim(t.Context(), "lock-worker", "lock-lease", time.Minute)
	if err != nil || claim.Ticket == nil {
		t.Fatalf("claim = %#v, %v", claim, err)
	}

	completeResult := make(chan error, 1)
	go func() {
		completeResult <- store.Complete(context.Background(), created.TicketID, claim.LeaseToken, Completion{Summary: "done"})
	}()
	deadline := time.Now().Add(2 * time.Second)
	for {
		var sleeping bool
		err := pool.QueryRow(t.Context(), `
			SELECT EXISTS (
				SELECT 1 FROM pg_stat_activity
				WHERE datname=current_database() AND wait_event='PgSleep'
				  AND query LIKE '%finalization_token_hash%'
			)`).Scan(&sleeping)
		if err != nil {
			t.Fatal(err)
		}
		if sleeping {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("finalization never reached the delay trigger")
		}
		time.Sleep(10 * time.Millisecond)
	}
	heartbeatResult := make(chan error, 1)
	go func() {
		_, err := store.Heartbeat(context.Background(), "lock-worker", claim.LeaseToken, time.Minute)
		heartbeatResult <- err
	}()

	var completeErr, heartbeatErr error
	select {
	case completeErr = <-completeResult:
	case <-time.After(4 * time.Second):
		t.Fatal("finalization timed out")
	}
	select {
	case heartbeatErr = <-heartbeatResult:
	case <-time.After(4 * time.Second):
		t.Fatal("heartbeat timed out")
	}
	if completeErr != nil {
		t.Fatalf("completion failed: %v", completeErr)
	}
	if heartbeatErr != nil && !errors.Is(heartbeatErr, ErrLeaseLost) {
		t.Fatalf("heartbeat failed unexpectedly: %v", heartbeatErr)
	}
	if strings.Contains(strings.ToLower(fmt.Sprint(completeErr, heartbeatErr)), "deadlock") {
		t.Fatalf("database deadlock detected: complete=%v heartbeat=%v", completeErr, heartbeatErr)
	}
}

func TestAttachmentRetentionPurgesOnlyOldTerminalTicketsIntegration(t *testing.T) {
	store, pool := openTicketIntegrationStore(t)
	root := t.TempDir()
	type fixture struct {
		status       string
		completedAt  any
		ticketID     int64
		attachmentID int64
		path         string
	}
	fixtures := []fixture{
		{status: StatusCompleted, completedAt: time.Now().UTC().Add(-31 * 24 * time.Hour)},
		{status: StatusCompleted, completedAt: time.Now().UTC().Add(-2 * time.Hour)},
		{status: StatusQueued, completedAt: nil},
	}
	for index := range fixtures {
		item := &fixtures[index]
		if err := pool.QueryRow(t.Context(), `
			INSERT INTO tickets (chat_id,first_message_id,body,status,completed_at)
			VALUES (-400,$1,'retention',$2,$3) RETURNING id`, 100+index, item.status, item.completedAt).Scan(&item.ticketID); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(t.Context(), `
			INSERT INTO ticket_attachments (
				ticket_id,message_id,telegram_file_id,kind,download_status,local_path,byte_size
			) VALUES ($1,$2,$3,'document','ready','',4) RETURNING id`,
			item.ticketID, 100+index, fmt.Sprintf("file-%d", index)).Scan(&item.attachmentID); err != nil {
			t.Fatal(err)
		}
		directory := filepath.Join(root, fmt.Sprint(item.ticketID))
		if err := os.Mkdir(directory, 0o700); err != nil {
			t.Fatal(err)
		}
		item.path = filepath.Join(directory, fmt.Sprintf("%d.bin", item.attachmentID))
		if err := os.WriteFile(item.path, []byte("data"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(t.Context(), `UPDATE ticket_attachments SET local_path=$2 WHERE id=$1`, item.attachmentID, item.path); err != nil {
			t.Fatal(err)
		}
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	stats, err := CleanupTerminalAttachments(t.Context(), Config{
		AttachmentDir: root, AttachmentRetention: 30 * 24 * time.Hour,
		AttachmentDiskWarnBytes: 1 << 30,
	}, store, false, 10, logger)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Eligible != 1 || stats.FilesRemoved != 1 || stats.RecordsPurged != 1 {
		t.Fatalf("retention stats = %#v", stats)
	}
	for index, item := range fixtures {
		var status, localPath string
		if err := pool.QueryRow(t.Context(), `SELECT download_status,local_path FROM ticket_attachments WHERE id=$1`, item.attachmentID).Scan(&status, &localPath); err != nil {
			t.Fatal(err)
		}
		if index == 0 {
			if status != "purged" || localPath != "" {
				t.Fatalf("old terminal DB state = %q %q", status, localPath)
			}
			if _, err := os.Lstat(item.path); !os.IsNotExist(err) {
				t.Fatalf("old terminal file remains: %v", err)
			}
			continue
		}
		if status != "ready" || localPath != item.path {
			t.Fatalf("protected attachment %d mutated: %q %q", index, status, localPath)
		}
		if _, err := os.Stat(item.path); err != nil {
			t.Fatalf("protected attachment %d removed: %v", index, err)
		}
	}
}

func TestTicketBotDatabaseRoleLeastPrivilegeIntegration(t *testing.T) {
	_, pool := openTicketIntegrationStore(t)
	var roleExists bool
	if err := pool.QueryRow(t.Context(), `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tencorp_ticket_bot')`).Scan(&roleExists); err != nil {
		t.Fatal(err)
	}
	if roleExists {
		t.Skip("tencorp_ticket_bot already exists; refusing to mutate a real role in a test")
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err := tx.Exec(t.Context(), `
		CREATE ROLE tencorp_ticket_bot LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
		CREATE TABLE integrations (id bigserial PRIMARY KEY, secret text);`); err != nil {
		t.Skipf("database user cannot create the isolated role audit fixture: %v", err)
	}
	grantPath, err := filepath.Abs(filepath.Join("..", "..", "..", "automation", "deploy", "postgresql", "tencorp-ticket-bot-grants.sql"))
	if err != nil {
		t.Fatal(err)
	}
	grantSQL, err := os.ReadFile(grantPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(t.Context(), string(grantSQL)); err != nil {
		t.Fatalf("apply least-privilege grants: %v", err)
	}
	var functionExecute, ticketRead, leadsRead, integrationsRead bool
	if err := tx.QueryRow(t.Context(), `
		SELECT
			has_function_privilege('tencorp_ticket_bot','ticket_cap_body(text,text)','EXECUTE'),
			has_table_privilege('tencorp_ticket_bot','tickets','SELECT'),
			has_table_privilege('tencorp_ticket_bot','leads','SELECT'),
			has_table_privilege('tencorp_ticket_bot','integrations','SELECT')`).Scan(
		&functionExecute, &ticketRead, &leadsRead, &integrationsRead,
	); err != nil {
		t.Fatal(err)
	}
	if !functionExecute || !ticketRead || leadsRead || integrationsRead {
		t.Fatalf("role privileges function=%v tickets=%v leads=%v integrations=%v",
			functionExecute, ticketRead, leadsRead, integrationsRead)
	}
}
