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
const REVIEWED_DOCKER_HOST_PINS = Object.freeze({
  "darwin-arm64": Object.freeze({
    platform: "linux/arm64",
    architecture: "arm64",
    childImage: "docker.io/library/node@sha256:8d342e46d3b2883df69f797cb60fc71d8a0b65de65ddfbf4bf63fdc02049615f",
    imageId: "sha256:97aaa653fb55806b0d7acc6c93dd4f3f06b373a286c988bd68c0527d4310bb05",
  }),
  "darwin-x64": Object.freeze({
    platform: "linux/amd64",
    architecture: "amd64",
    childImage: "docker.io/library/node@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96",
    imageId: "sha256:6e6261159fd399ebe5a3d556b7d89da9c85c873f3f270918aad6c8107da8b411",
  }),
});
const DEFAULT_DOCKER_HOST_PIN = REVIEWED_DOCKER_HOST_PINS[`${process.platform}-${process.arch}`] || null;
const DEFAULT_GITHUB_CLI_BIN = "/opt/homebrew/bin/gh";
const PRODUCTION_ENABLE_CONFIRMATION = "DEPLOY_FORM_TENCORP_UZ_MAIN";
const PRODUCTION_ORIGIN = "https://github.com/Ibrakam/residence-service.git";
const PRODUCTION_WORKER_API_URL = "https://form.tencorp.uz/__residence-ticket-worker/";
const PRODUCTION_PUBLIC_ORIGIN = "https://form.tencorp.uz";
const TRUSTED_DEPLOY_SCRIPT_BASENAME = "deploy-residence-root-remote";
const MARKET_MAP_PROJECT_KEY = "market-map";
const MARKET_MAP_ORIGIN = "https://github.com/Ibrakam/tencorp-market-map.git";
const MARKET_MAP_PUBLIC_URL = `${PRODUCTION_PUBLIC_ORIGIN}/market-map/`;
const MARKET_MAP_DEPLOY_SCRIPT_BASENAME = "deploy-market-map-remote";
const MARKET_MAP_PYTHON_BIN = "/Applications/Xcode.app/Contents/Developer/usr/bin/python3";
const MARKET_MAP_PYTHON_RUNTIME_ROOT = "/Applications/Xcode.app/Contents/Developer";
const MARKET_MAP_CHANGED_PATHS = Object.freeze([
  "server.py",
  "dshk_sync.py",
  "leadora_carto_map.html",
  "test_dshk_sync.py",
  "vendor/leaflet.css",
  "vendor/leaflet.js",
]);
const MARKET_MAP_ARTIFACT_PATHS = Object.freeze([
  "server.py",
  "dshk_sync.py",
  "leadora_carto_map.html",
  "vendor/leaflet.css",
  "vendor/leaflet.js",
  "data.json",
]);
const MARKET_MAP_REQUIRED_ARTIFACT_PATHS = Object.freeze([
  "server.py",
  "dshk_sync.py",
  "leadora_carto_map.html",
  "data.json",
]);

const DEFAULT_VERIFY_COMMANDS = [
  { name: "website-install", cwd: "website", argv: ["npm", "ci", "--include=dev", "--ignore-scripts", "--no-audit", "--no-fund"], timeoutMs: 15 * 60_000 },
  { name: "website-lint", cwd: "website", argv: ["npm", "run", "lint"], timeoutMs: 10 * 60_000 },
  { name: "website-build", cwd: "website", argv: ["npm", "run", "build"], timeoutMs: 20 * 60_000 },
];

const MARKET_MAP_SCRIPT_GOAL_CHECK = String.raw`const fs=require("node:fs"),vm=require("node:vm");const filename=process.argv[1];new vm.Script(fs.readFileSync(filename,"utf8"),{filename});`;

