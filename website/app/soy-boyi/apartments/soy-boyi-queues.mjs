const romanByOrder = Object.freeze({
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
});

/**
 * The official MBC project cards advertise four construction queues for
 * Soy Bo‘yi. Queue I currently has no available apartments in the residential
 * feed, but keeping it in the selector makes the site match the CRM and lets it
 * become selectable as soon as an apartment appears there.
 */
export const soyBoyiOfficialQueues = Object.freeze([
  Object.freeze({
    queueKey: "q1",
    queueLabel: "I очередь",
    queueDisplayCode: "I",
    queueOrder: 1,
  }),
  Object.freeze({
    queueKey: "q2",
    queueLabel: "II очередь",
    queueDisplayCode: "II",
    queueOrder: 2,
  }),
  Object.freeze({
    queueKey: "q3",
    queueLabel: "III очередь",
    queueDisplayCode: "III",
    queueOrder: 3,
  }),
  Object.freeze({
    queueKey: "q4",
    queueLabel: "IV очередь",
    queueDisplayCode: "IV",
    queueOrder: 4,
  }),
]);

function queueNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const qNumber = text.match(/(?:^|[^a-z])q(?:ueue)?[\s:_-]*(\d+)(?:\D|$)/i);
  if (qNumber) return Number(qNumber[1]);
  if (/^\d+$/.test(text)) return Number(text);
  const roman = text.match(/^\s*(I{1,3}|IV)\b/i)?.[1]?.toUpperCase();
  if (roman) return Object.entries(romanByOrder).find(([, value]) => value === roman)?.[0] ?? null;
  return null;
}

export function soyQueueKey(unit) {
  const explicitKey = String(unit?.queueKey ?? "").trim();
  if (explicitKey) return explicitKey;
  for (const candidate of [
    unit?.phaseSlug,
    unit?.queue,
    unit?.phase,
    unit?.queueLabel,
    unit?.phaseName,
  ]) {
    const order = Number(queueNumber(candidate));
    if (Number.isInteger(order) && order > 0 && order < 100) return `q${order}`;
  }
  return "";
}

export function soyQueueOrder(value) {
  if (value && typeof value === "object") {
    const explicitOrder = Number(value.queueOrder ?? value.order);
    if (Number.isInteger(explicitOrder) && explicitOrder > 0 && explicitOrder < 100) {
      return explicitOrder;
    }
  }
  const candidates =
    value && typeof value === "object"
      ? [
          value.queueKey,
          value.key,
          value.queueDisplayCode,
          value.displayCode,
          value.queueLabel,
          value.label,
          value.phaseSlug,
          value.queue,
          value.phase,
          value.phaseName,
        ]
      : [value];
  for (const candidate of candidates) {
    const order = Number(queueNumber(candidate));
    if (Number.isInteger(order) && order > 0 && order < 100) return order;
  }
  return null;
}

export function soyQueueLabel(value, language) {
  const order = soyQueueOrder(value);
  if (!order) return "";
  const numeral =
    (value && typeof value === "object" &&
      String(value.queueDisplayCode ?? value.displayCode ?? "").trim()) ||
    romanByOrder[order] ||
    String(order);
  if (language === "uz") return `${numeral} navbat`;
  if (language === "en") return `Queue ${numeral}`;
  if (value && typeof value === "object") {
    const crmLabel = String(value.queueLabel ?? value.label ?? "").trim();
    if (crmLabel) return crmLabel;
  }
  return `${numeral} очередь`;
}

export function soyQueueOptions(units, advertisedQueues = []) {
  const authoritativeQueues = Array.isArray(advertisedQueues)
    ? advertisedQueues.filter(Boolean)
    : [];
  const definitions = new Map(
    (authoritativeQueues.length ? [] : soyBoyiOfficialQueues).map((queue) => [
      queue.queueKey,
      {
        ...queue,
        key: queue.queueKey,
        order: queue.queueOrder,
        displayCode: queue.queueDisplayCode,
      },
    ]),
  );
  for (const queue of authoritativeQueues) {
    const key =
      soyQueueKey(queue) ||
      String(queue?.queueKey ?? queue?.key ?? "")
        .trim()
        .toLowerCase();
    const order = soyQueueOrder(queue) ?? soyQueueOrder(key);
    if (!key || key.length > 128 || !order) continue;
    definitions.set(key, {
      ...definitions.get(key),
      ...queue,
      key,
      order,
      displayCode:
        String(queue?.queueDisplayCode ?? queue?.displayCode ?? "").trim() ||
        romanByOrder[order] ||
        String(order),
    });
  }

  const counts = new Map();
  for (const unit of units ?? []) {
    const key = soyQueueKey(unit);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!definitions.has(key)) {
      definitions.set(key, {
        key,
        order: soyQueueOrder(unit) ?? soyQueueOrder(key),
        queueLabel: unit?.queueLabel,
        queueDisplayCode: unit?.queueDisplayCode,
        displayCode: unit?.queueDisplayCode,
      });
    }
  }

  return [...definitions.values()]
    .filter((queue) => Number.isInteger(queue.order))
    .map((queue) => ({ ...queue, count: counts.get(queue.key) ?? 0 }))
    .sort((left, right) => left.order - right.order);
}
