import path from "node:path";

const SECRET_PATTERNS = [
  [/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, "<redacted-telegram-token>"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, "<redacted-api-key>"],
  [/\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g, "<redacted-github-token>"],
  [/\bAKIA[A-Z0-9]{16}\b/g, "<redacted-aws-key>"],
  [/\bAIza[A-Za-z0-9_-]{30,}\b/g, "<redacted-google-api-key>"],
  [/\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g, "<redacted-slack-token>"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "<redacted-jwt>"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<redacted-private-key>"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{16,}/gi, "$1<redacted>"],
  [/\b(Basic\s+)[A-Za-z0-9+/=]{12,}/gi, "$1<redacted>"],
  [/\b((?:api[_-]?key|token|secret|password|credential)\s*[=:]\s*)[^\s,;]+/gi, "$1<redacted>"],
];

const HIGH_CONFIDENCE_ADDED_SECRET_PATTERNS = [
  /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bAIza[A-Za-z0-9_-]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const RESIDENCE_PROJECT_SLUGS = new Set([
  "4u",
  "bayterak",
  "botanika-saroyi",
  "flagman",
  "jomiy",
  "maftun-makon",
  "meros",
  "mirador",
  "ofiyat",
  "regnum-plaza",
  "sado",
  "sun",
  "voha",
  "yangibaxt",
  "zamon",
]);

export function redactSecrets(value) {
  let text = String(value ?? "");
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function cleanText(value, maxLength = 40_000) {
  const normalized = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim();
  return normalized.slice(0, maxLength);
}

export function safeTicketId(value) {
  const id = cleanText(value, 96);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(id)) {
    throw new TypeError("Ticket id must contain only letters, numbers, dot, underscore, or dash");
  }
  return id;
}

export function safeSlug(value, fallback = "item") {
  const slug = cleanText(value, 120)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

export function xmlEscape(value) {
  return cleanText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function safeExcerpt(value, maxLength = 2_000) {
  const text = redactSecrets(cleanText(value, maxLength * 2));
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export function normalizeRepoRelativePath(value) {
  const text = cleanText(value, 1_024).replaceAll("\\", "/");
  if (!text || text.startsWith("/") || text.includes("\u0000")) {
    throw new TypeError("Changed path is not a safe repository-relative path");
  }
  const normalized = path.posix.normalize(text);
  if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith(".git/")) {
    throw new TypeError("Changed path escapes the repository or targets .git");
  }
  return normalized;
}

export function scanAddedLinesForSecrets(diffText) {
  const findings = [];
  for (const rawLine of String(diffText).split("\n")) {
    if (!rawLine.startsWith("+") || rawLine.startsWith("+++")) continue;
    const line = rawLine.slice(1);
    for (const pattern of HIGH_CONFIDENCE_ADDED_SECRET_PATTERNS) {
      if (pattern.test(line)) {
        findings.push(pattern.source);
        break;
      }
    }
  }
  return findings;
}

export function assertSafeChangedPaths(paths, { allowedPrefixes, allowedExactPaths, deniedPatterns }) {
  const normalized = paths.map(normalizeRepoRelativePath);
  for (const changedPath of normalized) {
    const allowed = Array.isArray(allowedExactPaths)
      ? allowedExactPaths.map(normalizeRepoRelativePath).includes(changedPath)
      : allowedPrefixes.some((prefix) => {
        const cleanPrefix = prefix.replace(/^\.\//, "").replace(/\/$/, "");
        return changedPath === cleanPrefix || changedPath.startsWith(`${cleanPrefix}/`);
      });
    if (!allowed) {
      throw new TypeError(`Changed path is outside the allowlist: ${changedPath}`);
    }
    if (deniedPatterns.some((pattern) => pattern.test(changedPath))) {
      throw new TypeError(`Changed path is denied by policy: ${changedPath}`);
    }
  }
  return normalized;
}

export function assertSingleResidenceProject(paths) {
  const scoped = [];
  for (const value of paths) {
    const changedPath = normalizeRepoRelativePath(value);
    let slug = "";
    const routeMatch = /^website\/(?:app|public)\/([^/]+)(?:\/|$)/.exec(changedPath);
    if (routeMatch && RESIDENCE_PROJECT_SLUGS.has(routeMatch[1])) slug = routeMatch[1];
    if (!slug) {
      const filenameMatch = /^website\/(?:data|scripts)\/([^/]+)$/.exec(changedPath);
      if (filenameMatch) {
        slug = [...RESIDENCE_PROJECT_SLUGS].find((candidate) => filenameMatch[1] === candidate
          || filenameMatch[1].startsWith(`${candidate}-`)
          || filenameMatch[1].startsWith(`build-${candidate}-`)
          || filenameMatch[1].startsWith(`verify-${candidate}-`)) || "";
      }
    }
    if (!slug) throw new TypeError(`Automatic tickets cannot change shared/global or unscoped files: ${changedPath}`);
    scoped.push(slug);
  }
  const projects = [...new Set(scoped)];
  if (projects.length !== 1) throw new TypeError(`Automatic tickets must target exactly one Residence project (found: ${projects.join(", ")})`);
  return projects[0];
}

export function sanitizeForLog(value, depth = 0) {
  if (depth > 4) return "<max-depth>";
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return safeExcerpt(value, 1_000);
  if (Array.isArray(value)) return value.slice(0, 30).map((entry) => sanitizeForLog(entry, depth + 1));
  if (typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value).slice(0, 50)) {
      if (/(body|description|prompt|token|secret|password|credential|authorization|cookie|url)$/i.test(key)) {
        result[key] = key.toLowerCase().endsWith("url") ? "<redacted-url>" : "<redacted>";
      } else {
        result[key] = sanitizeForLog(entry, depth + 1);
      }
    }
    return result;
  }
  return safeExcerpt(String(value), 1_000);
}
