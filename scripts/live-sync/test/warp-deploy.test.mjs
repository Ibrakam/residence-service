import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('optional WARP override preserves the original browser security, profile and CDP settings', async () => {
  const original = await readFile(new URL('../deploy/systemd/residence-live-browser-uysot.service', import.meta.url), 'utf8');
  const override = await readFile(new URL('../deploy/systemd/residence-live-browser-uysot-warp.conf', import.meta.url), 'utf8');
  const originalCommand = original.match(/^ExecStart=(.+)$/m)?.[1];
  const commands = [...override.matchAll(/^ExecStart=(.*)$/gm)].map((match) => match[1]);
  assert.equal(commands.length, 2);
  assert.equal(commands[0], '', 'systemd must replace rather than append ExecStart');
  assert.equal(commands[1].replace(' --proxy-server=socks5://127.0.0.1:40000 --disable-quic', ''), originalCommand);
  assert.match(override, /^After=warp-svc\.service$/m);
  assert.match(override, /^Wants=warp-svc\.service$/m);
  assert.doesNotMatch(override, /ignore-certificate-errors|disable-web-security|no-sandbox|0\.0\.0\.0|password=/i);
  const main = await readFile(new URL('../deploy/systemd/residence-live-browser-main.service', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /proxy-server|warp-svc/, 'Kayan/MBC must keep their direct connection');
});
