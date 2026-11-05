import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { StudioMedia } from './models/Studio.ts';
import { crc32, mediaRouter, mediaView, saveGeneratedMedia } from './studio-media.ts';
import { rejectMedia } from './studio-reject-media.ts';

vi.mock('./models/Studio.ts', () => ({ StudioMedia: { create: vi.fn(), findById: vi.fn() } }));
vi.mock('./projects.ts', () => ({ assertMediaAccess: vi.fn() }));
vi.mock('./studio-reject-media.ts', () => ({
  rejectMedia: vi.fn(async () => ({ removed: true }))
}));
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-media-'));
  vi.mocked(StudioMedia.create).mockImplementation(
    async (input) => ({ ...input, toObject: () => input }) as never
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  vi.clearAllMocks();
});
function app() {
  const app = express();
  app.use('/', mediaRouter(directory));
  app.use((error, _req, res, _next) =>
    res.status(error.status ?? 500).json({ message: error.message })
  );
  return app;
}
const bytes = (signature: number[] | string) => {
  const buffer = Buffer.alloc(16);
  if (typeof signature === 'string') buffer.write(signature);
  else Buffer.from(signature).copy(buffer);
  return buffer;
};
test.each([
  ['jpg', bytes([255, 216, 255])],
  ['jpeg', bytes([255, 216, 255])],
  ['webp', bytes('RIFF0000WEBP')],
  ['gif', bytes('GIF89a')],
  ['webm', bytes([26, 69, 223, 163])],
  ['m4a', bytes('0000ftyp')],
  ['ogg', bytes('OggS')],
  ['mp3', bytes([255, 224])]
])('generated %s originals retain their format and integrity hashes', async (extension, buffer) => {
  const media = await saveGeneratedMedia(directory, buffer, `result.${extension}`);
  expect(media.bytes).toBe(16);
  expect(media.sha256).toHaveLength(64);
  expect(await readdir(directory)).toHaveLength(1);
});
test('invalid generated files never persist and database failures remove their local originals', async () => {
  for (const [name, buffer] of [
    ['file.txt', bytes('invalid')],
    ['file.gif', 'not a buffer'],
    ['file.gif', Buffer.alloc(2)],
    ['file.gif', bytes('not gif')]
  ] as const)
    await expect(saveGeneratedMedia(directory, buffer, name)).rejects.toThrow('supported media');
  vi.mocked(StudioMedia.create).mockRejectedValueOnce(new Error('Database failed'));
  await expect(saveGeneratedMedia(directory, bytes('GIF87a'), 'file.gif')).rejects.toThrow(
    'Database failed'
  );
  expect(await readdir(directory)).toEqual([]);
  expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  expect(mediaView({ _id: 'id', filename: 'secret', projectKey: 'other' })).toEqual({
    _id: 'id',
    projectKey: 'other',
    url: '/api/studio/media/id?project=other'
  });
});
test('uploads reject malformed filenames and missing files produce a useful recovery message', async () => {
  const api = app();
  expect((await request(api).post('/').send('body')).status).toBe(400);
  for (const name of ['%FF', '..%2Ffile.gif', 'file%00.gif', 'x'.repeat(241)])
    expect(
      (await request(api).post('/').set('X-File-Name', name).send(bytes('GIF89a'))).status
    ).toBe(400);
  const missing = '111111111111111111111111';
  vi.mocked(StudioMedia.findById).mockReturnValue({
    lean: async () => ({ filename: 'missing.mp4', originalName: 'video.mp4', mime: 'video/mp4' })
  } as never);
  const result = await request(api).get('/' + missing);
  expect(result.status).toBe(404);
  expect(result.body.message).toContain('Restore it from your backup');
  await request(api).delete('/' + missing);
  expect(rejectMedia).toHaveBeenCalledWith(directory, missing, {});
  vi.mocked(StudioMedia.findById).mockReturnValueOnce({
    lean: async () => ({ filename: '.', mime: 'video/mp4' })
  } as never);
  expect((await request(api).get('/' + missing)).status).toBe(500);
  vi.mocked(StudioMedia.create).mockRejectedValueOnce(new Error('Database unavailable'));
  expect(
    (await request(api).post('/').set('X-File-Name', 'upload.gif').send(bytes('GIF89a'))).status
  ).toBe(500);
  expect(await readdir(directory)).toEqual([]);
});
