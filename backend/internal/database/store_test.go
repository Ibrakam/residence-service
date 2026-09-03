package database

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

type resolverFixtureUnit struct {
	id        int64
	projectID int64
	sourceID  string
	sourceKey string
	number    string
	active    bool
}

type resolverFixtureQuery struct {
	units []resolverFixtureUnit
}

type resolverFixtureRow struct {
	values []any
	err    error
}

func (row resolverFixtureRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(dest) != len(row.values) {
		return fmt.Errorf("fixture scan destinations=%d, values=%d", len(dest), len(row.values))
	}
	for index, value := range row.values {
		switch target := dest[index].(type) {
		case *int64:
			typed, ok := value.(int64)
			if !ok {
				return fmt.Errorf("fixture value %d is %T, want int64", index, value)
			}
			*target = typed
		case *bool:
			typed, ok := value.(bool)
			if !ok {
				return fmt.Errorf("fixture value %d is %T, want bool", index, value)
			}
			*target = typed
		default:
			return fmt.Errorf("unsupported fixture scan destination %T", target)
		}
	}
	return nil
}

func (query *resolverFixtureQuery) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, " OR ") || strings.Contains(sql, "source_id=$2 OR") || strings.Contains(sql, "source_key=$2 OR") {
		return resolverFixtureRow{err: errors.New("resolver combined identity namespaces")}
	}
	isProjectLookup := strings.Contains(sql, "ph.project_id=$1")
	isGlobalLookup := strings.Contains(sql, "SELECT EXISTS")
	if !isProjectLookup && !isGlobalLookup {
		return resolverFixtureRow{err: errors.New("unexpected resolver query")}
	}
	valueIndex := 0
	var projectID int64
	if isProjectLookup {
		if len(args) != 2 {
			return resolverFixtureRow{err: fmt.Errorf("project lookup args=%d", len(args))}
		}
		var ok bool
		projectID, ok = args[0].(int64)
		if !ok {
			return resolverFixtureRow{err: fmt.Errorf("project id has type %T", args[0])}
		}
		valueIndex = 1
	} else if len(args) != 1 {
		return resolverFixtureRow{err: fmt.Errorf("global lookup args=%d", len(args))}
	}

	matches := make([]int64, 0, 2)
	for _, unit := range query.units {
		if !unit.active || isProjectLookup && unit.projectID != projectID {
			continue
		}
		matched := false
		switch {
		case strings.Contains(sql, "u.source_key=$"):
			value, ok := args[valueIndex].(string)
			matched = ok && unit.sourceKey == value
		case strings.Contains(sql, "u.source_id=$"):
			value, ok := args[valueIndex].(string)
			matched = ok && unit.sourceID == value
		case strings.Contains(sql, "u.id=$"):
			value, ok := args[valueIndex].(int64)
			matched = ok && unit.id == value
		default:
			return resolverFixtureRow{err: errors.New("query has no single identity namespace")}
		}
		if matched {
			matches = append(matches, unit.id)
		}
	}
	if isGlobalLookup {
		return resolverFixtureRow{values: []any{len(matches) > 0}}
	}
	minimumID := int64(0)
	for _, id := range matches {
		if minimumID == 0 || id < minimumID {
			minimumID = id
		}
	}
	return resolverFixtureRow{values: []any{minimumID, int64(len(matches))}}
}

func TestClassifyUnitCandidates(t *testing.T) {
	if id, err := classifyUnitCandidates([]int64{41}, false); err != nil || id != 41 {
		t.Fatalf("single project-scoped candidate = (%d,%v)", id, err)
	}
	if _, err := classifyUnitCandidates([]int64{41, 42}, false); !errors.Is(err, ErrAmbiguousUnitReference) {
		t.Fatalf("ambiguous candidate error = %v", err)
	}
	if _, err := classifyUnitCandidates(nil, true); !errors.Is(err, ErrUnitProjectMismatch) {
		t.Fatalf("cross-project candidate error = %v", err)
	}
	if _, err := classifyUnitCandidates(nil, false); !errors.Is(err, ErrUnitNotFound) {
		t.Fatalf("missing candidate error = %v", err)
	}
}

