import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { once } from "node:events";
import { TicketServerClient } from "../src/server-client.mjs";

test("server client retains proxy base path and matches the Go worker contract", async (t) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, headers: request.headers, body: body ? JSON.parse(body) : null });
    response.setHeader("content-type", "application/json");
    if (request.url.endsWith("/lease")) {
      response.end(JSON.stringify({
        leaseToken: "lease-123",
        leaseExpiresAt: new Date().toISOString(),
        ticket: { id: 42, attempt: 1, title: "Synthetic", body: "Fix the test", attachments: [] },
      }));
    } else {
      response.end('{"ok":true}');
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const config = {
    serverBaseUrl: new URL(`http://127.0.0.1:${port}/__residence-ticket-worker/`),
    serverTimeoutMs: 5_000,
    apiToken: "api-token-for-test",
    runnerId: "runner-test",
    leaseSeconds: 180,
    ticketBodyMaxChars: 40_000,
    smokeUrls: [new URL("https://form.tencorp.uz/health")],
    productionPublicUrl: new URL("https://form.tencorp.uz/"),
  };
  const client = new TicketServerClient(config, { warn() {} });
  const lease = await client.lease();
  await client.heartbeat(lease.ticket.id, lease.leaseToken, "verifying");
  await client.progress(lease.ticket.id, lease.leaseToken, "verifying", { stage: "tests" });
  await client.complete(lease.ticket.id, lease.leaseToken, {
    summary: "Fixed it",
    commitSha: "abc123",
    deployment: { deployed: true },
  });
  await client.fail(lease.ticket.id, lease.leaseToken, { error: { message: "Example failure" } });

  assert.equal(requests[0].path, "/__residence-ticket-worker/internal/ticket-runner/lease");
  assert.deepEqual(requests[0].body, { workerId: "runner-test" });
  assert.equal(requests[1].body, null);
  assert.equal(requests[1].headers["x-ticket-lease"], "lease-123");
  assert.deepEqual(requests[2].body, { summary: "verifying: tests" });
  assert.deepEqual(requests[3].body, {
    summary: "Fixed it",
    commitSha: "abc123",
    productionUrl: "https://form.tencorp.uz/",
  });
  assert.deepEqual(requests[4].body, { summary: "Example failure" });
});

test("lease treats worker_busy as no work without masking ticket lease conflicts", async (t) => {
  let requestCount = 0;
  const server = http.createServer((_request, response) => {
    requestCount += 1;
    response.statusCode = 409;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: requestCount === 1 ? "worker_busy" : "lease_lost" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const config = {
    serverBaseUrl: new URL(`http://127.0.0.1:${port}/__residence-ticket-worker/`),
    serverTimeoutMs: 5_000,
    apiToken: "api-token-for-test",
    runnerId: "runner-test",
    ticketBodyMaxChars: 40_000,
    smokeUrls: [],
  };
  const client = new TicketServerClient(config, { warn() {} });

  assert.equal(await client.lease(), null);
  await assert.rejects(
    client.progress("ticket-1", "lease-123", "verifying"),
    (error) => error?.code === "LEASE_LOST",
  );
});
