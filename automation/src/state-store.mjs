import fs from "node:fs/promises";
import path from "node:path";
import { safeTicketId } from "./sanitize.mjs";

async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
}

export class StateStore {
  constructor(stateDir) {
    this.stateDir = stateDir;
    this.ticketDir = path.join(stateDir, "tickets");
    this.resultDir = path.join(stateDir, "test-results");
  }

  async initialize() {
    await ensurePrivateDirectory(this.stateDir);
    await ensurePrivateDirectory(this.ticketDir);
    await ensurePrivateDirectory(this.resultDir);
  }

  ticketStatePath(ticketId, attempt = 1) {
    const id = safeTicketId(ticketId);
    const safeAttempt = Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 1;
    return path.join(this.ticketDir, `${id}.attempt-${safeAttempt}.json`);
  }

  async readTicket(ticketId, attempt = 1) {
    try {
      const text = await fs.readFile(this.ticketStatePath(ticketId, attempt), "utf8");
      return JSON.parse(text);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async writeTicket(ticketId, attempt, state) {
    const destination = this.ticketStatePath(ticketId, attempt);
    const temporary = `${destination}.${process.pid}.tmp`;
    const payload = `${JSON.stringify({ version: 1, ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`;
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(payload);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, destination);
    const directory = await fs.open(this.ticketDir, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  async listTicketStates() {
    const entries = await fs.readdir(this.ticketDir, { withFileTypes: true });
    const states = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[A-Za-z0-9._-]+\.attempt-[1-9][0-9]*\.json$/.test(entry.name)) continue;
      const filename = path.join(this.ticketDir, entry.name);
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
        throw new Error(`Unsafe ticket state file: ${entry.name}`);
      }
      states.push(JSON.parse(await fs.readFile(filename, "utf8")));
    }
    return states;
  }

  async writeTestResult(ticketId, result) {
    const destination = path.join(this.resultDir, `${safeTicketId(ticketId)}.json`);
    const temporary = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, destination);
    await fs.chmod(destination, 0o600);
    return destination;
  }
}

export class ProcessLock {
  constructor(stateDir) {
    this.lockDir = path.join(stateDir, "runner.lock");
    this.held = false;
  }

  async acquire() {
    try {
      await fs.mkdir(this.lockDir, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const ownerFile = path.join(this.lockDir, "owner.json");
      let owner = null;
      try {
        owner = JSON.parse(await fs.readFile(ownerFile, "utf8"));
      } catch {
        // Treat an unreadable lock as active. Operators can inspect it manually.
      }
      const pid = Number(owner?.pid);
      if (Number.isSafeInteger(pid) && pid > 1) {
        try {
          process.kill(pid, 0);
          throw new Error(`Another ticket runner is active (pid ${pid})`);
        } catch (probeError) {
          if (probeError?.code !== "ESRCH") throw probeError;
        }
      } else {
        throw new Error(`Runner lock already exists: ${this.lockDir}`);
      }
      await fs.rm(this.lockDir, { recursive: true, force: false });
      await fs.mkdir(this.lockDir, { mode: 0o700 });
    }
    await fs.writeFile(path.join(this.lockDir, "owner.json"), `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    this.held = true;
  }

  async release() {
    if (!this.held) return;
    this.held = false;
    await fs.rm(this.lockDir, { recursive: true, force: true });
  }
}
