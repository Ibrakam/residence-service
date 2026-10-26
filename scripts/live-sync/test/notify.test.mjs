import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { alertProviders, emptyAlertState, validateAlertState, planAlerts, notificationText, confirmDelivery, postponeDelivery, readCatalogHealth, sendTelegramAlert } from '../src/notify.mjs';

const now = Date.parse('2026-10-26T09:00:00Z');
const minute = 60_000;
function healthy() {
  return { items: Object.keys(alertProviders).filter((key) => key !== 'monitor').map((provider) => ({
    provider, status: 'succeeded', freshness: 'fresh',
    lastSuccessAt: new Date(now - minute).toISOString(), freshUntil: new Date(now + 30 * minute).toISOString(),
  })) };
}
function failed(provider = 'uysot', code = 'capture_failed') {
  const payload = healthy();
  Object.assign(payload.items.find((item) => item.provider === provider), { status: 'failed', errorCode: code });
  return payload;
}
function confirmedIncident() {
  const first = planAlerts(emptyAlertState(), failed(), now);
  const second = planAlerts(first.state, failed(), now + minute);
  return confirmDelivery(second.state, second.events);
}

test('healthy startup is silent; one failure is debounced and recovery before alert is silent', () => {
  assert.deepEqual(planAlerts(emptyAlertState(), healthy(), now).events, []);
  const once = planAlerts(emptyAlertState(), failed(), now);
  assert.deepEqual(once.events, []);
  assert.deepEqual(planAlerts(once.state, failed(), now + 1).events, [], 'two checks in the same second are not an incident');
  assert.deepEqual(planAlerts(once.state, healthy(), now + minute).events, []);
});

test('access/update failure alerts once after 60 seconds and stays deduplicated across process restarts', () => {
  const first = planAlerts(emptyAlertState(), failed(), now);
  const second = planAlerts(first.state, failed(), now + minute);
  assert.deepEqual(second.events, [{ key: 'uysot', kind: 'problem' }]);
  assert.match(notificationText(second.state, second.events), /Uysot — Avalon Residence/);
  const saved = JSON.parse(JSON.stringify(confirmDelivery(second.state, second.events)));
  assert.deepEqual(planAlerts(saved, failed(), now + 10 * minute).events, []);
  assert.equal(saved.entries.uysot.notified, true);
});

test('only a successful fresh import confirms recovery; the next separate outage alerts again', () => {
  const incident = confirmedIncident();
  const running = healthy();
  running.items.find((item) => item.provider === 'uysot').status = 'running';
  assert.deepEqual(planAlerts(incident, running, now + 2 * minute).events, []);
  const recovery = planAlerts(incident, healthy(), now + 3 * minute);
  assert.deepEqual(recovery.events, [{ key: 'uysot', kind: 'recovered' }]);
  assert.match(notificationText(recovery.state, recovery.events), /обновление восстановлено/);
  const saved = confirmDelivery(recovery.state, recovery.events);
  assert.deepEqual(planAlerts(saved, healthy(), now + 4 * minute).events, []);
  const again = planAlerts(saved, failed(), now + 5 * minute);
  assert.deepEqual(planAlerts(again.state, failed(), now + 6 * minute).events, [{ key: 'uysot', kind: 'problem' }]);
});

test('API outage is one monitor incident and never fabricates upstream recovery', () => {
  const incident = confirmedIncident();
  const once = planAlerts(incident, null, now + 2 * minute);
  const twice = planAlerts(once.state, { items: 'invalid' }, now + 3 * minute);
  assert.deepEqual(twice.events, [{ key: 'monitor', kind: 'problem' }]);
  assert.equal(twice.state.entries.uysot.notified, true);
  assert.equal(twice.state.entries.uysot.issue, 'capture_failed');
});

test('stale, expired, missing and failed providers are detected without exposing arbitrary source text', () => {
  const payload = healthy();
  payload.items[0].freshUntil = new Date(now - 1).toISOString();
  payload.items[1].status = 'failed';
  payload.items[1].errorCode = 'password=DO_NOT_COPY bearer=SECRET';
  payload.items.splice(2, 1);
  const first = planAlerts(emptyAlertState(), payload, now);
  const second = planAlerts(first.state, payload, now + minute);
  assert.deepEqual(second.events.map((event) => event.key), ['uysot', 'kayan', 'mbc']);
  assert.doesNotMatch(JSON.stringify(second), /DO_NOT_COPY|SECRET/);
  assert.doesNotMatch(notificationText(second.state, second.events), /DO_NOT_COPY|SECRET/);
  assert.match(notificationText(second.state, second.events), /Ташкент/);
});

