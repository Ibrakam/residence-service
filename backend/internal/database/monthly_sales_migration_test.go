package database

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMonthlySalesMigrationStartsForwardOnlyApartmentLedger(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("..", "..", "migrations", "0018_monthly_unit_sales.sql"))
	if err != nil {
		t.Fatal(err)
	}
	sql := string(body)
	for _, required := range []string{
		"CREATE TABLE IF NOT EXISTS unit_sales_tracking_state",
		"tracking_started_at timestamptz NOT NULL",
		"CREATE TABLE IF NOT EXISTS unit_sale_events",
		"unit_id bigint NOT NULL UNIQUE",
		"sold_observed_at timestamptz NOT NULL",
		"SECURITY DEFINER",
		"SET search_path = pg_catalog, public",
		"AFTER INSERT ON unit_status_history",
		"NEW.new_status = 'sold'",
		"NEW.old_status <> 'sold'",
		"unit.property_type = 'apartment'",
		"NEW.observed_at >= tracking.tracking_started_at",
		"ON CONFLICT (unit_id) DO NOTHING",
		"AT TIME ZONE 'Asia/Tashkent'",
	} {
		if !strings.Contains(sql, required) {
			t.Errorf("sales migration is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"FROM unit_status_history AS history",
		"FROM unit_status_history history",
		"INSERT INTO unit_sale_events SELECT",
	} {
		if strings.Contains(sql, forbidden) {
			t.Errorf("sales migration performs unsafe historical backfill via %q", forbidden)
		}
	}
}

func TestKnownSalesMigrationPersistsExplicitLifetimeFacts(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("..", "..", "migrations", "0019_known_unit_sales.sql"))
	if err != nil {
		t.Fatal(err)
	}
	sql := string(body)
	for _, required := range []string{
		"CREATE TABLE IF NOT EXISTS unit_sold_facts",
		"unit_id bigint PRIMARY KEY",
		"evidence_kind IN ('baseline_status', 'status_transition')",
		"unit.status = 'sold'",
		"ON CONFLICT (unit_id) DO NOTHING",
		"AFTER INSERT OR UPDATE OF status, property_type, phase_id, source_updated_at ON units",
		"NEW.property_type = 'apartment'",
		"NEW.status = 'sold'",
		"SECURITY DEFINER",
		"SET search_path = pg_catalog, public",
	} {
		if !strings.Contains(sql, required) {
			t.Errorf("known-sales migration is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"is_active = false",
		"is_active=false",
		"new_status = 'unavailable'",
	} {
		if strings.Contains(sql, forbidden) {
			t.Errorf("known-sales migration infers a sale from disappearance via %q", forbidden)
		}
	}
}
