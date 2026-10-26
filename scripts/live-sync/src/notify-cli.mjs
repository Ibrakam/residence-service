import { readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyAlertState, validateAlertState, planAlerts, notificationText, confirmDelivery, postponeDelivery, readCatalogHealth, sendTelegramAlert } from './notify.mjs';

async function main() {
  const stateDirectory = process.env.STATE_DIRECTORY;
  const credentialsDirectory = process.env.CREDENTIALS_DIRECTORY;
  const chatId = process.env.CRM_ALERT_CHAT_ID;
  if (!stateDirectory || !credentialsDirectory || !isAbsolute(stateDirectory) || !isAbsolute(credentialsDirectory)
    || stateDirectory.includes(':') || !/^[1-9][0-9]{4,19}$/.test(chatId ?? '')) throw Error('configuration_invalid');
  const statePath = join(stateDirectory, 'state-v1.json');
  let previous = emptyAlertState();
  try {
    const metadata = await lstat(statePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 64 * 1024) throw Error('state_invalid');
    previous = validateAlertState(JSON.parse(await readFile(statePath, 'utf8')));
  } catch (error) { if (error.code !== 'ENOENT') throw Error('state_invalid'); }
  const now = Date.now();
  const { state, events } = planAlerts(previous, await readCatalogHealth(), now);
  async function save(value) {
    const temporary = join(stateDirectory, `.state-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await rename(temporary, statePath);
  }
  await save(state);
  if (!events.length) { console.log(JSON.stringify({ event: 'crm_alerts', status: 'unchanged' })); return; }
  const token = (await readFile(join(credentialsDirectory, 'telegram-token'), 'utf8')).trim();
  try {
    await sendTelegramAlert({ token, chatId, text: notificationText(state, events) });
    await save(confirmDelivery(state, events));
    console.log(JSON.stringify({ event: 'crm_alerts', status: 'sent', changes: events.map(({ key, kind }) => ({ provider: key, kind })) }));
  } catch (error) {
    await save(postponeDelivery(state, now, error.retryAfterSeconds));
    throw Error('delivery_failed');
  }
}

main().catch((error) => {
  const code = ['configuration_invalid', 'state_invalid', 'delivery_failed'].includes(error.message) ? error.message : 'monitor_failed';
  console.error(JSON.stringify({ event: 'crm_alerts', status: 'failed', code }));
  process.exitCode = 1;
});
