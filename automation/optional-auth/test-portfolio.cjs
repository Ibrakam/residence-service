/* Verify actual built residence forms locally, never submit an application.
 * Start dist/standalone/server.js on 127.0.0.1:4382 first. The local transport
 * below emulates only the reviewed Nginx static alias and optional HTML flag.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const clientRoot = path.join(root, 'website/dist/standalone/dist/client');
const bootstrap = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8');
const catalogs = process.argv.includes('--catalogs');
const projects = ['avalon', '4u', 'bayterak', 'botanika-saroyi', 'c1', 'dormon-hills',
  'flagman', 'jomiy', 'maftun-makon', 'meros', 'mirador', 'ofiyat', 'pushkin',
  'regnum-plaza', 'saadiyat', 'sarbon', 'sado', 'soy-boyi', 'sun', 'voha', 'yangibaxt', 'zamon']
  .filter(project => !catalogs || project !== 'avalon');

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  let next = 0;
  const results = [];
  async function worker() {
    while (next < projects.length) {
      const project = projects[next++];
      const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
      const errors = [];
      let leadPosts = 0;
      try {
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url());
          if (url.pathname.startsWith('/residence-assets/_next/static/')) {
            const file = path.resolve(clientRoot, '.' + url.pathname);
            assert.ok(file.startsWith(clientRoot + path.sep));
            return route.fulfill({ path: file,
              contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : undefined });
          }
          if (request.method() === 'POST') {
            if (/leads|submit/.test(url.pathname)) leadPosts++;
            return route.abort(); // Analytics and forms never write during this test.
          }
          if (url.pathname === '/__auth/me') return route.fulfill({ status: 401, json: { error: 'guest' } });
          if (request.isNavigationRequest() && request.resourceType() === 'document' && url.hostname === '127.0.0.1') {
            const response = await route.fetch();
            return route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><meta name="tencorp-auth-mode" content="optional">') });
          }
          return route.continue();
        });
        await page.goto('http://127.0.0.1:4382/' + project + (catalogs ? '/apartments' : ''), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => window.__tencorpOptionalConsumerReady === true, null, { timeout: 15000 });
        await page.addScriptTag({ content: bootstrap });
        await page.waitForFunction(() => Array.from(document.querySelectorAll('[role=dialog],[aria-modal=true],dialog[open]'))
          .some(dialog => dialog.getBoundingClientRect().width && dialog.querySelector('input[type=tel],input[name=phone]')), null, { timeout: 25000 });
        assert.equal(leadPosts, 0);
        assert.ok(!page.url().includes('/__auth/login'));
        const hasFields = await page.locator('[role=dialog],[aria-modal=true],dialog[open]')
          .filter({ has: page.locator('input[type=tel],input[name=phone]') }).first()
          .evaluate(dialog => Boolean(dialog.querySelector('input[name=name],input[autocomplete=name],input[type=text]')));
        assert.ok(hasFields, 'existing application must include name and phone');
        assert.deepEqual(errors, []);
        results.push({ project, ok: true });
      } catch (error) {
        results.push({ project, ok: false, error: error.message, errors });
      } finally {
        console.log(JSON.stringify(results.at(-1)));
        await context.close();
      }
    }
  }
  try {
    await Promise.all([worker(), worker(), worker()]);
    console.log(JSON.stringify({ catalogs, total: results.length, passed: results.filter(result => result.ok).length }));
    if (results.some(result => !result.ok)) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
