package database

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUnitRepairMigrationKeepsUnknownNullable(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("..", "..", "migrations", "0021_unit_repair_included.sql"))
	if err != nil {
		t.Fatal(err)
	}
	migration := string(body)
	for _, fragment := range []string{
		"ADD COLUMN IF NOT EXISTS repair_included boolean",
		"NULL = provider does not expose it",
	} {
		if !strings.Contains(migration, fragment) {
			t.Fatalf("repair migration is missing %q", fragment)
		}
	}
	if strings.Contains(strings.ToUpper(migration), "NOT NULL") || strings.Contains(strings.ToUpper(migration), "DEFAULT FALSE") {
		t.Fatal("repair_included must remain nullable; unknown must not become without repair")
	}
}
