package importer

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/database"
)

func TestPublishedOffersScopeDoesNotClaimCompleteInventory(t *testing.T) {
	for _, test := range []struct {
		name, scope, units string
		count              int
		fail               bool
	}{
		{"counted offers", PublishedOffersScope, `[{"id":"42","phaseSlug":"block-a","number":"1","area":45}]`, 1, false},
		{"verified empty listing", PublishedOffersScope, `[]`, 0, false},
		{"empty complete catalog", "", `[]`, 0, true},
		{"empty without declared zero", PublishedOffersScope, `[]`, 1, true},
		{"missing physical phase", PublishedOffersScope, `[{"id":"42","number":"1","area":45}]`, 1, true},
		{"unknown scope", "typical-plans", `[]`, 0, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "test-catalog.json")
			body := fmt.Sprintf(`{"projectSlug":"test","capturedAt":"2026-11-24T08:00:00Z","catalogScope":%q,"officialCount":%d,"units":%s}`, test.scope, test.count, test.units)
			if err := os.WriteFile(path, []byte(body), 0600); err != nil {
				t.Fatal(err)
			}
			bundle, err := LoadCatalogFile(path)
			if test.fail {
				if err == nil {
					t.Fatal("unsafe listing accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(bundle.Projects[0].Units) > 0 && (!bundle.Projects[0].Units[0].PreserveStatus || bundle.Projects[0].Units[0].Status != "unknown") {
				t.Fatal("statusless published card fabricated availability")
			}
			if bundle.Projects[0].Complete || bundle.Projects[0].CatalogScope != PublishedOffersScope {
				t.Fatal("public listing claimed complete inventory")
			}
		})
	}
}

func TestNormalizedUnitPricesUsesOnlyPositiveEvidence(t *testing.T) {
	pi := func(v int64) *int64 { return &v }
	pf := func(v float64) *float64 { return &v }
	for _, test := range []struct {
		name  string
		unit  NormalizedUnit
		total int64
		perM2 float64
	}{
		{"absent", NormalizedUnit{Area: 50}, 0, 0},
		{"zero and negative", NormalizedUnit{Area: 50, Price: pi(0), PricePerM2: pf(-1)}, 0, 0},
		{"nan", NormalizedUnit{Area: 50, PricePerM2: pf(math.NaN())}, 0, 0},
		{"infinity", NormalizedUnit{Area: 50, PricePerM2: pf(math.Inf(1))}, 0, 0},
		{"total derives per metre", NormalizedUnit{Area: 50, Price: pi(100000)}, 100000, 2000},
		{"per metre derives total", NormalizedUnit{Area: 50, PricePerM2: pf(2400)}, 120000, 2400},
		{"negative total uses valid per metre", NormalizedUnit{Area: 50, Price: pi(-9), PricePerM2: pf(2400)}, 120000, 2400},
		{"unrepresentable total", NormalizedUnit{Area: 50, PricePerM2: pf(math.MaxFloat64)}, 0, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := normalizedUnitPrices(test.unit)
			if test.total == 0 {
				if got.Price != nil {
					t.Fatalf("unexpected total %d", *got.Price)
				}
			} else if got.Price == nil || *got.Price != test.total {
				t.Fatalf("total=%v", got.Price)
			}
			if test.perM2 == 0 {
				if got.PricePerM2 != nil {
					t.Fatalf("unexpected per metre %f", *got.PricePerM2)
				}
			} else if got.PricePerM2 == nil || *got.PricePerM2 != test.perM2 {
				t.Fatalf("per metre=%v", got.PricePerM2)
			}
		})
	}
}

