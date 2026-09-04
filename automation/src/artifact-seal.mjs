import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { PolicyError } from "./errors.mjs";
import { isPathInside, normalizeRepoRelativePath, safeSlug } from "./sanitize.mjs";

async function hashFile(filename) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function portablePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

const MACH_O_THIN_MAGIC = new Set(["feedface", "cefaedfe", "feedfacf", "cffaedfe"]);
const MACH_O_FAT_MAGIC = new Set(["cafebabe", "bebafeca", "cafebabf", "bfbafeca"]);
const REVIEWED_PURE_RUNTIME_PACKAGES = new Set(["react"]);

async function hasNativeExecutableHeader(filename, stat) {
  const handle = await fsp.open(filename, "r");
  const prefix = Buffer.alloc(Math.min(Math.max(stat.size, 0), 64));
  let bytesRead = 0;
  try {
    ({ bytesRead } = await handle.read(prefix, 0, prefix.length, 0));
    if (bytesRead >= 16 && prefix.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
      && (prefix[4] === 1 || prefix[4] === 2)
      && (prefix[5] === 1 || prefix[5] === 2)
      && prefix[6] === 1) return true;

    if (bytesRead >= 4) {
      const magic = prefix.subarray(0, 4).toString("hex");
      if (MACH_O_THIN_MAGIC.has(magic)) return true;
      if (MACH_O_FAT_MAGIC.has(magic) && bytesRead >= 8) {
        const swapped = magic === "bebafeca" || magic === "bfbafeca";
        const architectureCount = swapped ? prefix.readUInt32LE(4) : prefix.readUInt32BE(4);
        // A Java class also begins CAFEBABE; requiring a plausible Mach-O fat
        // architecture count avoids rejecting ordinary JVM data by magic alone.
        if (architectureCount >= 1 && architectureCount <= 64) return true;
      }
    }

    if (bytesRead >= 64 && prefix[0] === 0x4d && prefix[1] === 0x5a) {
      const peOffset = prefix.readUInt32LE(0x3c);
      if (peOffset <= stat.size - 4) {
        const signature = Buffer.alloc(4);
        const result = await handle.read(signature, 0, signature.length, peOffset);
        if (result.bytesRead === 4 && signature.equals(Buffer.from([0x50, 0x45, 0x00, 0x00]))) return true;
      }
    }
    return false;
  } finally {
    await handle.close();
  }
}

async function assertPureRuntimeClosure(rootPath) {
  const manifestPath = path.join(rootPath, "STANDALONE_RUNTIME.json");
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  } catch (cause) {
    throw new PolicyError("Standalone runtime closure manifest is missing or invalid", { cause });
  }
  if (manifest?.schemaVersion !== 2 || !Array.isArray(manifest.packages)) {
    throw new PolicyError("Standalone runtime closure manifest has an unsupported schema");
  }
  const seen = new Set();
  for (const entry of manifest.packages) {
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string"
      || !REVIEWED_PURE_RUNTIME_PACKAGES.has(entry.name) || seen.has(entry.name)) {
      throw new PolicyError("Standalone runtime closure contains an unreviewed or duplicate package");
    }
    seen.add(entry.name);
  }
}

async function assertPlatformNeutralArtifact(rootPath, { requireRuntimeManifest = true, rejectSymlinks = false } = {}) {
  const canonicalRoot = await fsp.realpath(rootPath);
  const scannedRealFiles = new Set();
  async function inspectFile(absolute, displayPath) {
    const realFile = await fsp.realpath(absolute);
    if (realFile !== canonicalRoot && !isPathInside(canonicalRoot, realFile)) {
      throw new PolicyError(`Artifact symlink escapes its root: ${displayPath}`);
    }
    if (scannedRealFiles.has(realFile)) return;
    scannedRealFiles.add(realFile);
    const stat = await fsp.stat(realFile);
    if (!stat.isFile()) return;
    if (/\.(?:node|dylib|dll|exe|so(?:\.[0-9]+)*)$/i.test(path.basename(realFile))
      || /\.(?:node|dylib|dll|exe|so(?:\.[0-9]+)*)$/i.test(displayPath)) {
      throw new PolicyError(`Standalone artifact contains a native runtime file: ${displayPath}`);
    }
    if (await hasNativeExecutableHeader(realFile, stat)) {
      throw new PolicyError(`Standalone artifact contains native executable content: ${displayPath}`);
    }
  }
  async function visit(directory) {
    const children = await fsp.readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const stat = await fsp.lstat(absolute);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        await visit(absolute);
      } else if (stat.isFile() && !stat.isSymbolicLink()) {
        await inspectFile(absolute, portablePath(path.relative(rootPath, absolute)));
      } else if (stat.isSymbolicLink()) {
        if (rejectSymlinks) throw new PolicyError(`Source artifact contains a symlink: ${portablePath(path.relative(rootPath, absolute))}`);
        await inspectFile(absolute, portablePath(path.relative(rootPath, absolute)));
      }
    }
  }
  await visit(rootPath);
  if (requireRuntimeManifest) await assertPureRuntimeClosure(rootPath);
}

