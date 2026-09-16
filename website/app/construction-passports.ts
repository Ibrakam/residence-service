export type ConstructionPassport = {
  objectId: number;
  name: string;
  address: string;
  url: string;
  linkedAt: string;
};

export const publishedProjectKeys = new Set([
  '4u', 'avalon-residence', 'bayterak', 'botanika-saroyi', 'c1', 'flagman', 'jomiy',
  'maftun-makon', 'meros', 'mirador', 'ofiyat', 'regnum-plaza', 'saadiyat', 'sado',
  'sarbon', 'soy-boyi', 'sun', 'voha', 'yangibaxt', 'zamon',
]);
const projectKeyPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
const officialPassportPathPattern = /^\/object-info\/[1-9][0-9]*$/;

function normalizedBasePath(value: string) {
  const cleaned = value.trim().replace(/^\/+|\/+$/g, '');
  return cleaned ? `/${cleaned}` : '';
}

export function projectKeyForLandingPath(pathname: string, configuredBasePath = ''): string {
  let path = pathname.split(/[?#]/, 1)[0] || '/';
  const basePath = normalizedBasePath(configuredBasePath);
  if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) {
    path = path.slice(basePath.length) || '/';
  }
  path = path.replace(/\/+$/, '') || '/';
  if (path === '/') return 'avalon-residence';
  const match = /^\/([^/]+)$/.exec(path);
  if (!match || !projectKeyPattern.test(match[1]) || !publishedProjectKeys.has(match[1])) return '';
  return match[1];
}

export function safeOfficialPassportURL(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256) return '';
  if (!/^https:\/\/api-nazorat\.mc\.uz\/object-info\/[1-9][0-9]*$/.test(value)) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'api-nazorat.mc.uz' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || !officialPassportPathPattern.test(parsed.pathname)) {
      return '';
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseConstructionPassports(value: unknown, projectKey: string): ConstructionPassport[] | null {
  if (!record(value) || value.projectKey !== projectKey || typeof value.linked !== 'boolean' || !Number.isInteger(value.objectCount) || Number(value.objectCount) < 0 || !Array.isArray(value.passports) || value.passports.length > 50) {
    return null;
  }
  const passports: ConstructionPassport[] = [];
  const seen = new Set<string>();
  for (const raw of value.passports) {
    if (!record(raw) || !Number.isSafeInteger(raw.objectId) || Number(raw.objectId) <= 0) return null;
    const url = safeOfficialPassportURL(raw.url);
    if (!url) return null;
    if (seen.has(url)) continue;
    seen.add(url);
    passports.push({
      objectId: Number(raw.objectId),
      name: typeof raw.name === 'string' ? raw.name.trim().slice(0, 180) : '',
      address: typeof raw.address === 'string' ? raw.address.trim().slice(0, 240) : '',
      url,
      linkedAt: typeof raw.linkedAt === 'string' ? raw.linkedAt.trim().slice(0, 64) : '',
    });
  }
  if (value.linked !== (Number(value.objectCount) > 0)) return null;
  if (!value.linked && passports.length > 0) return null;
  if (passports.length > Number(value.objectCount)) return null;
  return passports;
}

export function constructionPassportLabels(language: string) {
  if (language === 'uz') {
    return {
      open: 'Loyihaning rasmiy qurilish pasportini ochish (yangi oynada)',
      choose: 'Rasmiy loyiha pasportini tanlash',
      heading: 'Loyiha pasportlari',
      close: 'Yopish',
      object: 'Qurilish obyekti',
    };
  }
  if (language === 'en') {
    return {
      open: 'Open the official construction passport in a new tab',
      choose: 'Choose an official project passport',
      heading: 'Project passports',
      close: 'Close',
      object: 'Construction object',
    };
  }
  return {
    open: 'Открыть официальный паспорт проекта в новой вкладке',
    choose: 'Выбрать официальный паспорт проекта',
    heading: 'Паспорта проекта',
    close: 'Закрыть',
    object: 'Объект строительства',
  };
}