const DEFAULT_MARKET_MAP_VERIFY_COMMANDS = [
  {
    name: "market-map-python-compile",
    cwd: ".",
    argv: [MARKET_MAP_PYTHON_BIN, "-m", "py_compile", "server.py", "dshk_sync.py", "test_dshk_sync.py"],
    timeoutMs: 2 * 60_000,
  },
  {
    name: "market-map-unit-tests",
    cwd: ".",
    argv: [MARKET_MAP_PYTHON_BIN, "-m", "unittest", "-v", "test_dshk_sync.py"],
    timeoutMs: 5 * 60_000,
  },
  {
    name: "market-map-data-json",
    cwd: ".",
    argv: [process.execPath, "-e", "JSON.parse(require('node:fs').readFileSync('data.json','utf8'));"],
    timeoutMs: 60_000,
  },
  {
    name: "market-map-vendor-js-syntax",
    cwd: ".",
    argv: [process.execPath, "-e", MARKET_MAP_SCRIPT_GOAL_CHECK, "vendor/leaflet.js"],
    timeoutMs: 60_000,
  },
];

const DEFAULT_DENIED_PATH_PATTERNS = [
  /^automation(?:\/|$)/i,
  /^\.github(?:\/|$)/i,
  /^website\/app\/(?:api|v1)(?:\/|$)/i,
  /^website\/proxy\.(?:ts|js|mts|mjs)$/i,
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

function sameStringArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function pinProjectDeployScript(profile, label) {
  if (!profile.deployScript || !path.isAbsolute(profile.deployScript)) {
    throw new ConfigError(`${label} deployment script must use its fixed absolute path`);
  }
  if (path.resolve(profile.deployScript) !== path.resolve(profile.requiredDeployScriptPath)) {
    throw new ConfigError(`${label} deployment script must be the fixed trusted wrapper: ${profile.requiredDeployScriptPath}`);
  }
  const lstat = fs.lstatSync(profile.deployScript);
  if (!lstat.isFile() || lstat.isSymbolicLink()) throw new ConfigError(`${label} deployment script must be a regular non-symlink file`);
  if ((lstat.mode & 0o111) === 0 || (lstat.mode & 0o022) !== 0) {
    throw new ConfigError(`${label} deployment script has unsafe permissions`);
  }
  const requiredOwnerUid = Number.isSafeInteger(profile.requiredDeployOwnerUid)
    ? profile.requiredDeployOwnerUid
    : (typeof process.getuid === "function" ? process.getuid() : lstat.uid);
  if (lstat.uid !== requiredOwnerUid) throw new ConfigError(`${label} deployment script must be owned by uid ${requiredOwnerUid}`);
  const requiredMode = Number.isSafeInteger(profile.requiredDeployMode) ? profile.requiredDeployMode : 0o700;
  if ((lstat.mode & 0o777) !== requiredMode) {
    throw new ConfigError(`${label} deployment script must have mode ${requiredMode.toString(8)}`);
  }
  const realPath = fs.realpathSync(profile.deployScript);
  profile.deployScriptPin = {
    realPath,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(realPath)).digest("hex"),
    uid: lstat.uid,
    dev: lstat.dev,
    ino: lstat.ino,
    mode: lstat.mode,
  };
}

