package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/database"
	"github.com/tencorp/real-estate-platform/backend/internal/domain"
	"github.com/tencorp/real-estate-platform/backend/internal/httpapi"
)

func TestExplicitSoldTransitionProducesIdempotentMonthlySale(t *testing.T) {
	databaseURL := os.Getenv("FLOOR_SCHEME_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set FLOOR_SCHEME_TEST_DATABASE_URL to run the PostgreSQL sales-history test")
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
	var trackingStartedAt time.Time
	if err := pool.QueryRow(ctx, `
		SELECT tracking_started_at
		FROM unit_sales_tracking_state
		WHERE singleton=true`).Scan(&trackingStartedAt); err != nil {
		t.Fatal(err)
	}

	suffix := time.Now().UnixNano()
	developerSlug := fmt.Sprintf("sales-history-%d", suffix)
	projectSlug := fmt.Sprintf("sales-history-project-%d", suffix)
	var developerID, projectID, phaseID int64
	if err := pool.QueryRow(ctx, `INSERT INTO developers(slug,name) VALUES($1,$2) RETURNING id`, developerSlug, "Sales fixture").Scan(&developerID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM unit_sale_events WHERE project_id=$1`, projectID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM projects WHERE id=$1`, projectID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM developers WHERE id=$1`, developerID)
	}()
	if err := pool.QueryRow(ctx, `INSERT INTO projects(developer_id,slug,name) VALUES($1,$2,$3) RETURNING id`, developerID, projectSlug, "Sales fixture").Scan(&projectID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO phases(project_id,source_id,slug,name,property_type)
		VALUES($1,'main','main','Main','apartment') RETURNING id`, projectID).Scan(&phaseID); err != nil {
		t.Fatal(err)
	}

	upsert := func(sourceID, propertyType, status string, observedAt time.Time) int64 {
		t.Helper()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(context.Background()) }()
		if err := upsertUnit(ctx, tx, phaseID, observedAt, NormalizedUnit{
			SourceID: sourceID, SourceKey: sourceID, PhaseSlug: "main",
			PropertyType: propertyType, RawPropertyType: propertyType,
			Status: status, RawStatus: status, Number: sourceID, Area: 50,
			Currency: "UZS", SourcePayload: json.RawMessage(`{}`),
		}); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		var unitID int64
		if err := pool.QueryRow(ctx, `SELECT id FROM units WHERE phase_id=$1 AND source_id=$2`, phaseID, sourceID).Scan(&unitID); err != nil {
			t.Fatal(err)
		}
		return unitID
	}

	tashkent := time.FixedZone("Asia/Tashkent", 5*60*60)
	trackingLocal := trackingStartedAt.In(tashkent)
	soldAt := time.Date(trackingLocal.Year(), trackingLocal.Month()+1, 1, 0, 30, 0, 0, tashkent).UTC()
	initialAt := soldAt.Add(-time.Hour)
	unitID := upsert("apartment-1", "apartment", "available", initialAt)
	upsert("apartment-1", "apartment", "sold", soldAt)
	upsert("apartment-1", "apartment", "sold", soldAt.Add(time.Minute))
	upsert("apartment-1", "apartment", "available", soldAt.AddDate(0, 1, 0))
	upsert("apartment-1", "apartment", "sold", soldAt.AddDate(0, 1, 1))

	// A unit first observed as sold is a baseline state, not a fabricated sale.
	baselineSoldID := upsert("apartment-baseline-sold", "apartment", "sold", soldAt)
	// A replay accepted after migration but carrying a pre-cutover source time
	// is outside the trustworthy reporting window.
	replayedID := upsert("apartment-replayed", "apartment", "available", trackingStartedAt.Add(-2*time.Hour))
	upsert("apartment-replayed", "apartment", "sold", trackingStartedAt.Add(-time.Hour))
	// Disappearance from an available-only feed is ambiguous and must remain a
	// deactivation, not a sale.
	disappearedID := upsert("apartment-disappeared", "apartment", "available", initialAt)
	if _, err := pool.Exec(ctx, `UPDATE units SET is_active=false WHERE id=$1`, disappearedID); err != nil {
		t.Fatal(err)
	}
	// The metric is intentionally apartment-only.
	upsert("parking-1", "parking", "available", initialAt)
	parkingID := upsert("parking-1", "parking", "sold", soldAt)

	var eventCount int
	var storedSoldAt time.Time
	if err := pool.QueryRow(ctx, `
		SELECT count(*), min(sold_observed_at)
		FROM unit_sale_events
		WHERE unit_id=$1`, unitID).Scan(&eventCount, &storedSoldAt); err != nil {
		t.Fatal(err)
	}
	if eventCount != 1 || !storedSoldAt.Equal(soldAt) {
		t.Fatalf("sale events=(%d,%s), want one event at %s", eventCount, storedSoldAt, soldAt)
	}
	for _, id := range []int64{baselineSoldID, replayedID, disappearedID, parkingID} {
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM unit_sale_events WHERE unit_id=$1`, id).Scan(&eventCount); err != nil {
			t.Fatal(err)
		}
		if eventCount != 0 {
			t.Fatalf("unit %d produced %d fabricated sale events", id, eventCount)
		}
	}

	expectedMonth := soldAt.In(tashkent).Format("2006-01")
	fromMonth, err := time.Parse("2006-01", expectedMonth)
	if err != nil {
		t.Fatal(err)
	}
	toMonth := fromMonth.AddDate(0, 1, 0)
	store := database.NewStore(pool)
	report, err := store.MonthlyUnitSales(ctx, domain.MonthlyUnitSalesFilter{
		ProjectSlug: projectSlug, FromMonth: &fromMonth, ToMonthExclusive: &toMonth,
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.TrackingStartedAt.IsZero() || report.Timezone != "Asia/Tashkent" {
		t.Fatalf("monthly sales metadata = %#v", report)
	}
	if len(report.Items) != 1 || report.Items[0].Month != expectedMonth || report.Items[0].PropertyType != "apartment" || report.Items[0].SoldUnits != 1 {
		t.Fatalf("monthly apartment sales = %#v", report.Items)
	}

	server := httptest.NewServer(httpapi.New(store, slog.New(slog.NewTextHandler(io.Discard, nil)), ""))
	defer server.Close()
	response, err := http.Get(server.URL + "/v1/analytics/monthly-sales?project=" + projectSlug + "&fromMonth=" + expectedMonth + "&toMonth=" + expectedMonth) //nolint:gosec
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Cache-Control") != "no-store, max-age=0" {
		t.Fatalf("monthly sales HTTP status/cache=%d/%q", response.StatusCode, response.Header.Get("Cache-Control"))
	}
	var apiReport domain.MonthlyUnitSalesReport
	if err := json.NewDecoder(response.Body).Decode(&apiReport); err != nil {
		t.Fatal(err)
	}
	if !apiReport.TrackingStartedAt.Equal(report.TrackingStartedAt) || len(apiReport.Items) != 1 || apiReport.Items[0].SoldUnits != 1 {
		t.Fatalf("monthly sales API report = %#v", apiReport)
	}
}
