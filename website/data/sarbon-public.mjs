const publicUnitKeys = [
  "id", "unitKey", "sourceOrder", "number", "rooms", "area", "floor", "section",
  "phase", "completion", "status", "priceVisibility", "plan", "planStatus",
];

export function sarbonPublicUnit(unit) {
  return Object.fromEntries(publicUnitKeys.map((key) => [key, unit[key]]));
}

export function sarbonPublicSnapshot(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    capturedAt: snapshot.capturedAt,
    availableResidentialTotal: snapshot.availableResidentialTotal,
    excludedCommercial: snapshot.excludedCommercial,
    planCount: snapshot.planCount,
    uniquePlanCount: snapshot.uniquePlanCount,
    missingPlanCount: snapshot.missingPlanCount,
    filters: snapshot.filters,
    units: snapshot.units.map(sarbonPublicUnit),
  };
}

export function sarbonPublicPreview(snapshot, count = 4) {
  return snapshot.units.slice(0, count).map(sarbonPublicUnit);
}
