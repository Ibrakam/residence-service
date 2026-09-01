import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const standaloneRoot = resolve(websiteRoot, 'dist/standalone');
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
const runtimeManifest = {
  schemaVersion: 1,
  reason: 'vinext-standalone-runtime-closure',
  vinext: vinextPackage.version,
  packages: [...copied.values()].sort((left, right) => left.name.localeCompare(right.name)),
};
writeFileSync(resolve(standaloneRoot, 'STANDALONE_RUNTIME.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`, { mode: 0o644 });

console.log(`Prepared standalone runtime closure: ${runtimeManifest.packages.map(({ name, version }) => `${name}@${version}`).join(', ')}`);
