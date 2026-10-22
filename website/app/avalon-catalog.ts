type FloorUnit = { building: string; floor: number; number: string | number; area: number; rooms: number; status: string };

/** Geometry belongs to a fixed full-floor identity list, never an available-only index. */
export function avalonFloorSlots<T extends FloorUnit>(known: readonly FloorUnit[], available: readonly T[], building: string, floor: number, order: readonly number[]): Array<T | undefined> {
  const fullFloor = known.filter((unit) => unit.building === building && unit.floor === floor).sort((a, b) => Number(a.number) - Number(b.number));
  return order.map((index) => {
    const slot = fullFloor[index];
    if (!slot) return undefined;
    const matches = available.filter((unit) => unit.building === building && unit.floor === floor && String(unit.number) === String(slot.number));
    const unit = matches.length === 1 ? matches[0] : undefined;
    // Newly discovered or changed layouts have no verified position on this image.
    return unit?.status === 'free' && unit.rooms === slot.rooms && Math.abs(unit.area - slot.area) < 0.011 ? unit : undefined;
  });
}

export function verifiedAvalonPlan(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\/(?:avalon|avalon-residence)\/plans\/[a-zA-Z0-9_/-]+\.(?:webp|png|jpe?g)$/.test(value)) return null;
  return value;
}