func TestResolveLeadUnitDoesNotTreatNumericUnitKeyAsDatabaseID(t *testing.T) {
	// The selected catalog unit has database id 45 and apartment number 50.
	// A stale client that submits that display number as unitKey must not select
	// the unrelated row whose deployment-local database id happens to be 50.
	query := &resolverFixtureQuery{units: []resolverFixtureUnit{
		{id: 45, projectID: 7, sourceID: "crm-unit-45", sourceKey: "mirador-stable-45", number: "50", active: true},
		{id: 50, projectID: 7, sourceID: "crm-unit-50", sourceKey: "another-unit", number: "99", active: true},
	}}

	_, err := resolveLeadUnit(t.Context(), query, 7, []domain.UnitReference{{
		Namespace: domain.UnitReferenceSourceKey,
		Value:     "50",
	}})
	if !errors.Is(err, ErrUnitNotFound) {
		t.Fatalf("unitKey 50 selected database id 50 or returned unsafe error: %v", err)
	}

	resolved, err := resolveLeadUnit(t.Context(), query, 7, []domain.UnitReference{{
		Namespace: domain.UnitReferenceSourceKey,
		Value:     "mirador-stable-45",
	}})
	if err != nil || resolved != 45 {
		t.Fatalf("stable sourceKey round-trip = (%d,%v), want unit id 45", resolved, err)
	}

	resolved, err = resolveLeadUnit(t.Context(), query, 7, []domain.UnitReference{{
		Namespace: domain.UnitReferenceInternalID,
		Value:     "50",
	}})
	if err != nil || resolved != 50 {
		t.Fatalf("explicit numeric unitId = (%d,%v), want unit id 50", resolved, err)
	}
}

func TestResolveLeadUnitSeparatesSourceIDAndChecksMultipleFields(t *testing.T) {
	query := &resolverFixtureQuery{units: []resolverFixtureUnit{
		{id: 45, projectID: 7, sourceID: "crm-unit-45", sourceKey: "mirador-stable-45", active: true},
		{id: 50, projectID: 7, sourceID: "crm-unit-50", sourceKey: "another-unit", active: true},
	}}

	resolved, err := resolveLeadUnit(t.Context(), query, 7, []domain.UnitReference{
		{Namespace: domain.UnitReferenceSourceID, Value: "crm-unit-45"},
		{Namespace: domain.UnitReferenceSourceKey, Value: "mirador-stable-45"},
	})
	if err != nil || resolved != 45 {
		t.Fatalf("source id + source key round-trip = (%d,%v), want 45", resolved, err)
	}

	_, err = resolveLeadUnit(t.Context(), query, 7, []domain.UnitReference{
		{Namespace: domain.UnitReferenceInternalID, Value: "50"},
		{Namespace: domain.UnitReferenceSourceKey, Value: "mirador-stable-45"},
	})
	if !errors.Is(err, ErrUnitReferenceMismatch) {
		t.Fatalf("different canonical units returned %v", err)
	}

	_, err = resolveLeadUnit(t.Context(), query, 7, []domain.UnitReference{{
		Namespace: domain.UnitReferenceSourceKey,
		Value:     "crm-unit-45",
	}})
	if !errors.Is(err, ErrUnitNotFound) {
		t.Fatalf("unitKey fell back to source_id: %v", err)
	}
}

