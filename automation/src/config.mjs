import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError } from "./errors.mjs";
import { cleanText, safeSlug } from "./sanitize.mjs";

const AUTOMATION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REPO_ROOT = path.resolve(AUTOMATION_ROOT, "..");
const DEFAULT_CODEX_BIN = "/Applications/ChatGPT.app/Contents/Resources/codex";
const DEFAULT_DOCKER_BIN = "/usr/local/bin/docker";
const DEFAULT_DOCKER_IMAGE = "docker.io/library/node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5";

const DEFAULT_VERIFY_COMMANDS = [
  { name: "website-install", cwd: "website", argv: ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], timeoutMs: 15 * 60_000 },
  { name: "website-lint", cwd: "website", argv: ["npm", "run", "lint"], timeoutMs: 10 * 60_000 },
  { name: "website-build", cwd: "website", argv: ["npm", "run", "build"], timeoutMs: 20 * 60_000 },
];

const DEFAULT_DENIED_PATH_PATTERNS = [
  /^automation(?:\/|$)/i,
  /^\.github(?:\/|$)/i,
  /(^|\/)\.git(?:\/|$)/i,
  /(^|\/)\.git(?:attributes|ignore|modules)$/i,
  /(^|\/)\.codex(?:\/|$)/i,
  /(^|\/)AGENTS\.md$/i,
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:auth|credentials?|secrets?)(?:\.|\/|$)/i,
  /(^|\/)(?:deploy|release|publish)(?:[-_.\/]|$)/i,
  /(^|\/)package(?:-lock)?\.json$/i,
  /(^|\/)(?:npm-shrinkwrap\.json|pnpm-lock\.ya?ml|yarn\.lock|bun\.lockb?)$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)(?:scripts?|bin)(?:\/|$)/i,
  /(^|\/)(?:next|vite|webpack|rollup|eslint|postcss|tailwind)\.config(?:\.[^/]+)?$/i,
  /\.(?:pem|key|p12|pfx|keystore)$/i,
  /(^|\/)config\.(?:toml|json|ya?ml)$/i,
];

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  if (/^(?:1|true|yes|on)$/i.test(value)) return true;
  if (/^(?:0|false|no|off)$/i.test(value)) return false;
  throw new ConfigError(`Invalid boolean value: ${value}`);
}

function parseInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(`Integer value must be between ${min} and ${max}`);
  }
  return parsed;
}

function parseCsv(value, fallback = []) {
  if (!value) return [...fallback];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function unquoteEnvValue(raw) {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch (cause) {
      throw new ConfigError("Invalid JSON-style double-quoted value in runner env file", { cause });
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseEnvFile(text) {
  const values = {};
  for (const [index, rawLine] of String(text).split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new ConfigError(`Invalid runner env line ${index + 1}`);
    if (Object.hasOwn(values, match[1])) throw new ConfigError(`Duplicate runner env key: ${match[1]}`);
    values[match[1]] = unquoteEnvValue(match[2]);
  }
  return values;
}

function loadEnvFile(baseEnv) {
  const envFile = baseEnv.RUNNER_ENV_FILE;
  if (!envFile) return { ...baseEnv };
  const absolute = path.resolve(envFile);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch (cause) {
    throw new ConfigError(`RUNNER_ENV_FILE is not readable: ${absolute}`, { cause });
  }
  if (!stat.isFile()) throw new ConfigError("RUNNER_ENV_FILE must be a regular file");
  if ((stat.mode & 0o077) !== 0) throw new ConfigError("RUNNER_ENV_FILE must not be readable or writable by group/others (chmod 600)");
  const fromFile = parseEnvFile(fs.readFileSync(absolute, "utf8"));
  return { ...fromFile, ...baseEnv };
}

function readSecretFile(filename, label) {
  if (!filename) return "";
  const absolute = path.resolve(filename);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch (cause) {
    throw new ConfigError(`${label} file is not readable`, { cause });
  }
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new ConfigError(`${label} file must be a regular chmod 600 file`);
  }
  const value = fs.readFileSync(absolute, "utf8").trim();
  if (!value) throw new ConfigError(`${label} file is empty`);
  return value;
}

function parseJsonArray(value, fallback, label) {
  if (!value) return structuredClone(fallback);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw new ConfigError(`${label} must be valid JSON`, { cause });
  }
  if (!Array.isArray(parsed)) throw new ConfigError(`${label} must be a JSON array`);
  return parsed;
}

function normalizeVerifyCommands(raw, defaultTimeoutMs) {
  if (raw.length === 0) throw new ConfigError("At least one fixed verification command is required");
  return raw.map((command, index) => {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw new ConfigError(`Verification command ${index + 1} must be an object`);
    }
    if (!Array.isArray(command.argv) || command.argv.length === 0 || command.argv.some((part) => typeof part !== "string" || !part)) {
      throw new ConfigError(`Verification command ${index + 1} has invalid argv`);
    }
    const cwd = cleanText(command.cwd || ".", 256).replaceAll("\\", "/");
    if (path.posix.isAbsolute(cwd) || cwd === ".." || cwd.startsWith("../")) {
      throw new ConfigError(`Verification command ${index + 1} cwd must stay inside the worktree`);
    }
    return {
      name: safeSlug(command.name || `verification-${index + 1}`),
      cwd,
      argv: [...command.argv],
      timeoutMs: parseInteger(String(command.timeoutMs ?? ""), defaultTimeoutMs, { min: 1_000, max: 60 * 60_000 }),
    };
  });
}

