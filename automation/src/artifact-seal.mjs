import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { PolicyError } from "./errors.mjs";
import { isPathInside, safeSlug } from "./sanitize.mjs";

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
      await fsp.chmod(absolute, 0o500);
    } else if (stat.isFile() && !stat.isSymbolicLink()) {
      await fsp.chmod(absolute, 0o400);
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

async function sealArtifactSource({ config, sourcePath, ticketId, sealId }) {
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
    await makeReadOnly(artifactPath);
    await fsp.chmod(artifactPath, 0o500);
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