func TestPostgresPublishedOverlayPreservesInventoryAndLastPrices(t *testing.T) {
	databaseURL := os.Getenv("FLOOR_SCHEME_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set FLOOR_SCHEME_TEST_DATABASE_URL for isolated PostgreSQL regression")
	}
	ctx := t.Context()
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool, filepath.Join("..", "..", "migrations")); err != nil {
		t.Fatal(err)
	}
	slug := fmt.Sprintf("overlay-%d", time.Now().UnixNano())
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM projects WHERE slug=$1`, slug)
		_, _ = pool.Exec(context.Background(), `DELETE FROM developers WHERE slug=$1`, slug)
		_, _ = pool.Exec(context.Background(), `DELETE FROM sync_runs WHERE source=$1`, slug)
	}()
	observed := time.Now().UTC().Truncate(time.Second)
	unit := func(id, phase, status string, price int64) NormalizedUnit {
		u := NormalizedUnit{SourceID: id, SourceKey: id, PhaseSlug: phase, PropertyType: "apartment", RawPropertyType: "Квартира", Status: status, RawStatus: status, Number: id, Area: 50, Currency: "USD", SourcePayload: json.RawMessage(`{"floor":3,"status":"` + status + `"}`), Floor: 3, PlanImageURL: "/old-plan.webp"}
		if price > 0 {
			u.Price = &price
		}
		return u
	}
	count := 3
	project := CatalogProject{DeveloperSlug: slug, DeveloperName: slug, Slug: slug, Name: slug, CapturedAt: observed, Complete: true, OfficialCount: &count, QueueMetadataPresent: true,
		Queues:  []CatalogQueue{{SourceID: "q1", Key: "q1", Label: "I", DisplayCode: "I", SortOrder: 10}, {SourceID: "q2", Key: "q2", Label: "II", DisplayCode: "II", SortOrder: 20}},
		Phases:  []CatalogPhase{{SourceID: "p1", Slug: "p1", Name: "Block A", PropertyType: "apartment", Address: "Old address", ImageURL: "/building.webp", FloorsTotal: 9, QueueKey: "q1"}, {SourceID: "p2", Slug: "p2", Name: "Block B", PropertyType: "apartment", QueueKey: "q2"}},
		Units:   []NormalizedUnit{unit("u1", "p1", "reserved", 100000), unit("u2", "p2", "available", 200000), unit("u3", "p2", "sold", 300000)},
		Layouts: []NormalizedLayout{{SourceID: "l1", PhaseSlug: "p1", PriceText: "100000 USD", ImageURL: "/l1.webp"}, {SourceID: "l2", PhaseSlug: "p2", PriceText: "200000 USD", ImageURL: "/l2.webp"}},
	}
	apply := func(p CatalogProject, overlay bool) {
		t.Helper()
		body, _ := json.Marshal(p)
		_, err := ImportPreparedCatalog(ctx, pool, PreparedCatalogImport{Bundles: []CatalogBundle{{Path: "synthetic-catalog.json", Checksum: fmt.Sprintf("%x", sha256.Sum256(body)), Projects: []CatalogProject{p}}}}, CatalogImportOptions{Source: slug, Overlay: overlay})
		if err != nil {
			t.Fatal(err)
		}
	}
	apply(project, false)
	project.CatalogScope = PublishedOffersScope
	project.Complete = false
	project.CapturedAt = observed.Add(time.Minute)
	count = 2
	project.OfficialCount = &count
	project.Queues = project.Queues[:1]
	project.Phases = project.Phases[:1]
	project.Phases[0].Address = ""
	project.Phases[0].ImageURL = ""
	project.Phases[0].FloorsTotal = 0
	existing := unit("u1", "p1", "available", 0)
	existing.Currency = "UZS"
	existing.SourceKey = "new-public-key"
	existing.SourcePayload = json.RawMessage(`{}`)
	existing.Floor = 0
	existing.PlanImageURL = ""
	newOffer := unit("u4", "p1", "available", 80000)
	newOffer.SourcePayload = json.RawMessage(`{}`)
	newOffer.PreserveStatus = true
	project.Units = []NormalizedUnit{existing, newOffer}
	project.Layouts = project.Layouts[:1]
	project.Layouts[0].PriceText = ""
	apply(project, true)
	var active, queues, layouts, histories int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM units u JOIN phases p ON p.id=u.phase_id JOIN projects pr ON pr.id=p.project_id WHERE pr.slug=$1 AND u.is_active`, slug).Scan(&active); err != nil {
		t.Fatal(err)
	}
	var newStatus string
	if err := pool.QueryRow(ctx, `SELECT u.status FROM units u JOIN phases ph ON ph.id=u.phase_id JOIN projects p ON p.id=ph.project_id WHERE p.slug=$1 AND u.source_id='u4'`, slug).Scan(&newStatus); err != nil {
		t.Fatal(err)
	}
	if newStatus != "unknown" {
		t.Fatalf("new statusless public offer falsely marked %s", newStatus)
	}
	if active != 4 {
		t.Fatalf("unseen inventory lost or new verified offer missing: active=%d", active)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM project_queues q JOIN projects p ON p.id=q.project_id WHERE p.slug=$1`, slug).Scan(&queues); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM layouts l JOIN phases p ON p.id=l.phase_id JOIN projects pr ON pr.id=p.project_id WHERE pr.slug=$1`, slug).Scan(&layouts); err != nil {
		t.Fatal(err)
	}
	if queues != 2 || layouts != 2 {
		t.Fatalf("partial metadata destroyed queues/layouts: %d/%d", queues, layouts)
	}
	var total int64
	var perM2 float64
	var currency, status, plan, address, image, priceText string
	var floor, floors int
	check := func(wantTotal int64, wantPerM2 float64, wantHistory int) {
		t.Helper()
		if err := pool.QueryRow(ctx, `SELECT u.price,u.price_per_m2,u.currency,u.status,u.plan_image_url,u.floor,p.address,p.image_url,p.floors_total FROM units u JOIN phases p ON p.id=u.phase_id JOIN projects pr ON pr.id=p.project_id WHERE pr.slug=$1 AND u.source_id='u1'`, slug).Scan(&total, &perM2, &currency, &status, &plan, &floor, &address, &image, &floors); err != nil {
			t.Fatal(err)
		}
		if total != wantTotal || perM2 != wantPerM2 || currency != "USD" || status != "reserved" || plan != "/old-plan.webp" || floor != 3 || address != "Old address" || image != "/building.webp" || floors != 9 {
			t.Fatalf("lost existing data: total=%d perM2=%f currency=%s status=%s plan=%s floor=%d address=%s image=%s floors=%d", total, perM2, currency, status, plan, floor, address, image, floors)
		}
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM unit_price_history h JOIN units u ON u.id=h.unit_id JOIN phases p ON p.id=u.phase_id JOIN projects pr ON pr.id=p.project_id WHERE pr.slug=$1`, slug).Scan(&histories); err != nil {
			t.Fatal(err)
		}
		if histories != wantHistory {
			t.Fatalf("spurious or missing price history=%d want=%d", histories, wantHistory)
		}
	}
	check(100000, 2000, 0)
	if err := pool.QueryRow(ctx, `SELECT price_text FROM layouts l JOIN phases p ON p.id=l.phase_id JOIN projects pr ON pr.id=p.project_id WHERE pr.slug=$1 AND l.source_id='l1'`, slug).Scan(&priceText); err != nil {
		t.Fatal(err)
	}
	if priceText != "100000 USD" {
		t.Fatal("layout price cleared")
	}
	empty := project
	zero := 0
	empty.OfficialCount = &zero
	empty.Units = nil
	empty.Queues = nil
	empty.Phases = nil
	empty.Layouts = nil
	empty.CapturedAt = observed.Add(2 * time.Minute)
	apply(empty, true)
	check(100000, 2000, 0)
	price := int64(120000)
	project.CapturedAt = observed.Add(3 * time.Minute)
	project.Units = project.Units[:1]
	one := 1
	project.OfficialCount = &one
	project.Units[0].Price = &price
	project.Units[0].Currency = ""
	apply(project, true)
	check(120000, 2400, 1)
	apply(project, true)
	check(120000, 2400, 1)
	invalid := int64(0)
	project.CapturedAt = observed.Add(4 * time.Minute)
	project.Units[0].Price = &invalid
	apply(project, true)
	check(120000, 2400, 1)
	// The legacy importer uses the same preservation policy without overlay mode.
	var phaseID int64
	if err := pool.QueryRow(ctx, `SELECT ph.id FROM phases ph JOIN projects p ON p.id=ph.project_id WHERE p.slug=$1 AND ph.source_id='p1'`, slug).Scan(&phaseID); err != nil {
		t.Fatal(err)
	}
	legacy := unit("u1", "p1", "reserved", 0)
	legacy.SourceKey = "new-public-key"
	legacy.Currency = "UZS"
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := upsertUnit(ctx, tx, phaseID, observed.Add(5*time.Minute), legacy); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	check(120000, 2400, 1)
	// Exercise the ON CONFLICT fallback separately: even a concurrent insert
	// losing its race must not clear the accepted monetary fields.
	if _, err := pool.Exec(ctx, upsertUnitSQL, phaseID, legacy.SourceKey, legacy.SourceID, legacy.PropertyType, legacy.RawPropertyType, "unknown", "", legacy.Number, legacy.Entrance, legacy.Floor, legacy.HouseName, legacy.Area, legacy.Rooms, nil, nil, "UZS", legacy.PlanImageURL, legacy.RepairIncluded, string(legacy.SourcePayload), observed.Add(6*time.Minute), true, ""); err != nil {
		t.Fatal(err)
	}
	check(120000, 2400, 1)
	// Crossed source-key/source-id matches reject the complete transaction.
	ambiguous := unit("u1", "p1", "available", 999000)
	ambiguous.SourceKey = "u4"
	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := upsertUnit(ctx, tx, phaseID, observed.Add(7*time.Minute), ambiguous); err == nil {
		_ = tx.Rollback(ctx)
		t.Fatal("ambiguous unit identity accepted")
	}
	_ = tx.Rollback(ctx)
	check(120000, 2400, 1)

}
