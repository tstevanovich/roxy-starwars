import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
export async function securePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const { stdout } = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
      windowsHide: true
    });
    const sid = stdout.match(/S-1-5-[\d-]+/)?.[0];
    if (!sid) throw new Error('Could not identify the Windows owner.');
    await run(
      'icacls.exe',
      [directory, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'],
      { windowsHide: true }
    );
  }
}
