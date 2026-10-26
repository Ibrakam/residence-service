// This monitor receives only the sanitized catalogue-health contract. It never
// reads CRM credentials, browser profiles, captures, cookies or database URLs.
export const alertProviders = Object.freeze({
  uysot: 'Uysot — Avalon Residence',
  kayan: 'Kayan — Mirador и Ofiyat',
  mbc: 'Murad Buildings — Regnum Plaza, C1, Soy Bo‘yi, Saadiyat',
  'mbc-sarbon': 'Murad Buildings — Sarbon',
  human2human: 'SUN',
  'nrg-bi': 'NRG BI — 11 ЖК',
  monitor: 'Проверка состояния CRM на сервере',
});

const minute = 60_000;
const reasons = Object.freeze({
  capture_failed: 'Не удалось получить данные. Возможно, истёк вход или источник заблокировал доступ.',
  capture_timeout: 'Источник не ответил за отведённое время.',
  completeness_guard_failed: 'Выгрузка не прошла проверку полноты. Старые данные сохранены.',
  stale: 'Обновление данных просрочено.',
  missing: 'Источник отсутствует в ответе проверки.',
  unavailable: 'Проверка состояния на сервере недоступна.',
  failed: 'Обновление завершилось с ошибкой. Проверьте доступ и состояние источника.',
});

export function emptyAlertState() {
  return { schemaVersion: 1, entries: {}, deliveryFailures: 0, nextDeliveryAt: 0 };
}

export function validateAlertState(state) {
  if (state?.schemaVersion !== 1 || !state.entries || typeof state.entries !== 'object' || Array.isArray(state.entries)
    || !Number.isSafeInteger(state.deliveryFailures) || state.deliveryFailures < 0
    || !Number.isFinite(state.nextDeliveryAt) || state.nextDeliveryAt < 0) throw Error('alert_state_invalid');
  for (const [key, entry] of Object.entries(state.entries)) {
    if (!Object.hasOwn(alertProviders, key) || !entry || typeof entry.notified !== 'boolean'
      || !(entry.issue === null || Object.hasOwn(reasons, entry.issue))
      || !Number.isFinite(entry.firstBadAt) || entry.firstBadAt < 0
      || !Number.isSafeInteger(entry.observations) || entry.observations < 0
      || !(entry.lastSuccessAt === null || Number.isFinite(entry.lastSuccessAt))) throw Error('alert_state_invalid');
  }
  return state;
}

function providerHealth(payload, now) {
  if (!Array.isArray(payload?.items) || payload.items.length > 32) return null;
  const byProvider = new Map();
  for (const item of payload.items) {
    if (!item || typeof item.provider !== 'string' || byProvider.has(item.provider)
      || !['running', 'succeeded', 'failed'].includes(item.status)
      || !['fresh', 'stale'].includes(item.freshness)) return null;
    byProvider.set(item.provider, item);
  }
  return Object.fromEntries(Object.keys(alertProviders).filter((key) => key !== 'monitor').map((key) => {
    const item = byProvider.get(key);
    if (!item) return [key, { issue: 'missing', lastSuccessAt: null }];
    const parsedSuccess = Date.parse(item.lastSuccessAt ?? '');
    const lastSuccessAt = Number.isFinite(parsedSuccess) && parsedSuccess <= now + 5 * minute ? parsedSuccess : null;
    if (item.status === 'failed') return [key, {
      issue: Object.hasOwn(reasons, item.errorCode) ? item.errorCode : 'failed', lastSuccessAt,
    }];
    const freshUntil = Date.parse(item.freshUntil ?? '');
    if (item.freshness !== 'fresh' || lastSuccessAt === null || !Number.isFinite(freshUntil) || freshUntil <= now) {
      return [key, { issue: 'stale', lastSuccessAt }];
    }
    // A running capture is not proof of recovery. Wait for a confirmed import.
    return [key, { issue: item.status === 'running' ? undefined : null, lastSuccessAt }];
  }));
}