async function assertReviewedSourceArtifact(rootPath, { allowedPaths, requiredPaths }) {
  const allowed = allowedPaths.map(normalizeRepoRelativePath);
  const required = requiredPaths.map(normalizeRepoRelativePath);
  if (allowed.length === 0 || required.length === 0) throw new PolicyError("Source artifact scope must not be empty");
  const manifest = await createArtifactManifest(rootPath);
  for (const entry of manifest.entries) {
    const inScope = allowed.some((reviewedPath) => entry.path === reviewedPath
      || (entry.type === "directory" && reviewedPath.startsWith(`${entry.path}/`)));
    if (!inScope) throw new PolicyError(`Source artifact contains an unreviewed path: ${entry.path}`);
    if (entry.type === "symlink") throw new PolicyError(`Source artifact contains a symlink: ${entry.path}`);
  }
  const files = new Set(manifest.entries.filter((entry) => entry.type === "file").map((entry) => entry.path));
  for (const requiredPath of required) {
    if (!files.has(requiredPath)) throw new PolicyError(`Source artifact is missing required file: ${requiredPath}`);
  }
  await assertPlatformNeutralArtifact(rootPath, { requireRuntimeManifest: false, rejectSymlinks: true });
}

export async function createArtifactManifest(rootPath) {
  const root = await fsp.realpath(rootPath);
  const entries = [];
  async function visit(directory, relativeDirectory = "") {
    const children = await fsp.readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const child of children) {
      if (/[\u0000\r\n]/.test(child.name)) throw new PolicyError("Artifact contains a control character in a filename");
      const absolute = path.join(directory, child.name);
      const relative = portablePath(path.join(relativeDirectory, child.name));
      const stat = await fsp.lstat(absolute);
      const mode = stat.mode & 0o7777;
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        entries.push({ path: relative, type: "directory", mode });
        await visit(absolute, path.join(relativeDirectory, child.name));
      } else if (stat.isFile() && !stat.isSymbolicLink()) {
        entries.push({ path: relative, type: "file", mode, size: stat.size, sha256: await hashFile(absolute) });
      } else if (stat.isSymbolicLink()) {
        const target = await fsp.readlink(absolute);
        const resolved = await fsp.realpath(absolute).catch(() => "");
        if (!resolved || (resolved !== root && !isPathInside(root, resolved))) {
          throw new PolicyError(`Artifact symlink escapes or is dangling: ${relative}`);
        }
        entries.push({ path: relative, type: "symlink", mode, target });
      } else {
        throw new PolicyError(`Artifact contains an unsupported filesystem entry: ${relative}`);
      }
    }
  }
  await visit(root);
  return { schemaVersion: 1, entries };
}

export function manifestDigest(manifestText) {
  return crypto.createHash("sha256").update(manifestText).digest("hex");
}

async function makeReadOnly(directory) {
  const children = await fsp.readdir(directory, { withFileTypes: true });
  for (const child of children) {
    const absolute = path.join(directory, child.name);
    const stat = await fsp.lstat(absolute);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      await makeReadOnly(absolute);
      await fsp.chmod(absolute, 0o555);
    } else if (stat.isFile() && !stat.isSymbolicLink()) {
      await fsp.chmod(absolute, 0o444);
    }
  }
}

async function makeRemovable(directory) {
  await fsp.chmod(directory, 0o700).catch(() => {});
  const children = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const child of children) {
    const absolute = path.join(directory, child.name);
    const stat = await fsp.lstat(absolute).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory() && !stat.isSymbolicLink()) await makeRemovable(absolute);
    else if (stat.isFile() && !stat.isSymbolicLink()) await fsp.chmod(absolute, 0o600).catch(() => {});
  }
}

