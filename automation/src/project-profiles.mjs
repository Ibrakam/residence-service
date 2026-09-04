import path from "node:path";
import { runDockerVerification } from "./docker-verification.mjs";
import { PolicyError } from "./errors.mjs";
import { GitWorkspace } from "./git-worktree.mjs";
import { runMarketMapVerification } from "./market-map-verification.mjs";
import { cleanText, isPathInside } from "./sanitize.mjs";

export const DEFAULT_PROJECT_KEY = "residence";

const BUILTIN_PRODUCTION_VERIFIERS = Object.freeze({
  "residence-docker": runDockerVerification,
  "market-map-source": runMarketMapVerification,
});

export function normalizeProjectKey(value, { fallback = DEFAULT_PROJECT_KEY } = {}) {
  const source = value === undefined || value === null || String(value).trim() === ""
    ? fallback
    : value;
  const normalized = cleanText(source, 64)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(normalized) || normalized.includes("--")) {
    throw new PolicyError("Ticket project key is invalid", { code: "INVALID_PROJECT_KEY" });
  }
  return normalized;
}

function configuredProfiles(config) {
  if (config.projectProfiles && typeof config.projectProfiles === "object" && !Array.isArray(config.projectProfiles)) {
    return Object.values(config.projectProfiles);
  }
  return [{
    key: DEFAULT_PROJECT_KEY,
    label: "Residence Service",
    enabled: true,
    productionVerifierKey: "residence-docker",
  }];
}

export class ProjectRuntimeRegistry {
  constructor(config, logger, {
    workspaceFactory = (runtimeConfig) => new GitWorkspace(runtimeConfig, logger),
    productionVerifiers = BUILTIN_PRODUCTION_VERIFIERS,
  } = {}) {
    this.config = config;
    this.logger = logger;
    this.workspaceFactory = workspaceFactory;
    this.productionVerifiers = productionVerifiers;
    this.runtimes = new Map();
  }

  async initialize() {
    const seen = new Set();
    const selected = [];
    for (const rawProfile of configuredProfiles(this.config)) {
      if (!rawProfile || typeof rawProfile !== "object") throw new PolicyError("Configured project profile is invalid");
      const projectKey = normalizeProjectKey(rawProfile.key, { fallback: "" });
      if (seen.has(projectKey)) throw new PolicyError(`Duplicate project profile: ${projectKey}`);
      seen.add(projectKey);
      if (rawProfile.enabled !== true) continue;

      const productionVerifier = this.productionVerifiers[rawProfile.productionVerifierKey];
      if (typeof productionVerifier !== "function") {
        throw new PolicyError(`Project profile has no trusted production verifier: ${projectKey}`);
      }
      const runtimeConfig = {
        ...this.config,
        ...rawProfile,
        projectKey,
        projectLabel: cleanText(rawProfile.label || projectKey, 128),
      };
      // Profiles cannot recursively replace the operator-owned registry.
      delete runtimeConfig.projectProfiles;
      if (!runtimeConfig.repoRoot || !runtimeConfig.worktreeRoot) {
        throw new PolicyError(`Project profile has no repository/worktree root: ${projectKey}`);
      }
      selected.push({ projectKey, runtimeConfig, productionVerifier });
    }

    for (const current of selected) {
      const currentRepo = path.resolve(current.runtimeConfig.repoRoot);
      const currentWorktrees = path.resolve(current.runtimeConfig.worktreeRoot);
      for (const candidate of selected) {
        const candidateRepo = path.resolve(candidate.runtimeConfig.repoRoot);
        const candidateWorktrees = path.resolve(candidate.runtimeConfig.worktreeRoot);
        if (current.projectKey !== candidate.projectKey
          && (currentRepo === candidateRepo || isPathInside(currentRepo, candidateRepo) || isPathInside(candidateRepo, currentRepo))) {
          throw new PolicyError(`Enabled project repositories overlap: ${current.projectKey} and ${candidate.projectKey}`);
        }
        if (currentWorktrees === candidateRepo
          || isPathInside(currentWorktrees, candidateRepo)
          || isPathInside(candidateRepo, currentWorktrees)) {
          throw new PolicyError(`Project worktree root overlaps a configured repository: ${current.projectKey}`);
        }
        if (current.projectKey !== candidate.projectKey
          && (currentWorktrees === candidateWorktrees
            || isPathInside(currentWorktrees, candidateWorktrees)
            || isPathInside(candidateWorktrees, currentWorktrees))) {
          throw new PolicyError(`Enabled project worktree roots overlap: ${current.projectKey} and ${candidate.projectKey}`);
        }
      }
    }

    for (const { projectKey, runtimeConfig, productionVerifier } of selected) {
      const gitWorkspace = this.workspaceFactory(runtimeConfig);
      await gitWorkspace.initialize();
      this.runtimes.set(projectKey, {
        projectKey,
        projectLabel: runtimeConfig.projectLabel,
        config: runtimeConfig,
        gitWorkspace,
        productionVerifier,
      });
    }
    if (!this.runtimes.has(DEFAULT_PROJECT_KEY)) {
      throw new PolicyError(`Default project profile is not enabled: ${DEFAULT_PROJECT_KEY}`);
    }
    return this;
  }

  resolve(value) {
    const projectKey = normalizeProjectKey(value);
    const runtime = this.runtimes.get(projectKey);
    if (!runtime) {
      throw new PolicyError(`Ticket targets an unknown or disabled project profile: ${projectKey}`, {
        code: "UNKNOWN_PROJECT_PROFILE",
      });
    }
    return runtime;
  }

  list() {
    return [...this.runtimes.values()].map(({ projectKey, projectLabel, config }) => ({
      projectKey,
      projectLabel,
      repoRoot: config.repoRoot,
      worktreeRoot: config.worktreeRoot,
    }));
  }
}

export { BUILTIN_PRODUCTION_VERIFIERS };
