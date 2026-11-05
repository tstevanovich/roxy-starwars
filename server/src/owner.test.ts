import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { equalSecret, hashPassword, readOwner, verifyPassword, writeOwner } from './owner.ts';

vi.mock('node:crypto', async (original) => ({
  ...(await original<typeof import('node:crypto')>()),
  scrypt: (_password, _salt, length, _options, callback) => {
    callback(new Error('scrypt unavailable'), Buffer.alloc(length));
  }
}));
let directory: string, filename: string;
const owner = { username: 'owner', hash: 'a'.repeat(128), salt: 'b'.repeat(48), version: 'v1' };
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-owner-'));
  filename = join(directory, 'owner.json');
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
test('missing records remain locked and malformed credentials fail closed', async () => {
  expect(await readOwner(filename)).toBeNull();
  for (const record of [
    '{',
    JSON.stringify({ ...owner, username: '' }),
    JSON.stringify({ ...owner, hash: '' }),
    JSON.stringify({ ...owner, salt: '' }),
    JSON.stringify({ ...owner, version: '' })
  ]) {
    await writeFile(filename, record);
    await expect(readOwner(filename)).rejects.toThrow('Access remains locked');
  }
  await writeFile(filename, JSON.stringify(owner));
  expect(await readOwner(filename)).toEqual(owner);
});
test('owner writes use compare-and-swap and remove temporary files on conflicts', async () => {
  await expect(writeOwner(filename, owner, 'missing')).rejects.toMatchObject({ status: 409 });
  expect(await readdir(directory)).toEqual([]);
  await writeOwner(filename, owner, null);
  await expect(writeOwner(filename, { ...owner, version: 'v2' }, 'stale')).rejects.toMatchObject({
    status: 409
  });
  expect(JSON.parse(await readFile(filename, 'utf8'))).toEqual(owner);
  expect(await readdir(directory)).toEqual(['owner.json']);
  await writeOwner(filename, { ...owner, version: 'v2' }, 'v1');
  expect((await readOwner(filename)).version).toBe('v2');
});
test('cryptographic failures propagate and empty or absent secrets never match', async () => {
  await expect(hashPassword('password')).rejects.toThrow('scrypt unavailable');
  await expect(verifyPassword('password', owner)).rejects.toThrow('scrypt unavailable');
  expect(equalSecret(undefined, null)).toBe(false);
  expect(equalSecret('a', undefined)).toBe(false);
  expect(equalSecret('same', 'same')).toBe(true);
  expect(equalSecret('aaaa', 'bbbb')).toBe(false);
});