function normalizeDeployArgs(raw) {
  if (raw.some((entry) => typeof entry !== "string")) throw new ConfigError("RUNNER_DEPLOY_ARGS_JSON must contain only strings");
  return raw;
}

function normalizeSmokeUrls(raw, allowHttp) {
  return raw.map((entry) => {
    let url;
    try {
      url = new URL(entry);
    } catch (cause) {
      throw new ConfigError(`Invalid smoke URL: ${entry}`, { cause });
    }
    if (url.username || url.password) throw new ConfigError("Smoke URLs must not contain credentials");
    if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
      throw new ConfigError("Smoke URLs must use HTTPS outside test mode");
    }
    return url;
  });
}

function selectedEnvironment(env, names, { allowSecrets = false } = {}) {
  const selected = {};
  for (const name of names) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new ConfigError(`Invalid environment allowlist name: ${name}`);
    if (!allowSecrets && /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|AUTH|COOKIE)/i.test(name)) {
      throw new ConfigError(`Verification environment must not expose secret-like variable: ${name}`);
    }
    if (Object.hasOwn(env, name)) selected[name] = env[name];
  }
  return selected;
}

export function parseCliArgs(argv) {
  const result = { once: false, dryRun: false, configCheck: false, testTicketFile: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--once") result.once = true;
    else if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--config-check") result.configCheck = true;
    else if (arg === "--test-ticket") {
      const filename = argv[index + 1];
      if (!filename) throw new ConfigError("--test-ticket requires a JSON filename");
      result.testTicketFile = path.resolve(filename);
      result.once = true;
      result.dryRun = true;
      index += 1;
    } else {
      throw new ConfigError(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

export function loadConfig({ env: rawEnv = process.env, argv = process.argv.slice(2) } = {}) {
  const cli = parseCliArgs(argv);
  const env = loadEnvFile(rawEnv);
  const testTicketFile = cli.testTicketFile || (env.RUNNER_TEST_TICKET_FILE ? path.resolve(env.RUNNER_TEST_TICKET_FILE) : "");
  const testMode = Boolean(testTicketFile);
  // Publishing is deliberately opt-out at the parser level and additionally
  // blocked below. A missing/stale env file can therefore never enable it.
  const dryRun = cli.dryRun || parseBoolean(env.RUNNER_DRY_RUN, true) || testMode;
  const stateDir = path.resolve(env.RUNNER_STATE_DIR || path.join(os.homedir(), "Library", "Application Support", "AvalonTicketRunner"));
  const defaultCommandTimeoutMs = parseInteger(env.RUNNER_COMMAND_TIMEOUT_MS, 20 * 60_000, { min: 1_000, max: 60 * 60_000 });
  const verifyRaw = parseJsonArray(env.RUNNER_VERIFY_COMMANDS_JSON, DEFAULT_VERIFY_COMMANDS, "RUNNER_VERIFY_COMMANDS_JSON");
  const deployArgs = normalizeDeployArgs(parseJsonArray(env.RUNNER_DEPLOY_ARGS_JSON, [], "RUNNER_DEPLOY_ARGS_JSON"));
  const allowedPrefixes = parseCsv(env.RUNNER_ALLOWED_PATHS, ["website"])
    .map((entry) => entry.replace(/^\.\//, "").replace(/\/$/, ""))
    .filter(Boolean);
  if (allowedPrefixes.length === 0) throw new ConfigError("RUNNER_ALLOWED_PATHS must not be empty");

  const serverBaseUrl = env.RUNNER_SERVER_BASE_URL ? new URL(env.RUNNER_SERVER_BASE_URL) : null;
  if (serverBaseUrl && !serverBaseUrl.pathname.endsWith("/")) serverBaseUrl.pathname += "/";
  if (serverBaseUrl && !testMode && serverBaseUrl.protocol !== "https:" && serverBaseUrl.hostname !== "127.0.0.1" && serverBaseUrl.hostname !== "localhost") {
    throw new ConfigError("RUNNER_SERVER_BASE_URL must use HTTPS unless it is localhost");
  }

  const apiToken = env.RUNNER_API_TOKEN_FILE
    ? readSecretFile(env.RUNNER_API_TOKEN_FILE, "Runner API token")
    : cleanText(env.RUNNER_API_TOKEN || "", 8_192);

  const verificationEnvAllowlist = parseCsv(env.RUNNER_VERIFICATION_ENV_ALLOWLIST, [
    "CI",
    "NODE_ENV",
    "NEXT_PUBLIC_SITE_URL",
    "NEXT_PUBLIC_APP_BASE_PATH",
    "NEXT_PUBLIC_ASSET_PREFIX",
    "NEXT_PUBLIC_CATALOG_API_URL",
  ]);
  const deployEnvAllowlist = parseCsv(env.RUNNER_DEPLOY_ENV_ALLOWLIST, ["SSH_AUTH_SOCK"]);
  const config = {
    automationRoot: AUTOMATION_ROOT,
    runnerId: safeSlug(env.RUNNER_ID || `${os.hostname()}-${os.userInfo().username}`, "ticket-runner"),
    logLevel: env.RUNNER_LOG_LEVEL || "info",
    once: cli.once || parseBoolean(env.RUNNER_ONCE, false) || testMode,
    configCheck: cli.configCheck,
    dryRun,
    testMode,
    testTicketFile,
    repoRoot: path.resolve(env.RUNNER_REPO_ROOT || DEFAULT_REPO_ROOT),
    stateDir,
    worktreeRoot: path.resolve(env.RUNNER_WORKTREE_ROOT || path.join(stateDir, "worktrees")),
    codexBin: path.resolve(env.CODEX_BIN || DEFAULT_CODEX_BIN),
    codexHome: path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex")),
    runnerEnvFile: env.RUNNER_ENV_FILE ? path.resolve(env.RUNNER_ENV_FILE) : "",
    apiTokenFile: env.RUNNER_API_TOKEN_FILE ? path.resolve(env.RUNNER_API_TOKEN_FILE) : "",
    codexModel: cleanText(env.RUNNER_CODEX_MODEL || "", 128),
    codexTimeoutMs: parseInteger(env.RUNNER_CODEX_TIMEOUT_MS, 45 * 60_000, { min: 10_000, max: 4 * 60 * 60_000 }),
    dockerBin: path.resolve(env.RUNNER_DOCKER_BIN || DEFAULT_DOCKER_BIN),
    dockerImage: cleanText(env.RUNNER_DOCKER_IMAGE || DEFAULT_DOCKER_IMAGE, 512),
    dockerPlatform: "linux/amd64",
    dockerPidsLimit: parseInteger(env.RUNNER_DOCKER_PIDS_LIMIT, 1_024, { min: 64, max: 1_024 }),
    dockerMemory: cleanText(env.RUNNER_DOCKER_MEMORY || "4g", 32),
    dockerCpus: cleanText(env.RUNNER_DOCKER_CPUS || "3", 16),
    commandTimeoutMs: defaultCommandTimeoutMs,
    pollIntervalMs: parseInteger(env.RUNNER_POLL_INTERVAL_MS, 5_000, { min: 500, max: 5 * 60_000 }),
    leaseSeconds: parseInteger(env.RUNNER_LEASE_SECONDS, 180, { min: 30, max: 3_600 }),
    heartbeatIntervalMs: parseInteger(env.RUNNER_HEARTBEAT_INTERVAL_MS, 30_000, { min: 5_000, max: 5 * 60_000 }),
    maxHeartbeatFailures: parseInteger(env.RUNNER_MAX_HEARTBEAT_FAILURES, 3, { min: 1, max: 20 }),
    serverBaseUrl,
    apiToken,
    serverTimeoutMs: parseInteger(env.RUNNER_SERVER_TIMEOUT_MS, 20_000, { min: 1_000, max: 120_000 }),
    attachmentAllowedHosts: parseCsv(env.RUNNER_ATTACHMENT_ALLOWED_HOSTS, serverBaseUrl ? [serverBaseUrl.hostname] : []),
    attachmentMaxCount: parseInteger(env.RUNNER_ATTACHMENT_MAX_COUNT, 10, { min: 0, max: 30 }),
    attachmentMaxBytes: parseInteger(env.RUNNER_ATTACHMENT_MAX_BYTES, 25 * 1024 * 1024, { min: 1_024, max: 250 * 1024 * 1024 }),
    ticketBodyMaxChars: parseInteger(env.RUNNER_TICKET_BODY_MAX_CHARS, 40_000, { min: 100, max: 200_000 }),
    allowedPrefixes,
    deniedPathPatterns: DEFAULT_DENIED_PATH_PATTERNS,
    enforceSingleProjectScope: true,
    maxChangedFiles: parseInteger(env.RUNNER_MAX_CHANGED_FILES, 25, { min: 1, max: 25 }),
    maxChangedLines: parseInteger(env.RUNNER_MAX_CHANGED_LINES, 3_000, { min: 1, max: 3_000 }),
    maxChangedBlobBytes: parseInteger(env.RUNNER_MAX_CHANGED_BLOB_BYTES, 16 * 1024 * 1024, { min: 1_024, max: 16 * 1024 * 1024 }),
    verifyCommands: normalizeVerifyCommands(verifyRaw, defaultCommandTimeoutMs),
    verificationEnvAllowlist,
    verificationEnvironment: selectedEnvironment(env, verificationEnvAllowlist),
    gitAuthorName: cleanText(env.RUNNER_GIT_AUTHOR_NAME || "Avalon Ticket Bot", 128),
    gitAuthorEmail: cleanText(env.RUNNER_GIT_AUTHOR_EMAIL || "ticket-bot@localhost", 254),
    deployScript: env.RUNNER_DEPLOY_SCRIPT ? path.resolve(env.RUNNER_DEPLOY_SCRIPT) : "",
    deployArgs,
    deployTimeoutMs: parseInteger(env.RUNNER_DEPLOY_TIMEOUT_MS, 20 * 60_000, { min: 1_000, max: 2 * 60 * 60_000 }),
    deployEnvAllowlist,
    deployEnvironment: selectedEnvironment(env, deployEnvAllowlist, { allowSecrets: true }),
    smokeUrls: normalizeSmokeUrls(parseCsv(env.RUNNER_SMOKE_URLS), testMode),
    smokeTimeoutMs: parseInteger(env.RUNNER_SMOKE_TIMEOUT_MS, 30_000, { min: 1_000, max: 5 * 60_000 }),
    keepSuccessfulWorktrees: parseBoolean(env.RUNNER_KEEP_SUCCESSFUL_WORKTREES, false),
    keepFailedWorktrees: parseBoolean(env.RUNNER_KEEP_FAILED_WORKTREES, true),
  };

  validateStaticConfig(config);
  return config;
}

export function validateStaticConfig(config) {
  if (!fs.existsSync(config.codexBin)) throw new ConfigError(`CODEX_BIN does not exist: ${config.codexBin}`);
  if (!fs.statSync(config.codexBin).isFile()) throw new ConfigError("CODEX_BIN must be a regular file");
  if (config.heartbeatIntervalMs >= config.leaseSeconds * 1_000) {
    throw new ConfigError("Heartbeat interval must be shorter than the lease duration");
  }
  if (!config.testMode) {
    if (!config.serverBaseUrl) throw new ConfigError("RUNNER_SERVER_BASE_URL is required");
    if (!config.apiToken) throw new ConfigError("RUNNER_API_TOKEN_FILE or RUNNER_API_TOKEN is required");
  }
  if (!config.dryRun) {
    throw new ConfigError("Automatic push/deploy is disabled. RUNNER_DRY_RUN must remain true");
  }
  if (!config.dryRun) {
    if (!fs.existsSync(config.dockerBin) || !fs.statSync(config.dockerBin).isFile()) {
      throw new ConfigError(`RUNNER_DOCKER_BIN must resolve to a regular file: ${config.dockerBin}`);
    }
    if (!/^docker\.io\/library\/node@sha256:[a-f0-9]{64}$/.test(config.dockerImage)) {
      throw new ConfigError("RUNNER_DOCKER_IMAGE must be an immutable docker.io/library/node SHA-256 digest");
    }
    if (!/^\d+(?:\.\d+)?[kmg]$/i.test(config.dockerMemory)) throw new ConfigError("RUNNER_DOCKER_MEMORY has an invalid value");
    if (!/^\d+(?:\.\d+)?$/.test(config.dockerCpus)) throw new ConfigError("RUNNER_DOCKER_CPUS has an invalid value");
    if (!config.deployScript) throw new ConfigError("RUNNER_DEPLOY_SCRIPT is required outside dry-run mode");
    if (!path.isAbsolute(config.deployScript)) throw new ConfigError("RUNNER_DEPLOY_SCRIPT must be absolute");
    if (config.smokeUrls.length === 0) throw new ConfigError("At least one RUNNER_SMOKE_URLS entry is required outside dry-run mode");
    const lstat = fs.lstatSync(config.deployScript);
    if (!lstat.isFile() || lstat.isSymbolicLink()) throw new ConfigError("RUNNER_DEPLOY_SCRIPT must be a regular non-symlink file");
    const currentUid = typeof process.getuid === "function" ? process.getuid() : lstat.uid;
    if (lstat.uid !== 0 && lstat.uid !== currentUid) throw new ConfigError("RUNNER_DEPLOY_SCRIPT must be owned by root or the runner user");
    if ((lstat.mode & 0o022) !== 0) throw new ConfigError("RUNNER_DEPLOY_SCRIPT must not be group/world writable");
    const realPath = fs.realpathSync(config.deployScript);
    const bytes = fs.readFileSync(realPath);
    config.deployScriptPin = {
      realPath,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      uid: lstat.uid,
      dev: lstat.dev,
      ino: lstat.ino,
      mode: lstat.mode,
    };
  }
}

export function safeChildEnv(baseEnv, { extraAllowlist = [], codexHome } = {}) {
  const always = ["HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "USER", "LOGNAME", "SHELL", "TERM", "TZ"];
  const result = {};
  for (const key of new Set([...always, ...extraAllowlist])) {
    if (!Object.hasOwn(baseEnv, key)) continue;
    if (/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|AUTH|COOKIE)/i.test(key)) continue;
    result[key] = baseEnv[key];
  }
  result.PATH = result.PATH || "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin";
  result.HOME = result.HOME || os.homedir();
  result.LANG = result.LANG || "C.UTF-8";
  result.TERM = "dumb";
  result.NO_COLOR = "1";
  if (codexHome) result.CODEX_HOME = codexHome;
  return result;
}

export { DEFAULT_DENIED_PATH_PATTERNS, DEFAULT_VERIFY_COMMANDS };
