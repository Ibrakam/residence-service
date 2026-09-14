const publicUnitKeys = [
  "id",
  "unitKey",
  "sourceOrder",
  "number",
  "rooms",
  "area",
  "floor",
  "section",
  "phase",
  "completion",
  "status",
  "priceVisibility",
  "plan",
  "planStatus",
];

export function soyBoyiPublicUnit(unit) {
  return Object.fromEntries(publicUnitKeys.map((key) => [key, unit[key]]));
}

export function soyBoyiPublicSnapshot(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    capturedAt: snapshot.capturedAt,
    serverDate: snapshot.serverDate,
    availableResidentialTotal: snapshot.availableResidentialTotal,
    excludedCommercial: snapshot.excludedCommercial,
    planCount: snapshot.planCount,
    missingPlanCount: snapshot.missingPlanCount,
    reconciliation: snapshot.reconciliation,
    filters: snapshot.filters,
    units: snapshot.units.map(soyBoyiPublicUnit),
  };
}

export function soyBoyiPublicPreview(snapshot, count = 3) {
  return snapshot.units.slice(0, count).map(soyBoyiPublicUnit);
}
