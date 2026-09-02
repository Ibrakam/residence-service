import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./command.mjs";
import { ConfigError, PolicyError, RemoteMovedError, RunnerError } from "./errors.mjs";
import { assertSafeChangedPaths, isPathInside, safeSlug, scanAddedLinesForSecrets } from "./sanitize.mjs";

function trustedGitEnv(extra = {}) {
  const env = {
    HOME: process.env.HOME || os.homedir(),
    PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin",
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    ...extra,
  };
  if (process.env.SSH_AUTH_SOCK) env.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
  return env;
}

function splitNul(text) {
  return String(text).split("\0").filter(Boolean);
}

function parseGitModes(text) {
  const modes = new Map();
  for (const record of splitNul(text)) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const metadata = record.slice(0, tab).split(/\s+/);
    const mode = metadata[0];
    const filename = record.slice(tab + 1);
    if (mode && filename) modes.set(filename, mode);
  }
  return modes;
}

async function realpathExisting(value, label) {
  try {
    return await fs.realpath(value);
  } catch (cause) {
    throw new ConfigError(`${label} does not exist: ${value}`, { cause });
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function readSmallFile(filename, label) {
  const bytes = await fs.readFile(filename);
  if (bytes.length > 64 * 1024) throw new PolicyError(`${label} is unexpectedly large`);
  return bytes;
}

export class GitWorkspace {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.repoRoot = "";
    this.worktreeRoot = path.resolve(config.worktreeRoot);
    this.commonGitDir = "";
    this.worktreeContexts = new Map();
  }

  async git(argv, { cwd, timeoutMs, label, signal, env, captureLimit, input } = {}) {
    return runCommand({
      argv: ["/usr/bin/git", "-c", "core.hooksPath=/dev/null", ...argv],
      cwd: cwd || this.repoRoot || this.config.repoRoot,
      timeoutMs: timeoutMs || this.config.commandTimeoutMs,
      label: label || "git",
      signal,
      env: env || trustedGitEnv(),
      logger: this.logger,
      captureLimit,
      input,
    });
  }

  async initialize() {
    this.repoRoot = await realpathExisting(this.config.repoRoot, "RUNNER_REPO_ROOT");
    const topLevel = (await this.git(["rev-parse", "--show-toplevel"], { cwd: this.repoRoot, label: "git.validate_root" })).stdout.trim();
    const resolvedTopLevel = await fs.realpath(topLevel);
    if (resolvedTopLevel !== this.repoRoot) {
      throw new ConfigError(`RUNNER_REPO_ROOT is not the root git top-level (${resolvedTopLevel})`);
    }
    if (isPathInside(this.repoRoot, this.worktreeRoot) || this.worktreeRoot === this.repoRoot) {
      throw new ConfigError("RUNNER_WORKTREE_ROOT must be outside the source repository");
    }
    await fs.mkdir(this.worktreeRoot, { recursive: true, mode: 0o700 });
    await fs.chmod(this.worktreeRoot, 0o700);
    this.worktreeRoot = await fs.realpath(this.worktreeRoot);
    await this.git(["remote", "get-url", "origin"], { label: "git.validate_origin" });
    const common = (await this.git(["rev-parse", "--git-common-dir"], { cwd: this.repoRoot, label: "git.resolve_common_dir" })).stdout.trim();
    this.commonGitDir = await realpathExisting(path.resolve(this.repoRoot, common), "Repository common git dir");
  }

  async registeredGitDir(worktreePath) {
    const registry = path.join(this.commonGitDir, "worktrees");
    let entries;
    try {
      entries = await fs.readdir(registry, { withFileTypes: true });
    } catch (cause) {
      throw new PolicyError("Git worktree registry is unavailable", { cause });
    }
    const pointerPath = path.join(path.resolve(worktreePath), ".git");
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const candidate = path.join(registry, entry.name);
      const backPointer = path.join(candidate, "gitdir");
      try {
        const registeredPointer = (await readSmallFile(backPointer, "Git worktree registry pointer")).toString("utf8").trim();
        if (path.resolve(registeredPointer) === pointerPath) return await fs.realpath(candidate);
      } catch {
        // Ignore unrelated or concurrently-pruned registry entries.
      }
    }
    throw new PolicyError("Worktree is not registered in the trusted root repository");
  }

  async captureWorktreeContext(worktreePath, baseSha) {
    const resolvedWorktree = await fs.realpath(worktreePath);
    const pointerPath = path.join(resolvedWorktree, ".git");
    const pointerStat = await fs.lstat(pointerPath);
    if (!pointerStat.isFile() || pointerStat.isSymbolicLink()) throw new PolicyError("Worktree .git pointer must be a regular non-symlink file");
    const gitDir = await this.registeredGitDir(resolvedWorktree);
    const pointerBytes = await readSmallFile(pointerPath, "Worktree .git pointer");
    const pointerMatch = /^gitdir:\s*(.+)\s*$/.exec(pointerBytes.toString("utf8"));
    if (!pointerMatch || await fs.realpath(path.resolve(resolvedWorktree, pointerMatch[1])) !== gitDir) {
      throw new PolicyError("Worktree .git pointer does not match the trusted root registry");
    }
    const commonPointerPath = path.join(gitDir, "commondir");
    const commonPointerBytes = await readSmallFile(commonPointerPath, "Worktree common-dir pointer");
    const resolvedCommon = await fs.realpath(path.resolve(gitDir, commonPointerBytes.toString("utf8").trim()));
    if (resolvedCommon !== this.commonGitDir) throw new PolicyError("Worktree common-dir escaped the trusted root repository");
    const headPath = path.join(gitDir, "HEAD");
    const headBytes = await readSmallFile(headPath, "Worktree HEAD");
    if (headBytes.toString("utf8").trim() !== baseSha) throw new PolicyError("Worktree HEAD file does not match the recorded base");
    const configPath = path.join(this.commonGitDir, "config");
    const configBytes = await readSmallFile(configPath, "Repository git config");
    const gitDirStat = await fs.lstat(gitDir);
    const commonStat = await fs.lstat(this.commonGitDir);
    const context = {
      worktreePath: resolvedWorktree,
      pointerPath,
      pointerDev: pointerStat.dev,
      pointerIno: pointerStat.ino,
      pointerMode: pointerStat.mode,
      pointerSha256: sha256(pointerBytes),
      gitDir,
      gitDirDev: gitDirStat.dev,
      gitDirIno: gitDirStat.ino,
      commonDir: this.commonGitDir,
      commonDev: commonStat.dev,
      commonIno: commonStat.ino,
      commonPointerSha256: sha256(commonPointerBytes),
      headSha256: sha256(headBytes),
      configSha256: sha256(configBytes),
    };
    this.worktreeContexts.set(resolvedWorktree, context);
    return context;
  }

  async assertWorktreeIntegrity(worktreePath) {
    const resolved = await fs.realpath(worktreePath);
    const context = this.worktreeContexts.get(resolved);
    if (!context) throw new PolicyError("Trusted worktree context was not recorded");
    const pointerStat = await fs.lstat(context.pointerPath);
    const gitDirStat = await fs.lstat(context.gitDir);
    const commonStat = await fs.lstat(context.commonDir);
    if (!pointerStat.isFile() || pointerStat.isSymbolicLink()
      || pointerStat.dev !== context.pointerDev || pointerStat.ino !== context.pointerIno || pointerStat.mode !== context.pointerMode
      || gitDirStat.dev !== context.gitDirDev || gitDirStat.ino !== context.gitDirIno
      || commonStat.dev !== context.commonDev || commonStat.ino !== context.commonIno) {
      throw new PolicyError("Worktree git metadata identity changed after agent execution");
    }
    const checks = [
      [context.pointerPath, context.pointerSha256, "Worktree .git pointer"],
      [path.join(context.gitDir, "commondir"), context.commonPointerSha256, "Worktree common-dir pointer"],
      [path.join(context.gitDir, "HEAD"), context.headSha256, "Worktree HEAD"],
      [path.join(context.commonDir, "config"), context.configSha256, "Repository git config"],
    ];
    for (const [filename, expected, label] of checks) {
      const bytes = await readSmallFile(filename, label);
      if (sha256(bytes) !== expected) throw new PolicyError(`${label} changed after agent execution`);
    }
    return context;
  }

  async worktreeGit(worktreePath, argv, options = {}) {
    const context = await this.assertWorktreeIntegrity(worktreePath);
    return this.git([`--git-dir=${context.gitDir}`, `--work-tree=${context.worktreePath}`, ...argv], {
      ...options,
      cwd: context.worktreePath,
    });
  }

  async fetchBase(signal) {
    await this.git(["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"], {
      label: "git.fetch_origin_main",
      signal,
      timeoutMs: this.config.commandTimeoutMs,
    });
    const baseSha = (await this.git(["rev-parse", "refs/remotes/origin/main^{commit}"], { label: "git.resolve_base" })).stdout.trim();
    if (!/^[a-f0-9]{40,64}$/.test(baseSha)) throw new RunnerError("origin/main did not resolve to a commit", { code: "INVALID_BASE_SHA" });
    return baseSha;
  }

  worktreePath(ticketId, attempt) {
    const directory = `ticket-${safeSlug(ticketId)}-attempt-${Number(attempt) || 1}`;
    const result = path.join(this.worktreeRoot, directory);
    if (!isPathInside(this.worktreeRoot, result)) throw new PolicyError("Computed worktree path escaped RUNNER_WORKTREE_ROOT");
    return result;
  }

  async validateWorktree(worktreePath, baseSha) {
    const resolved = await realpathExisting(worktreePath, "Recovered worktree");
    if (!isPathInside(this.worktreeRoot, resolved)) throw new PolicyError("Recovered worktree is outside RUNNER_WORKTREE_ROOT");
    await this.captureWorktreeContext(resolved, baseSha);
    const topLevel = (await this.worktreeGit(resolved, ["rev-parse", "--show-toplevel"], { label: "git.validate_worktree" })).stdout.trim();
    if (await fs.realpath(topLevel) !== resolved) throw new PolicyError("Recovered directory is not a worktree top-level");
    const head = (await this.worktreeGit(resolved, ["rev-parse", "HEAD^{commit}"], { label: "git.worktree_head" })).stdout.trim();
    if (head !== baseSha) throw new PolicyError("Recovered worktree HEAD does not equal its recorded origin/main base");
    return resolved;
  }

  async prepareWorktree(ticket, previousState, signal) {
    if (previousState?.worktreePath && previousState?.baseSha) {
      const worktreePath = await this.validateWorktree(previousState.worktreePath, previousState.baseSha);
      this.logger.info("worktree.recovered", { ticketId: ticket.id, worktreePath, baseSha: previousState.baseSha });
      return { worktreePath, baseSha: previousState.baseSha, recovered: true };
    }

    const baseSha = await this.fetchBase(signal);
    const worktreePath = this.worktreePath(ticket.id, ticket.attempt);
    try {
      await fs.lstat(worktreePath);
      throw new PolicyError(`Worktree path already exists without recoverable state: ${worktreePath}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await this.git(["worktree", "add", "--detach", worktreePath, baseSha], {
      cwd: this.repoRoot,
      label: "git.worktree_add",
      signal,
    });
    await this.validateWorktree(worktreePath, baseSha);
    this.logger.info("worktree.created", { ticketId: ticket.id, worktreePath, baseSha });
    return { worktreePath, baseSha, recovered: false };
  }

  async changedPaths(worktreePath) {
    const tracked = splitNul((await this.worktreeGit(worktreePath, ["diff", "--name-only", "-z", "HEAD", "--"], {
      label: "git.changed_tracked",
    })).stdout);
    const untracked = splitNul((await this.worktreeGit(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"], {
      label: "git.changed_untracked",
    })).stdout);
    return [...new Set([...tracked, ...untracked])].sort();
  }

  async preflight({ worktreePath, baseSha, signal }) {
    await this.assertWorktreeIntegrity(worktreePath);
    const headBefore = (await this.worktreeGit(worktreePath, ["rev-parse", "HEAD^{commit}"], { label: "git.preflight_head" })).stdout.trim();
    if (headBefore !== baseSha) throw new PolicyError("Agent changed git history; expected HEAD to remain at the recorded origin/main base");
    const paths = await this.changedPaths(worktreePath);
    if (paths.length === 0) throw new PolicyError("Codex completed without producing a code change");
    let normalized;
    try {
      normalized = assertSafeChangedPaths(paths, {
        allowedPrefixes: this.config.allowedPrefixes,
        deniedPatterns: this.config.deniedPathPatterns,
      });
    } catch (cause) {
      throw new PolicyError(cause.message, { cause });
    }

    await this.worktreeGit(worktreePath, ["add", "-A", "--"], { label: "git.stage", signal });
    await this.worktreeGit(worktreePath, ["diff", "--cached", "--check"], { label: "git.staged_diff_check", signal });
    const stagedModes = parseGitModes((await this.worktreeGit(worktreePath, ["ls-files", "--stage", "-z", "--", ...normalized], {
      label: "git.staged_modes",
      signal,
    })).stdout);
    const baseModes = parseGitModes((await this.worktreeGit(worktreePath, ["ls-tree", "-r", "-z", baseSha, "--", ...normalized], {
      label: "git.base_modes",
      signal,
    })).stdout);
    for (const changedPath of normalized) {
      const modes = [baseModes.get(changedPath), stagedModes.get(changedPath)].filter(Boolean);
      if (modes.some((mode) => mode === "100755")) {
        throw new PolicyError(`Changes to executable files are denied by policy: ${changedPath}`);
      }
      if (modes.some((mode) => mode === "120000" || mode === "160000")) {
        throw new PolicyError(`Changes to symlinks or submodules are denied by policy: ${changedPath}`);
      }
      if (modes.some((mode) => mode !== "100644")) {
        throw new PolicyError(`Unsupported git file mode in ticket change: ${changedPath}`);
      }
    }
    const diff = (await this.worktreeGit(worktreePath, ["diff", "--cached", "--no-ext-diff", "--unified=0", "--"], {
      label: "git.secret_scan_diff",
      signal,
      captureLimit: 16 * 1024 * 1024,
    })).stdout;
    if (Buffer.byteLength(diff) >= 16 * 1024 * 1024) throw new PolicyError("Staged diff is too large for the secret scanner");
    if (scanAddedLinesForSecrets(diff).length > 0) throw new PolicyError("High-confidence secret material was detected in added lines");
    const treeSha = (await this.worktreeGit(worktreePath, ["write-tree"], { label: "git.preflight_tree", signal })).stdout.trim();
    const diffStat = (await this.worktreeGit(worktreePath, ["diff", "--cached", "--stat", "--no-renames", "--"], {
      label: "git.preflight_diff_stat",
      signal,
    })).stdout.trim().slice(0, 4_000);
    return { changedPaths: normalized, treeSha, diffStat };
  }

  async cleanIgnoredArtifacts(worktreePath, signal) {
    await this.worktreeGit(worktreePath, ["clean", "-ffdX", "--"], {
      label: "git.clean_ignored_artifacts",
      signal,
    });
  }

  async exportTreeArchive({ worktreePath, treeSha, destination, signal }) {
    await this.assertWorktreeIntegrity(worktreePath);
    if (!/^[a-f0-9]{40,64}$/.test(treeSha)) throw new PolicyError("Invalid staged tree id for verifier export");
    const absoluteDestination = path.resolve(destination);
    if (absoluteDestination === path.resolve(worktreePath) || isPathInside(worktreePath, absoluteDestination)) {
      throw new PolicyError("Verifier source archive must be outside the agent worktree");
    }
    await this.git(["archive", "--format=tar", `--output=${absoluteDestination}`, treeSha], {
      cwd: this.repoRoot,
      label: "git.export_verifier_tree",
      signal,
    });
    const stat = await fs.lstat(absoluteDestination);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new PolicyError("Verifier source archive is not a regular file");
    return absoluteDestination;
  }

  async inspectAndCommit({ ticket, worktreePath, baseSha, expectedTreeSha, signal }) {
    const inspection = await this.preflight({ worktreePath, baseSha, signal });
    if (expectedTreeSha && inspection.treeSha !== expectedTreeSha) {
      throw new PolicyError("Verification commands changed the staged ticket patch; refusing to commit a post-preflight mutation");
    }

    const commitEnv = trustedGitEnv({
      GIT_AUTHOR_NAME: this.config.gitAuthorName,
      GIT_AUTHOR_EMAIL: this.config.gitAuthorEmail,
      GIT_COMMITTER_NAME: this.config.gitAuthorName,
      GIT_COMMITTER_EMAIL: this.config.gitAuthorEmail,
    });
    const commitSha = (await this.worktreeGit(worktreePath, ["commit-tree", inspection.treeSha, "-p", baseSha], {
      label: "git.commit_tree",
      signal,
      env: commitEnv,
      input: `fix(ticket): ${ticket.id}\n`,
    })).stdout.trim();
    const parentSha = (await this.git(["rev-parse", `${commitSha}^1^{commit}`], { cwd: this.repoRoot, label: "git.commit_parent" })).stdout.trim();
    if (parentSha !== baseSha) throw new PolicyError("Runner commit is not a direct child of the recorded origin/main base");
    const context = await this.assertWorktreeIntegrity(worktreePath);
    await this.git([
      `--git-dir=${context.gitDir}`,
      `--work-tree=${context.worktreePath}`,
      "update-ref",
      "HEAD",
      commitSha,
      baseSha,
    ], {
      cwd: context.worktreePath,
      label: "git.advance_trusted_head",
      signal,
    });
    const headBytes = await readSmallFile(path.join(context.gitDir, "HEAD"), "Worktree HEAD");
    if (headBytes.toString("utf8").trim() !== commitSha) throw new PolicyError("Trusted worktree HEAD did not advance to the runner commit");
    context.headSha256 = sha256(headBytes);
    return { commitSha, changedPaths: inspection.changedPaths, diffStat: inspection.diffStat };
  }

  async safePush({ worktreePath, baseSha, commitSha, signal }) {
    await this.assertWorktreeIntegrity(worktreePath);
    await this.fetchBase(signal);
    const observed = (await this.git(["rev-parse", "refs/remotes/origin/main^{commit}"], { label: "git.remote_main_before_push" })).stdout.trim();
    if (observed !== baseSha) throw new RemoteMovedError();
    const parent = (await this.git(["rev-parse", `${commitSha}^1^{commit}`], { cwd: this.repoRoot, label: "git.push_commit_parent" })).stdout.trim();
    if (parent !== baseSha) throw new PolicyError("Runner commit changed or is not a direct child of the recorded base");

    await this.git([
      "push",
      "--no-verify",
      "--porcelain",
      `--force-with-lease=refs/heads/main:${baseSha}`,
      "origin",
      `${commitSha}:refs/heads/main`,
    ], { cwd: this.repoRoot, label: "git.push_commit_main", signal, timeoutMs: this.config.commandTimeoutMs });

    await this.fetchBase(signal);
    const published = (await this.git(["rev-parse", "refs/remotes/origin/main^{commit}"], { label: "git.remote_main_after_push" })).stdout.trim();
    if (published !== commitSha) throw new RunnerError("origin/main did not resolve to the pushed commit", { code: "PUSH_VERIFICATION_FAILED" });
  }

  async rollbackPush({ worktreePath, baseSha, commitSha, signal }) {
    await this.fetchBase(signal);
    const observed = (await this.git(["rev-parse", "refs/remotes/origin/main^{commit}"], { label: "git.remote_main_before_rollback" })).stdout.trim();
    if (observed !== commitSha) {
      throw new RemoteMovedError("origin/main moved after this ticket push; rollback was not attempted");
    }
    await this.git([
      "push",
      "--no-verify",
      "--porcelain",
      `--force-with-lease=refs/heads/main:${commitSha}`,
      "origin",
      `${baseSha}:refs/heads/main`,
    ], { cwd: this.repoRoot, label: "git.rollback_main", signal, timeoutMs: this.config.commandTimeoutMs });
    await this.fetchBase(signal);
    const restored = (await this.git(["rev-parse", "refs/remotes/origin/main^{commit}"], { label: "git.remote_main_after_rollback" })).stdout.trim();
    if (restored !== baseSha) throw new RunnerError("origin/main did not resolve to the rollback base", { code: "ROLLBACK_VERIFICATION_FAILED" });
  }

  async removeWorktree(worktreePath) {
    const resolved = path.resolve(worktreePath);
    if (!isPathInside(this.worktreeRoot, resolved)) throw new PolicyError("Refusing to remove a worktree outside RUNNER_WORKTREE_ROOT");
    await this.git(["worktree", "remove", "--force", resolved], { cwd: this.repoRoot, label: "git.worktree_remove" });
    this.worktreeContexts.delete(resolved);
    await this.git(["worktree", "prune"], { cwd: this.repoRoot, label: "git.worktree_prune" });
  }
}

export { trustedGitEnv };
