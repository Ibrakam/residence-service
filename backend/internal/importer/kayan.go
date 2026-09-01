package importer

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const KayanSource = "profitbase-kayan"

type Snapshot struct {
	SchemaVersion int           `json:"schemaVersion"`
	Source        string        `json:"source"`
	Developer     string        `json:"developer"`
	CapturedAt    time.Time     `json:"capturedAt"`
	House         SnapshotHouse `json:"house"`
	Headers       []string      `json:"headers"`
	Records       []RawRecord   `json:"records"`
	Layouts       []RawLayout   `json:"layouts"`
	Path          string        `json:"-"`
	Checksum      string        `json:"-"`
}

type SnapshotHouse struct {
	SourceID     string   `json:"sourceId"`
	ProjectSlug  string   `json:"projectSlug"`
	ProjectName  string   `json:"projectName"`
	PhaseSlug    string   `json:"phaseSlug"`
	PhaseName    string   `json:"phaseName"`
	PropertyType string   `json:"propertyType"`
	Card         *RawCard `json:"card,omitempty"`
}

type RawCard struct {
	Index int    `json:"index"`
	Text  string `json:"text"`
	Image string `json:"image"`
	Label string `json:"label"`
}

type RawRecord struct {
	PropertyType string `json:"propertyType"`
	RawStatus    string `json:"rawStatus"`
	Number       string `json:"number"`
	PriceText    string `json:"priceText"`
	Entrance     string `json:"entrance"`
	Floor        string `json:"floor"`
	HouseName    string `json:"houseName"`
	ProjectName  string `json:"projectName"`
	AreaText     string `json:"areaText"`
	RoomsText    string `json:"roomsText"`
}

type RawLayout struct {
	SourceID       string `json:"sourceId"`
	RoomsText      string `json:"roomsText"`
	Title          string `json:"title"`
	Address        string `json:"address"`
	PriceText      string `json:"priceText"`
	AvailableCount int    `json:"availableCount"`
	ThumbnailURL   string `json:"thumbnailUrl"`
	ImageURL       string `json:"imageUrl"`
}

type NormalizedSnapshot struct {
	Snapshot         Snapshot
	House            SnapshotHouse
	Address          string
	ImageURL         string
	Floors           int
	DuplicateRecords int
	Units            []NormalizedUnit
	Layouts          []NormalizedLayout
	PlanMapping      *PlanMappingAudit
	FloorSchemes     []NormalizedFloorScheme
	FloorSchemeAudit *FloorSchemeMappingAudit
}

type NormalizedUnit struct {
	SourceID        string
	PhaseSlug       string
	SourceKey       string
	PropertyType    string
	RawPropertyType string
	Status          string
	RawStatus       string
	Number          string
	Entrance        string
	Floor           int
	HouseName       string
	ProjectName     string
	Area            float64
	Rooms           *int
	Price           *int64
	PricePerM2      *float64
	Currency        string
	PlanImageURL    string
	SourcePayload   json.RawMessage
}

type NormalizedLayout struct {
	SourceID       string
	PhaseSlug      string
	Rooms          *int
	AvailableCount int
	Title          string
	Address        string
	PriceText      string
	ImageURL       string
	ThumbnailURL   string
}

type ImportResult struct {
	SyncRunID         int64 `json:"syncRunId"`
	Files             int   `json:"files"`
	RecordsRead       int   `json:"recordsRead"`
	RecordsSaved      int   `json:"recordsSaved"`
	DuplicatesSkipped int   `json:"duplicatesSkipped"`
}

