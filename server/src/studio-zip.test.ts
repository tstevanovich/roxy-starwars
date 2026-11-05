import { stat } from 'node:fs/promises';
import { PassThrough } from 'node:stream';

import { expect, test, vi } from 'vitest';

import { sendZip } from './studio-zip.ts';

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  stat: vi.fn()
}));
const response = () => Object.assign(new PassThrough(), { attachment: vi.fn(), type: vi.fn() });
test('export rejects changed originals before sending any bytes', async () => {
  vi.mocked(stat).mockResolvedValue({ size: 11 } as Awaited<ReturnType<typeof stat>>);
  const res = response();
  await expect(
    sendZip(
      res,
      '/fixture',
      [{ bytes: 10, filename: 'original.mp4', originalName: 'original.mp4' }],
      {}
    )
  ).rejects.toThrow('source media file changed');
  expect(res.attachment).not.toHaveBeenCalled();
});
test('export rejects classic ZIP size overflow before streaming', async () => {
  vi.mocked(stat).mockResolvedValue({ size: 0xffffffff } as Awaited<ReturnType<typeof stat>>);
  await expect(
    sendZip(
      response(),
      '/fixture',
      [{ bytes: 0xffffffff, filename: 'large.mp4', originalName: 'large.mp4' }],
      {}
    )
  ).rejects.toMatchObject({ status: 400 });
});
test('manifest-only exports produce a valid central directory', async () => {
  const res = response(),
    chunks: Buffer[] = [];
  res.on('data', (chunk) => chunks.push(chunk));
  await sendZip(res, '/fixture', [], { episode: 'Example' });
  const zip = Buffer.concat(chunks);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  expect(zip.toString()).toContain('Example');
});
