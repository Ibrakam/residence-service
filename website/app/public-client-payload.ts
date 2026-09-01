const officialWebsiteUrl = /https?:\/\/(?:www\.)?(?:nrg-bi\.uz|mbc\.uz|human2human\.uz|kayan\.uz)(?:[/:?#]|$)/i;

function withoutOfficialWebsiteUrls(value: unknown): unknown {
  if (typeof value === 'string') return officialWebsiteUrl.test(value) ? undefined : value;
  if (Array.isArray(value)) {
    return value
      .map(withoutOfficialWebsiteUrls)
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, withoutOfficialWebsiteUrls(item)] as const)
      .filter((entry) => entry[1] !== undefined),
  );
}

/**
 * Creates the plain object that may cross a React Server Component boundary.
 * Checked-in capture/source data remains intact on the server, while official
 * developer URLs are not serialized into HTML, RSC responses or client state.
 */
export function publicClientPayload<T>(value: T): T {
  const result = withoutOfficialWebsiteUrls(value);
  if (result === undefined) throw new Error('A public client payload cannot be an official website URL');
  return result as T;
}
