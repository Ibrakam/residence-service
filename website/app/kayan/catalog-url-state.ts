export type CatalogUnitIdentity = {
  phaseSlug: string;
  entrance?: string;
  floor: number;
  number: string;
  status?: string;
};

export type CatalogUnitSelection = {
  phase?: string | null;
  entrance?: string | null;
  floor?: string | number | null;
  unit?: string | null;
  availableOnly?: boolean;
};

function normalizedText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/**
 * Resolve a catalogue deep-link only when its complete physical identity points
 * to exactly one unit. Display numbers repeat between Ofiyat phases, entrances
 * and parking levels, so a partial or ambiguous query must never select a unit.
 */
export function resolveCompositeCatalogUnit<T extends CatalogUnitIdentity>(
  units: readonly T[],
  selection: CatalogUnitSelection,
): T | undefined {
  const phase = normalizedText(selection.phase);
  const entrance = normalizedText(selection.entrance);
  const unit = normalizedText(selection.unit);
  const floorValue = typeof selection.floor === 'number'
    ? selection.floor
    : normalizedText(selection.floor) === undefined
      ? Number.NaN
      : Number(selection.floor);

  if (!phase || !entrance || !unit || !Number.isSafeInteger(floorValue)) return undefined;

  const matches = units.filter((candidate) => (
    candidate.phaseSlug === phase
    && candidate.entrance === entrance
    && candidate.floor === floorValue
    && candidate.number === unit
    && (!selection.availableOnly || candidate.status === 'available')
  ));

  return matches.length === 1 ? matches[0] : undefined;
}

export function catalogUnitQuery(
  unit: CatalogUnitIdentity & { entrance: string },
  language: string,
  block?: string | null,
) {
  const query: Record<string, string> = {
    lang: language,
    phase: unit.phaseSlug,
    entrance: unit.entrance,
    floor: String(unit.floor),
    unit: unit.number,
  };
  const normalizedBlock = normalizedText(block);
  if (normalizedBlock) query.block = normalizedBlock;
  return query;
}
