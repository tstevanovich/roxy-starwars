import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { StudioAsset, StudioEpisode, StudioMedia } from '../models/Studio.ts';
import { mixState } from '../sound-design.ts';
import { saveGeneratedMedia } from '../studio-media.ts';
import { Job } from './models.ts';
import { createSoundProduction } from './sound-production.ts';

vi.mock('../models/Studio.ts', () => ({
  StudioEpisode: { findById: vi.fn(), findOneAndUpdate: vi.fn() },
  StudioAsset: {
    find: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn()
  },
  StudioMedia: { findById: vi.fn(), findOne: vi.fn() }
}));
vi.mock('../production-workflow.ts', () => ({
  workflowEnabled: () => true,
  requireWorkflow: vi.fn()
}));
vi.mock('../sound-design.ts', () => ({ approvedSoundPlan: vi.fn(), mixState: vi.fn() }));
vi.mock('../studio-media.ts', () => ({ saveGeneratedMedia: vi.fn(), mediaView: (media) => media }));
vi.mock('./models.ts', () => ({
  Job: { findOne: vi.fn(), exists: vi.fn(), create: vi.fn(), updateOne: vi.fn(), findById: vi.fn() }
}));
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  readFile: vi.fn(async () => Buffer.from('fixture'))
}));
let episode, sound, file, job, state, fetcher, executeFile, production;
const eid = '111111111111111111111111';
const query = (value) => ({ lean: async () => value });
const args = () => ({
  episodeId: eid,
  sceneId: 'scene',
  revision: 0,
  layerId: 'air',
  clipId: 'shot',
  sourceTakeId: eid,
  requestId: 'request'
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ELEVENLABS_API_KEY', 'key');
  episode = {
    _id: eid,
    revision: 0,
    scenes: [
      {
        id: 'scene',
        assetIds: [],
        clips: [
          { id: 'previous', duration: 2 },
          { id: 'shot', title: 'Shot', duration: 5, takeIds: [] }
        ],
        soundPlan: {
          layers: [
            {
              id: 'air',
              title: 'Air',
              description: 'Ventilation',
              type: 'ambience',
              duration: 5,
              loop: true,
              start: 0,
              sourceStart: 0,
              gainDb: -20,
              assetId: eid
            }
          ]
        }
      }
    ]
  };
  sound = { _id: eid, name: 'Air', kind: 'sound', revision: 0, candidates: [] };
  file = { _id: eid, filename: 'sound.wav', kind: 'audio' };
  job = {};
  state = {
    fingerprint: 'mix',
    inputFingerprint: 'input',
    source: { _id: eid, filename: 'video.mp4', videoVerification: { width: 1920 } },
    cleanDialogue: null,
    layers: [{ layer: episode.scenes[0].soundPlan.layers[0], media: file }]
  };
  vi.mocked(StudioEpisode.findById).mockImplementation(() => query(episode) as never);
  vi.mocked(StudioEpisode.findOneAndUpdate).mockImplementation(() => query(episode) as never);
  vi.mocked(StudioAsset.find).mockImplementation(() => query([sound]) as never);
  vi.mocked(StudioAsset.findById).mockImplementation(() => query(sound) as never);
  vi.mocked(StudioAsset.create).mockImplementation(
    async () => ({ toObject: () => sound }) as never
  );
  vi.mocked(StudioAsset.findOneAndUpdate).mockImplementation(() => query(sound) as never);
  vi.mocked(StudioAsset.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);
  vi.mocked(StudioMedia.findById).mockImplementation(() => query(file) as never);
  vi.mocked(StudioMedia.findOne).mockReturnValue(query(null) as never);
  vi.mocked(mixState).mockImplementation(async () => state);
  vi.mocked(saveGeneratedMedia).mockImplementation(
    async (_directory, _bytes, name) =>
      ({ toObject: () => ({ _id: name, filename: name }) }) as never
  );
  vi.mocked(Job.findOne).mockReturnValue(query(null) as never);
  vi.mocked(Job.exists).mockResolvedValue(null);
  vi.mocked(Job.create).mockImplementation(async (fields) => {
    job = { ...fields, _id: 'job' };
    return { toObject: () => job } as never;
  });
  vi.mocked(Job.updateOne).mockImplementation((async (_filter, update: { $set: object }) => {
    Object.assign(job, update.$set);
    return { modifiedCount: 1 };
  }) as never);
  vi.mocked(Job.findById).mockImplementation(() => query(job) as never);
  fetcher = vi.fn(async () => new Response(Buffer.from('ID3sound')));
  executeFile = vi.fn(async () => ({
    stdout: '{"format":{"duration":5},"streams":[{"codec_type":"audio"}]}'
  }));
  production = createSoundProduction({ mediaDirectory: '/fixture', fetcher, executeFile });
});
afterEach(() => vi.unstubAllEnvs());
test('sound linking creates missing assets and checks episode, asset and import revisions', async () => {
  file.kind = 'image';
  await expect(production.importSound({ ...args(), mediaId: eid })).rejects.toThrow('audio file');
  file.kind = 'audio';
  await expect(production.importSound({ ...args(), revision: 1, mediaId: eid })).rejects.toThrow(
    'refresh the episode'
  );
  await expect(
    production.importSound({ ...args(), layerId: 'missing', mediaId: eid })
  ).rejects.toThrow('layer not found');
  sound.kind = 'voice';
  await expect(production.importSound({ ...args(), mediaId: eid })).rejects.toThrow('sound asset');
  sound.kind = 'sound';
  Object.assign(sound, { scope: 'episode', episodeId: 'other' });
  await expect(production.importSound({ ...args(), mediaId: eid })).rejects.toThrow('sound asset');
  sound.scope = 'reusable';
  vi.mocked(StudioAsset.findOneAndUpdate).mockReturnValueOnce(query(null) as never);
  await expect(production.importSound({ ...args(), mediaId: eid })).rejects.toThrow(
    'Sound changed'
  );
  delete episode.scenes[0].soundPlan.layers[0].assetId;
  expect((await production.importSound({ ...args(), mediaId: eid, scope: 'episode' })).asset).toBe(
    sound
  );
  delete episode.scenes[0].soundPlan.layers[0].assetId;
  vi.mocked(StudioEpisode.findOneAndUpdate).mockReturnValueOnce(query(null) as never);
  await expect(production.importSound({ ...args(), mediaId: eid })).rejects.toThrow(
    'Episode changed'
  );
  episode = null;
  await expect(production.queueSound(args())).rejects.toThrow('saved scene');
});
test('sound and mix queues enforce one active request without spending credits', async () => {
  vi.stubEnv('ELEVENLABS_API_KEY', '');
  await expect(production.queueSound(args())).rejects.toThrow('Configure');
  vi.stubEnv('ELEVENLABS_API_KEY', 'key');
  vi.mocked(Job.exists).mockResolvedValueOnce({ _id: eid } as never);
  await expect(production.queueSound(args())).rejects.toThrow('unfinished work');
  vi.mocked(Job.findOne).mockReturnValueOnce(query({ _id: 'existing' }) as never);
  expect((await production.queueMix(args())).job._id).toBe('existing');
  await expect(production.queueMix({ ...args(), revision: 1 })).rejects.toThrow(
    'refresh the episode'
  );
  await expect(production.queueMix({ ...args(), clipId: 'missing' })).rejects.toThrow('saved clip');
  vi.mocked(Job.exists).mockResolvedValueOnce({ _id: eid } as never);
  await expect(production.queueMix(args())).rejects.toThrow('already being prepared');
});
test('sound workers record rejection and stale-result errors while keeping imported audio', async () => {
  await production.queueSound(args());
  const queued = structuredClone(job);
  fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await production.processJob(queued);
  expect(job.status).toBe('failed');
  expect(job.error).toContain('generation failed');
  fetcher.mockRejectedValueOnce(new Error('Offline'));
  await production.processJob(queued);
  expect(job.status).toBe('uncertain');
  fetcher.mockResolvedValueOnce(new Response(new Uint8Array(16 * 1024 * 1024 + 1)));
  await production.processJob(queued);
  expect(job.error).toContain('file limit');
  vi.mocked(StudioAsset.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  await production.processJob(queued);
  expect(job.error).toContain('sound changed during');
  await production.processJob(queued);
  expect(job.status).toBe('ready');
  expect(job.receipt.creditsCharged).toBeNull();
  await production.processJob({ ...queued, status: 'importing' });
  expect(job.status).toBe('ready');
  sound.candidates = [{ id: 'sound-job' }];
  vi.mocked(StudioMedia.findOne).mockReturnValue(query(file) as never);
  await production.processJob(queued);
  expect(job.status).toBe('ready');
  vi.mocked(StudioEpisode.findById)
    .mockReturnValueOnce(query(episode) as never)
    .mockReturnValueOnce(
      query({
        ...episode,
        scenes: [
          { ...episode.scenes[0], soundPlan: { ...episode.scenes[0].soundPlan, notes: 'Changed' } }
        ]
      }) as never
    );
  await production.processJob(queued);
  expect(job.error).toContain('Sound plan changed during');
  vi.mocked(StudioMedia.findOne).mockReturnValue(query(null) as never);
  sound.revision++;
  await production.processJob(queued);
  expect(job.error).toContain('sound plan or sound changed');
  sound = null;
  await production.processJob(queued);
  expect(job.error).toContain('asset was removed');
});
test('mixing validates media timing and supports a picture without dialogue', async () => {
  await production.queueMix(args());
  const queued = structuredClone(job);
  await production.processJob(queued);
  expect(job.status).toBe('ready');
  expect(executeFile).toHaveBeenCalledWith(
    expect.anything(),
    expect.arrayContaining(['-filter_complex', expect.stringContaining('anullsrc=')]),
    expect.anything()
  );
  executeFile.mockResolvedValueOnce({ stdout: '{"format":{"duration":9},"streams":[]}' });
  await production.processJob(queued);
  expect(job.error).toContain('duration does not match');
  state.source.filename = '../outside';
  await production.processJob(queued);
  expect(job.error).toBe('Invalid media path.');
  state.source.filename = 'video.mp4';
  executeFile
    .mockResolvedValueOnce({ stdout: '{"format":{"duration":5},"streams":[]}' })
    .mockResolvedValueOnce({ stdout: '{"format":{"duration":0},"streams":[]}' });
  await production.processJob(queued);
  expect(job.error).toContain('cannot be read');
  state.layers[0].layer.loop = false;
  state.layers[0].layer.type = 'effect';
  state.layers[0].layer.sourceStart = 4;
  state.layers[0].layer.lowpassHz = 1000;
  await production.processJob(queued);
  expect(job.error).toContain('too short');
  state.layers[0].layer.sourceStart = 0;
  await production.processJob(queued);
  expect(job.status).toBe('ready');
  state.cleanDialogue = { _id: eid, filename: 'dialogue.wav' };
  episode.scenes[0].soundPlan.dialogueGainDb = 1;
  await production.processJob(queued);
  expect(job.status).toBe('ready');
  delete episode.scenes[0].soundPlan.dialogueGainDb;
  await production.processJob(queued);
  expect(job.status).toBe('ready');
  vi.mocked(StudioMedia.findOne)
    .mockReturnValueOnce(query({ _id: 'cached', filename: 'mixed.mp4' }) as never)
    .mockReturnValueOnce(query(file) as never);
  vi.mocked(mixState)
    .mockResolvedValueOnce(state)
    .mockResolvedValueOnce({ ...state, fingerprint: 'changed' });
  await production.processJob(queued);
  expect(job.error).toContain('choices changed while mixing');
  await production.processJob({ ...queued, status: 'failed' });
  executeFile
    .mockResolvedValueOnce({ stdout: '{"format":{"duration":5},"streams":[]}' })
    .mockResolvedValueOnce({ stdout: '{"format":{"duration":1},"streams":[]}' });
  await production.processJob(queued);
  expect(job.error).toContain('clean dialogue stem');
  state.fingerprint = 'changed';
  await production.processJob(queued);
  expect(job.error).toContain('Sound choices changed');
  episode.scenes[0].clips = [];
  await production.processJob(queued);
  expect(job.error).toContain('Clip was removed');
});
