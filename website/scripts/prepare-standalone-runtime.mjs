import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const standaloneRoot = resolve(websiteRoot, 'dist/standalone');
const standaloneClientRoot = resolve(standaloneRoot, 'dist/client');
const sourceNodeModules = resolve(websiteRoot, 'node_modules');
const standaloneNodeModules = resolve(standaloneRoot, 'node_modules');
const appPackage = JSON.parse(readFileSync(resolve(websiteRoot, 'package.json'), 'utf8'));

// Vinext 1.0.0-beta.8 does not currently trace the React import used by its
// production server (app-elements-wire.js) into output: standalone. Keep the
// exception explicit so a future Vinext/runtime change is reviewed instead of
// silently copying the whole development dependency tree.
const runtimeRoots = ['react'];

assert.ok(existsSync(resolve(standaloneRoot, 'server.js')), 'Standalone server is missing; run vinext build first');
assert.ok(existsSync(resolve(standaloneNodeModules, 'vinext/package.json')), 'Standalone Vinext package is missing');

function readPackage(packageRoot) {
  return JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
}

function assertInside(parent, child, context) {
  const pathFromParent = relative(parent, child);
  assert.ok(pathFromParent && pathFromParent !== '..' && !pathFromParent.startsWith(`..${sep}`), `${context} escapes ${parent}`);
}

function manifestPath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join('/');
}

function lstatIfPresent(absolutePath) {
  try {
    return lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function findFiles(directory, predicate, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) findFiles(absolutePath, predicate, result);
    else if (entry.isFile() && predicate(absolutePath)) result.push(absolutePath);
    else if (!entry.isSymbolicLink() && !entry.isFile()) throw new Error(`Unsupported standalone client entry: ${absolutePath}`);
  }
  return result;
}

function discoverClientStaticRoot() {
  const candidates = [resolve(standaloneClientRoot, '_next/static')];
  for (const entry of readdirSync(standaloneClientRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) candidates.push(resolve(standaloneClientRoot, entry.name, '_next/static'));
  }
  const existing = candidates.filter((candidate) => existsSync(candidate));
  assert.equal(existing.length, 1, `Expected exactly one standalone _next/static directory, found ${existing.length}`);
  const staticRoot = realpathSync(existing[0]);
  assertInside(standaloneClientRoot, staticRoot, 'Standalone static root');
  return staticRoot;
}

