import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";
import { cleanupAttachmentDirectory, downloadAttachments } from "../src/attachments.mjs";

test("SVG documents retain their original name as untrusted metadata", async (t) => {
  const svg = '<?xml version="1.0" encoding="UTF-8"?><!-- floor --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>.unit{clip-path:url(#clip)}</style><defs><clipPath id="clip"><path id="apt-101" d="M0 0h10v10H0z"/></clipPath></defs><use href="#apt-101" class="unit"/></svg>';
  const sha256 = crypto.createHash("sha256").update(svg).digest("hex");
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "image/svg+xml");
    response.end(svg);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "ticket-svg-test-"));
  t.after(() => fs.rm(worktreePath, { recursive: true, force: true }));
  const { port } = server.address();
  const result = await downloadAttachments({
    ticket: {
      id: "TNC-SVG",
      attachments: [{
        url: `http://127.0.0.1:${port}/floor.svg`,
        mimeType: "image/svg+xml",
        fileName: "4u-block-a-floor-03.svg",
        sizeBytes: Buffer.byteLength(svg),
        sha256,
      }],
    },
    leaseToken: "lease-test",
    worktreePath,
    config: {
      testMode: true,
      attachmentAllowedHosts: ["127.0.0.1"],
      attachmentMaxCount: 10,
      attachmentMaxBytes: 1024 * 1024,
      serverTimeoutMs: 5_000,
    },
    client: { attachmentHeaders: () => ({}) },
    logger: { info() {} },
  });

  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].relativePath, ".ticket-runner-input/attachment-01.svg");
  assert.equal(result.attachments[0].originalFileName, "4u-block-a-floor-03.svg");
  assert.equal(result.attachments[0].mimeType, "image/svg+xml");
  assert.equal(result.attachments[0].isImage, false);
  assert.equal(result.attachments[0].sha256, sha256);
  assert.equal(await fs.readFile(result.attachments[0].absolutePath, "utf8"), svg);

  await cleanupAttachmentDirectory(worktreePath);
});

test("SVG metadata cannot disguise an HTML response", async (t) => {
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end("<script>alert(1)</script>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "ticket-svg-mime-test-"));
  t.after(() => fs.rm(worktreePath, { recursive: true, force: true }));
  const { port } = server.address();
  await assert.rejects(downloadAttachments({
    ticket: {
      id: "TNC-SVG-MIME",
      attachments: [{
        url: `http://127.0.0.1:${port}/not-an-svg`,
        mimeType: "image/svg+xml",
        fileName: "floor.svg",
        sizeBytes: null,
        sha256: "",
      }],
    },
    leaseToken: "lease-test",
    worktreePath,
    config: {
      testMode: true,
      attachmentAllowedHosts: ["127.0.0.1"],
      attachmentMaxCount: 10,
      attachmentMaxBytes: 1024 * 1024,
      serverTimeoutMs: 5_000,
    },
    client: { attachmentHeaders: () => ({}) },
    logger: { info() {} },
  }), /response has unsupported MIME type/);
  assert.deepEqual(await fs.readdir(path.join(worktreePath, ".ticket-runner-input")), []);
});

test("SVG metadata cannot disagree with a supported response MIME type", async (t) => {
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "image/png");
    response.end("not-a-real-png");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "ticket-svg-mismatch-test-"));
  t.after(() => fs.rm(worktreePath, { recursive: true, force: true }));
  const { port } = server.address();
  await assert.rejects(downloadAttachments({
    ticket: {
      id: "TNC-SVG-MISMATCH",
      attachments: [{
        url: `http://127.0.0.1:${port}/wrong-type`,
        mimeType: "image/svg+xml",
        fileName: "floor.svg",
        sizeBytes: null,
        sha256: "",
      }],
    },
    leaseToken: "lease-test",
    worktreePath,
    config: {
      testMode: true,
      attachmentAllowedHosts: ["127.0.0.1"],
      attachmentMaxCount: 10,
      attachmentMaxBytes: 1024 * 1024,
      serverTimeoutMs: 5_000,
    },
    client: { attachmentHeaders: () => ({}) },
    logger: { info() {} },
  }), /MIME type does not match server metadata/);
  assert.deepEqual(await fs.readdir(path.join(worktreePath, ".ticket-runner-input")), []);
});

test("SVG content validation rejects active XML and external references", async (t) => {
  const vectors = [
    ["html-root", "<html><script>alert(1)</script></html>", /valid SVG root/],
    ["doctype", '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"/>', /disallowed XML declarations/],
    ["script", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', /active elements/],
    ["foreign-object", '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><p>HTML</p></foreignObject></svg>', /active elements/],
    ["event", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', /active attributes/],
    ["external-href", '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/pixel.png"/></svg>', /external reference/],
    ["data-href", '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>', /external reference/],
    ["external-css", '<svg xmlns="http://www.w3.org/2000/svg"><style>.x{fill:url(https://example.test/a.svg#x)}</style></svg>', /external style URL/],
    ["encoded-css", '<svg xmlns="http://www.w3.org/2000/svg"><style>.x{fill:u&#114;l(https://example.test/a.svg#x)}</style></svg>', /active styles or URLs/],
    ["escaped-css", '<svg xmlns="http://www.w3.org/2000/svg"><style>.x{fill:u\\72l(https://example.test/a.svg#x)}</style></svg>', /active styles or URLs/],
    ["misplaced-xml", '<svg xmlns="http://www.w3.org/2000/svg"><?xml version="1.0"?></svg>', /disallowed XML declarations/],
  ];
  const server = http.createServer((request, response) => {
    const index = Number(String(request.url).slice(1));
    response.setHeader("content-type", "image/svg+xml");
    response.end(vectors[index][1]);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  for (const [index, [name, svg, expectedError]] of vectors.entries()) {
    await t.test(name, async () => {
      const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), `ticket-svg-${name}-test-`));
      try {
        await assert.rejects(downloadAttachments({
          ticket: {
            id: `TNC-SVG-${index}`,
            attachments: [{
              url: `http://127.0.0.1:${port}/${index}`,
              mimeType: "image/svg+xml",
              fileName: `${name}.svg`,
              sizeBytes: Buffer.byteLength(svg),
              sha256: crypto.createHash("sha256").update(svg).digest("hex"),
            }],
          },
          leaseToken: "lease-test",
          worktreePath,
          config: {
            testMode: true,
            attachmentAllowedHosts: ["127.0.0.1"],
            attachmentMaxCount: 10,
            attachmentMaxBytes: 1024 * 1024,
            serverTimeoutMs: 5_000,
          },
          client: { attachmentHeaders: () => ({}) },
          logger: { info() {} },
        }), expectedError);
        assert.deepEqual(await fs.readdir(path.join(worktreePath, ".ticket-runner-input")), []);
      } finally {
        await fs.rm(worktreePath, { recursive: true, force: true });
      }
    });
  }
});