func LoadDirectory(dir string) ([]NormalizedSnapshot, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return nil, fmt.Errorf("glob snapshots: %w", err)
	}
	sort.Strings(paths)
	if len(paths) == 0 {
		return nil, fmt.Errorf("no KAYAN snapshots found in %s", dir)
	}
	items := make([]NormalizedSnapshot, 0, len(paths))
	for _, path := range paths {
		item, err := LoadFile(path)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func LoadFile(path string) (NormalizedSnapshot, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return NormalizedSnapshot{}, fmt.Errorf("read snapshot %s: %w", path, err)
	}
	var raw Snapshot
	if err := json.Unmarshal(body, &raw); err != nil {
		return NormalizedSnapshot{}, fmt.Errorf("decode snapshot %s: %w", path, err)
	}
	hash := sha256.Sum256(body)
	raw.Path = path
	raw.Checksum = hex.EncodeToString(hash[:])
	result, err := Normalize(raw)
	if err != nil {
		return NormalizedSnapshot{}, err
	}
	if err := loadAndApplyPlanMapping(path, body, &result); err != nil {
		return NormalizedSnapshot{}, err
	}
	if err := loadAndApplyFloorSchemeMapping(path, &result); err != nil {
		return NormalizedSnapshot{}, err
	}
	return result, nil
}

func Normalize(raw Snapshot) (NormalizedSnapshot, error) {
	if raw.SchemaVersion != 1 {
		return NormalizedSnapshot{}, fmt.Errorf("unsupported snapshot schema version %d", raw.SchemaVersion)
	}
	if raw.House.SourceID == "" || raw.House.ProjectSlug == "" || raw.House.PhaseSlug == "" {
		return NormalizedSnapshot{}, errors.New("snapshot house identity is incomplete")
	}
	if len(raw.Records) == 0 {
		return NormalizedSnapshot{}, errors.New("snapshot has no records")
	}
	if raw.CapturedAt.IsZero() {
		return NormalizedSnapshot{}, errors.New("snapshot capturedAt is required")
	}

	result := NormalizedSnapshot{Snapshot: raw, House: raw.House}
	if raw.House.Card != nil {
		result.ImageURL = raw.House.Card.Image
	}
	if len(raw.Layouts) > 0 {
		result.Address = raw.Layouts[0].Address
	}

	seen := make(map[string]string, len(raw.Records))
	result.Units = make([]NormalizedUnit, 0, len(raw.Records))
	for index, record := range raw.Records {
		unit, err := normalizeRecord(raw.House, record)
		if err != nil {
			return NormalizedSnapshot{}, fmt.Errorf("record %d: %w", index+1, err)
		}
		payload := string(unit.SourcePayload)
		if previous, exists := seen[unit.SourceKey]; exists {
			if previous == payload {
				result.DuplicateRecords++
				continue
			}
			return NormalizedSnapshot{}, fmt.Errorf("record %d: conflicting duplicate source key %q", index+1, unit.SourceKey)
		}
		seen[unit.SourceKey] = payload
		if unit.Floor > result.Floors {
			result.Floors = unit.Floor
		}
		result.Units = append(result.Units, unit)
	}

	result.Layouts = make([]NormalizedLayout, 0, len(raw.Layouts))
	for _, layout := range raw.Layouts {
		if layout.SourceID == "" || layout.ImageURL == "" {
			continue
		}
		result.Layouts = append(result.Layouts, NormalizedLayout{
			SourceID: layout.SourceID, Rooms: parseOptionalInt(layout.RoomsText),
			AvailableCount: layout.AvailableCount, Title: layout.Title,
			Address: layout.Address, PriceText: layout.PriceText,
			ImageURL: layout.ImageURL, ThumbnailURL: layout.ThumbnailURL,
		})
	}
	return result, nil
}

