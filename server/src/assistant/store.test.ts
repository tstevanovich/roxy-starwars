import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { createSecretStore } from './store.ts';

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, readFile: vi.fn(fs.readFile), writeFile: vi.fn(fs.writeFile) };
});
let directory: string;
beforeEach(async () => {
  vi.mocked(fs.readFile).mockClear();
  vi.mocked(fs.writeFile).mockClear();
  directory = await fs.mkdtemp(join(tmpdir(), 'studio-secret-'));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});
test('encrypted storage serializes concurrent updates and recovers its queue after an unsuccessful edit', async () => {
  const store = createSecretStore(directory);
  expect(await store.read()).toEqual({});
  await expect(
    store.update(() => {
      throw new Error('Cancelled edit');
    })
  ).rejects.toThrow('Cancelled edit');
  await Promise.all([
    store.update(() => ({ first: true })),
    store.update((current) => ({ ...current, second: true }))
  ]);
  expect(await store.read()).toEqual({ first: true, second: true });
  expect((await fs.readFile(join(directory, 'integrations.enc'))).toString()).not.toContain(
    'first'
  );
  await fs.writeFile(join(directory, 'integrations.enc'), Buffer.alloc(32));
  await expect(store.read()).rejects.toThrow();
});
test('permission errors are never treated as missing credentials', async () => {
  const denied = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
  vi.mocked(fs.readFile).mockRejectedValueOnce(denied);
  await expect(createSecretStore(directory).read()).rejects.toBe(denied);
  vi.mocked(fs.readFile)
    .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    .mockRejectedValueOnce(denied);
  await expect(createSecretStore(directory).update(() => ({}))).rejects.toBe(denied);
});
test('key creation handles concurrent creators but propagates real write failures', async () => {
  const write = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'))
    .writeFile;
  vi.mocked(fs.writeFile).mockImplementationOnce(async (path, data, options) => {
    await write(path, data, options);
    throw Object.assign(new Error('Another writer created the key'), { code: 'EEXIST' });
  });
  await createSecretStore(directory).update(() => ({ connected: true }));
  expect(await createSecretStore(directory).read()).toEqual({ connected: true });
  await fs.rm(join(directory, 'integrations.enc'));
  await fs.rm(join(directory, 'integrations.key'));
  vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error('Disk full'));
  await expect(createSecretStore(directory).update(() => ({}))).rejects.toThrow('Disk full');
});
