import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const auditCapture = process.argv.includes('--audit-capture');
const snapshot = JSON.parse(await readFile(path.join(root, 'data', 'saadiyat-catalog.json'), 'utf8'));
const landing = await readFile(path.join(root, 'app', 'saadiyat', 'saadiyat-page.tsx'), 'utf8');
const catalogue = await readFile(path.join(root, 'app', 'saadiyat', 'apartments', 'saadiyat-catalog.tsx'), 'utf8');
const landingPage = await readFile(path.join(root, 'app', 'saadiyat', 'page.tsx'), 'utf8');
const cataloguePage = await readFile(path.join(root, 'app', 'saadiyat', 'apartments', 'page.tsx'), 'utf8');
const documentLanguage = await readFile(path.join(root, 'app', 'saadiyat', 'saadiyat-language.ts'), 'utf8');
const proxy = await readFile(path.join(root, 'proxy.ts'), 'utf8');
const fail = (message) => { throw new Error(message); };

if (auditCapture) {
  const manifest = JSON.parse(await readFile(path.join(root, 'source', 'saadiyat', 'capture-manifest.json'), 'utf8'));
  if (!manifest.stable) fail('Capture did not remain stable across the before/after result checks.');
}
if (snapshot.availableResidentialTotal !== 159 || snapshot.units.length !== 159) fail('Expected the reconciled residential AVAILABLE count to be 159.');
if (snapshot.officialUntypedTotal !== 163 || snapshot.excludedCommercial !== 4) fail('Untyped/commercial reconciliation changed.');
if (snapshot.units.some((unit) => unit.status !== 'AVAILABLE')) fail('Non-AVAILABLE unit entered the public catalogue.');
if (snapshot.units.some((unit) => unit.priceVisible)) fail('A unit unexpectedly exposes price while is_price=0.');
if (snapshot.units.some((unit) => !/^\/saadiyat\/plans\/[a-f0-9]{16}\.webp$/.test(unit.plan))) fail('A runtime plan is not local.');
await Promise.all([...new Set(snapshot.units.map((unit) => unit.plan))].map((file) => access(path.join(root, 'public', file))));
if (/pb12218|profitbase\.ru|mbc\.uz\/storage/.test(`${landing}\n${catalogue}`)) fail('Runtime component contains a remote media hotlink.');
if (/Студия|Studiya|Studio/.test(`${landing}\n${catalogue}`)) fail('rooms=0 is labelled as a studio without source confirmation.');
if (!/project=saadiyat&lang=\$\{language\}&from=/.test(`${landing}\n${catalogue}`)) fail('Privacy URL does not preserve project, language and surface.');
if (!/projectSlug="saadiyat"/.test(`${landing}\n${catalogue}`) || !/catalogLeadIdentity\(lead\.unit\)\.unitKey/.test(`${landing}\n${catalogue}`)) fail('Canonical live lead identity is missing.');
if (/unitId=\$\{|crmId=\$\{/.test(`${landing}\n${catalogue}`)) fail('Legacy CRM identity leaked into the lead context.');
if (!/useLiveCatalogUnits\('saadiyat'/.test(landing) || !/useLiveCatalogSnapshot\('saadiyat'/.test(catalogue)) fail('Saadiyat routes are not connected to the live catalogue.');
if (!/['"]@type['"]\s*:\s*['"]CollectionPage['"]/.test(cataloguePage) || !/['"]@type['"]\s*:\s*['"]ApartmentComplex['"]/.test(cataloguePage) || !/['"]@type['"]\s*:\s*['"]BreadcrumbList['"]/.test(cataloguePage)) fail('Saadiyat catalogue JSON-LD must describe only the stable collection page, project and breadcrumbs.');
if (/['"]@type['"]\s*:\s*['"]ItemList['"]|itemListElement\s*:\s*catalog\.units\.map|numberOfItems\s*:\s*catalog\.units\.length|dateModified\s*:\s*catalog\.capturedAt/.test(cataloguePage)) fail('Saadiyat catalogue JSON-LD must not publish embedded fallback units as live inventory.');
if (/crmId: unit\.crmId/.test(`${landingPage}\n${cataloguePage}`)) fail('Internal CRM identifiers are serialized into the public client payload.');
if (!/\['cards', 'chess'\]/.test(catalogue) || /floorPlan|chessPlus|Шахматка\+/.test(catalogue)) fail('Catalogue modes violate the Cards + Chessboard-only contract.');
if (!/'\/saadiyat\/:path\*'/.test(proxy)) fail('Saadiyat is absent from the document-language proxy matcher.');
if (!/document\.documentElement/.test(documentLanguage) || !/root\.lang = language/.test(documentLanguage) || !/root\.lang === language/.test(documentLanguage)) fail('The live document language hook is missing its guarded update or cleanup.');
if (!/useSaadiyatDocumentLanguage\(language\)/.test(landing) || !/useSaadiyatDocumentLanguage\(language\)/.test(catalogue)) fail('Both Saadiyat routes must synchronize the live document language.');
if (!/useSearchParams/.test(landing) || !/useSearchParams/.test(catalogue) || !/languageFrom\(searchParams\.get\('lang'\), initialLanguage\)/.test(landing) || !/languageFrom\(searchParams\.get\('lang'\), initialLanguage\)/.test(catalogue)) fail('Both Saadiyat routes must derive language from the live URL with a server-rendered fallback.');
if (!/@media\(max-width:850px\).*\.sac-chess-layout\{display:flex;flex-direction:column\}.*\.sac-detail\{position:static;width:100%;order:2\}/s.test(await readFile(path.join(root, 'app', 'saadiyat', 'apartments', 'saadiyat-catalog.css'), 'utf8'))) fail('The tablet catalogue must stack a full-width chessboard above its detail panel.');
if (!/\.sac-detail\.is-empty p\{[^}]*color:rgba\(255,255,255,\.82\)/.test(await readFile(path.join(root, 'app', 'saadiyat', 'apartments', 'saadiyat-catalog.css'), 'utf8'))) fail('The empty chessboard detail hint must explicitly override the dark body-copy color.');
if (!/SAADIYAT · \{t\.inventory\}/.test(catalogue) || !/\{t\.availabilityStatus\}/.test(catalogue) || !/\{t\.serverDateLabel\}/.test(catalogue) || !/format\(new Date\(snapshot\.serverDate\)\)/.test(catalogue)) fail('Catalogue service labels and server date must be localized at runtime.');
if (!/facts=\{lead\.unit [^\n]+ : t\.leadFacts\}/.test(landing) || !/\.\.\.t\.leadFacts/.test(catalogue)) fail('General lead facts must come from localized copy.');
if (!/rooms === 1 \? 'room' : 'rooms'/.test(landing) || !/unit\.rooms === 1 \? 'room' : 'rooms'/.test(catalogue)) fail('English one-room labels must use the singular noun.');
console.log(`Saadiyat contract passed: ${snapshot.units.length} AVAILABLE residential fallbacks, ${new Set(snapshot.units.map((unit) => unit.plan)).size} local plans, live catalogue and canonical lead identity enabled.`);