export function planAlerts(previous, payload, now = Date.now()) {
  const state = structuredClone(validateAlertState(previous));
  const health = providerHealth(payload, now);
  const observations = health ? { ...health, monitor: { issue: null, lastSuccessAt: now } }
    : { monitor: { issue: 'unavailable', lastSuccessAt: null } };
  for (const [key, observation] of Object.entries(observations)) {
    if (observation.issue === undefined) continue;
    const entry = state.entries[key] ?? { issue: null, notified: false, firstBadAt: 0, observations: 0, lastSuccessAt: null };
    if (observation.issue === null) {
      entry.issue = null;
      entry.firstBadAt = 0;
      entry.observations = 0;
    } else {
      if (entry.issue === null) entry.firstBadAt = now;
      entry.issue = observation.issue;
      entry.observations = Math.min(entry.observations + 1, 1_000_000);
    }
    entry.lastSuccessAt = observation.lastSuccessAt;
    state.entries[key] = entry;
  }
  const events = [];
  if (now >= state.nextDeliveryAt) {
    for (const [key, entry] of Object.entries(state.entries)) {
      // A health API outage must not guess that upstream access recovered or
      // synthesize additional provider failures from a missing response.
      if (!health && key !== 'monitor') continue;
      if (entry.issue && !entry.notified && entry.observations >= 2 && now - entry.firstBadAt >= minute) events.push({ key, kind: 'problem' });
      if (entry.issue === null && entry.notified) events.push({ key, kind: 'recovered' });
    }
  }
  return { state, events };
}

export function notificationText(state, events) {
  const formatter = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' });
  const lines = events.map(({ key, kind }) => {
    const entry = state.entries[key];
    if (!Object.hasOwn(alertProviders, key) || !entry || !['problem', 'recovered'].includes(kind)) throw Error('alert_event_invalid');
    if (kind === 'recovered') return `✅ ${alertProviders[key]}: обновление восстановлено.`;
    const last = entry.lastSuccessAt === null ? 'успешной выгрузки ещё нет' : `последняя успешная выгрузка: ${formatter.format(entry.lastSuccessAt)} (Ташкент)`;
    return `⚠️ ${alertProviders[key]}\n${reasons[entry.issue]}\n${last}.`;
  });
  return `TENCORP · состояние обновления CRM\n\n${lines.join('\n\n')}\n\nСохранённые данные не удаляются. Повторных сообщений по этому сбою не будет до восстановления.`;
}

export function confirmDelivery(state, events) {
  const next = structuredClone(state);
  for (const { key, kind } of events) next.entries[key].notified = kind === 'problem';
  next.deliveryFailures = 0;
  next.nextDeliveryAt = 0;
  return next;
}

export function postponeDelivery(state, now, retryAfterSeconds = 0) {
  const next = structuredClone(state);
  next.deliveryFailures = Math.min(next.deliveryFailures + 1, 20);
  const backoff = Math.min(15 * minute, minute * 2 ** (next.deliveryFailures - 1));
  const retryAfter = Number.isInteger(retryAfterSeconds) ? Math.min(3600, Math.max(0, retryAfterSeconds)) * 1000 : 0;
  next.nextDeliveryAt = now + Math.max(backoff, retryAfter);
  return next;
}

async function boundedJSON(response, maximumBytes) {
  if (!response.body) throw Error('response_invalid');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximumBytes) throw Error('response_too_large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

export async function readCatalogHealth(fetcher = fetch) {
  try {
    const response = await fetcher('http://127.0.0.1:4300/v1/sync/catalog-status', {
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return await boundedJSON(response, 128 * 1024);
  } catch { return null; }
}

export async function sendTelegramAlert({ token, chatId, text, fetcher = fetch }) {
  if (!/^[0-9]{5,20}:[A-Za-z0-9_-]{25,200}$/.test(token ?? '') || !/^[1-9][0-9]{4,19}$/.test(String(chatId))) throw Error('telegram_configuration_invalid');
  if (typeof text !== 'string' || text.length > 3500) throw Error('alert_text_invalid');
  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(chatId), text, link_preview_options: { is_disabled: true } }),
    });
    const body = await boundedJSON(response, 64 * 1024);
    if (!response.ok || body.ok !== true || !Number.isSafeInteger(body.result?.message_id)
      || String(body.result?.chat?.id) !== String(chatId)) {
      const error = Error('telegram_delivery_failed');
      error.retryAfterSeconds = Number.isInteger(body.parameters?.retry_after) ? body.parameters.retry_after : 0;
      throw error;
    }
    return { messageId: body.result.message_id };
  } catch (cause) {
    // Fetch errors can embed the capability-bearing request URL. Never pass
    // upstream exception text, Telegram descriptions or tokens to the journal.
    const error = Error('telegram_delivery_failed');
    error.retryAfterSeconds = cause?.retryAfterSeconds ?? 0;
    throw error;
  }
}
