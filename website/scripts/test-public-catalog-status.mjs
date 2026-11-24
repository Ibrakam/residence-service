import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(new URL('../package.json', import.meta.url));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const result = await build({
  entryPoints: [new URL('../app/catalog-source-status.tsx', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  loader: { '.css': 'empty' },
  write: false,
  logLevel: 'silent',
});
const bundledModule = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, bundledModule, bundledModule.exports);
const { CatalogSourceStatus } = bundledModule.exports;
const render = (props) => renderToStaticMarkup(createElement(CatalogSourceStatus, props));

for (const language of ['ru', 'uz', 'en']) {
  for (const dataSource of ['live', 'stale', 'unverified', 'cached', 'embedded']) {
    // A retained catalogue stays visible without provider age/health messages,
    // even when the next background request is loading or fails.
    for (const refreshedAt of ['2020-01-01T00:00:00Z', 'not-a-date', undefined]) {
      for (const state of [{}, { isLoading: true }, { loadError: true }]) {
        assert.equal(render({ language, dataSource, refreshedAt, hasData: true, ...state }), '');
      }
    }
    const props = { language, dataSource, refreshedAt: '2020-01-01T00:00:00Z', hasData: false };
    assert.equal(render(props), '', 'a genuinely empty catalogue has no source-age notice');
    const loading = render({ ...props, isLoading: true });
    const failure = render({ ...props, loadError: true, onRetry() {} });
    assert.match(loading, /role="status"/);
    assert.match(failure, /aria-live="polite"/);
    assert.match(failure, /<button type="button"/);
    assert.doesNotMatch(loading + failure, /2020|<time|stale|cached|устар|последн|synchroni/i);
    let retries = 0;
    const tree = CatalogSourceStatus({ ...props, loadError: true, onRetry: () => { retries += 1; } });
    const retry = tree.props.children[1];
    assert.equal(retry.props.type, 'button');
    assert.equal(Boolean(retry.props.disabled), false);
    retry.props.onClick();
    assert.equal(retries, 1, 'the generic retry must keep its callback');
    const pendingRetry = CatalogSourceStatus({ ...props, loadError: true, isLoading: true, onRetry() {} });
    assert.equal(pendingRetry.props.children[1].props.disabled, true);
  }
}

const shared = await readFile(new URL('../app/catalog/apartment-catalog.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(shared, /catalogStatusMessage|dateLabel|<time/);
assert.match(shared, /hasData=\{units\.length > 0\}/);
console.log('Public catalogue status passed: retained data is silent in all locales/source states; empty loading/error and keyboard-native retry remain available.');
