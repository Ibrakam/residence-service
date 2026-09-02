import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConfigError, PolicyError } from "./errors.mjs";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

function sbString(value) {
  return JSON.stringify(path.resolve(String(value)));
}

function uniquePaths(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function pathRules(operation, values) {
  return uniquePaths(values).map((value) => `(${operation} (subpath ${sbString(value)}))`).join("\n");
}

function literalRules(operation, values) {
  return uniquePaths(values).map((value) => `(${operation} (literal ${sbString(value)}))`).join("\n");
}

export function verificationRuntimePaths(env = process.env) {
  const roots = ["/System", "/usr", "/bin", "/sbin", "/Library/Apple"];
  const entries = String(env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    const absolute = path.resolve(entry);
    const nvmMatch = /^(.*\/\.nvm\/versions\/node\/[^/]+)\/bin$/.exec(absolute);
    if (nvmMatch) roots.push(nvmMatch[1]);
    else if (absolute === "/usr/local/bin" || absolute.startsWith("/usr/local/")) roots.push("/usr/local");
    else if (absolute === "/opt/homebrew/bin" || absolute.startsWith("/opt/homebrew/")) roots.push("/opt/homebrew");
    else roots.push(absolute);
  }
  const executable = path.resolve(process.execPath);
  const executableNvm = /^(.*\/\.nvm\/versions\/node\/[^/]+)\/bin\/[^/]+$/.exec(executable);
  if (executableNvm) roots.push(executableNvm[1]);
  else roots.push(path.dirname(executable));
  return uniquePaths(roots);
}

export function buildVerificationProfile({ worktreePath, tempPath, runtimePaths = verificationRuntimePaths(), allowNetwork = false }) {
  const readPaths = uniquePaths([
    worktreePath,
    tempPath,
    ...runtimePaths,
    "/dev",
    "/private/etc/ssl",
    "/private/var/db/timezone",
  ]);
  const writePaths = uniquePaths([worktreePath, tempPath, "/dev"]);
  const ancestorRules = uniquePaths([...readPaths, ...writePaths])
    .map((value) => `(allow file-read-metadata file-test-existence (path-ancestors ${sbString(value)}))`)
    .join("\n");
  const networkRule = allowNetwork ? "(allow network-outbound)" : "(deny network*)";
  return `(version 1)
(deny default)
(import "system.sb")
(allow process*)
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup)
(allow ipc-posix-shm*)
${ancestorRules}
(allow file-read* file-test-existence file-map-executable
${readPaths.map((value) => `  (subpath ${sbString(value)})`).join("\n")})
(allow file-write*
${writePaths.map((value) => `  (subpath ${sbString(value)})`).join("\n")})
(deny file-write* (subpath "/cores") (literal "/dev/dtracehelper"))
${networkRule}
`;
}

export function defaultCodexSensitivePaths(config = {}) {
  const home = os.homedir();
  const codexHome = path.resolve(config.codexHome || path.join(home, ".codex"));
  const stateDir = config.stateDir ? path.resolve(config.stateDir) : "";
  return uniquePaths([
    path.join(home, ".ssh"),
    path.join(home, ".aws"),
    path.join(home, ".kube"),
    path.join(home, ".docker"),
    "/var/run/docker.sock",
    path.join(home, ".docker", "run", "docker.sock"),
    path.join(home, "Library", "Containers", "com.docker.docker"),
    path.join(home, "Library", "Group Containers", "group.com.docker"),
    path.join(home, ".config", "gcloud"),
    path.join(home, ".netrc"),
    path.join(home, ".git-credentials"),
    path.join(home, ".npmrc"),
    path.join(home, "Library", "Keychains"),
    path.join(home, "Library", "Safari"),
    path.join(home, "Library", "Application Support", "BraveSoftware"),
    path.join(home, "Library", "Application Support", "Google", "Chrome"),
    path.join(home, "Library", "Application Support", "Chromium"),
    path.join(home, "Library", "Application Support", "Firefox", "Profiles"),
    path.join(codexHome, "config.toml"),
    path.join(codexHome, "auth.json"),
    path.join(codexHome, "AGENTS.md"),
    path.join(codexHome, "rules"),
    path.join(codexHome, "skills"),
    path.join(codexHome, "plugins"),
    path.join(codexHome, "sessions"),
    path.join(codexHome, "archived_sessions"),
    path.join(codexHome, "shell_snapshots"),
    path.join(codexHome, "logs"),
    path.join(codexHome, "history.jsonl"),
    path.join(codexHome, "session_index.jsonl"),
    path.join(codexHome, "goals_1.sqlite"),
    path.join(codexHome, "memories_1.sqlite"),
    path.join(codexHome, "queue_1.sqlite"),
    path.join(codexHome, "state_5.sqlite"),
    path.join(codexHome, "thread_history_1.sqlite"),
    path.join(codexHome, "transcription-history.jsonl"),
    config.runnerEnvFile,
    config.apiTokenFile,
    config.deployScript,
    stateDir && path.join(stateDir, "sealed-artifacts"),
    stateDir && path.join(stateDir, "bin"),
    stateDir && path.join(stateDir, "tickets"),
    stateDir && path.join(stateDir, "test-results"),
    stateDir && path.join(stateDir, "runner.env"),
    stateDir && path.join(stateDir, "worker-api-token"),
  ]);
}

export function buildCodexGuardProfile({
  sensitivePaths,
  worktreePath,
  runtimeHome,
  tempPath,
  homePath,
  repoRoot,
  codexBin,
  runtimePaths = verificationRuntimePaths(),
}) {
  const paths = uniquePaths(sensitivePaths);
  const readPaths = uniquePaths([
    worktreePath,
    runtimeHome,
    tempPath,
    homePath,
    repoRoot && path.join(repoRoot, ".git"),
    codexBin,
    ...runtimePaths,
    "/Applications/ChatGPT.app",
    "/dev",
    "/private/etc",
    "/private/var/db/timezone",
  ]);
  const writePaths = uniquePaths([worktreePath, runtimeHome, tempPath, homePath, "/dev"]);
  const ancestorRules = uniquePaths([...readPaths, ...writePaths])
    .map((value) => `(allow file-read-metadata file-test-existence (path-ancestors ${sbString(value)}))`)
    .join("\n");
  return `(version 1)
(deny default)
(import "system.sb")
(allow process*)
(allow signal)
(allow sysctl-read)
(allow mach-lookup)
(allow ipc-posix-shm*)
(allow network*)
${ancestorRules}
(allow file-read* file-test-existence file-map-executable
${readPaths.map((value) => `  (subpath ${sbString(value)})`).join("\n")})
(allow file-write*
${writePaths.map((value) => `  (subpath ${sbString(value)})`).join("\n")})
${pathRules("deny file-read* file-test-existence", paths)}
${pathRules("deny file-write*", paths)}
`;
}

export async function createSandboxContext({ stateDir, prefix, profile }) {
  if (process.platform !== "darwin") {
    throw new ConfigError("Ticket runner sandboxing requires macOS sandbox-exec");
  }
  try {
    const stat = await fs.stat(SANDBOX_EXEC);
    if (!stat.isFile()) throw new Error("not a regular file");
  } catch (cause) {
    throw new ConfigError(`${SANDBOX_EXEC} is required`, { cause });
  }
  const sandboxRoot = path.join(path.resolve(stateDir), "sandboxes");
  await fs.mkdir(sandboxRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(sandboxRoot, 0o700);
  let directory = await fs.mkdtemp(path.join(sandboxRoot, `${prefix}-`));
  directory = await fs.realpath(directory);
  await fs.chmod(directory, 0o700);
  let tempPath = path.join(directory, "tmp");
  let homePath = path.join(directory, "home");
  await fs.mkdir(tempPath, { recursive: true, mode: 0o700 });
  await fs.mkdir(homePath, { recursive: true, mode: 0o700 });
  tempPath = await fs.realpath(tempPath);
  homePath = await fs.realpath(homePath);
  const profilePath = path.join(directory, "profile.sb");
  const content = typeof profile === "function" ? profile({ directory, tempPath, homePath }) : profile;
  if (!content || typeof content !== "string") throw new PolicyError("Sandbox profile generation failed");
  await fs.writeFile(profilePath, content, { encoding: "utf8", mode: 0o600 });
  return {
    directory,
    tempPath,
    homePath,
    profilePath,
    async cleanup() {
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}

export function sandboxArgv(profilePath, argv) {
  if (!Array.isArray(argv) || argv.length === 0) throw new PolicyError("Sandbox command argv is empty");
  return [SANDBOX_EXEC, "-f", profilePath, ...argv];
}

export { literalRules, pathRules, sbString };
