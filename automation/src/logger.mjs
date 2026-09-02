import { sanitizeForLog } from "./sanitize.mjs";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger({ runnerId, level = "info", stream = process.stdout } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(logLevel, event, fields = {}) {
    if ((LEVELS[logLevel] ?? 100) < threshold) return;
    const payload = {
      timestamp: new Date().toISOString(),
      level: logLevel,
      event,
      runnerId,
      ...sanitizeForLog(fields),
    };
    stream.write(`${JSON.stringify(payload)}\n`);
  }

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}

export function safeError(error) {
  return {
    name: error?.name ?? "Error",
    code: error?.code ?? "UNKNOWN",
    message: error?.message ?? String(error),
    retryable: Boolean(error?.retryable),
  };
}
