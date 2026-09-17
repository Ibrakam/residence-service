ALTER TABLE units
  ADD COLUMN IF NOT EXISTS repair_included boolean;

COMMENT ON COLUMN units.repair_included IS
  'Authoritative CRM finishing flag: true = with repair, false = without repair, NULL = provider does not expose it';