function createProjectProfiles(config, env, defaultCommandTimeoutMs) {
  const marketMapEnabled = parseBoolean(env.RUNNER_MARKET_MAP_ENABLED, false);
  const marketMapRepoRoot = cleanText(env.RUNNER_MARKET_MAP_REPO_ROOT || "", 1_024);
  if (marketMapEnabled && !marketMapRepoRoot) {
    throw new ConfigError("RUNNER_MARKET_MAP_REPO_ROOT is required when RUNNER_MARKET_MAP_ENABLED=true");
  }
  const marketMapDeployScript = path.join(config.stateDir, "bin", MARKET_MAP_DEPLOY_SCRIPT_BASENAME);
  const marketMapProfile = {
    key: MARKET_MAP_PROJECT_KEY,
    label: "Tencorp Market Map",
    enabled: marketMapEnabled,
    productionVerifierKey: "market-map-source",
    productionVerificationStage: "production_source_verification",
    prePushDeploymentValidation: true,
    repoRoot: marketMapRepoRoot ? path.resolve(marketMapRepoRoot) : "",
    worktreeRoot: path.resolve(env.RUNNER_MARKET_MAP_WORKTREE_ROOT || path.join(config.stateDir, "worktrees-market-map")),
    expectedOrigin: MARKET_MAP_ORIGIN,
    requiredExpectedOrigin: MARKET_MAP_ORIGIN,
    allowedPrefixes: [...MARKET_MAP_CHANGED_PATHS],
    allowedExactPaths: [...MARKET_MAP_CHANGED_PATHS],
    deniedPathPatterns: DEFAULT_DENIED_PATH_PATTERNS,
    enforceSingleProjectScope: false,
    verifyCommands: normalizeVerifyCommands(DEFAULT_MARKET_MAP_VERIFY_COMMANDS, defaultCommandTimeoutMs),
    verificationEnvAllowlist: [],
    verificationEnvironment: {},
    verificationRuntimePaths: [MARKET_MAP_PYTHON_RUNTIME_ROOT],
    marketMapPythonBin: MARKET_MAP_PYTHON_BIN,
    deployScript: marketMapDeployScript,
    requiredDeployScriptPath: marketMapDeployScript,
    requiredDeployOwnerUid: typeof process.getuid === "function" ? process.getuid() : null,
    requiredDeployMode: 0o700,
    deployArgs: [],
    deployEnvAllowlist: [],
    deployEnvironment: {},
    productionPublicUrl: new URL(MARKET_MAP_PUBLIC_URL),
    smokeUrls: [new URL(MARKET_MAP_PUBLIC_URL)],
    smokeChecks: [{ url: new URL(MARKET_MAP_PUBLIC_URL), expectedStatuses: [401] }],
    sourceArtifactPaths: [...MARKET_MAP_ARTIFACT_PATHS],
    sourceArtifactRequiredPaths: [...MARKET_MAP_REQUIRED_ARTIFACT_PATHS],
  };
  return {
    residence: {
      key: "residence",
      label: "Residence Service",
      enabled: true,
      productionVerifierKey: "residence-docker",
    },
    [MARKET_MAP_PROJECT_KEY]: marketMapProfile,
  };
}

