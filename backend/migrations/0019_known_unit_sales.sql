-- A current explicit sold status is trustworthy as a lifetime fact even when
-- the source cannot tell us the historical sale date. Keep that fact separate
-- from unit_sale_events: the latter remains the forward-only monthly ledger.
CREATE TABLE IF NOT EXISTS unit_sold_facts (
    unit_id bigint PRIMARY KEY REFERENCES units(id) ON DELETE RESTRICT,
    project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    first_sold_observed_at timestamptz NOT NULL,
    evidence_kind text NOT NULL CHECK (evidence_kind IN ('baseline_status', 'status_transition')),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS unit_sold_facts_project_idx
    ON unit_sold_facts (project_id);

COMMENT ON TABLE unit_sold_facts IS
    'Immutable lifetime fact that an apartment was explicitly observed with sold status; it is never inferred from disappearance.';
COMMENT ON COLUMN unit_sold_facts.first_sold_observed_at IS
    'First accepted source observation carrying sold status; for baseline rows this is not claimed to be the historical sale date.';

-- Backfill only the source's current explicit sold status. This is safe for the
-- all-time total and intentionally does not create a monthly sale event.
INSERT INTO unit_sold_facts(
    unit_id,
    project_id,
    first_sold_observed_at,
    evidence_kind
)
SELECT
    unit.id,
    phase.project_id,
    COALESCE(event.sold_observed_at, unit.source_updated_at),
    CASE WHEN event.unit_id IS NULL THEN 'baseline_status' ELSE 'status_transition' END
FROM units AS unit
JOIN phases AS phase ON phase.id = unit.phase_id
LEFT JOIN unit_sale_events AS event ON event.unit_id = unit.id
WHERE unit.property_type = 'apartment'
  AND unit.status = 'sold'
ON CONFLICT (unit_id) DO NOTHING;

CREATE OR REPLACE FUNCTION record_explicit_apartment_sold_fact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW.property_type = 'apartment' AND NEW.status = 'sold' THEN
        INSERT INTO unit_sold_facts(
            unit_id,
            project_id,
            first_sold_observed_at,
            evidence_kind
        )
        SELECT
            NEW.id,
            phase.project_id,
            COALESCE(event.sold_observed_at, NEW.source_updated_at),
            CASE WHEN event.unit_id IS NULL THEN 'baseline_status' ELSE 'status_transition' END
        FROM phases AS phase
        LEFT JOIN unit_sale_events AS event ON event.unit_id = NEW.id
        WHERE phase.id = NEW.phase_id
        ON CONFLICT (unit_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS units_record_explicit_apartment_sold_fact ON units;
CREATE TRIGGER units_record_explicit_apartment_sold_fact
AFTER INSERT OR UPDATE OF status, property_type, phase_id, source_updated_at ON units
FOR EACH ROW
EXECUTE FUNCTION record_explicit_apartment_sold_fact();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'residence_api') THEN
        EXECUTE 'GRANT SELECT ON unit_sold_facts TO residence_api';
    END IF;
END;
$$;
