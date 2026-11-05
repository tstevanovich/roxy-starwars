import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { StudioAsset, StudioMedia } from '../models/Studio.ts';
import { workflowContext } from '../production-workflow.ts';
import { saveGeneratedMedia } from '../studio-media.ts';
import { Job, Proposal } from './models.ts';
import {
  createVoiceProduction,
  currentVoiceAuditions,
  voiceDirection,
  voiceRevisionFields
} from './voice-production.ts';

vi.mock('../models/Studio.ts', () => ({
  StudioAsset: { findById: vi.fn(), findOneAndUpdate: vi.fn(), updateOne: vi.fn() },
  StudioMedia: { findById: vi.fn(), updateOne: vi.fn() }
}));
vi.mock('../production-workflow.ts', () => ({ workflowContext: vi.fn() }));
vi.mock('../projects.ts', () => ({ withProject: (_key, work) => work() }));
vi.mock('../studio-media.ts', () => ({
  saveGeneratedMedia: vi.fn(async () => ({ _id: 'audio' }))
}));
vi.mock('./models.ts', () => ({
  Job: {
    findOne: vi.fn(),
    exists: vi.fn(),
    create: vi.fn(),
    updateOne: vi.fn(),
    findById: vi.fn()
  },
  Proposal: { exists: vi.fn(), findOne: vi.fn() }
}));
const aid = '111111111111111111111111';
let voice, assets, scene, gates, currentJob, fetcher, production;
const query = (value) => ({ lean: async () => value });
const args = () => ({
  target: { episodeId: aid, sceneId: 'scene' },
  speaker: 'Harkun',
  requestId: 'request'
});
const preview = {
  generated_voice_id: 'generated',
  audio_base_64: Buffer.from('ID3fake audio').toString('base64')
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ELEVENLABS_API_KEY', 'test-key');
  voice = {
    _id: aid,
    name: 'Harkun voice',
    aliases: ['Harkun'],
    kind: 'voice',
    production: { voiceDescription: 'Clear baritone' },
    revision: 0,
    candidates: [],
    brief: 'Clear baritone'
  };
  assets = [voice];
  scene = { clips: [{ dialogue: 'HARKUN: Hello.' }] };
  gates = 'approved';
  currentJob = { status: 'queued' };
  vi.mocked(workflowContext).mockImplementation(
    async () =>
      ({
        assets,
        locate: () => ({ scene }),
        evaluate: () => ({ status: gates, fingerprint: 'approved' })
      }) as never
  );
  vi.mocked(StudioAsset.findById).mockImplementation(() => query(voice) as never);
  vi.mocked(StudioAsset.findOneAndUpdate).mockImplementation(() => query(voice) as never);
  vi.mocked(StudioAsset.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);
  vi.mocked(StudioMedia.findById).mockReturnValue(
    query({ _id: 'audio', voiceDesign: { generatedVoiceId: 'generated' } }) as never
  );
  vi.mocked(Job.findOne).mockReturnValue(query(null) as never);
  vi.mocked(Job.exists).mockResolvedValue(null);
  vi.mocked(Job.create).mockImplementation(async (fields) => {
    currentJob = { ...fields, _id: 'job' };
    return { toObject: () => currentJob } as never;
  });
  vi.mocked(Job.updateOne).mockImplementation((async (_filter, update: { $set: object }) => {
    Object.assign(currentJob, update.$set);
    return { modifiedCount: 1 };
  }) as never);
  vi.mocked(Job.findById).mockImplementation(() => query(currentJob) as never);
  vi.mocked(Proposal.exists).mockResolvedValue(null);
  vi.mocked(Proposal.findOne).mockReturnValue({
    sort: () => ({ select: () => query(null) })
  } as never);
  fetcher = vi.fn(async () => Response.json({ previews: [preview] }));
  production = createVoiceProduction({ mediaDirectory: '/fixture', fetcher });
});
afterEach(() => vi.unstubAllEnvs());
test('effective voice directions prefer saved voice and character settings and never treat visual directions as voice design', () => {
  expect(voiceDirection('Harkun', assets)).toBe('Clear baritone');
  delete voice.production.voiceDescription;
  expect(voiceDirection('Harkun', assets)).toBe('Clear baritone');
  voice.seedKey = 'workflow-voice-harkun';
  voice.production.voiceDescription = ' ';
  voice.brief = 'Legacy voice';
  expect(voiceDirection('Harkun', assets)).toBe('Legacy voice');
  delete voice.production.voiceDescription;
  const character = {
    name: 'Harkun',
    kind: 'character',
    production: { voiceDescription: 'Quiet' }
  };
  expect(voiceDirection('Harkun', [voice, character])).toBe('Quiet');
  character.production.voiceDescription = '';
  Object.assign(character, {
    brief: 'A rasp in his voice. Costume portrait voice source frames.',
    notes: 'British accent.'
  });
  expect(voiceDirection('Harkun', [character])).toContain('British accent');
  expect(currentVoiceAuditions(null, 'Prompt')).toEqual([]);
  expect(
    voiceRevisionFields(
      {
        brief: 'Saved',
        finalChoice: { id: 'chosen' },
        reviewStatus: 'approved',
        candidates: [{ id: 'chosen', generatedVoiceId: 'id', description: 'Old' }]
      },
      {}
    ).reviewStatus
  ).toBe('approved');
  expect(
    voiceRevisionFields({ brief: 'Saved', candidates: [{ id: 'a', mediaIds: ['audio'] }] }, {})
      .reviewStatus
  ).toBe('pending-choice');
});
test('queue protects saved directions, unfinished requests, approvals and compare-and-swap races', async () => {
  vi.mocked(Job.findOne).mockReturnValueOnce(query({ _id: 'existing' }) as never);
  expect(await production.queue(args())).toEqual({ _id: 'existing' });
  vi.stubEnv('ELEVENLABS_API_KEY', '');
  await expect(production.queue(args())).rejects.toThrow('Configure');
  vi.stubEnv('ELEVENLABS_API_KEY', 'key');
  gates = 'draft';
  await expect(production.queue(args())).rejects.toThrow('outline');
  gates = 'approved';
  scene.clips = [];
  await expect(production.queue(args())).rejects.toThrow('no longer required');
  scene.clips = [{ dialogue: 'HARKUN: Hello.' }];
  let count = 0;
  vi.mocked(workflowContext).mockResolvedValueOnce({
    assets,
    locate: () => ({ scene }),
    evaluate: () => ({ status: count++ === 0 ? 'approved' : 'draft' })
  } as never);
  await expect(production.queue(args())).rejects.toThrow('script, shot plan');
  vi.mocked(Proposal.exists).mockResolvedValueOnce({ _id: aid } as never);
  await expect(production.queue(args())).rejects.toThrow('current voice-directions');
  vi.mocked(Job.exists).mockResolvedValueOnce({ _id: aid } as never);
  await expect(production.queue(args())).rejects.toThrow('in progress');
  voice.candidates = [{ id: 'old', mediaIds: ['audio'] }];
  await expect(production.queue(args())).rejects.toThrow('Review the existing');
  voice.candidates = [];
  vi.mocked(StudioAsset.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  await expect(production.queue(args())).rejects.toThrow('changed while preparing');
  voice.production.voiceDescription = '';
  await expect(production.queue({ ...args(), target: { assetId: aid } })).rejects.toThrow(
    'Save the voice'
  );
});
test('audition processing persists provider receipts and reuses already imported previews', async () => {
  const job = await production.queue({ ...args(), chatId: 'chat' });
  await production.processJob(job);
  expect(currentJob.status).toBe('ready');
  expect(saveGeneratedMedia).toHaveBeenCalled();
  voice.candidates = [{ id: 'voice-job-0', mediaIds: ['old-audio'] }];
  await production.importPreviews({ ...job, receipt: { previews: [preview] } });
  expect(currentJob.resultMediaIds).toEqual(['old-audio']);
  voice.candidates = [];
  voice.production.voiceDescription = 'New direction';
  await production.importPreviews({ ...job, receipt: { previews: [preview] } });
  expect(StudioAsset.updateOne).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ $set: { reviewStatus: 'development' } })
  );
  delete voice.production.voiceDescription;
  await production.importPreviews({ ...job, receipt: { previews: [preview] } });
  for (const bad of [{}, { generated_voice_id: 'id' }])
    await expect(
      production.importPreviews({ ...job, receipt: { previews: [bad] } })
    ).rejects.toThrow('incomplete audition');
  voice.archived = true;
  await expect(
    production.importPreviews({ ...job, receipt: { previews: [preview] } })
  ).rejects.toThrow('asset was removed');
});
test('worker failures distinguish rejected requests, uncertain submissions, and interrupted imports', async () => {
  const job = await production.queue(args());
  vi.mocked(Job.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  await production.processJob(job);
  expect(fetcher).not.toHaveBeenCalled();
  await production.processJob({ ...job, snapshot: { fingerprint: 'obsolete' } });
  expect(currentJob.error).toContain('directions changed');
  for (const body of [
    { detail: { message: 'No credit' } },
    { message: 'No credit' },
    { detail: { status: 'quota' } },
    null
  ]) {
    fetcher.mockResolvedValueOnce(
      body ? Response.json(body, { status: 403 }) : new Response('{', { status: 403 })
    );
    await production.processJob(job);
    expect(currentJob.status).toBe('failed');
    expect(currentJob.error).toContain('generation failed');
  }
  fetcher.mockResolvedValueOnce(Response.json({}));
  await production.processJob(job);
  expect(currentJob.status).toBe('uncertain');
  fetcher.mockRejectedValueOnce(new Error('Offline'));
  await production.processJob(job);
  expect(currentJob.status).toBe('uncertain');
  vi.mocked(saveGeneratedMedia).mockRejectedValueOnce(new Error('Disk full'));
  await production.processJob(job);
  expect(currentJob.status).toBe('importing');
  voice.finalChoice = {};
  await production.processJob(job);
  expect(currentJob.error).toContain('already finalized');
});
test('finalization verifies current directions and preview ownership and reuses a saved provider voice', async () => {
  expect(await production.finalize(voice, { id: 'manual' })).toEqual({ id: 'manual' });
  expect(
    await production.finalize(voice, { generatedVoiceId: 'generated', voiceId: 'saved' })
  ).toMatchObject({ voiceId: 'saved' });
  const candidate = {
    generatedVoiceId: 'generated',
    description: 'Clear baritone',
    mediaIds: ['audio']
  };
  await expect(production.finalize(voice, { ...candidate, description: 'Old' })).rejects.toThrow(
    'earlier voice'
  );
  vi.mocked(StudioMedia.findById).mockReturnValueOnce(query(null) as never);
  await expect(production.finalize(voice, candidate)).rejects.toThrow('does not belong');
  fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(production.finalize(voice, candidate)).rejects.toThrow('Saving the chosen');
  fetcher.mockResolvedValueOnce(Response.json({}));
  await expect(production.finalize(voice, candidate)).rejects.toThrow('saved voice ID');
  fetcher.mockResolvedValueOnce(Response.json({ voice_id: 'saved' }));
  expect(await production.finalize(voice, candidate)).toMatchObject({ voiceId: 'saved' });
  delete voice.production.voiceDescription;
  vi.mocked(StudioMedia.findById).mockReturnValueOnce(
    query({ voiceDesign: { generatedVoiceId: 'generated', savedVoiceId: 'existing' } }) as never
  );
  expect(await production.finalize(voice, candidate)).toMatchObject({ voiceId: 'existing' });
});
