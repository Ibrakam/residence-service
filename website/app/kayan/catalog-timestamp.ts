function isValidTimestamp(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
}

/** Prefer the project-scoped timestamp and fall back only when it is unusable. */
export function selectCatalogTimestamp(
  projectUpdatedAt: string | null | undefined,
  fallbackGeneratedAt?: string | null,
) {
  if (isValidTimestamp(projectUpdatedAt)) return projectUpdatedAt;
  if (isValidTimestamp(fallbackGeneratedAt)) return fallbackGeneratedAt;
  return undefined;
}