function cssUrls(stylesheet) {
  const withoutComments = readFileSync(stylesheet, 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '');
  const urls = [];
  for (const match of withoutComments.matchAll(/url\(\s*(?:(['"])(.*?)\1|([^)]*?))\s*\)/g)) {
    const value = (match[2] ?? match[3] ?? '').trim();
    if (value) urls.push(value);
  }
  return urls;
}

function decodeCssAssetPath(value, staticUrlPrefix, stylesheet) {
  const rawPath = value.split(/[?#]/, 1)[0];
  if (!rawPath.startsWith(`${staticUrlPrefix}/`)) return null;

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new Error(`CSS asset URL is not valid UTF-8 in ${stylesheet}: ${value}`);
  }
  assert.ok(decodedPath.startsWith(`${staticUrlPrefix}/`), `CSS asset URL changes prefix after decoding in ${stylesheet}: ${value}`);
  assert.ok(!decodedPath.includes('\\') && !/[\0-\x1f\x7f]/.test(decodedPath), `CSS asset URL contains unsafe characters in ${stylesheet}: ${value}`);

  const assetPath = decodedPath.slice(staticUrlPrefix.length + 1);
  assert.ok(assetPath, `CSS asset URL has no path below ${staticUrlPrefix} in ${stylesheet}`);
  assert.ok(assetPath.split('/').every((segment) => segment && segment !== '.' && segment !== '..'), `CSS asset URL contains an unsafe path segment in ${stylesheet}: ${value}`);
  return { assetPath, url: rawPath };
}

function prepareCssPublicAssetAliases() {
  const staticRoot = discoverClientStaticRoot();
  const staticUrlPrefix = `/${manifestPath(standaloneClientRoot, staticRoot)}`;
  const cssRoot = resolve(staticRoot, 'css');
  assert.ok(existsSync(cssRoot), `Standalone CSS directory is missing below ${staticRoot}`);
  const stylesheets = findFiles(cssRoot, (absolutePath) => absolutePath.endsWith('.css')).sort();
  assert.ok(stylesheets.length > 0, 'Standalone build contains no CSS to audit for public asset references');

  const references = new Map();
  for (const stylesheet of stylesheets) {
    for (const value of cssUrls(stylesheet)) {
      const asset = decodeCssAssetPath(value, staticUrlPrefix, stylesheet);
      if (!asset) continue;
      const reference = references.get(asset.url) ?? { ...asset, stylesheets: new Set() };
      reference.stylesheets.add(manifestPath(standaloneClientRoot, stylesheet));
      references.set(asset.url, reference);
    }
  }

  const entries = [];
  for (const reference of [...references.values()].sort((left, right) => left.url.localeCompare(right.url))) {
    const aliasPath = resolve(staticRoot, reference.assetPath);
    assertInside(staticRoot, aliasPath, `CSS asset alias ${reference.url}`);
    const sourcePath = resolve(standaloneClientRoot, reference.assetPath);
    assertInside(standaloneClientRoot, sourcePath, `CSS public asset source ${reference.url}`);

    const sourceEntry = lstatIfPresent(sourcePath);
    const aliasEntry = lstatIfPresent(aliasPath);
    // A generated chunk/font already resident below _next/static needs no alias.
    if (!sourceEntry && aliasEntry?.isFile()) continue;

    assert.ok(sourceEntry, `CSS references a missing public asset: ${reference.url} (expected ${sourcePath})`);
    assert.ok(statSync(sourcePath).isFile(), `CSS public asset source is not a file: ${sourcePath}`);
    const canonicalSource = realpathSync(sourcePath);
    assertInside(standaloneClientRoot, canonicalSource, `CSS public asset source ${reference.url}`);
    assert.ok(!canonicalSource.startsWith(`${staticRoot}${sep}`), `CSS public asset source unexpectedly points back into _next/static: ${sourcePath}`);

    mkdirSync(dirname(aliasPath), { recursive: true });
    const canonicalAliasParent = realpathSync(dirname(aliasPath));
    if (canonicalAliasParent !== staticRoot) assertInside(staticRoot, canonicalAliasParent, `CSS asset alias parent ${reference.url}`);
    const symlinkTarget = relative(dirname(aliasPath), sourcePath);
    assert.ok(symlinkTarget && !symlinkTarget.startsWith(sep), `CSS asset alias target must be relative: ${reference.url}`);

    if (aliasEntry) {
      assert.ok(aliasEntry.isSymbolicLink(), `CSS asset alias collides with a non-symlink build output: ${aliasPath}`);
      if (readlinkSync(aliasPath) !== symlinkTarget || realpathSync(aliasPath) !== canonicalSource) rmSync(aliasPath);
    }
    if (!lstatIfPresent(aliasPath)) symlinkSync(symlinkTarget, aliasPath, 'file');
    assert.equal(realpathSync(aliasPath), canonicalSource, `CSS asset alias resolves to the wrong source: ${aliasPath}`);

    entries.push({
      url: reference.url,
      alias: manifestPath(standaloneClientRoot, aliasPath),
      source: manifestPath(standaloneClientRoot, sourcePath),
      target: symlinkTarget.split(sep).join('/'),
      stylesheets: [...reference.stylesheets].sort(),
    });
  }

  return {
    staticRoot: manifestPath(standaloneRoot, staticRoot),
    urlPrefix: staticUrlPrefix,
    entries,
  };
}

function hashPackage(packageRoot) {
  const hash = createHash('sha256');
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const absolute = join(directory, entry.name);
      const packagePath = relative(packageRoot, absolute).split(sep).join('/');
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        hash.update(packagePath);
        hash.update('\0');
        hash.update(readFileSync(absolute));
        hash.update('\0');
      } else {
        throw new Error(`Unsupported entry in standalone runtime package: ${absolute}`);
      }
    }
  };
  visit(packageRoot);
  return hash.digest('hex');
}

const pending = [...runtimeRoots];
const copied = new Map();
while (pending.length > 0) {
  const packageName = pending.shift();
  if (copied.has(packageName)) continue;

  const declaredVersion = appPackage.dependencies?.[packageName];
  assert.ok(declaredVersion, `Standalone runtime root ${packageName} must be an application dependency`);

  const sourceRoot = realpathSync(resolve(sourceNodeModules, packageName));
  assertInside(sourceNodeModules, sourceRoot, `Runtime package ${packageName}`);
  const sourcePackage = readPackage(sourceRoot);
  assert.equal(sourcePackage.name, packageName, `Resolved the wrong package for ${packageName}`);
  assert.equal(sourcePackage.version, declaredVersion, `${packageName} must be pinned exactly in package.json for reproducible standalone packaging`);

  const destinationRoot = resolve(standaloneNodeModules, packageName);
  assertInside(standaloneNodeModules, destinationRoot, `Standalone destination for ${packageName}`);
  rmSync(destinationRoot, { force: true, recursive: true });
  mkdirSync(dirname(destinationRoot), { recursive: true });
  cpSync(sourceRoot, destinationRoot, {
    dereference: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    recursive: true,
  });

  const copiedPackage = readPackage(destinationRoot);
  assert.equal(copiedPackage.version, sourcePackage.version, `Copied ${packageName} version changed`);
  copied.set(packageName, {
    name: packageName,
    version: copiedPackage.version,
    sha256: hashPackage(destinationRoot),
  });

  for (const dependencyName of Object.keys(sourcePackage.dependencies ?? {}).sort()) {
    assert.ok(appPackage.dependencies?.[dependencyName], `${packageName} runtime dependency ${dependencyName} must be declared by the application`);
    pending.push(dependencyName);
  }
}

const vinextPackage = readPackage(resolve(standaloneNodeModules, 'vinext'));
const publicAssetAliases = prepareCssPublicAssetAliases();
const runtimeManifest = {
  schemaVersion: 2,
  reason: 'vinext-standalone-runtime-closure',
  vinext: vinextPackage.version,
  packages: [...copied.values()].sort((left, right) => left.name.localeCompare(right.name)),
  publicAssetAliases,
};
writeFileSync(resolve(standaloneRoot, 'STANDALONE_RUNTIME.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`, { mode: 0o644 });

console.log(`Prepared standalone runtime closure: ${runtimeManifest.packages.map(({ name, version }) => `${name}@${version}`).join(', ')}; ${publicAssetAliases.entries.length} CSS public-asset aliases below ${publicAssetAliases.urlPrefix}.`);
