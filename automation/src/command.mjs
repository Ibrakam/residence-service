import { spawn } from "node:child_process";
import fs from "node:fs";
import { CommandError } from "./errors.mjs";
import { safeExcerpt } from "./sanitize.mjs";

const DEFAULT_CAPTURE_LIMIT = 2 * 1024 * 1024;

function appendLimited(current, chunk, limit) {
  if (current.length >= limit) return current;
  const remaining = limit - current.length;
  return current + chunk.toString("utf8", 0, remaining);
}

function terminateProcessGroup(child, signal = "SIGTERM") {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Process already exited.
    }
  }
}

export function runCommand({
  argv,
  cwd,
  env = process.env,
  input,
  inputFile,
  timeoutMs = 10 * 60_000,
  signal,
  label = "command",
  logger,
  captureLimit = DEFAULT_CAPTURE_LIMIT,
}) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((part) => typeof part !== "string")) {
    throw new TypeError("argv must be a non-empty string array");
  }
  if (input !== undefined && inputFile !== undefined) throw new TypeError("input and inputFile are mutually exclusive");
  if (inputFile !== undefined && (typeof inputFile !== "string" || !inputFile)) throw new TypeError("inputFile must be a non-empty path");

  const startedAt = Date.now();
  logger?.info("command.started", { label, cwd });

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let inputStream = null;

    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      stdio: [input === undefined && inputFile === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      detached: true,
    });

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortHandler);
      inputStream?.destroy();
      const durationMs = Date.now() - startedAt;
      if (error) {
        logger?.error("command.failed", { label, durationMs, error: { name: error.name, code: error.code, message: error.message } });
        reject(error);
      } else {
        logger?.info("command.completed", { label, durationMs, exitCode: result.exitCode });
        resolve({ ...result, durationMs });
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessGroup(child, "SIGTERM");
      setTimeout(() => terminateProcessGroup(child, "SIGKILL"), 5_000).unref();
    }, timeoutMs);
    timeout.unref();

    const abortHandler = () => {
      terminateProcessGroup(child, "SIGTERM");
      setTimeout(() => terminateProcessGroup(child, "SIGKILL"), 5_000).unref();
    };
    if (signal) {
      if (signal.aborted) abortHandler();
      else signal.addEventListener("abort", abortHandler, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk, captureLimit);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk, captureLimit);
    });
    child.on("error", (cause) => {
      finish(new CommandError(`${label} could not start`, { cause, stderr: safeExcerpt(stderr) }));
    });
    child.on("close", (exitCode, exitSignal) => {
      if (exitCode === 0 && !timedOut && !signal?.aborted) {
        // The group leader may exit while background descendants keep running.
        // Kill the detached group before any post-command trust decision.
        terminateProcessGroup(child, "SIGKILL");
        finish(null, { stdout, stderr, exitCode, signal: exitSignal });
        return;
      }
      const reason = timedOut ? "timed out" : signal?.aborted ? "was aborted" : `exited with code ${exitCode}`;
      finish(new CommandError(`${label} ${reason}`, {
        exitCode,
        stdout: safeExcerpt(stdout),
        stderr: safeExcerpt(stderr),
        timedOut,
        retryable: timedOut || Boolean(signal?.aborted),
      }));
    });

    if (input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    } else if (inputFile !== undefined) {
      child.stdin.on("error", () => {});
      inputStream = fs.createReadStream(inputFile);
      inputStream.on("error", (cause) => {
        terminateProcessGroup(child, "SIGTERM");
        finish(new CommandError(`${label} could not read its fixed input file`, { cause }));
      });
      inputStream.pipe(child.stdin);
    }
  });
}
