import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readOwner } from '../server/src/owner.ts';
import { prepareDevelopmentDatabase } from './local-database.ts';

if (!(await readOwner())) throw new Error('Run npm.cmd run auth:setup first.');
let database,
  server,
  stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server?.kill('SIGTERM');
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  database = await prepareDevelopmentDatabase(process.env.MONGODB_URI);
  server = spawn(process.execPath, ['--env-file-if-exists=.env', 'src/server.ts'], {
    cwd: fileURLToPath(new URL('../server/', import.meta.url)),
    env: { ...process.env, NODE_ENV: 'production' },
    windowsHide: true,
    stdio: 'inherit'
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', resolve);
  });
  if (code && !stopping) process.exitCode = code;
} finally {
  if (database?.managed) await database.stop();
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
