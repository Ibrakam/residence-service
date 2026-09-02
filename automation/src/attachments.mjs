import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PolicyError, RunnerError } from "./errors.mjs";
import { isPathInside } from "./sanitize.mjs";

const INPUT_DIRECTORY_NAME = ".ticket-runner-input";
const MIME_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["application/pdf", ".pdf"],
  ["text/plain", ".txt"],
  ["video/mp4", ".mp4"],
  ["video/quicktime", ".mov"],
]);

function normalizedMime(value) {
  return String(value || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
}

function isImageMime(mimeType) {
  return mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp" || mimeType === "image/gif";
}

function validateAttachmentUrl(rawUrl, config) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (cause) {
    throw new PolicyError("Attachment URL is invalid", { cause });
  }
  const localTestUrl = config.testMode && url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localTestUrl) throw new PolicyError("Attachment URL must use HTTPS");
  if (url.username || url.password) throw new PolicyError("Attachment URL must not contain credentials");
  if (!config.attachmentAllowedHosts.includes(url.hostname)) {
    throw new PolicyError(`Attachment host is not allowlisted: ${url.hostname}`);
  }
  return url;
}

async function fetchWithValidatedRedirects(initialUrl, config, client, leaseToken, signal) {
  let url = validateAttachmentUrl(initialUrl, config);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const timeout = AbortSignal.timeout(config.serverTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(url, {
      headers: client.attachmentHeaders(url, leaseToken),
      redirect: "manual",
      signal: combined,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === 3) throw new RunnerError("Attachment redirected too many times", { code: "ATTACHMENT_REDIRECT_LIMIT" });
      const location = response.headers.get("location");
      if (!location) throw new RunnerError("Attachment redirect omitted Location", { code: "ATTACHMENT_DOWNLOAD_FAILED" });
      url = validateAttachmentUrl(new URL(location, url).toString(), config);
      continue;
    }
    if (!response.ok) throw new RunnerError(`Attachment download returned HTTP ${response.status}`, { code: "ATTACHMENT_DOWNLOAD_FAILED", retryable: response.status >= 500 });
    return response;
  }
  throw new RunnerError("Attachment redirect loop", { code: "ATTACHMENT_REDIRECT_LIMIT" });
}

async function writeResponseBody(response, destination, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new PolicyError("Attachment exceeds the configured size limit");
  if (!response.body) throw new RunnerError("Attachment response has no body", { code: "ATTACHMENT_DOWNLOAD_FAILED" });

  const handle = await fs.open(destination, "wx", 0o600);
  const hash = crypto.createHash("sha256");
  const reader = response.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PolicyError("Attachment exceeds the configured size limit");
      }
      hash.update(value);
      await handle.write(value);
    }
  } catch (error) {
    await handle.close();
    await fs.rm(destination, { force: true });
    throw error;
  }
  await handle.close();
  return { bytes: total, sha256: hash.digest("hex") };
}

export async function downloadAttachments({ ticket, leaseToken, worktreePath, config, client, signal, logger }) {
  if (ticket.attachments.length > config.attachmentMaxCount) {
    throw new PolicyError(`Ticket has more than ${config.attachmentMaxCount} attachments`);
  }
  const inputDir = path.join(worktreePath, INPUT_DIRECTORY_NAME);
  if (!isPathInside(worktreePath, inputDir)) throw new PolicyError("Attachment input directory escaped the worktree");
  await fs.mkdir(inputDir, { mode: 0o700 });
  const downloaded = [];

  for (const [index, attachment] of ticket.attachments.entries()) {
    if (attachment.sizeBytes !== null && attachment.sizeBytes > config.attachmentMaxBytes) {
      throw new PolicyError(`Attachment ${index + 1} exceeds the configured size limit`);
    }
    const response = await fetchWithValidatedRedirects(attachment.url, config, client, leaseToken, signal);
    const responseMime = normalizedMime(response.headers.get("content-type"));
    const declaredMime = normalizedMime(attachment.mimeType);
    const mimeType = MIME_EXTENSIONS.has(responseMime) ? responseMime : declaredMime;
    const extension = MIME_EXTENSIONS.get(mimeType);
    if (!extension) throw new PolicyError(`Attachment ${index + 1} has unsupported MIME type`);
    if (MIME_EXTENSIONS.has(responseMime) && MIME_EXTENSIONS.has(declaredMime) && responseMime !== declaredMime) {
      throw new PolicyError(`Attachment ${index + 1} MIME type does not match server metadata`);
    }
    const filename = `attachment-${String(index + 1).padStart(2, "0")}${extension}`;
    const absolutePath = path.join(inputDir, filename);
    const saved = await writeResponseBody(response, absolutePath, config.attachmentMaxBytes);
    const expectedSha = /^[a-f0-9]{64}$/.test(attachment.sha256) ? attachment.sha256 : "";
    if (attachment.sha256 && !expectedSha) {
      await fs.rm(absolutePath, { force: true });
      throw new PolicyError(`Attachment ${index + 1} has an invalid checksum`);
    }
    if (expectedSha && !crypto.timingSafeEqual(Buffer.from(saved.sha256, "hex"), Buffer.from(expectedSha, "hex"))) {
      await fs.rm(absolutePath, { force: true });
      throw new PolicyError(`Attachment ${index + 1} checksum does not match`);
    }
    downloaded.push({
      relativePath: path.posix.join(INPUT_DIRECTORY_NAME, filename),
      absolutePath,
      mimeType,
      isImage: isImageMime(mimeType),
      bytes: saved.bytes,
      sha256: saved.sha256,
    });
    logger.info("attachment.downloaded", { ticketId: ticket.id, attachmentIndex: index + 1, mimeType, bytes: saved.bytes });
  }
  return { inputDir, attachments: downloaded };
}

export async function cleanupAttachmentDirectory(worktreePath) {
  const target = path.join(worktreePath, INPUT_DIRECTORY_NAME);
  if (path.basename(target) !== INPUT_DIRECTORY_NAME || !isPathInside(worktreePath, target)) {
    throw new PolicyError("Refusing to clean an unexpected attachment directory");
  }
  await fs.rm(target, { recursive: true, force: true });
}

export { INPUT_DIRECTORY_NAME, validateAttachmentUrl };
