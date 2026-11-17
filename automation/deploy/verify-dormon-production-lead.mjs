import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run from /var/www/tencorp with the same private .env.local / tsx command
// used for the previous Pushkin verification. This script submits at most once.
const output = '/root/tencorp-workflow-backups/20261117T195421Z-dormon/lead-test.json';
const marker = 'DORMON-PROD-20261117T195421Z';
const logPath = '/root/.pm2/logs/tencorp-out.log';
const source = 'https://millenniumhouse.uz/dormon-hills';
const phone = '+998781137712';

async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function saveRecord(record, exclusive = false) {
  const filename = exclusive ? output : `${output}.${randomUUID()}.tmp`;
  const handle = await fs.open(filename, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
    await handle.sync();
  } finally { await handle.close(); }
  if (!exclusive) await fs.rename(filename, output);
  await syncDirectory(path.dirname(output));
}

export function buildPayload(state) {
  const plan = state?.plans?.[0];
  if (state?.source !== source || state.freshness !== 'current' ||
      !plan || !/^layout-[a-z0-9-]+$/.test(plan.id) ||
      !['А', 'Б', 'В', 'Г', 'Д'].includes(plan.block) || ![1, 2, 3].includes(plan.rooms) ||
      !Number.isFinite(plan.area) || plan.area <= 0 || plan.area > 500) {
    throw new Error('A current published layout is required before the single test submission');
  }
  return {
    name: `[ТЕСТ — НЕ ЗВОНИТЬ] ${marker}`,
    phone,
    goal: 'live',
    consent: true,
    projectSlug: 'dormon-hills',
    lang: 'ru',
    language: 'ru',
    formContext: `projectSlug=dormon-hills;lang=ru;surface=catalog:typical-plan;qa=${marker};source=${source}#plans;block=${plan.block};rooms=${plan.rooms};area=${plan.area};plan=${plan.id}`,
    landing_url: 'https://form.tencorp.uz/dormon-hills/apartments?lang=ru',
    utm_source: 'tencorp-integration-check',
    utm_medium: 'internal-test',
    utm_campaign: marker,
  };
}