async function sealArtifactSource({
  config,
  sourcePath,
  ticketId,
  sealId,
  kind = "standalone",
  allowedPaths = [],
  requiredPaths = [],
}) {
  const source = await fsp.realpath(sourcePath);
  const sourceStat = await fsp.lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new PolicyError("Build artifact root must be a regular directory");

  const sealedRoot = path.join(path.resolve(config.stateDir), "sealed-artifacts");
  await fsp.mkdir(sealedRoot, { recursive: true, mode: 0o700 });
  await fsp.chmod(sealedRoot, 0o700);
  const staging = await fsp.mkdtemp(path.join(sealedRoot, ".incoming-"));
  const artifactPath = path.join(staging, "standalone");
  try {
    await fsp.cp(source, artifactPath, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    if (kind === "standalone") await assertPlatformNeutralArtifact(artifactPath);
    else if (kind === "reviewed-source") await assertReviewedSourceArtifact(artifactPath, { allowedPaths, requiredPaths });
    else throw new PolicyError(`Unsupported sealed artifact kind: ${kind}`);
    await makeReadOnly(artifactPath);
    await fsp.chmod(artifactPath, 0o555);
    const manifest = await createArtifactManifest(artifactPath);
    const manifestText = JSON.stringify(manifest);
    const manifestSha256 = manifestDigest(manifestText);
    const manifestPath = path.join(staging, "manifest.json");
    await fsp.writeFile(manifestPath, manifestText, { mode: 0o400 });
    const finalPath = path.join(sealedRoot, `${safeSlug(ticketId)}-${safeSlug(sealId)}`);
    try {
      await fsp.lstat(finalPath);
      throw new PolicyError("Sealed artifact destination already exists");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await fsp.rename(staging, finalPath);
    await fsp.chmod(finalPath, 0o500);
    return {
      kind,
      rootPath: finalPath,
      artifactPath: path.join(finalPath, "standalone"),
      manifestPath: path.join(finalPath, "manifest.json"),
      manifestSha256,
    };
  } catch (error) {
    await makeRemovable(staging).catch(() => {});
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function sealBuildArtifact({ config, worktreePath, ticketId, commitSha }) {
  const resolvedWorktree = await fsp.realpath(worktreePath);
  const source = await fsp.realpath(path.join(resolvedWorktree, "website", "dist", "standalone"));
  if (!isPathInside(resolvedWorktree, source)) throw new PolicyError("Build artifact escaped the ticket worktree");
  return sealArtifactSource({ config, sourcePath: source, ticketId, sealId: commitSha });
}

export async function sealExternalBuildArtifact({ config, sourcePath, trustedSourceRoot, ticketId, treeSha }) {
  const source = await fsp.realpath(sourcePath);
  const trustedRoot = await fsp.realpath(trustedSourceRoot);
  if (!isPathInside(trustedRoot, source)) throw new PolicyError("Container artifact escaped its trusted export directory");
  return sealArtifactSource({ config, sourcePath: source, ticketId, sealId: treeSha });
}

export async function sealExternalSourceArtifact({
  config,
  sourcePath,
  trustedSourceRoot,
  ticketId,
  treeSha,
  allowedPaths,
  requiredPaths,
}) {
  const source = await fsp.realpath(sourcePath);
  const trustedRoot = await fsp.realpath(trustedSourceRoot);
  if (source !== trustedRoot && !isPathInside(trustedRoot, source)) {
    throw new PolicyError("Source artifact escaped its trusted export directory");
  }
  return sealArtifactSource({
    config,
    sourcePath: source,
    ticketId,
    sealId: treeSha,
    kind: "reviewed-source",
    allowedPaths,
    requiredPaths,
  });
}

export async function verifySealedArtifact(seal) {
  const rootStat = await fsp.lstat(seal.rootPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o022) !== 0) {
    throw new PolicyError("Sealed artifact root identity or permissions are unsafe");
  }
  const manifestText = await fsp.readFile(seal.manifestPath, "utf8");
  if (manifestDigest(manifestText) !== seal.manifestSha256) throw new PolicyError("Sealed artifact manifest digest changed");
  const expected = JSON.parse(manifestText);
  const actual = await createArtifactManifest(seal.artifactPath);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new PolicyError("Sealed artifact content changed after verification");
  return true;
}

export async function cleanupSealedArtifact(seal) {
  if (!seal?.rootPath) return;
  await makeRemovable(seal.rootPath).catch(() => {});
  await fsp.rm(seal.rootPath, { recursive: true, force: true });
}
