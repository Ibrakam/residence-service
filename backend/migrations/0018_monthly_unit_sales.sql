-- Historical status rows cannot be backfilled safely: older imports include
-- technical source-switch transitions that are indistinguishable from sales.
-- This singleton marks the exact beginning of trustworthy sale tracking.
CREATE TABLE IF NOT EXISTS unit_sales_tracking_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    tracking_started_at timestamptz NOT NULL
);

INSERT INTO unit_sales_tracking_state(singleton, tracking_started_at)
VALUES(true, clock_timestamp())
ON CONFLICT (singleton) DO NOTHING;

-- Immutable application ledger. One unit can contribute only once, even if an
-- upstream status later flaps through sold -> available -> sold. No migration
-- backfill is performed; rows are appended only by the trigger installed below.
CREATE TABLE IF NOT EXISTS unit_sale_events (
    id bigserial PRIMARY KEY,
    status_history_id bigint NOT NULL UNIQUE REFERENCES unit_status_history(id) ON DELETE RESTRICT,
    unit_id bigint NOT NULL UNIQUE REFERENCES units(id) ON DELETE RESTRICT,
    project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    old_status text NOT NULL CHECK (old_status <> '' AND old_status <> 'sold'),
    sold_observed_at timestamptz NOT NULL,
    detected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS unit_sale_events_project_observed_idx
    ON unit_sale_events (project_id, sold_observed_at);

COMMENT ON TABLE unit_sale_events IS
    'First explicit non-sold -> sold CRM transition for each apartment, recorded only after tracking_started_at.';
COMMENT ON COLUMN unit_sale_events.sold_observed_at IS
    'Accepted CRM/source capture timestamp, not a contractual sale timestamp.';

CREATE OR REPLACE FUNCTION record_explicit_apartment_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW.new_status = 'sold'
       AND NEW.old_status IS NOT NULL
       AND NEW.old_status <> 'sold' THEN
        INSERT INTO unit_sale_events(
            status_history_id,
            unit_id,
            project_id,
            old_status,
            sold_observed_at
        )
        SELECT
            NEW.id,
            unit.id,
            phase.project_id,
            NEW.old_status,
            NEW.observed_at
        FROM units AS unit
        JOIN phases AS phase ON phase.id = unit.phase_id
        JOIN unit_sales_tracking_state AS tracking ON tracking.singleton
        WHERE unit.id = NEW.unit_id
          AND unit.property_type = 'apartment'
          AND NEW.observed_at >= tracking.tracking_started_at
        ON CONFLICT (unit_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS unit_status_history_record_apartment_sale ON unit_status_history;
CREATE TRIGGER unit_status_history_record_apartment_sale
AFTER INSERT ON unit_status_history
FOR EACH ROW
EXECUTE FUNCTION record_explicit_apartment_sale();

CREATE OR REPLACE VIEW monthly_unit_sales AS
SELECT
    project_id,
    date_trunc('month', sold_observed_at AT TIME ZONE 'Asia/Tashkent')::date AS sale_month,
    count(*)::bigint AS sold_units
FROM unit_sale_events
GROUP BY project_id, date_trunc('month', sold_observed_at AT TIME ZONE 'Asia/Tashkent')::date;

COMMENT ON VIEW monthly_unit_sales IS
    'First-time apartment sales by Asia/Tashkent month; disappearance/deactivation is never inferred as a sale.';

-- Production migrations may be applied by the PostgreSQL administrator while
-- the API and importer connect as residence_api. Keep development databases
-- role-agnostic, but grant the read projection when that production role exists.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'residence_api') THEN
        EXECUTE 'GRANT SELECT ON unit_sales_tracking_state, unit_sale_events, monthly_unit_sales TO residence_api';
    END IF;
END;
$$;