func TestResolveLeadUnitDistinguishesStringSourceIDFromNumericDatabaseID(t *testing.T) {
	query := &resolverFixtureQuery{units: []resolverFixtureUnit{
		{id: 45, projectID: 7, sourceID: "12", sourceKey: "regnum-stable-45", active: true},
		{id: 46, projectID: 7, sourceID: "235", sourceKey: "regnum-stable-46", active: true},
		{id: 12, projectID: 7, sourceID: "different-source", sourceKey: "different-key", active: true},
		{id: 235, projectID: 7, sourceID: "another-source", sourceKey: "another-key", active: true},
	}}

	resolved, err := resolveLeadUnit(t.Context(), query, 7, []domain.UnitReference{{
		Namespace: domain.UnitReferenceSourceID,
		Value:     "12",
	}})
	if err != nil || resolved != 45 {
		t.Fatalf("string unitId source_id round-trip = (%d,%v), want catalog unit 45", resolved, err)
	}

	resolved, err = resolveLeadUnit(t.Context(), query, 7, []domain.UnitReference{{
		Namespace: domain.UnitReferenceInternalID,
		Value:     "12",
	}})
	if err != nil || resolved != 12 {
		t.Fatalf("JSON number unitId internal-id lookup = (%d,%v), want database unit 12", resolved, err)
	}

	resolved, err = resolveLeadUnit(t.Context(), query, 7, []domain.UnitReference{{
		Namespace: domain.UnitReferenceSourceID,
		Value:     "235",
	}})
	if err != nil || resolved != 46 {
		t.Fatalf("nontrivial string unitId source_id round-trip = (%d,%v), want catalog unit 46", resolved, err)
	}

	resolved, err = resolveLeadUnit(t.Context(), query, 7, []domain.UnitReference{{
		Namespace: domain.UnitReferenceInternalID,
		Value:     "235",
	}})
	if err != nil || resolved != 235 {
		t.Fatalf("JSON number unitId internal-id lookup = (%d,%v), want database unit 235", resolved, err)
	}
}

func TestResolveLeadUnitPreservesMismatchAndAmbiguityErrors(t *testing.T) {
	query := &resolverFixtureQuery{units: []resolverFixtureUnit{
		{id: 45, projectID: 7, sourceKey: "duplicate", active: true},
		{id: 46, projectID: 7, sourceKey: "duplicate", active: true},
		{id: 90, projectID: 9, sourceKey: "foreign", active: true},
	}}

	_, err := resolveLeadUnit(t.Context(), query, 7, []domain.UnitReference{{Namespace: domain.UnitReferenceSourceKey, Value: "duplicate"}})
	if !errors.Is(err, ErrAmbiguousUnitReference) {
		t.Fatalf("duplicate sourceKey returned %v", err)
	}
	_, err = resolveLeadUnit(t.Context(), query, 7, []domain.UnitReference{{Namespace: domain.UnitReferenceSourceKey, Value: "foreign"}})
	if !errors.Is(err, ErrUnitProjectMismatch) {
		t.Fatalf("cross-project sourceKey returned %v", err)
	}
}

func TestOpenDoesNotEchoInvalidDatabaseURL(t *testing.T) {
	const marker = "must-not-appear"
	pool, err := Open(t.Context(), "postgres://catalog:"+marker+"@[")
	if pool != nil {
		pool.Close()
	}
	if err == nil {
		t.Fatal("invalid database URL was accepted")
	}
	if strings.Contains(err.Error(), marker) {
		t.Fatalf("database credential leaked in parse error: %s", err)
	}
}

func TestCooldownSecondsRoundsUpAndCanBeDisabled(t *testing.T) {
	tests := []struct {
		duration time.Duration
		want     int64
	}{
		{duration: 0, want: 0},
		{duration: -time.Second, want: 0},
		{duration: time.Nanosecond, want: 1},
		{duration: time.Second, want: 1},
		{duration: time.Second + time.Nanosecond, want: 2},
		{duration: time.Minute, want: 60},
	}
	for _, test := range tests {
		if got := cooldownSeconds(test.duration); got != test.want {
			t.Fatalf("cooldownSeconds(%s)=%d, want %d", test.duration, got, test.want)
		}
	}
}

func TestCreateLeadRejectsMissingConsentBeforeDatabase(t *testing.T) {
	store := &Store{}
	if _, err := store.CreateLead(t.Context(), domain.CreateLeadInput{}); !errors.Is(err, ErrConsentRequired) {
		t.Fatalf("missing consent error = %v", err)
	}
}

func TestOnlyReferenceErrorsAreOptionalForLastViewedApartment(t *testing.T) {
	for _, err := range []error{ErrUnitNotFound, ErrUnitProjectMismatch, ErrAmbiguousUnitReference, ErrUnitReferenceMismatch} {
		if !isOptionalLastViewedReferenceError(err) {
			t.Fatalf("last viewed reference error %v was not optional", err)
		}
	}
	if isOptionalLastViewedReferenceError(errors.New("database unavailable")) {
		t.Fatal("database failure was incorrectly treated as optional")
	}
}
