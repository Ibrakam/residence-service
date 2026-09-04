import fs from "node:fs/promises";
import path from "node:path";
import { LeaseLostError, RunnerError } from "./errors.mjs";
import { normalizeProjectKey } from "./project-profiles.mjs";
import { cleanText, safeTicketId } from "./sanitize.mjs";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function readLimitedResponse(response, limit = MAX_RESPONSE_BYTES) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new RunnerError("Server response exceeded the configured size limit", { code: "SERVER_RESPONSE_TOO_LARGE" });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function normalizeAttachment(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RunnerError(`Attachment ${index + 1} is invalid`, { code: "INVALID_TICKET" });
  if (typeof raw.url !== "string" || !raw.url) throw new RunnerError(`Attachment ${index + 1} has no URL`, { code: "INVALID_TICKET" });
  return {
    id: cleanText(raw.id || `attachment-${index + 1}`, 128),
    url: raw.url,
    mimeType: cleanText(raw.mimeType || raw.contentType || "application/octet-stream", 128).toLowerCase(),
    fileName: cleanText(raw.fileName || raw.name || `attachment-${index + 1}`, 256),
    sizeBytes: Number.isSafeInteger(raw.sizeBytes) && raw.sizeBytes >= 0 ? raw.sizeBytes : null,
    sha256: typeof raw.sha256 === "string" ? raw.sha256.toLowerCase() : "",
  };
}

export function normalizeLease(raw, bodyMaxChars = 40_000) {
  if (!raw || typeof raw !== "object" || !raw.ticket || typeof raw.ticket !== "object") {
    throw new RunnerError("Lease response is missing ticket data", { code: "INVALID_LEASE" });
  }
  const ticket = raw.ticket;
  const id = safeTicketId(ticket.id);
  const body = cleanText(ticket.body ?? ticket.description ?? ticket.message ?? "", bodyMaxChars);
  if (!body) throw new RunnerError("Ticket body is empty", { code: "INVALID_TICKET" });
  const leaseToken = cleanText(raw.leaseToken || ticket.leaseToken || "", 8_192);
  if (!leaseToken) throw new RunnerError("Lease response is missing leaseToken", { code: "INVALID_LEASE" });
  return {
    leaseToken,
    leaseExpiresAt: cleanText(raw.leaseExpiresAt || "", 128),
    ticket: {
      id,
      attempt: Number.isSafeInteger(ticket.attempt) && ticket.attempt > 0 ? ticket.attempt : 1,
      projectKey: normalizeProjectKey(ticket.projectKey),
      title: cleanText(ticket.title || "", 500),
      body,
      attachments: Array.isArray(ticket.attachments) ? ticket.attachments.map(normalizeAttachment) : [],
    },
  };
}

export class TicketServerClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.baseUrl = config.serverBaseUrl;
  }

  endpoint(pathname) {
    return new URL(String(pathname).replace(/^\/+/, ""), this.baseUrl);
  }

  async request(pathname, { method = "POST", body, leaseToken, signal, allowNoContent = false, workerBusyAsNull = false } = {}) {
    const timeoutSignal = AbortSignal.timeout(this.config.serverTimeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${this.config.apiToken}`,
      "Content-Type": "application/json",
      "User-Agent": "avalon-ticket-runner/0.1",
    };
    if (leaseToken) headers["X-Ticket-Lease"] = leaseToken;
    let response;
    try {
      response = await fetch(this.endpoint(pathname), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combinedSignal,
        redirect: "error",
      });
    } catch (cause) {
      throw new RunnerError("Ticket server request failed", { code: "SERVER_UNREACHABLE", retryable: true, cause });
    }
    if (allowNoContent && response.status === 204) return null;
    const text = await readLimitedResponse(response);
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (cause) {
        throw new RunnerError("Ticket server returned invalid JSON", { code: "INVALID_SERVER_RESPONSE", cause });
      }
    }
    if (workerBusyAsNull && response.status === 409 && parsed?.error === "worker_busy") return null;
    if (response.status === 409 || response.status === 410) throw new LeaseLostError();
    if (!response.ok) {
      throw new RunnerError(`Ticket server returned HTTP ${response.status}`, {
        code: "SERVER_HTTP_ERROR",
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return parsed;
  }

  async lease(signal) {
    const raw = await this.request("/internal/ticket-runner/lease", {
      body: { workerId: this.config.runnerId },
      signal,
      allowNoContent: true,
      workerBusyAsNull: true,
    });
    return raw ? normalizeLease(raw, this.config.ticketBodyMaxChars) : null;
  }

  heartbeat(ticketId, leaseToken, phase, signal) {
    return this.request(`/internal/ticket-runner/tickets/${encodeURIComponent(safeTicketId(ticketId))}/heartbeat`, {
      leaseToken,
      signal,
    });
  }

  progress(ticketId, leaseToken, phase, details = {}) {
    const stage = cleanText(details.stage || "", 256);
    const summary = stage ? `${phase}: ${stage}` : phase;
    return this.request(`/internal/ticket-runner/tickets/${encodeURIComponent(safeTicketId(ticketId))}/progress`, {
      body: { summary },
      leaseToken,
    });
  }

  complete(ticketId, leaseToken, result) {
    return this.request(`/internal/ticket-runner/tickets/${encodeURIComponent(safeTicketId(ticketId))}/complete`, {
      body: {
        summary: cleanText(result.summary || "Ticket completed", 12_000),
        commitSha: cleanText(result.commitSha || "", 128),
        productionUrl: result.deployment?.deployed && (result.productionUrl || this.config.productionPublicUrl)
          ? String(result.productionUrl || this.config.productionPublicUrl)
          : "",
      },
      leaseToken,
    });
  }

  fail(ticketId, leaseToken, result) {
    const publishState = result.deployed ? " Failure occurred after deployment." : result.pushed ? " Failure occurred after main was pushed." : "";
    return this.request(`/internal/ticket-runner/tickets/${encodeURIComponent(safeTicketId(ticketId))}/fail`, {
      body: { summary: cleanText(`${result.error?.message || result.summary || "Ticket runner failed"}${publishState}`, 12_000) },
      leaseToken,
    });
  }

  attachmentHeaders(url, leaseToken) {
    return url.origin === this.baseUrl.origin
      ? { Authorization: `Bearer ${this.config.apiToken}`, "X-Ticket-Lease": leaseToken }
      : {};
  }
}

export class FileTicketClient {
  constructor(config, stateStore, logger) {
    this.config = config;
    this.stateStore = stateStore;
    this.logger = logger;
    this.delivered = false;
  }

  async lease() {
    if (this.delivered) return null;
    this.delivered = true;
    const absolute = path.resolve(this.config.testTicketFile);
    const raw = JSON.parse(await fs.readFile(absolute, "utf8"));
    const lease = normalizeLease({ leaseToken: "local-test-lease", ticket: raw.ticket ?? raw }, this.config.ticketBodyMaxChars);
    return lease;
  }

  async heartbeat() {
    return { ok: true };
  }

  async progress(ticketId, _leaseToken, phase, details = {}) {
    this.logger.info("test.progress", { ticketId, phase, ...details });
  }

  async complete(ticketId, _leaseToken, result) {
    const resultPath = await this.stateStore.writeTestResult(ticketId, { status: "complete", ...result });
    this.logger.info("test.result_written", { ticketId, resultPath });
  }

  async fail(ticketId, _leaseToken, result) {
    const resultPath = await this.stateStore.writeTestResult(ticketId, { status: "failed", ...result });
    this.logger.info("test.result_written", { ticketId, resultPath });
  }

  attachmentHeaders() {
    return {};
  }
}
