-- Public website overlays can legitimately publish no unit-level offers.
-- The coordinator still permits a zero floor only for explicit overlay mode;
-- complete providers require a positive configured minimum.
ALTER TABLE catalog_sync_projects
    DROP CONSTRAINT IF EXISTS catalog_sync_projects_minimum_records_check;

ALTER TABLE catalog_sync_projects
    ADD CONSTRAINT catalog_sync_projects_minimum_records_check
    CHECK (minimum_records >= 0);
