import { unlink } from 'node:fs/promises';

import { beforeEach, expect, test, vi } from 'vitest';

import { StudioAsset, StudioEpisode, StudioMedia, StudioMusicCue } from './models/Studio.ts';
import { rejectMedia } from './studio-reject-media.ts';

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  unlink: vi.fn(async () => {})
}));
vi.mock('./models/Studio.ts', () => ({
  StudioAsset: { find: vi.fn(), findOneAndUpdate: vi.fn() },
  StudioEpisode: { find: vi.fn(), findOneAndUpdate: vi.fn() },
  StudioMusicCue: { find: vi.fn(), findOneAndUpdate: vi.fn() },
  StudioMedia: { findById: vi.fn(), exists: vi.fn(), deleteOne: vi.fn() }
}));
const mid = '111111111111111111111111',
  aid = '222222222222222222222222';
const query = (value) => ({ lean: async () => value });
let media, assets, episodes, cues;
beforeEach(() => {
  vi.clearAllMocks();
  media = { _id: mid, filename: 'audition.mp3' };
  assets = [];
  episodes = [];
  cues = [];
  vi.mocked(StudioMedia.findById).mockImplementation(() => query(media) as never);
  vi.mocked(StudioMedia.exists).mockResolvedValue(null);
  vi.mocked(StudioAsset.find).mockImplementation(() => query(assets) as never);
  vi.mocked(StudioEpisode.find).mockImplementation(() => query(episodes) as never);
  vi.mocked(StudioMusicCue.find).mockImplementation(() => query(cues) as never);
  for (const model of [StudioAsset, StudioEpisode, StudioMusicCue])
    vi.mocked(model.findOneAndUpdate).mockReturnValue(query({ _id: aid }) as never);
  vi.mocked(unlink).mockResolvedValue(undefined);
});
const reject = (context = {}) => rejectMedia('C:/fixture-studio-media', mid, context);
test('rejection verifies stored paths and current option ownership before deleting anything', async () => {
  media = null;
  await expect(reject()).rejects.toMatchObject({ status: 404 });
  media = { _id: mid, filename: '../outside' };
  await expect(reject()).rejects.toThrow('Invalid stored');
  media.filename = 'audition.mp3';
  assets = [{ _id: aid, revision: 0, candidates: [] }];
  await expect(reject({ assetId: aid, revision: 0, packageItemId: 'missing' })).rejects.toThrow(
    'reference package item'
  );
  await expect(reject({ assetId: aid, revision: 0, candidateId: 'missing' })).rejects.toThrow(
    'that option'
  );
  cues = [{ _id: aid, revision: 0, candidates: [] }];
  await expect(reject({ musicCueId: aid, revision: 1 })).rejects.toThrow('music record changed');
  await expect(reject({ musicCueId: aid, revision: 0, candidateId: 'missing' })).rejects.toThrow(
    'music take'
  );
  episodes = [{ _id: aid, revision: 0, scenes: [{ id: 'scene', clips: [{ id: 'shot' }] }] }];
  await expect(reject({ episodeId: aid, revision: 1 })).rejects.toThrow('episode changed');
  await expect(
    reject({ episodeId: aid, revision: 0, sceneId: 'scene', clipId: 'shot' })
  ).rejects.toThrow('not attached to that clip');
  expect(unlink).not.toHaveBeenCalled();
});
test('approved current character sheets and selected section music protect shared originals', async () => {
  const stamp = '2026-01-01';
  assets = [
    {
      _id: aid,
      name: 'Character',
      candidates: [],
      finalChoice: { id: 'choice', finalizedAt: stamp, mediaIds: [] },
      characterSheets: [
        { mediaId: mid, approvedAt: stamp, sourceCandidateId: 'choice', sourceFinalizedAt: stamp }
      ]
    }
  ];
  await expect(reject()).rejects.toThrow('approved in Character');
  assets[0].characterSheets.unshift({ mediaId: 'other' }, { mediaId: mid });
  assets[0].characterSheets[2].sourceCandidateId = 'old';
  cues = [{ _id: aid, selectedMediaId: mid }];
  await expect(reject()).rejects.toThrow('selected music take');
});
test('rejection preserves the file after a concurrent write and propagates real filesystem failures', async () => {
  assets = [
    {
      _id: aid,
      revision: 0,
      candidates: [
        { id: 'remove', mediaIds: [mid] },
        { id: 'keep', mediaIds: ['other'], archived: false }
      ],
      finalChoice: { id: 'remove', mediaIds: [mid] }
    }
  ];
  const context = { assetId: aid, revision: 0, candidateId: 'remove' };
  vi.mocked(StudioAsset.findOneAndUpdate).mockReturnValueOnce(query(null) as never);
  await expect(reject(context)).rejects.toThrow('file has been retained');
  expect(unlink).not.toHaveBeenCalled();
  vi.mocked(unlink).mockRejectedValueOnce(
    Object.assign(new Error('Already missing'), { code: 'ENOENT' })
  );
  expect((await reject(context)).changed.assets).toEqual([aid]);
  assets[0].candidates[1].archived = true;
  expect((await reject(context)).changed.assets).toEqual([aid]);
  vi.mocked(unlink).mockRejectedValueOnce(
    Object.assign(new Error('Permission denied'), { code: 'EACCES' })
  );
  await expect(reject(context)).rejects.toThrow('Permission denied');
});