test('duplicate provider and malformed private state fail closed', () => {
  const duplicate = healthy(); duplicate.items.push(duplicate.items[0]);
  const first = planAlerts(emptyAlertState(), duplicate, now);
  assert.equal(first.state.entries.monitor.issue, 'unavailable');
  assert.throws(() => validateAlertState({ schemaVersion: 2 }), /alert_state_invalid/);
  const malicious = emptyAlertState(); malicious.entries = JSON.parse('{"constructor":{}}');
  assert.throws(() => validateAlertState(malicious), /alert_state_invalid/);
});

test('delivery failures retain pending events, back off, and respect bounded Telegram Retry-After', () => {
  const once = planAlerts(emptyAlertState(), failed(), now);
  const pending = planAlerts(once.state, failed(), now + minute);
  const retry = postponeDelivery(pending.state, now + minute, 600);
  assert.equal(retry.entries.uysot.notified, false);
  assert.deepEqual(planAlerts(retry, failed(), now + 2 * minute).events, []);
  assert.deepEqual(planAlerts(retry, failed(), now + 11 * minute).events, [{ key: 'uysot', kind: 'problem' }]);
  assert.equal(postponeDelivery(retry, now, 999999).nextDeliveryAt, now + 3600 * 1000);
});

test('health fetch is loopback-only, bounded, and ignores network/error bodies', async () => {
  assert.deepEqual(await readCatalogHealth(async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:4300/v1/sync/catalog-status');
    assert.equal(options.redirect, 'error');
    return Response.json(healthy());
  }), healthy());
  assert.equal(await readCatalogHealth(async () => new Response('private error', { status: 500 })), null);
  assert.equal(await readCatalogHealth(async () => new Response('x'.repeat(129 * 1024))), null);
});

const token = '123456789:' + 'A'.repeat(35);
test('Telegram delivery uses exactly the configured private recipient and checks the receipt', async () => {
  let requests = 0;
  await sendTelegramAlert({ token, chatId: '123456789', text: 'TEST', fetcher: async (url, options) => {
    requests += 1;
    assert.equal(url, `https://api.telegram.org/bot${token}/sendMessage`);
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { chat_id: '123456789', text: 'TEST', link_preview_options: { is_disabled: true } });
    return Response.json({ ok: true, result: { message_id: 42, chat: { id: 123456789 } } });
  } });
  assert.equal(requests, 1);
  await assert.rejects(sendTelegramAlert({ token, chatId: '-1001234', text: 'TEST' }), /configuration_invalid/);
  await assert.rejects(sendTelegramAlert({ token, chatId: '123456789', text: 'TEST', fetcher: async () => Response.json({ ok: true, result: { message_id: 42, chat: { id: 999999999 } } }) }), /delivery_failed/);
});

test('Telegram URL/token and error descriptions are never propagated into errors', async () => {
  const secret = `https://api.telegram.org/bot${token}/sendMessage`;
  await assert.rejects(sendTelegramAlert({ token, chatId: '123456789', text: 'TEST', fetcher: async () => { throw Error(secret); } }), (error) => {
    assert.equal(String(error), 'Error: telegram_delivery_failed');
    assert.equal(JSON.stringify(error).includes(token), false);
    return true;
  });
  await assert.rejects(sendTelegramAlert({ token, chatId: '123456789', text: 'TEST', fetcher: async () => Response.json({ ok: false, description: secret, parameters: { retry_after: 123 } }, { status: 429 }) }), (error) => error.retryAfterSeconds === 123 && !String(error).includes(token));
});

test('CLI rejects corrupt state without attempting delivery, and journal output never contains credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crm-alert-test-'));
  await writeFile(join(root, 'state-v1.json'), '{broken');
  await writeFile(join(root, 'telegram-token'), token, { mode: 0o600 });
  await chmod(root, 0o700);
  const cli = new URL('../src/notify-cli.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [cli.pathname], { encoding: 'utf8', env: { ...process.env, STATE_DIRECTORY: root, CREDENTIALS_DIRECTORY: root, CRM_ALERT_CHAT_ID: '123456789' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /state_invalid/);
  assert.doesNotMatch(result.stderr, new RegExp(token));
  assert.equal(await readFile(join(root, 'state-v1.json'), 'utf8'), '{broken');
});