async function candidateIds(record) {
  if (Number.isSafeInteger(record.leadId) && record.leadId > 0) return [record.leadId];
  const handle = await fs.open(logPath, 'r');
  try {
    const file = await handle.stat();
    if (String(file.ino) !== record.logInode || String(file.dev) !== record.logDevice ||
        !Number.isSafeInteger(record.logOffset) || record.logOffset < 0 || file.size < record.logOffset) {
      throw new Error('The receipt log rotated; reconcile the existing marker without resubmitting');
    }
    const length = file.size - record.logOffset;
    if (length > 2_000_000) throw new Error('The receipt log window exceeds the bounded read limit; do not resubmit');
    const bytes = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const result = await handle.read(bytes, offset, length - offset, record.logOffset + offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    return [...new Set([...bytes.subarray(0, offset).toString('utf8').matchAll(/website lead created[^\n]*lead_id=(\d+)/g)]
      .map(match => Number(match[1])).filter(Number.isSafeInteger))].slice(-20);
  } finally { await handle.close(); }
}

async function reconcile(record, getLeadTrackingContext, pipelineId, reused = false) {
  if (record.marker !== marker || record.projectSlug !== 'dormon-hills') throw new Error('Unexpected private verification record');
  for (let attempt = 0; attempt < 8; attempt++) {
    for (const id of await candidateIds(record)) {
      let lead;
      try { lead = await getLeadTrackingContext(id); } catch { continue; }
      if (!lead?.leadName?.includes(marker)) continue;
      if (!lead.leadName.includes('[ТЕСТ — НЕ ЗВОНИТЬ]') || lead.pipelineId !== pipelineId ||
          String(lead.phone ?? '').replace(/\D/g, '') !== phone.replace(/\D/g, '')) {
        throw new Error('The existing test lead has an unexpected pipeline or contact; do not resubmit');
      }
      const result = { ...record, phase: 'verified', leadId: lead.leadId, pipelineId: lead.pipelineId,
        verified: true, verifiedAt: new Date().toISOString() };
      await saveRecord(result);
      console.log(JSON.stringify({ marker, eventId: result.eventId ?? null, leadId: lead.leadId,
        pipelineId: lead.pipelineId, verified: true, reused }));
      return;
    }
    if (attempt < 7) await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw new Error('The single submission is pending reconciliation; rerun for readback only, never delete its marker or resubmit');
}

export async function verifyProductionLead() {
  if (process.getuid?.() !== 0) throw new Error('Run the verifier as root on the production host');
  const pipelineId = Number(process.env.AMO_PIPELINE_ID);
  if (!Number.isSafeInteger(pipelineId) || pipelineId <= 0) throw new Error('Load the private existing .env.local before verification');
  const { getLeadTrackingContext } = await import('/var/www/tencorp/src/lib/amocrm.ts');
  let existing;
  try { existing = JSON.parse(await fs.readFile(output, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('The private verification record cannot be read safely; do not submit');
  }
  if (existing) return reconcile(existing, getLeadTrackingContext, pipelineId, true);

  const stateResponse = await fetch('http://127.0.0.1:4320/api/dormon-plans', { signal: AbortSignal.timeout(10_000) });
  if (!stateResponse.ok) throw new Error('The deployed layout endpoint is unavailable');
  const stateText = await stateResponse.text();
  if (stateText.length > 128_000) throw new Error('The layout response exceeds its limit');
  const state = JSON.parse(stateText);
  const payload = buildPayload(state);
  const fixturePath = '/etc/tencorp-auth-gateway/deploy-smoke-session';
  const fixture = await fs.lstat(fixturePath);
  if (!fixture.isFile() || fixture.uid !== 0 || (fixture.mode & 0o077)) throw new Error('The deployment fixture must be a private root-owned file');
  const token = (await fs.readFile(fixturePath, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('The verified deployment fixture is unavailable');
  const config = `/run/dormon-lead-curl-${process.pid}-${randomUUID()}`;
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const log = await fs.stat(logPath);
  const record = { marker, projectSlug: 'dormon-hills', phase: 'pending', attemptedAt: new Date().toISOString(),
    source, capturedAt: state.capturedAt, layout: { id: state.plans[0].id, block: state.plans[0].block,
      rooms: state.plans[0].rooms, area: state.plans[0].area },
    logOffset: log.size, logInode: String(log.ino), logDevice: String(log.dev) };
  // Exclusive create plus file/directory fsync happens before the network POST.
  // Every later run reconciles this record and cannot submit another request.
  try { await saveRecord(record, true); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another verifier reserved the single submission; rerun for readback only');
    throw error;
  }
  let receipt;
  try {
    await fs.writeFile(config, `noproxy = "*"\ncookie = "__Host-tencorp_session=${token}"\n`, { mode: 0o600, flag: 'wx' });
    const response = execFileSync('curl', ['--disable', '--config', config, '--silent', '--show-error',
      '--fail-with-body', '--max-time', '40', '--max-filesize', '65536', '--header', 'Content-Type: application/json',
      '--header', 'Origin: https://form.tencorp.uz', '--data-binary', '@-', 'https://form.tencorp.uz/v1/leads'],
    { input: JSON.stringify(payload), encoding: 'utf8', maxBuffer: 65_536, stdio: ['pipe', 'pipe', 'pipe'] });
    receipt = JSON.parse(response);
    if (receipt.success !== true || receipt.forwarded !== true) throw new Error('Delivery was not acknowledged');
    record.phase = 'acknowledged';
    if (typeof receipt.eventId === 'string' && receipt.eventId.length <= 200) record.eventId = receipt.eventId;
    record.acknowledgedAt = new Date().toISOString();
    await saveRecord(record);
  } catch {
    record.phase = 'uncertain';
    await saveRecord(record);
  } finally { await fs.rm(config, { force: true }); }
  await reconcile(record, getLeadTrackingContext, pipelineId);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyProductionLead().catch(error => { console.error(error.message); process.exitCode = 1; });
}
