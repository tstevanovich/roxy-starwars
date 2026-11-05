import { mkdtemp } from 'node:fs/promises';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { StudioAutomation, StudioEpisode, StudioMedia, StudioMusicCue } from '../models/Studio.ts';
import { musicState } from '../music-state.ts';
import { workflowContext, workflowEnabled } from '../production-workflow.ts';
import { saveGeneratedMedia } from '../studio-media.ts';
import { rejectMedia } from '../studio-reject-media.ts';
import { Job } from './models.ts';
import { audibleWindow, createMusicProduction } from './music-production.ts';

vi.mock('../models/Studio.ts', () => ({
  StudioEpisode: { findById: vi.fn() },
  StudioMusicCue: {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    create: vi.fn(),
    updateOne: vi.fn(),
    findById: vi.fn()
  },
  StudioAutomation: { find: vi.fn() },
  StudioMedia: { findById: vi.fn(), exists: vi.fn() }
}));
vi.mock('../production-workflow.ts', () => ({
  workflowContext: vi.fn(),
  workflowEnabled: vi.fn(() => true),
  requireWorkflow: vi.fn()
}));
vi.mock('../projects.ts', () => ({ assertMediaAccess: vi.fn() }));
vi.mock('../studio-media.ts', () => ({ saveGeneratedMedia: vi.fn() }));
vi.mock('../studio-reject-media.ts', () => ({ rejectMedia: vi.fn() }));
vi.mock('./models.ts', () => ({
  Job: {
    findOne: vi.fn(),
    exists: vi.fn(),
    create: vi.fn(),
    updateOne: vi.fn(),
    findById: vi.fn(),
    find: vi.fn()
  }
}));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, mkdtemp: vi.fn(fs.mkdtemp) };
});
let episode, cue, job, file, fetcher, executeFile, production;
const eid = '111111111111111111111111';
const query = (value) => ({ lean: async () => value });
const args = () => ({ episodeId: eid, sceneId: 'scene', cueRevision: 0, requestId: 'request' });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ELEVENLABS_API_KEY', 'key');
  episode = {
    _id: eid,
    scenes: [{ id: 'scene', title: 'Scene', clips: [{ id: 'shot', duration: 5 }] }]
  };
  cue = {
    _id: eid,
    revision: 0,
    enabled: true,
    prompt: 'Original orchestra',
    bufferSeconds: 5,
    candidates: []
  };
  file = { _id: 'raw', filename: 'music.mp3' };
  job = {};
  vi.mocked(StudioEpisode.findById).mockImplementation(() => query(episode) as never);
  vi.mocked(StudioMusicCue.findOne).mockImplementation(() => query(cue) as never);
  vi.mocked(StudioMusicCue.findById).mockImplementation(() => query(cue) as never);
  vi.mocked(StudioMusicCue.findOneAndUpdate).mockImplementation(() => query(cue) as never);
  vi.mocked(StudioMusicCue.create).mockImplementation(
    async (value) => ({ toObject: () => value }) as never
  );
  vi.mocked(StudioMusicCue.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);
  vi.mocked(StudioMedia.findById).mockImplementation(() => query(file) as never);
  vi.mocked(StudioMedia.exists).mockResolvedValue({ _id: eid } as never);
  vi.mocked(workflowEnabled).mockReturnValue(true);
  vi.mocked(workflowContext).mockResolvedValue({
    musicJobs: [],
    evaluate: (_target, stage) => ({ stage })
  } as never);
  const chain = { sort: () => ({ limit: () => ({ select: () => query([]) }) }) };
  vi.mocked(StudioAutomation.find).mockReturnValue(chain as never);
  vi.mocked(Job.find).mockReturnValue(chain as never);
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
  vi.mocked(saveGeneratedMedia).mockResolvedValue(file);
  fetcher = vi.fn(async () => new Response(Buffer.from('ID3music')));
  executeFile = vi.fn(async (_binary, parameters) =>
    parameters.includes('json')
      ? { stdout: '{"format":{"duration":2},"streams":[{"codec_type":"audio"}]}' }
      : { stderr: '' }
  );
  production = createMusicProduction({ mediaDirectory: '/fixture', fetcher, executeFile });
});
afterEach(() => vi.unstubAllEnvs());
test('music plans create and update independently with clear conflict handling', async () => {
  expect((await production.plan(args())).cue).toBe(cue);
  vi.mocked(StudioMusicCue.findOneAndUpdate).mockReturnValueOnce(query(null) as never);
  await expect(production.plan(args())).rejects.toThrow('plan changed');
  cue = null;
  expect((await production.plan({ ...args(), enabled: false })).cue.enabled).toBe(false);
  for (const error of [
    Object.assign(new Error('Duplicate'), { code: 11000 }),
    new Error('Offline')
  ]) {
    vi.mocked(StudioMusicCue.create).mockRejectedValueOnce(error);
    await expect(production.plan(args())).rejects.toThrow(
      'code' in error ? 'already exists' : 'Offline'
    );
  }
  episode = null;
  await expect(production.plan(args())).rejects.toMatchObject({ status: 404 });
});
test('music queue requires explicit readiness and handles duplicate requests safely', async () => {
  vi.stubEnv('ELEVENLABS_API_KEY', '');
  await expect(production.queue(args())).rejects.toThrow('API key');
  vi.stubEnv('ELEVENLABS_API_KEY', 'key');
  vi.mocked(workflowEnabled).mockReturnValueOnce(false);
  await expect(production.queue(args())).rejects.toThrow('Enable the production');
  cue.enabled = false;
  await expect(production.queue(args())).rejects.toThrow('scene music brief');
  cue.enabled = true;
  episode.scenes[0].clips[0].duration = 601;
  await expect(production.queue(args())).rejects.toThrow('ten minutes');
  episode.scenes[0].clips[0].duration = 5;
  for (const error of [
    Object.assign(new Error('Duplicate'), { code: 11000 }),
    new Error('Offline')
  ]) {
    vi.mocked(Job.create).mockRejectedValueOnce(error);
    await expect(production.queue(args())).rejects.toThrow(
      'code' in error ? 'already exists' : 'Offline'
    );
  }
});
test('status includes current takes and useful defaults before any cue is saved', async () => {
  cue.candidates = [
    {
      id: 'take',
      fingerprint: musicState(episode, episode.scenes[0], cue).fingerprint,
      qc: { passed: true }
    }
  ];
  expect((await production.status(args())).currentCandidateIds).toEqual(['take']);
  cue = null;
  expect((await production.status(args())).currentCandidateIds).toEqual([]);
});
test('processing retains short audio for review and handles claims, changed plans and bad originals', async () => {
  await production.queue(args());
  const queued = structuredClone(job);
  vi.mocked(Job.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  await production.processJob(queued);
  expect(fetcher).not.toHaveBeenCalled();
  await production.processJob(queued);
  expect(job.status).toBe('ready');
  expect(job.error).toContain('Only 2.00 seconds');
  fetcher.mockResolvedValueOnce(new Response(new Uint8Array(50 * 1024 * 1024 + 1)));
  await production.processJob(queued);
  expect(job.error).toContain('file limit');
  cue.candidates = [
    { id: 'music-job', mediaIds: ['ready'], sourceMediaId: 'raw', qc: { passed: true } }
  ];
  await production.processJob({ ...queued, status: 'importing' });
  expect(job.error).toBeNull();
  cue.candidates = [];
  file.filename = '../outside';
  await production.processJob(queued);
  expect(job.error).toBe('Invalid audio path.');
  file.filename = 'music.mp3';
  executeFile.mockResolvedValueOnce({ stdout: '{"format":{},"streams":[]}' });
  await production.processJob(queued);
  expect(job.error).toContain('no readable audio');
  vi.mocked(StudioMusicCue.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  await production.processJob(queued);
  expect(job.error).toContain('music record changed');
  cue.prompt = 'Changed';
  await production.processJob(queued);
  expect(job.error).toContain('brief or scene timing changed');
});
test('rejection checks revisions and deletes both derived and original audio', async () => {
  await expect(production.reject({ ...args(), cueRevision: 1 })).rejects.toThrow(
    'music record changed'
  );
  await expect(production.reject({ ...args(), candidateId: 'missing' })).rejects.toThrow(
    'take not found'
  );
  cue.candidates = [{ id: 'take', mediaIds: ['derived'], sourceMediaId: 'original' }];
  expect((await production.reject({ ...args(), candidateId: 'take' })).deletedMediaIds).toEqual([
    'derived',
    'original'
  ]);
  expect(rejectMedia).toHaveBeenCalledTimes(2);
  cue.candidates[0].sourceMediaId = 'derived';
  await production.reject({ ...args(), candidateId: 'take' });
  expect(rejectMedia).toHaveBeenCalledTimes(3);
  expect(audibleWindow('silence_end: 1', 5)).toEqual({
    leadingSeconds: 0,
    trailingSeconds: 0,
    audibleSeconds: 5
  });
});
test('music cleanup refuses a temporary directory outside the expected parent', async () => {
  await production.queue(args());
  vi.mocked(mkdtemp).mockResolvedValueOnce('C:/outside-studio-test/missing');
  executeFile.mockResolvedValueOnce({
    stdout: '{"format":{"duration":10},"streams":[{"codec_type":"audio"}]}'
  });
  await production.processJob(structuredClone(job));
  expect(job.status).toBe('failed');
});