func normalizeRecord(house SnapshotHouse, record RawRecord) (NormalizedUnit, error) {
	if strings.TrimSpace(record.Number) == "" {
		return NormalizedUnit{}, errors.New("unit number is empty")
	}
	area, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(record.AreaText), ",", "."), 64)
	if err != nil || area <= 0 {
		return NormalizedUnit{}, fmt.Errorf("invalid area %q", record.AreaText)
	}
	floor, err := strconv.Atoi(strings.TrimSpace(record.Floor))
	if err != nil {
		return NormalizedUnit{}, fmt.Errorf("invalid floor %q", record.Floor)
	}
	price := parsePrice(record.PriceText)
	var pricePerM2 *float64
	if price != nil && area > 0 {
		value := float64(*price) / area
		pricePerM2 = &value
	}
	payload, err := json.Marshal(record)
	if err != nil {
		return NormalizedUnit{}, fmt.Errorf("encode source payload: %w", err)
	}
	propertyType := normalizePropertyType(record.PropertyType)
	sourceKey := strings.Join([]string{
		cleanKey(house.SourceID), cleanKey(propertyType), cleanKey(record.Entrance),
		cleanKey(record.Floor), cleanKey(record.Number),
	}, ":")
	return NormalizedUnit{
		SourceKey: sourceKey, PhaseSlug: house.PhaseSlug, PropertyType: propertyType, RawPropertyType: record.PropertyType,
		Status: normalizeStatus(record.RawStatus), RawStatus: record.RawStatus,
		Number: strings.TrimSpace(record.Number), Entrance: strings.TrimSpace(record.Entrance),
		Floor: floor, HouseName: strings.TrimSpace(record.HouseName), ProjectName: strings.TrimSpace(record.ProjectName), Area: area,
		Rooms: parseOptionalInt(record.RoomsText), Price: price, PricePerM2: pricePerM2,
		Currency: "UZS", SourcePayload: payload,
	}, nil
}

func normalizeStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "свободно":
		return "available"
	case "бронь", "договор составлен", "договор согласован":
		return "reserved"
	case "продано":
		return "sold"
	default:
		return "unavailable"
	}
}

func normalizePropertyType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "квартира":
		return "apartment"
	case "машиноместо", "паркинг":
		return "parking"
	case "коммерческое помещение", "коммерция", "офис":
		return "commercial"
	case "кладовая", "кладовка":
		return "storage"
	default:
		return "other"
	}
}

var integerPrefix = regexp.MustCompile(`^-?\d+`)

func parseOptionalInt(value string) *int {
	match := integerPrefix.FindString(strings.TrimSpace(value))
	if match == "" {
		return nil
	}
	parsed, err := strconv.Atoi(match)
	if err != nil {
		return nil
	}
	return &parsed
}

func parsePrice(value string) *int64 {
	if !strings.Contains(strings.ToLower(value), "сум") {
		return nil
	}
	digits := strings.Map(func(r rune) rune {
		if unicode.IsDigit(r) {
			return r
		}
		return -1
	}, value)
	if digits == "" {
		return nil
	}
	parsed, err := strconv.ParseInt(digits, 10, 64)
	if err != nil {
		return nil
	}
	return &parsed
}

func cleanKey(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.Join(strings.Fields(value), "-")
	return strings.ReplaceAll(value, ":", "-")
}

