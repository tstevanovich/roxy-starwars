import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { readOwner } from '../server/src/owner.js';
import { keepAwakeFor } from './keep-awake.mjs';
import { securePrivateDirectory } from './private-files.mjs';

const run = promisify(execFile),
  root = fileURLToPath(new URL('../', import.meta.url));
const statePath = new URL('../.data/private/remote.json', import.meta.url),
  exe = fileURLToPath(new URL('../.data/tools/cloudflared.exe', import.meta.url));
const command = process.argv[2] ?? 'status';
const psQuote = (value) => "'" + value.replaceAll("'", "''") + "'";
async function state() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
async function verifiedProcess(value) {
  if (!value?.pid || !Number.isSafeInteger(value.pid)) return false;
  if (process.platform !== 'win32')
    throw new Error('Process identity verification currently targets Windows.');
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter ${psQuote('ProcessId = ' + value.pid)} | Select-Object ProcessId,ExecutablePath,CreationDate | ConvertTo-Json -Compress`
    ],
    { windowsHide: true }
  );
  if (!stdout.trim()) return false;
  const processInfo = JSON.parse(stdout);
  return (
    processInfo.ExecutablePath?.toLowerCase() === exe.toLowerCase() &&
    processInfo.CreationDate === value.creationDate
  );
}
if (command === 'awake') {
  const value = await state();
  if (!(await verifiedProcess(value))) throw new Error('Start the studio tunnel first.');
  value.keepAwakePid = await keepAwakeFor(value.pid);
  await writeFile(statePath, JSON.stringify(value, null, 2), { mode: 0o600 });
  console.log('Windows wake request attached to the running tunnel. The display may still sleep.');
} else if (command === 'status') {
  const value = await state();
  console.log(
    JSON.stringify(
      {
        running: await verifiedProcess(value),
        origin: value?.origin ?? null,
        addressFile: '.data/private/remote-access.txt'
      },
      null,
      2
    )
  );
} else if (command === 'stop') {
  const value = await state();
  if (await verifiedProcess(value)) {
    process.kill(value.pid);
    console.log('Stopped the verified studio tunnel.');
  } else console.log('No verified studio tunnel is running.');
  await writeFile(
    statePath,
    JSON.stringify({ ...value, pid: null, stoppedAt: new Date().toISOString() }, null, 2)
  );
} else if (command === 'start') {
  const old = await state();
  if (await verifiedProcess(old)) {
    console.log('Studio tunnel is already running: ' + old.origin);
    process.exit(0);
  }
  if (!(await readOwner())) throw new Error('Run npm.cmd run auth:setup first.');
  const base = 'http://127.0.0.1:5000';
  const auth = await fetch(base + '/api/auth/session', { signal: AbortSignal.timeout(5000) });
  const authData = await auth.json();
  if (!auth.ok || authData.authenticated !== false || authData.configured !== true)
    throw new Error('Owner authentication is not ready. No tunnel was started.');
  if ((await fetch(base + '/api/studio')).status !== 401)
    throw new Error('Studio is not protected. No tunnel was started.');
  const index = await (await fetch(base)).text();
  if (!index.includes('/assets/') || index.includes('/src/main'))
    throw new Error(
      'Run the built production studio on port 5000, not Vite, before opening a tunnel.'
    );
  const release = JSON.parse(
    await readFile(new URL('../.data/tools/cloudflared-release.json', import.meta.url), 'utf8')
  );
  if (
    createHash('sha256')
      .update(await readFile(exe))
      .digest('hex') !== release.sha256
  )
    throw new Error('Cloudflared verification failed.');
  await securePrivateDirectory(fileURLToPath(new URL('../.data/private/', import.meta.url)));
  const logDir = new URL('../.data/remote/', import.meta.url);
  await mkdir(logDir, { recursive: true });
  const logPath = new URL('cloudflared-' + Date.now() + '.log', logDir);
  const log = await open(logPath, 'wx');
  const child = spawn(exe, ['tunnel', '--url', base, '--no-autoupdate', '--protocol', 'http2'], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log.fd, log.fd]
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  await log.close();
  child.unref();
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter ${psQuote('ProcessId = ' + child.pid)} | Select-Object CreationDate | ConvertTo-Json -Compress`
    ],
    { windowsHide: true }
  );
  const value = {
    pid: child.pid,
    creationDate: JSON.parse(stdout).CreationDate,
    startedAt: new Date().toISOString(),
    origin: null,
    logPath: fileURLToPath(logPath)
  };
  value.keepAwakePid = await keepAwakeFor(child.pid);
  await writeFile(statePath, JSON.stringify(value, null, 2), { mode: 0o600 });
  for (let attempt = 0; attempt < 45; attempt++) {
    const text = await readFile(logPath, 'utf8'),
      origin = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
    if (origin) {
      value.origin = origin;
      await writeFile(statePath, JSON.stringify(value, null, 2), { mode: 0o600 });
      const owner = await readOwner();
      let setupLink = '';
      if (owner.inviteHash && Date.parse(owner.inviteExpiresAt) > Date.now()) {
        const token = (
          await readFile(new URL('../.data/private/setup-token.txt', import.meta.url), 'utf8')
        ).trim();
        setupLink = origin + '/#setup=' + token;
      }
      await writeFile(
        new URL('../.data/private/remote-access.txt', import.meta.url),
        'Studio address: ' +
          origin +
          '\nUsername: tony\n' +
          (setupLink
            ? 'One-time password setup (keep private): ' + setupLink + '\n'
            : 'Sign in with your chosen password.\n') +
          '\nThe computer and tunnel must stay running. This temporary hostname changes after a tunnel restart.\n',
        { mode: 0o600 }
      );
      console.log(
        'Remote HTTPS address: ' +
          origin +
          '\nPrivate one-time sign-in instructions: .data/private/remote-access.txt'
      );
      process.exit(0);
    }
    if (!(await verifiedProcess(value)))
      throw new Error('Cloudflared stopped. Read its local log.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (await verifiedProcess(value)) process.kill(value.pid);
  throw new Error(
    'Tunnel did not return a hostname within 45 seconds; stopped the verified tunnel.'
  );
} else throw new Error('Use remote:start, remote:status or remote:stop.');
