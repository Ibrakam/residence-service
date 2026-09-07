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
  ["image/svg+xml", ".svg"],
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

function skipWhitespace(text, start) {
  let cursor = start;
  while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
  return cursor;
}

function hasSvgRoot(text) {
  let cursor = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  cursor = skipWhitespace(text, cursor);
  if (/^<\?xml(?:\s|\?>)/iu.test(text.slice(cursor, cursor + 8))) {
    const declarationEnd = text.indexOf("?>", cursor + 5);
    if (declarationEnd < 0) return false;
    cursor = skipWhitespace(text, declarationEnd + 2);
  }
  while (text.startsWith("<!--", cursor)) {
    const commentEnd = text.indexOf("-->", cursor + 4);
    if (commentEnd < 0) return false;
    cursor = skipWhitespace(text, commentEnd + 3);
  }
  return /^<svg(?:\s|>)/iu.test(text.slice(cursor, cursor + 8));
}

function assertSafeSvgContent(buffer, attachmentNumber) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (cause) {
    throw new PolicyError(`Attachment ${attachmentNumber} SVG is not valid UTF-8`, { cause });
  }
  if (!text || text.includes("\u0000")) {
    throw new PolicyError(`Attachment ${attachmentNumber} does not contain a valid SVG root`);
  }
  const processingInstructions = text.match(/<\?/gu) ?? [];
  const start = skipWhitespace(text, text.charCodeAt(0) === 0xfeff ? 1 : 0);
  const hasLeadingXmlDeclaration = /^<\?xml(?:\s|\?>)/iu.test(text.slice(start, start + 8));
  if (processingInstructions.length !== (hasLeadingXmlDeclaration ? 1 : 0) || /<!\s*(?:doctype|entity)\b/iu.test(text)) {
    throw new PolicyError(`Attachment ${attachmentNumber} SVG contains disallowed XML declarations`);
  }
  if (!hasSvgRoot(text)) {
    throw new PolicyError(`Attachment ${attachmentNumber} does not contain a valid SVG root`);
  }
  if (/<\s*\/?\s*(?:[^\s<>/:]+:)?(?:script|foreignobject|iframe|object|embed|handler|animate|animatemotion|animatetransform|set|discard)\b/iu.test(text)) {
    throw new PolicyError(`Attachment ${attachmentNumber} SVG contains active elements`);
  }
  if (/(?:^|[\s<])(?:[^\s<>=]+:)?on[a-z][a-z0-9_.:-]*\s*=/imu.test(text) || /\bxml:base\s*=/iu.test(text)) {
    throw new PolicyError(`Attachment ${attachmentNumber} SVG contains active attributes`);
  }
  if (text.includes("\\") || /&#(?:x[0-9a-f]+|[0-9]+);/iu.test(text) || /@import\b|\bexpression\s*\(|\b(?:java|vb)script\s*:|\bbehavior\s*:/iu.test(text)) {
    throw new PolicyError(`Attachment ${attachmentNumber} SVG contains active styles or URLs`);
  }

  const safeFragment = /^#[a-z0-9_.:-]+$/iu;
  const referenceAttribute = /\b(?:href|xlink:href|src)\s*=\s*(["'])([\s\S]*?)\1/giu;
  const withoutReferences = text.replace(referenceAttribute, (_match, _quote, value) => {
    const reference = String(value).trim();
    if (reference && !safeFragment.test(reference)) {
      throw new PolicyError(`Attachment ${attachmentNumber} SVG contains an external reference`);
    }
    return "";
  });
  if (/\b(?:href|xlink:href|src)\s*=/iu.test(withoutReferences)) {
    throw new PolicyError(`Attachment ${attachmentNumber} SVG contains an invalid reference`);
  }

  const cssUrl = /\burl\s*\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/giu;
  const withoutCssUrls = text.replace(cssUrl, (_match, _quote, quotedValue, bareValue) => {
    const reference = String(quotedValue ?? bareValue ?? "").trim();
    if (!safeFragment.test(reference)) {
      throw new PolicyError(`Attachment ${attachmentNumber} SVG contains an external style URL`);
    }
    return "";
  });
  if (/\burl\s*\(/iu.test(withoutCssUrls)) {
    throw new PolicyError(`Attachment ${attachmentNumber} SVG contains an invalid style URL`);
  }
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
    const responseIsGeneric = responseMime === "application/octet-stream";
    const responseIsSupported = MIME_EXTENSIONS.has(responseMime);
    const declaredIsSupported = MIME_EXTENSIONS.has(declaredMime);
    if (!responseIsSupported && !responseIsGeneric) {
      throw new PolicyError(`Attachment ${index + 1} response has unsupported MIME type`);
    }
    const mimeType = responseIsSupported ? responseMime : declaredMime;
    const extension = MIME_EXTENSIONS.get(mimeType);
    if (!extension) throw new PolicyError(`Attachment ${index + 1} has unsupported MIME type`);
    if (responseIsSupported && declaredIsSupported && responseMime !== declaredMime) {
      throw new PolicyError(`Attachment ${index + 1} MIME type does not match server metadata`);
    }
    const filename = `attachment-${String(index + 1).padStart(2, "0")}${extension}`;
    const absolutePath = path.join(inputDir, filename);
    const saved = await writeResponseBody(response, absolutePath, config.attachmentMaxBytes);
    try {
      if (mimeType === "image/svg+xml") {
        assertSafeSvgContent(await fs.readFile(absolutePath), index + 1);
      }
      const expectedSha = /^[a-f0-9]{64}$/.test(attachment.sha256) ? attachment.sha256 : "";
      if (attachment.sha256 && !expectedSha) {
        throw new PolicyError(`Attachment ${index + 1} has an invalid checksum`);
      }
      if (expectedSha && !crypto.timingSafeEqual(Buffer.from(saved.sha256, "hex"), Buffer.from(expectedSha, "hex"))) {
        throw new PolicyError(`Attachment ${index + 1} checksum does not match`);
      }
    } catch (error) {
      await fs.rm(absolutePath, { force: true });
      throw error;
    }
    downloaded.push({
      relativePath: path.posix.join(INPUT_DIRECTORY_NAME, filename),
      absolutePath,
      originalFileName: attachment.fileName,
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
