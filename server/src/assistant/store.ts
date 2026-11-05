import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toError } from '../../../shared/errors.ts';

const defaultDirectory = fileURLToPath(new URL('../../../.data/private/', import.meta.url));
// A separate key keeps connection credentials out of MongoDB, backups of chat, and browser storage.
export function createSecretStore(directory = defaultDirectory) {
  let pending = Promise.resolve();
  async function key() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const location = join(directory, 'integrations.key');
    try {
      return await readFile(location);
    } catch (caughtError) {
      const error = toError(caughtError);
      if (error.code !== 'ENOENT') throw error;
      try {
        await writeFile(location, randomBytes(32), { flag: 'wx', mode: 0o600 });
      } catch (caughtError) {
        const race = toError(caughtError);
        if (race.code !== 'EEXIST') throw race;
      }
      return readFile(location);
    }
  }
  async function read() {
    try {
      const data = await readFile(join(directory, 'integrations.enc'));
      const decipher = createDecipheriv('aes-256-gcm', await key(), data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
      );
    } catch (caughtError) {
      const error = toError(caughtError);
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }
  function update(change) {
    const result = pending.then(async () => {
      const current = await read();
      const next = await change(current);
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', await key(), iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(next)), cipher.final()]);
      const target = join(directory, 'integrations.enc');
      await writeFile(target + '.tmp', Buffer.concat([iv, cipher.getAuthTag(), body]), {
        mode: 0o600
      });
      await rename(target + '.tmp', target);
      return next;
    });
    pending = result.catch(() => {});
    return result;
  }
  return { read, update };
}
