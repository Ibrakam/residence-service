export type RegnumQueueLanguage = 'ru' | 'uz' | 'en';

export type RegnumQueueDescriptor = {
  queueKey: string;
  queueLabel: string;
  queueDisplayCode?: string;
  queueOrder: number;
};

export type RegnumQueueUnit = {
  queue?: number | string;
  queueKey?: string;
  queueLabel?: string;
  queueDisplayCode?: string;
  queueOrder?: number;
};

// The frozen MBC audit uses source queue ids 1 and 3 for the two construction
// queues that are currently on sale. They are presentation codes I and II;
// source id q3 must never be presented to a customer as the third queue.
const auditedQueueBySourceValue: Record<string, { key: string; code: string; order: number }> = {
  '1': { key: 'q1', code: 'I', order: 1 },
  '3': { key: 'q3', code: 'II', order: 2 },
};

const auditedQueueByKey = new Map(
  Object.values(auditedQueueBySourceValue).map((queue) => [queue.key, queue]),
);

export function regnumQueueKey(unit: RegnumQueueUnit): string | undefined {
  const explicit = unit.queueKey?.trim();
  if (explicit) return explicit;
  return auditedQueueBySourceValue[String(unit.queue ?? '')]?.key;
}

export function regnumQueueCode(
  unit: RegnumQueueUnit,
  queues: readonly RegnumQueueDescriptor[] = [],
): string | undefined {
  const key = regnumQueueKey(unit);
  const auditedCode = key ? auditedQueueByKey.get(key)?.code : undefined;
  if (auditedCode) return auditedCode;
  const explicit = unit.queueDisplayCode?.trim();
  if (explicit) return explicit;
  const projectQueue = key ? queues.find((queue) => queue.queueKey === key) : undefined;
  const projectCode = projectQueue?.queueDisplayCode?.trim();
  if (projectCode) return projectCode;
  return key ? auditedQueueByKey.get(key)?.code : undefined;
}

export function regnumQueueOrder(
  unit: RegnumQueueUnit,
  queues: readonly RegnumQueueDescriptor[] = [],
): number {
  if (Number.isInteger(unit.queueOrder) && Number(unit.queueOrder) > 0) return Number(unit.queueOrder);
  const key = regnumQueueKey(unit);
  const projectQueue = key ? queues.find((queue) => queue.queueKey === key) : undefined;
  if (projectQueue) return projectQueue.queueOrder;
  return key ? auditedQueueByKey.get(key)?.order ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
}

export function regnumQueueLabel(
  unit: RegnumQueueUnit,
  language: RegnumQueueLanguage,
  queues: readonly RegnumQueueDescriptor[] = [],
): string {
  const code = regnumQueueCode(unit, queues);
  if (!code) return language === 'ru' ? 'Очередь не указана' : language === 'uz' ? 'Bosqich ko\u2018rsatilmagan' : 'Phase not specified';
  if (language === 'ru') return `${code} очередь`;
  if (language === 'uz') return `${code} bosqich`;
  return `Phase ${code}`;
}