func ImportDirectory(ctx context.Context, pool *pgxpool.Pool, dir string) (ImportResult, error) {
	snapshots, err := LoadDirectory(dir)
	if err != nil {
		return ImportResult{}, err
	}
	result := ImportResult{Files: len(snapshots)}
	for _, snapshot := range snapshots {
		result.RecordsRead += len(snapshot.Snapshot.Records)
		result.DuplicatesSkipped += snapshot.DuplicateRecords
	}

	err = pool.QueryRow(ctx, `INSERT INTO sync_runs(source,status,records_read) VALUES($1,'running',$2) RETURNING id`, KayanSource, result.RecordsRead).Scan(&result.SyncRunID)
	if err != nil {
		return ImportResult{}, fmt.Errorf("start sync run: %w", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return failRun(ctx, pool, result, fmt.Errorf("begin import: %w", err))
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	var developerID int64
	if err := tx.QueryRow(ctx, `
        INSERT INTO developers(slug,name) VALUES('kayan','KAYAN')
        ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name, updated_at=now()
        RETURNING id`).Scan(&developerID); err != nil {
		return failRun(ctx, pool, result, fmt.Errorf("upsert developer: %w", err))
	}

	projectIDs := make(map[string]int64)
	for _, snapshot := range snapshots {
		projectID, ok := projectIDs[snapshot.House.ProjectSlug]
		if !ok {
			if err := tx.QueryRow(ctx, `
                INSERT INTO projects(developer_id,slug,name) VALUES($1,$2,$3)
                ON CONFLICT(developer_id,slug) DO UPDATE SET name=EXCLUDED.name, updated_at=now()
                RETURNING id`, developerID, snapshot.House.ProjectSlug, snapshot.House.ProjectName).Scan(&projectID); err != nil {
				return failRun(ctx, pool, result, fmt.Errorf("upsert project %s: %w", snapshot.House.ProjectSlug, err))
			}
			projectIDs[snapshot.House.ProjectSlug] = projectID
		}

		var phaseID int64
		if err := tx.QueryRow(ctx, `
            INSERT INTO phases(project_id,source_id,slug,name,property_type,sort_order,address,image_url,floors_total,source_updated_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT(project_id,slug) DO UPDATE SET
              source_id=EXCLUDED.source_id, name=EXCLUDED.name, property_type=EXCLUDED.property_type,
              sort_order=EXCLUDED.sort_order,
              address=EXCLUDED.address, image_url=EXCLUDED.image_url, floors_total=EXCLUDED.floors_total,
              source_updated_at=EXCLUDED.source_updated_at, updated_at=now()
            RETURNING id`, projectID, snapshot.House.SourceID, snapshot.House.PhaseSlug,
			snapshot.House.PhaseName, snapshot.House.PropertyType, phaseSortOrder(snapshot.House.PhaseSlug), snapshot.Address,
			snapshot.ImageURL, snapshot.Floors, snapshot.Snapshot.CapturedAt).Scan(&phaseID); err != nil {
			return failRun(ctx, pool, result, fmt.Errorf("upsert phase %s: %w", snapshot.House.PhaseSlug, err))
		}

		if _, err := tx.Exec(ctx, `UPDATE units SET is_active=false, updated_at=now() WHERE phase_id=$1`, phaseID); err != nil {
			return failRun(ctx, pool, result, fmt.Errorf("deactivate phase units: %w", err))
		}
		for _, unit := range snapshot.Units {
			if err := upsertUnit(ctx, tx, phaseID, snapshot.Snapshot.CapturedAt, unit); err != nil {
				return failRun(ctx, pool, result, fmt.Errorf("upsert unit %s: %w", unit.SourceKey, err))
			}
			result.RecordsSaved++
		}
		if err := persistFloorSchemeArtifact(ctx, tx, projectID, phaseID, snapshot); err != nil {
			return failRun(ctx, pool, result, fmt.Errorf("persist floor-scheme artifact for %s: %w", snapshot.House.ProjectSlug, err))
		}

		if _, err := tx.Exec(ctx, `DELETE FROM layouts WHERE phase_id=$1`, phaseID); err != nil {
			return failRun(ctx, pool, result, fmt.Errorf("replace phase layouts: %w", err))
		}
		for _, layout := range snapshot.Layouts {
			if _, err := tx.Exec(ctx, `
                INSERT INTO layouts(phase_id,source_id,rooms,available_count,title,address,price_text,image_url,thumbnail_url,source_updated_at)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
				phaseID, layout.SourceID, layout.Rooms, layout.AvailableCount, layout.Title,
				layout.Address, layout.PriceText, layout.ImageURL, layout.ThumbnailURL,
				snapshot.Snapshot.CapturedAt); err != nil {
				return failRun(ctx, pool, result, fmt.Errorf("insert layout %s: %w", layout.SourceID, err))
			}
		}

		if _, err := tx.Exec(ctx, `
            INSERT INTO source_snapshots(sync_run_id,source,source_id,path,checksum_sha256,record_count,captured_at)
            VALUES($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT(source,source_id,checksum_sha256) DO NOTHING`,
			result.SyncRunID, KayanSource, snapshot.House.SourceID, filepath.Base(snapshot.Snapshot.Path),
			snapshot.Snapshot.Checksum, len(snapshot.Units), snapshot.Snapshot.CapturedAt); err != nil {
			return failRun(ctx, pool, result, fmt.Errorf("record source snapshot: %w", err))
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return failRun(ctx, pool, result, fmt.Errorf("commit import: %w", err))
	}
	if _, err := pool.Exec(ctx, `UPDATE sync_runs SET status='succeeded',finished_at=now(),records_saved=$2 WHERE id=$1`, result.SyncRunID, result.RecordsSaved); err != nil {
		return result, fmt.Errorf("finish sync run: %w", err)
	}
	return result, nil
}

func phaseSortOrder(slug string) int {
	switch slug {
	case "main", "phase-1":
		return 10
	case "phase-2":
		return 20
	case "parking":
		return 90
	default:
		return 50
	}
}

const upsertUnitSQL = `
        INSERT INTO units(
          phase_id,source_key,source_id,property_type,raw_property_type,status,raw_status,number,entrance,
          floor,house_name,area,rooms,price,price_per_m2,currency,plan_image_url,is_active,
          source_payload,source_updated_at
        ) VALUES($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true,$18::jsonb,$19)
        ON CONFLICT(phase_id,source_key) DO UPDATE SET
          source_id=COALESCE(EXCLUDED.source_id,units.source_id),
          property_type=EXCLUDED.property_type, raw_property_type=EXCLUDED.raw_property_type,
          status=EXCLUDED.status, raw_status=EXCLUDED.raw_status, number=EXCLUDED.number,
          entrance=EXCLUDED.entrance, floor=EXCLUDED.floor, house_name=EXCLUDED.house_name,
          area=EXCLUDED.area, rooms=EXCLUDED.rooms, price=EXCLUDED.price,
          price_per_m2=EXCLUDED.price_per_m2, currency=EXCLUDED.currency,
          plan_image_url=COALESCE(NULLIF(EXCLUDED.plan_image_url,''),units.plan_image_url), is_active=true,
          source_payload=EXCLUDED.source_payload, source_updated_at=EXCLUDED.source_updated_at,
          updated_at=now()`

func upsertUnit(ctx context.Context, tx pgx.Tx, phaseID int64, observedAt time.Time, unit NormalizedUnit) error {
	var existingID int64
	var oldStatus string
	var oldPrice sql.NullInt64
	err := tx.QueryRow(ctx, `SELECT id,status,price FROM units WHERE phase_id=$1 AND source_key=$2`, phaseID, unit.SourceKey).Scan(&existingID, &oldStatus, &oldPrice)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err == nil {
		if oldStatus != unit.Status {
			if _, err := tx.Exec(ctx, `INSERT INTO unit_status_history(unit_id,old_status,new_status,observed_at) VALUES($1,$2,$3,$4)`, existingID, oldStatus, unit.Status, observedAt); err != nil {
				return err
			}
		}
		priceChanged := oldPrice.Valid != (unit.Price != nil) || (oldPrice.Valid && unit.Price != nil && oldPrice.Int64 != *unit.Price)
		if priceChanged {
			var old any
			if oldPrice.Valid {
				old = oldPrice.Int64
			}
			if _, err := tx.Exec(ctx, `INSERT INTO unit_price_history(unit_id,old_price,new_price,currency,observed_at) VALUES($1,$2,$3,$4,$5)`, existingID, old, unit.Price, unit.Currency, observedAt); err != nil {
				return err
			}
		}
	}

	_, err = tx.Exec(ctx, upsertUnitSQL,
		phaseID, unit.SourceKey, unit.SourceID, unit.PropertyType, unit.RawPropertyType, unit.Status,
		unit.RawStatus, unit.Number, unit.Entrance, unit.Floor, unit.HouseName, unit.Area,
		unit.Rooms, unit.Price, unit.PricePerM2, unit.Currency, unit.PlanImageURL,
		string(unit.SourcePayload), observedAt,
	)
	return err
}

func failRun(ctx context.Context, pool *pgxpool.Pool, result ImportResult, cause error) (ImportResult, error) {
	_, _ = pool.Exec(ctx, `UPDATE sync_runs SET status='failed',finished_at=now(),records_saved=$2,error=$3 WHERE id=$1`, result.SyncRunID, result.RecordsSaved, cause.Error())
	return result, cause
}