export function validateProjectProfiles(config) {
  const marketMap = config.projectProfiles?.[MARKET_MAP_PROJECT_KEY];
  if (!marketMap?.enabled) return;
  if (!marketMap.repoRoot) throw new ConfigError("Enabled market-map profile has no repository root");
  if (marketMap.expectedOrigin !== MARKET_MAP_ORIGIN || marketMap.requiredExpectedOrigin !== MARKET_MAP_ORIGIN) {
    throw new ConfigError(`Market-map profile requires the fixed Git origin: ${MARKET_MAP_ORIGIN}`);
  }
  if (!sameStringArray(marketMap.allowedPrefixes, MARKET_MAP_CHANGED_PATHS)) {
    throw new ConfigError("Market-map changed-path allowlist does not match the reviewed fixed scope");
  }
  if (!sameStringArray(marketMap.allowedExactPaths, MARKET_MAP_CHANGED_PATHS)) {
    throw new ConfigError("Market-map exact changed-path allowlist does not match the reviewed fixed scope");
  }
  if (!sameStringArray(marketMap.sourceArtifactPaths, MARKET_MAP_ARTIFACT_PATHS)) {
    throw new ConfigError("Market-map source artifact scope does not match the reviewed fixed scope");
  }
  if (!sameStringArray(marketMap.sourceArtifactRequiredPaths, MARKET_MAP_REQUIRED_ARTIFACT_PATHS)) {
    throw new ConfigError("Market-map required source artifact files do not match the reviewed fixed scope");
  }
  if (marketMap.productionVerifierKey !== "market-map-source"
    || marketMap.prePushDeploymentValidation !== true
    || !sameStringArray(marketMap.verificationRuntimePaths, [MARKET_MAP_PYTHON_RUNTIME_ROOT])
    || marketMap.marketMapPythonBin !== MARKET_MAP_PYTHON_BIN
    || marketMap.deployArgs.length !== 0
    || marketMap.deployEnvAllowlist.length !== 0
    || Object.keys(marketMap.deployEnvironment).length !== 0) {
    throw new ConfigError("Market-map verifier/deployer contract cannot be overridden");
  }
  let pythonStat;
  try {
    pythonStat = fs.statSync(MARKET_MAP_PYTHON_BIN);
  } catch (cause) {
    throw new ConfigError(`Market-map requires the fixed Xcode Python runtime: ${MARKET_MAP_PYTHON_BIN}`, { cause });
  }
  if (!pythonStat.isFile() || (pythonStat.mode & 0o111) === 0 || pythonStat.uid !== 0 || (pythonStat.mode & 0o022) !== 0) {
    throw new ConfigError("The fixed market-map Python runtime has unsafe identity or permissions");
  }
  if (marketMap.productionPublicUrl?.href !== MARKET_MAP_PUBLIC_URL) {
    throw new ConfigError(`Market-map profile requires the fixed production URL: ${MARKET_MAP_PUBLIC_URL}`);
  }
  if (!Array.isArray(marketMap.smokeChecks) || marketMap.smokeChecks.length !== 1
    || marketMap.smokeChecks[0].url?.href !== MARKET_MAP_PUBLIC_URL
    || !sameStringArray(marketMap.smokeChecks[0].expectedStatuses, [401])) {
    throw new ConfigError("Market-map profile requires the fixed protected-route HTTP 401 smoke contract");
  }
  if (!config.dryRun) pinProjectDeployScript(marketMap, "Market-map");
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
  // Publishing is opt-in at the parser level. A missing/stale env file can
  // therefore never enable it, and local test tickets always force dry-run.
  const dryRun = cli.dryRun || parseBoolean(env.RUNNER_DRY_RUN, true) || testMode;
  const stateDir = path.resolve(env.RUNNER_STATE_DIR || path.join(os.homedir(), "Library", "Application Support", "AvalonTicketRunner"));
  const trustedDeployScriptPath = path.join(stateDir, "bin", TRUSTED_DEPLOY_SCRIPT_BASENAME);
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
  const deployEnvAllowlist = parseCsv(env.RUNNER_DEPLOY_ENV_ALLOWLIST, []);
  const config = {
    automationRoot: AUTOMATION_ROOT,
    runnerId: safeSlug(env.RUNNER_ID || `${os.hostname()}-${os.userInfo().username}`, "ticket-runner"),
    logLevel: env.RUNNER_LOG_LEVEL || "info",
    once: cli.once || parseBoolean(env.RUNNER_ONCE, false) || testMode,
    configCheck: cli.configCheck,
    dryRun,
    autoDeployEnabled: parseBoolean(env.RUNNER_AUTO_DEPLOY_ENABLED, false),
    autoDeployConfirmation: cleanText(env.RUNNER_AUTO_DEPLOY_CONFIRM || "", 128),
    testMode,
    testTicketFile,
    repoRoot: path.resolve(env.RUNNER_REPO_ROOT || DEFAULT_REPO_ROOT),
    expectedOrigin: PRODUCTION_ORIGIN,
    githubCredentialHelperEnabled: true,
    githubCliBin: DEFAULT_GITHUB_CLI_BIN,
    requiredGithubCliPath: DEFAULT_GITHUB_CLI_BIN,
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
    // Platform selection is derived only from the physical macOS runner. It is
    // deliberately not configurable by ticket text or environment variables.
    dockerPlatform: DEFAULT_DOCKER_HOST_PIN?.platform || "",
    dockerArchitecture: DEFAULT_DOCKER_HOST_PIN?.architecture || "",
    dockerChildImage: DEFAULT_DOCKER_HOST_PIN?.childImage || "",
    dockerExpectedImageId: DEFAULT_DOCKER_HOST_PIN?.imageId || "",
    dockerPidsLimit: parseInteger(env.RUNNER_DOCKER_PIDS_LIMIT, 1_024, { min: 64, max: 1_024 }),
    dockerMemory: cleanText(env.RUNNER_DOCKER_MEMORY || "4g", 32),
    dockerCpus: cleanText(env.RUNNER_DOCKER_CPUS || "3", 16),
    commandTimeoutMs: defaultCommandTimeoutMs,
    pollIntervalMs: parseInteger(env.RUNNER_POLL_INTERVAL_MS, 5_000, { min: 500, max: 5 * 60_000 }),
    leaseSeconds: parseInteger(env.RUNNER_LEASE_SECONDS, 180, { min: 30, max: 3_600 }),
    heartbeatIntervalMs: parseInteger(env.RUNNER_HEARTBEAT_INTERVAL_MS, 30_000, { min: 5_000, max: 5 * 60_000 }),
    maxHeartbeatFailures: parseInteger(env.RUNNER_MAX_HEARTBEAT_FAILURES, 3, { min: 1, max: 20 }),
    serverBaseUrl,
    productionPublicUrl: new URL(`${PRODUCTION_PUBLIC_ORIGIN}/`),
    apiToken,
    serverTimeoutMs: parseInteger(env.RUNNER_SERVER_TIMEOUT_MS, 20_000, { min: 1_000, max: 120_000 }),
    attachmentAllowedHosts: parseCsv(env.RUNNER_ATTACHMENT_ALLOWED_HOSTS, serverBaseUrl ? [serverBaseUrl.hostname] : []),
    attachmentMaxCount: parseInteger(env.RUNNER_ATTACHMENT_MAX_COUNT, 10, { min: 0, max: 30 }),
    attachmentMaxBytes: parseInteger(env.RUNNER_ATTACHMENT_MAX_BYTES, 25 * 1024 * 1024, { min: 1_024, max: 250 * 1024 * 1024 }),
    ticketBodyMaxChars: parseInteger(env.RUNNER_TICKET_BODY_MAX_CHARS, 40_000, { min: 100, max: 200_000 }),
    allowedPrefixes,
    deniedPathPatterns: DEFAULT_DENIED_PATH_PATTERNS,
    enforceSingleProjectScope: parseBoolean(env.RUNNER_ENFORCE_SINGLE_PROJECT_SCOPE, false),
    maxChangedFiles: parseInteger(env.RUNNER_MAX_CHANGED_FILES, 25, { min: 1, max: 25 }),
    maxChangedLines: parseInteger(env.RUNNER_MAX_CHANGED_LINES, 3_000, { min: 1, max: 3_000 }),
    maxChangedBlobBytes: parseInteger(env.RUNNER_MAX_CHANGED_BLOB_BYTES, 16 * 1024 * 1024, { min: 1_024, max: 16 * 1024 * 1024 }),
    verifyCommands: normalizeVerifyCommands(verifyRaw, defaultCommandTimeoutMs),
    verificationEnvAllowlist,
    verificationEnvironment: selectedEnvironment(env, verificationEnvAllowlist),
    gitAuthorName: cleanText(env.RUNNER_GIT_AUTHOR_NAME || "Avalon Ticket Bot", 128),
    gitAuthorEmail: cleanText(env.RUNNER_GIT_AUTHOR_EMAIL || "ticket-bot@localhost", 254),
    deployScript: env.RUNNER_DEPLOY_SCRIPT ? path.resolve(env.RUNNER_DEPLOY_SCRIPT) : trustedDeployScriptPath,
    requiredDeployScriptPath: trustedDeployScriptPath,
    requiredDeployOwnerUid: typeof process.getuid === "function" ? process.getuid() : null,
    requiredDeployMode: 0o700,
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
  config.projectProfiles = createProjectProfiles(config, env, defaultCommandTimeoutMs);
  validateProjectProfiles(config);
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
    if (config.testMode) throw new ConfigError("Test-ticket mode cannot publish or deploy");
    if (config.autoDeployEnabled !== true) {
      throw new ConfigError("Production mode requires RUNNER_AUTO_DEPLOY_ENABLED=true");
    }
    if (config.autoDeployConfirmation !== PRODUCTION_ENABLE_CONFIRMATION) {
      throw new ConfigError(`Production mode requires RUNNER_AUTO_DEPLOY_CONFIRM=${PRODUCTION_ENABLE_CONFIRMATION}`);
    }
    if (config.serverBaseUrl?.href !== PRODUCTION_WORKER_API_URL) {
      throw new ConfigError(`Production mode requires the fixed worker API URL: ${PRODUCTION_WORKER_API_URL}`);
    }
    if (config.productionPublicUrl?.href !== `${PRODUCTION_PUBLIC_ORIGIN}/`) {
      throw new ConfigError(`Production mode requires the fixed public URL: ${PRODUCTION_PUBLIC_ORIGIN}/`);
    }
    const requiredOrigin = config.requiredExpectedOrigin || PRODUCTION_ORIGIN;
    if (config.expectedOrigin !== requiredOrigin) {
      throw new ConfigError(`Production mode requires the fixed Git origin: ${requiredOrigin}`);
    }
    if (!fs.existsSync(config.dockerBin) || !fs.statSync(config.dockerBin).isFile()) {
      throw new ConfigError(`RUNNER_DOCKER_BIN must resolve to a regular file: ${config.dockerBin}`);
    }
    const requiredDockerBinPath = path.resolve(config.requiredDockerBinPath || DEFAULT_DOCKER_BIN);
    if (path.resolve(config.dockerBin) !== requiredDockerBinPath) {
      throw new ConfigError(`Production mode requires the fixed Docker CLI path: ${requiredDockerBinPath}`);
    }
    const dockerLinkStat = fs.lstatSync(config.dockerBin);
    const dockerRealPath = fs.realpathSync(config.dockerBin);
    const dockerStat = fs.statSync(dockerRealPath);
    const dockerCurrentUid = typeof process.getuid === "function" ? process.getuid() : dockerStat.uid;
    if (!dockerStat.isFile() || (dockerStat.mode & 0o111) === 0
      || (dockerStat.uid !== 0 && dockerStat.uid !== dockerCurrentUid)
      || (dockerStat.mode & 0o022) !== 0) {
      throw new ConfigError("The fixed Docker CLI has unsafe identity or permissions");
    }
    config.dockerBinPin = {
      configuredPath: path.resolve(config.dockerBin),
      linkDev: dockerLinkStat.dev,
      linkIno: dockerLinkStat.ino,
      linkMode: dockerLinkStat.mode,
      realPath: dockerRealPath,
      uid: dockerStat.uid,
      dev: dockerStat.dev,
      ino: dockerStat.ino,
      mode: dockerStat.mode,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(dockerRealPath)).digest("hex"),
    };
    if (config.dockerImage !== DEFAULT_DOCKER_IMAGE) {
      throw new ConfigError(`Production mode requires the reviewed immutable Docker image: ${DEFAULT_DOCKER_IMAGE}`);
    }
    if (!DEFAULT_DOCKER_HOST_PIN) {
      throw new ConfigError(`Production Docker verification is not reviewed for host ${process.platform}-${process.arch}`);
    }
    if (config.dockerPlatform !== DEFAULT_DOCKER_HOST_PIN.platform
      || config.dockerArchitecture !== DEFAULT_DOCKER_HOST_PIN.architecture
      || config.dockerChildImage !== DEFAULT_DOCKER_HOST_PIN.childImage
      || config.dockerExpectedImageId !== DEFAULT_DOCKER_HOST_PIN.imageId) {
      throw new ConfigError("Production Docker platform and child-image pins must match the physical runner host");
    }
    if (!/^\d+(?:\.\d+)?[kmg]$/i.test(config.dockerMemory)) throw new ConfigError("RUNNER_DOCKER_MEMORY has an invalid value");
    if (!/^\d+(?:\.\d+)?$/.test(config.dockerCpus)) throw new ConfigError("RUNNER_DOCKER_CPUS has an invalid value");
    if (config.githubCredentialHelperEnabled !== true) {
      throw new ConfigError("Production mode requires the fixed GitHub CLI credential helper");
    }
    const requiredGithubCliPath = path.resolve(config.requiredGithubCliPath || DEFAULT_GITHUB_CLI_BIN);
    if (path.resolve(config.githubCliBin) !== requiredGithubCliPath) {
      throw new ConfigError(`Production mode requires the fixed GitHub CLI path: ${requiredGithubCliPath}`);
    }
    const ghLinkStat = fs.lstatSync(config.githubCliBin);
    const ghRealPath = fs.realpathSync(config.githubCliBin);
    const ghStat = fs.statSync(ghRealPath);
    if (!ghStat.isFile() || (ghStat.mode & 0o111) === 0) {
      throw new ConfigError("The fixed GitHub CLI must resolve to an executable regular file");
    }
    const ghCurrentUid = typeof process.getuid === "function" ? process.getuid() : ghStat.uid;
    if (ghStat.uid !== 0 && ghStat.uid !== ghCurrentUid) {
      throw new ConfigError("The fixed GitHub CLI must be owned by root or the runner user");
    }
    if ((ghStat.mode & 0o022) !== 0) throw new ConfigError("The fixed GitHub CLI must not be group/world writable");
    config.githubCliPin = {
      configuredPath: path.resolve(config.githubCliBin),
      linkDev: ghLinkStat.dev,
      linkIno: ghLinkStat.ino,
      linkMode: ghLinkStat.mode,
      realPath: ghRealPath,
      uid: ghStat.uid,
      dev: ghStat.dev,
      ino: ghStat.ino,
      mode: ghStat.mode,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(ghRealPath)).digest("hex"),
    };
    if (!config.deployScript) throw new ConfigError("RUNNER_DEPLOY_SCRIPT is required outside dry-run mode");
    if (!path.isAbsolute(config.deployScript)) throw new ConfigError("RUNNER_DEPLOY_SCRIPT must be absolute");
    const requiredDeployScriptPath = path.resolve(config.requiredDeployScriptPath || path.join(config.stateDir, "bin", TRUSTED_DEPLOY_SCRIPT_BASENAME));
    if (path.resolve(config.deployScript) !== requiredDeployScriptPath) {
      throw new ConfigError(`RUNNER_DEPLOY_SCRIPT must be the fixed trusted wrapper: ${requiredDeployScriptPath}`);
    }
    if (config.deployArgs.length !== 0) throw new ConfigError("RUNNER_DEPLOY_ARGS_JSON must be empty in production mode");
    if (config.deployEnvAllowlist.length !== 0 || Object.keys(config.deployEnvironment).length !== 0) {
      throw new ConfigError("RUNNER_DEPLOY_ENV_ALLOWLIST must be empty in production mode");
    }
    if (config.smokeUrls.length === 0) throw new ConfigError("At least one RUNNER_SMOKE_URLS entry is required outside dry-run mode");
    if (config.smokeUrls.some((url) => url.origin !== PRODUCTION_PUBLIC_ORIGIN || url.search || url.hash)) {
      throw new ConfigError(`Production smoke URLs must be clean paths on ${PRODUCTION_PUBLIC_ORIGIN}`);
    }
    if (config.allowedPrefixes.length !== 1 || config.allowedPrefixes[0] !== "website") {
      throw new ConfigError("Production mode requires RUNNER_ALLOWED_PATHS=website");
    }
    if (config.keepSuccessfulWorktrees !== false) {
      throw new ConfigError("Production mode requires RUNNER_KEEP_SUCCESSFUL_WORKTREES=false");
    }
    const lstat = fs.lstatSync(config.deployScript);
    if (!lstat.isFile() || lstat.isSymbolicLink()) throw new ConfigError("RUNNER_DEPLOY_SCRIPT must be a regular non-symlink file");
    const requiredDeployOwnerUid = Number.isSafeInteger(config.requiredDeployOwnerUid)
      ? config.requiredDeployOwnerUid
      : (typeof process.getuid === "function" ? process.getuid() : lstat.uid);
    if (lstat.uid !== requiredDeployOwnerUid) {
      throw new ConfigError(`RUNNER_DEPLOY_SCRIPT must be owned by uid ${requiredDeployOwnerUid}`);
    }
    const requiredDeployMode = Number.isSafeInteger(config.requiredDeployMode) ? config.requiredDeployMode : 0o700;
    if ((lstat.mode & 0o777) !== requiredDeployMode) {
      throw new ConfigError(`RUNNER_DEPLOY_SCRIPT must have mode ${requiredDeployMode.toString(8)}`);
    }
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

export {
  DEFAULT_DENIED_PATH_PATTERNS,
  DEFAULT_MARKET_MAP_VERIFY_COMMANDS,
  DEFAULT_VERIFY_COMMANDS,
  MARKET_MAP_ARTIFACT_PATHS,
  MARKET_MAP_CHANGED_PATHS,
  MARKET_MAP_REQUIRED_ARTIFACT_PATHS,
};
export {
  DEFAULT_DOCKER_IMAGE,
  DEFAULT_DOCKER_HOST_PIN,
  DEFAULT_GITHUB_CLI_BIN,
  MARKET_MAP_DEPLOY_SCRIPT_BASENAME,
  MARKET_MAP_ORIGIN,
  MARKET_MAP_PYTHON_BIN,
  MARKET_MAP_PROJECT_KEY,
  MARKET_MAP_PUBLIC_URL,
  PRODUCTION_ENABLE_CONFIRMATION,
  PRODUCTION_ORIGIN,
  PRODUCTION_PUBLIC_ORIGIN,
  PRODUCTION_WORKER_API_URL,
  TRUSTED_DEPLOY_SCRIPT_BASENAME,
};
