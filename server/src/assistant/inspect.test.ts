import { beforeEach, expect, test, vi } from 'vitest';

import { StudioEpisode, StudioMedia } from '../models/Studio.ts';
import { inspectMedia } from './inspect.ts';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  readFile: vi.fn(async () => Buffer.from('image'))
}));
vi.mock('node:child_process', () => {
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: mocks.execute
  });
  return { execFile };
});
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  readFile: mocks.readFile
}));
vi.mock('../models/Studio.ts', () => ({
  StudioMedia: { findById: vi.fn() },
  StudioEpisode: { find: vi.fn() }
}));
vi.mock('../projects.ts', () => ({ assertMediaAccess: vi.fn() }));
const mid = '111111111111111111111111';
let media;
beforeEach(() => {
  media = {
    _id: mid,
    kind: 'image',
    mime: 'image/png',
    bytes: 100,
    filename: 'image.png',
    originalName: 'Image',
    sourceFrame: { timestamp: 5 },
    sourceVideo: { sourceId: 'source' }
  };
  vi.mocked(StudioMedia.findById).mockImplementation(() => ({ lean: async () => media }) as never);
  vi.mocked(StudioEpisode.find).mockReturnValue({
    lean: async () => [
      {
        title: 'Episode',
        scenes: [
          {
            title: 'Scene',
            clips: [{ title: 'Shot', dialogue: 'Hi', dialogueTakeIds: [mid] }, { title: 'Other' }]
          }
        ]
      }
    ]
  } as never);
  mocks.execute.mockReset().mockResolvedValue({ stdout: '{"format":{"duration":"10"}}' });
});
test('inspection checks file existence, paths and image size before reading', async () => {
  const options = { mediaDirectory: '/fixture' };
  expect((await inspectMedia(mid, options)).images[0].image_url).toBe(
    'data:image/png;base64,aW1hZ2U='
  );
  media.bytes = 12 * 1024 * 1024 + 1;
  await expect(inspectMedia(mid, options)).rejects.toThrow('12 MB');
  media.filename = '../outside.png';
  await expect(inspectMedia(mid, options)).rejects.toThrow('Invalid media path');
  media = null;
  await expect(inspectMedia(mid, options)).rejects.toThrow('no longer exists');
});
test('audio inspection supplies saved scripts with a clear limitation instead of fabricated analysis', async () => {
  media.kind = 'audio';
  delete media.sourceFrame;
  delete media.sourceVideo;
  const result = await inspectMedia(mid, { mediaDirectory: '/fixture' });
  if (!('savedDialogue' in result.info))
    throw new Error('Audio inspection did not return script metadata');
  expect(result.info.savedDialogue).toEqual([
    { episode: 'Episode', scene: 'Scene', clip: 'Shot', script: 'Hi' }
  ]);
  expect(result.info.limitation).toContain('Audio was not heard');
  media.kind = 'other';
  await expect(inspectMedia(mid, { mediaDirectory: '/fixture' })).rejects.toThrow(
    'cannot be inspected'
  );
});
test('video inspection samples three frames and reports bounded duration and decoder errors', async () => {
  media.kind = 'video';
  const result = await inspectMedia(mid, { mediaDirectory: '/fixture' });
  if (!('frameTimes' in result.info))
    throw new Error('Video inspection did not return frame times');
  expect(result.images).toHaveLength(3);
  expect(result.info.frameTimes).toEqual([0, 5, 9.7]);
  for (const duration of [0, 601]) {
    mocks.execute.mockResolvedValueOnce({ stdout: JSON.stringify({ format: { duration } }) });
    await expect(inspectMedia(mid, { mediaDirectory: '/fixture' })).rejects.toThrow('ten minutes');
  }
  mocks.execute.mockRejectedValueOnce(new Error('Decoder unavailable'));
  await expect(inspectMedia(mid, { mediaDirectory: '/fixture' })).rejects.toThrow('Install FFmpeg');
  mocks.execute.mockResolvedValueOnce({ stdout: '{"format":{"duration":0.1}}' });
  expect((await inspectMedia(mid, { mediaDirectory: '/fixture' })).info).toMatchObject({
    frameTimes: [0, 0.05, 0]
  });
});
