import { readdir, readFile } from 'node:fs/promises';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { dialogueDuration } from '../animatic-timing.ts';
import { StudioAsset, StudioEpisode, StudioMedia } from '../models/Studio.ts';
import { workflowEnabled } from '../production-workflow.ts';
import { runProjectContext } from '../project-context.ts';
import { saveGeneratedMedia } from '../studio-media.ts';
import { Job, Proposal } from './models.ts';
import { createMusicProduction } from './music-production.ts';
import { createProduction, renderTarget } from './production.ts';
import { createSoundProduction } from './sound-production.ts';
import { createVoiceProduction } from './voice-production.ts';

const prompts = vi.hoisted(() => ({
  image: 'Shot image',
  continuity: { sources: [], errors: [], mediaIds: [] },
  referenceMediaIds: []
}));
const referenceResult = vi.hoisted(() => ({
  id: 'ref',
  url: 'https://cdn.openart.ai/ref.png',
  type: 'image'
}));
vi.mock('../models/Studio.ts', () => ({
  StudioAsset: { find: vi.fn(), create: vi.fn(), updateOne: vi.fn(), findOneAndUpdate: vi.fn() },
  StudioEpisode: { findById: vi.fn(), updateOne: vi.fn() },
  StudioMedia: { find: vi.fn(), findById: vi.fn(), findOne: vi.fn(), exists: vi.fn() }
}));
vi.mock('../production-workflow.ts', () => ({
  workflowEnabled: vi.fn(() => false),
  shotWorkflow: vi.fn(),
  imageWorkflow: vi.fn()
}));
vi.mock('../projects.ts', () => ({
  assertMediaAccess: vi.fn(),
  withProject: (_key, work) => work()
}));
vi.mock('../sound-design.ts', () => ({ approvedSoundPlan: vi.fn() }));
vi.mock('../studio-validation.ts', async (original) => ({
  ...(await original<typeof import('../studio-validation.ts')>()),
  sceneFingerprint: () => 'approved-scene'
}));
vi.mock('../studio-prompts.ts', () => ({
  clipPrompts: () => prompts,
  productionVideoPrompt: (_scene, clip, instructions) =>
    (clip.production.videoPrompt ?? 'Video prompt') + instructions
}));
vi.mock('../animatic-timing.ts', () => ({ dialogueDuration: vi.fn(async () => 5) }));
vi.mock('../studio-media.ts', () => ({ saveGeneratedMedia: vi.fn() }));
vi.mock('./models.ts', () => ({
  Job: {
    findOne: vi.fn(),
    exists: vi.fn(),
    create: vi.fn(),
    updateOne: vi.fn(),
    findById: vi.fn(),
    findOneAndUpdate: vi.fn()
  },
  Proposal: { findById: vi.fn(), updateOne: vi.fn() },
  SourceGrant: { deleteMany: vi.fn() }
}));
vi.mock('./render-revisions.ts', () => ({
  assertNoPendingRevision: vi.fn(),
  applyVideoRevision: vi.fn()
}));
vi.mock('./reference-storage.ts', () => ({
  createReferenceStorage: () => ({ reference: vi.fn(async () => ({ ...referenceResult })) })
}));
vi.mock('./music-production.ts', () => ({
  createMusicProduction: vi.fn(() => ({ processJob: vi.fn() }))
}));
vi.mock('./sound-production.ts', () => ({
  createSoundProduction: vi.fn(() => ({ processJob: vi.fn() }))
}));
vi.mock('./voice-production.ts', () => ({
  createVoiceProduction: vi.fn(() => ({
    queue: vi.fn(),
    processJob: vi.fn(),
    importPreviews: vi.fn()
  }))
}));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, readdir: vi.fn(async () => []), readFile: vi.fn(fs.readFile) };
});
const eid = '111111111111111111111111',
  mid = '222222222222222222222222',
  pid = '333333333333333333333333';
const query = (value) => ({
  lean: async () => value,
  then: (resolve) => Promise.resolve(value).then(resolve)
});
let episode,
  scene,
  clip,
  shot,
  assets,
  media,
  currentJob,
  proposal,
  store,
  openart,
  fetcher,
  production;
const target = () => ({ episodeId: eid, sceneId: 'scene', clipId: 'shot' });
const queue = (kind = 'image', extra = {}) =>
  production.queue({ kind, requestId: 'request', target: target(), ...extra });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ELEVENLABS_API_KEY', 'key');
  vi.mocked(workflowEnabled).mockReturnValue(false);
  referenceResult.url = 'https://cdn.openart.ai/ref.png';
  referenceResult.type = 'image';
  clip = {
    id: 'shot',
    title: 'Shot',
    duration: 5,
    dialogue: '',
    action: 'Stay',
    production: {},
    takeIds: []
  };
  scene = {
    id: 'scene',
    title: 'Scene',
    style: 'cinematic',
    assetIds: [],
    clips: [clip],
    approval: { fingerprint: 'approved-scene' }
  };
  episode = { _id: eid, revision: 0, scenes: [scene], videoPass: { id: 'pass' } };
  shot = {
    _id: pid,
    kind: 'environment',
    name: 'Shot image',
    episodeId: eid,
    sceneId: 'scene',
    clipId: 'shot',
    candidates: [],
    finalChoice: { mediaIds: [mid] },
    revision: 0
  };
  assets = [shot];
  media = {
    _id: mid,
    kind: 'image',
    filename: 'image.png',
    originalName: 'Image',
    providerReference: { id: 'image', url: 'https://cdn.openart.ai/ref.png' }
  };
  currentJob = {};
  proposal = null;
  Object.assign(prompts, {
    image: 'Shot image',
    continuity: { sources: [], errors: [], mediaIds: [] },
    referenceMediaIds: []
  });
  vi.mocked(StudioAsset.find).mockImplementation(() => query(assets) as never);
  vi.mocked(StudioAsset.create).mockImplementation(async () => ({ toObject: () => shot }) as never);
  vi.mocked(StudioAsset.findOneAndUpdate).mockImplementation(() => query(shot) as never);
  vi.mocked(StudioAsset.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);
  vi.mocked(StudioEpisode.findById).mockImplementation(() => query(episode) as never);
  vi.mocked(StudioEpisode.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);
  vi.mocked(StudioMedia.find).mockImplementation(() => ({ select: () => query([media]) }) as never);
  vi.mocked(StudioMedia.findById).mockImplementation(() => query(media) as never);
  vi.mocked(StudioMedia.findOne).mockReturnValue(query(null) as never);
  vi.mocked(StudioMedia.exists).mockResolvedValue(null);
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
  vi.mocked(Job.findOneAndUpdate).mockImplementation(() => {
    currentJob.status = 'preparing';
    return query(currentJob) as never;
  });
  vi.mocked(Proposal.findById).mockImplementation(() => query(proposal) as never);
  vi.mocked(Proposal.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);
  vi.mocked(saveGeneratedMedia).mockImplementation(
    async () => ({ ...media, toObject: () => media }) as never
  );
  store = { read: vi.fn(async () => ({ openart: { tokens: {}, projectId: 'project' } })) };
  openart = {
    call: vi.fn(async (name) =>
      name === 'openart_model_cost'
        ? { items: [{ affordable: true }] }
        : name === 'openart_creation_get'
          ? {
              status: 'COMPLETED',
              resources: [{ mediaType: 'image', url: 'https://cdn.openart.ai/result.png' }]
            }
          : { historyId: 'history' }
    )
  };
  fetcher = vi.fn(async () => new Response(Buffer.from('fixture')));
  production = createProduction({ store, openart, fetcher, mediaDirectory: '/fixture' });
});
afterEach(() => vi.unstubAllEnvs());
test('render targets validate source, library ownership, selected speech and video identity references', async () => {
  await expect(renderTarget({ assetId: pid }, 'video')).rejects.toThrow('Choose a clip');
  await expect(renderTarget({ assetId: eid }, 'image')).rejects.toThrow(
    'existing creative-library'
  );
  shot.kind = 'voice';
  await expect(renderTarget({ assetId: pid }, 'image')).rejects.toThrow('visual asset');
  shot.kind = 'environment';
  await runProjectContext({ key: 'faithful', faithfulAdaptation: true }, async () => {
    await expect(renderTarget(target(), 'image')).rejects.toThrow('verify the linked source');
    episode.sourceReferences = [{ id: 'source', status: 'verified' }];
    scene.sourceReferenceIds = ['source'];
    expect(await renderTarget(target(), 'image')).toBeTruthy();
  });
  scene.assetIds = [pid];
  shot.finalChoice = null;
  await expect(renderTarget(target(), 'image')).rejects.toThrow('Finalize');
  shot.finalChoice = { mediaIds: [mid] };
  scene.assetIds = [];
  clip.dialogue = 'HARKUN: Hello.';
  await expect(renderTarget(target(), 'video')).rejects.toThrow('dialogue performance');
  clip.selectedDialogueId = mid;
  clip.production.videoReferenceMediaIds = [mid];
  await expect(renderTarget(target(), 'video')).rejects.toThrow('identity reference');
  episode = null;
  await expect(renderTarget(target(), 'image')).rejects.toThrow('existing episode');
});
test('queue rejects unsupported media, unavailable connections and excessive silent video directions', async () => {
  await expect(queue('wrong')).rejects.toThrow('Choose image');
  for (const referenceIds of [null, Array(13).fill(mid)])
    await expect(queue('image', { referenceIds })).rejects.toThrow('at most 12');
  store.read.mockResolvedValueOnce({});
  await expect(queue()).rejects.toThrow('Connect OpenArt');
  await expect(queue('video', { instructions: 'x'.repeat(3001) })).rejects.toThrow('under 3000');
  clip.dialogue = 'HARKUN: Hello.';
  assets.push({
    name: 'Harkun',
    kind: 'voice',
    finalChoice: { voiceId: 'voice', voiceModel: 'eleven_v3' }
  });
  vi.stubEnv('ELEVENLABS_API_KEY', '');
  await expect(queue('dialogue')).rejects.toThrow('API key');
});
test('build detects changes and rejects audio attachments in image generation', async () => {
  const job = await queue();
  shot.finalChoice = { mediaIds: [eid] };
  await expect(production.build(job)).rejects.toThrow('Creative choices changed');
  shot.finalChoice = { mediaIds: [mid] };
  vi.mocked(StudioMedia.exists).mockResolvedValueOnce({ _id: mid } as never);
  await expect(production.build(job)).rejects.toThrow('image references only');
});
test('job processing rechecks preparation, never retries uncertain submissions, and imports persisted receipts', async () => {
  const job = structuredClone(await queue());
  vi.mocked(Job.findOneAndUpdate).mockReturnValueOnce(query(null) as never);
  await production.processJob(job);
  expect(openart.call).not.toHaveBeenCalled();
  openart.call.mockImplementationOnce(async () => {
    shot.finalChoice = { mediaIds: [eid] };
    return {};
  });
  await production.processJob(job);
  expect(currentJob.status).toBe('failed');
  shot.finalChoice = { mediaIds: [mid] };
  openart.call.mockImplementation(async (name) =>
    name === 'openart_model_cost' ? { items: [{ affordable: true }] } : {}
  );
  await production.processJob(job);
  expect(currentJob.error).toContain('tracking ID');
  const receiptJob = {
    ...job,
    status: 'importing',
    receipt: {
      resources: [
        { mediaType: 'audio' },
        { mediaType: 'image', url: 'https://cdn.openart.ai/result.png' }
      ]
    }
  };
  await production.processJob(receiptJob);
  expect(currentJob.status).toBe('ready');
  shot.candidates = [{ id: 'chat-job' }];
  await production.processJob(receiptJob);
  expect(currentJob.status).toBe('ready');
  await production.processJob({ ...job, status: 'importing', receipt: {} });
  expect(currentJob.error).toContain('saved resource');
});
test('downloads reject unexpected hosts, unsuccessful responses and excessive provider sizes', async () => {
  const job = structuredClone(await queue());
  const importing = (url) => ({
    ...job,
    status: 'importing',
    receipt: { resources: [{ mediaType: 'image', url }] }
  });
  for (const url of ['http://cdn.openart.ai/image', 'https://other.example/image']) {
    await production.processJob(importing(url));
    expect(currentJob.error).toContain('unexpected download host');
  }
  fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await production.processJob(importing('https://cdn.openart.ai/image'));
  expect(currentJob.error).toContain('could not be downloaded');
  fetcher.mockResolvedValueOnce(
    new Response(null, { headers: { 'content-length': String(251 * 1024 * 1024) } })
  );
  await production.processJob(importing('https://cdn.openart.ai/image'));
  expect(currentJob.error).toContain('could not be downloaded');
});
test('polling retains known history on failures and handles every terminal provider response', async () => {
  const job = { ...structuredClone(await queue()), status: 'rendering', historyId: 'history' };
  for (const receipt of [
    { status: 'FAILED' },
    { status: 'CANCELLED', error: 'Cancelled' },
    { status: 'COMPLETED', warning: 'Needs review' },
    { status: 'COMPLETED', resources: [] }
  ]) {
    currentJob.status = 'rendering';
    openart.call.mockResolvedValueOnce(receipt);
    await production.processJob(job);
    expect(currentJob.status).toBe('failed');
  }
  await production.processJob({ ...job, status: 'failed' });
  await production.processJob({ kind: 'voice', status: 'importing' });
  expect(production.voices.importPreviews).toHaveBeenCalled();
  await production.processJob({ kind: 'voice', status: 'queued' });
  expect(production.voices.processJob).toHaveBeenCalled();
  await production.processJob({ kind: 'music' });
  expect(production.music.processJob).toHaveBeenCalled();
  await production.processJob({ kind: 'mix' });
  expect(production.sound.processJob).toHaveBeenCalled();
  expect(createVoiceProduction).toHaveBeenCalled();
  expect(createMusicProduction).toHaveBeenCalled();
  expect(createSoundProduction).toHaveBeenCalled();
});
test('revision generation refuses missing, obsolete, conflicting or concurrently claimed approvals', async () => {
  await expect(production.approveRevision(pid, { generate: true })).rejects.toMatchObject({
    status: 404
  });
  proposal = { _id: pid, status: 'dismissed', render: {} };
  await expect(production.approveRevision(pid, { generate: true })).rejects.toThrow(
    'no longer pending'
  );
  proposal.status = 'pending';
  proposal.render.resolution = '480p';
  await expect(production.approveRevision(pid, { generate: true })).rejects.toThrow('older output');
  proposal.render.resolution = '1080p';
  proposal.episodeId = eid;
  proposal.baseRevision = 1;
  await expect(production.approveRevision(pid, { generate: true })).rejects.toThrow();
  vi.mocked(Job.findOne).mockReturnValueOnce(query({ _id: 'existing' }) as never);
  expect(await production.approveRevision(pid, { generate: true })).toEqual({ _id: 'existing' });
});

test('reference provenance scanning is bounded and ignores partial or primitive manifests', async () => {
  vi.mocked(readdir).mockImplementation(async (directory) => {
    if (String(directory).endsWith('unavailable')) throw new Error('Unavailable');
    return [
      { name: 'nested', isDirectory: () => true },
      { name: 'unavailable', isDirectory: () => true },
      { name: 'null-manifest.json', isDirectory: () => false },
      { name: 'broken-manifest.json', isDirectory: () => false },
      { name: 'other.txt', isDirectory: () => false }
    ] as never;
  });
  vi.mocked(readFile).mockImplementation(async (path) => {
    if (String(path).endsWith('null-manifest.json')) return 'null';
    throw new Error('Partial manifest');
  });
  media.providerReference = undefined;
  const job = await queue('video');
  await production.build(job);
  expect(readdir).toHaveBeenCalled();
  vi.mocked(readdir).mockResolvedValue([]);
  vi.mocked(StudioMedia.findById).mockReturnValueOnce(query(null) as never);
  await expect(production.build(job)).rejects.toThrow('required reference was deleted');
});
test('video preparation validates measured audio, persisted revision approval and accepted provider references', async () => {
  clip.dialogue = 'HARKUN: Hello.';
  clip.selectedDialogueId = mid;
  assets.push({
    name: 'Harkun',
    kind: 'voice',
    finalChoice: { voiceId: 'voice', voiceModel: 'eleven_v3' }
  });
  const job = structuredClone(await queue('video'));
  vi.mocked(dialogueDuration).mockResolvedValueOnce(18);
  await expect(production.build(job)).rejects.toThrow('timing revision');
  await expect(production.build(job)).rejects.toThrow('approved dialogue recording is missing');
  proposal = { status: 'pending', render: {} };
  await expect(production.build({ ...job, revisionProposalId: pid })).rejects.toThrow(
    'revision approval is missing'
  );
  media.providerReference = undefined;
  referenceResult.url = 'http://unaccepted.example/image';
  referenceResult.type = 'audio';
  await production.processJob(job);
  expect(currentJob.error).toContain('not been accepted');
});
test('result attachment retains files when the owning scene, package or option changes concurrently', async () => {
  let job = structuredClone(await queue());
  const importing = () => ({
    ...job,
    status: 'importing',
    receipt: { resources: [{ mediaType: job.kind, url: 'https://cdn.openart.ai/result.png' }] }
  });
  fetcher.mockImplementationOnce(async () => {
    shot.finalChoice.mediaIds = [eid];
    return new Response('fixture');
  });
  await production.processJob(importing());
  expect(currentJob.error).toContain('source choices changed');
  shot.finalChoice.mediaIds = [mid];
  vi.mocked(StudioAsset.findOneAndUpdate).mockReturnValueOnce(query(null) as never);
  await production.processJob(importing());
  expect(currentJob.error).toContain('Asset changed while attaching');
  prompts.continuity.sources = [{ sceneId: 'earlier', clipId: 'earlier' }];
  job = structuredClone(await queue());
  await production.processJob(importing());
  expect(currentJob.status).toBe('ready');
  shot.production = {
    sourceMediaIds: [],
    items: [
      { id: 'body-turnaround', title: 'Turnaround', type: 'image' },
      { id: 'other', title: 'Other', type: 'image' }
    ]
  };
  job = structuredClone(
    await queue('image', { target: { assetId: pid, packageItemId: 'body-turnaround' } })
  );
  vi.mocked(StudioAsset.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  await production.processJob(importing());
  expect(currentJob.error).toContain('Reference package changed');
  await production.processJob(importing());
  expect(currentJob.status).toBe('ready');
});
test('video imports and dialogue failures retain the provider job outcome without overwriting current takes', async () => {
  let job = structuredClone(await queue('video'));
  vi.mocked(StudioEpisode.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  await production.processJob({
    ...job,
    status: 'importing',
    receipt: { resources: [{ mediaType: 'video', url: 'https://cdn.openart.ai/result.mp4' }] }
  });
  expect(currentJob.error).toContain('Episode changed while attaching');
  clip.dialogue = 'HARKUN: Hello.';
  assets.push({
    name: 'Harkun',
    kind: 'voice',
    finalChoice: { voiceId: 'voice', voiceModel: 'eleven_v3' }
  });
  job = structuredClone(await queue('dialogue'));
  fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await production.processJob(job);
  expect(currentJob.error).toContain('ElevenLabs request failed');
});
test('streamed downloads enforce their byte limit even without a trustworthy content length', async () => {
  const job = structuredClone(await queue());
  const chunk = new Uint8Array(1024 * 1024);
  fetcher.mockResolvedValueOnce({
    ok: true,
    headers: new Headers(),
    body: {
      async *[Symbol.asyncIterator]() {
        for (let i = 0; i < 251; i++) yield chunk;
      }
    }
  } as never);
  await production.processJob({
    ...job,
    status: 'importing',
    receipt: { resources: [{ mediaType: 'image', url: 'https://cdn.openart.ai/result.png' }] }
  });
  expect(currentJob.error).toContain('250 MB limit');
});

test('package renders require the exact saved image directions', async () => {
  shot.production = {
    items: [{ id: 'view', title: 'View', type: 'image', imagePrompt: 'Saved view' }]
  };
  const job = await queue('image', {
    target: { assetId: pid, packageItemId: 'view' },
    instructions: 'Different view'
  });
  await expect(production.build(job)).rejects.toThrow('Revise and approve');
});

test('revision queue conflicts restore the pending proposal unless a matching job already exists', async () => {
  proposal = {
    _id: pid,
    chatId: eid,
    episodeId: eid,
    baseRevision: 0,
    status: 'pending',
    updatedAt: new Date(),
    render: {
      target: target(),
      instructions: 'New directions',
      referenceIds: [],
      resolution: '1080p'
    }
  };
  vi.mocked(Proposal.updateOne).mockImplementation((async (_filter, update: { $set?: object }) => {
    for (const [key, value] of Object.entries(update.$set ?? {})) {
      if (key.startsWith('render.')) proposal.render[key.slice(7)] = value;
      else proposal[key] = value;
    }
    return { modifiedCount: 1 };
  }) as never);
  vi.mocked(Proposal.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  await expect(production.approveRevision(pid, { generate: true })).rejects.toThrow(
    'already being approved'
  );
  vi.mocked(Job.create).mockRejectedValueOnce(new Error('Database unavailable'));
  await expect(production.approveRevision(pid, { generate: true })).rejects.toThrow(
    'Database unavailable'
  );
  expect(Proposal.updateOne).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ $set: { status: 'pending' } })
  );
  vi.mocked(Proposal.updateOne).mockClear();
  vi.mocked(Job.exists).mockImplementation((async (filter: { requestId?: string }) =>
    filter.requestId ? { _id: 'existing' } : null) as never);
  vi.mocked(Job.create).mockRejectedValueOnce(new Error('Duplicate submission'));
  await expect(production.approveRevision(pid, { generate: true })).rejects.toThrow(
    'Duplicate submission'
  );
  expect(Proposal.updateOne).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ $set: { status: 'pending' } })
  );
});

test('saved revision references, cached imports and pending provider history preserve the original inputs', async () => {
  let job = structuredClone(await queue('video'));
  const state = await renderTarget(target(), 'video', pid);
  proposal = {
    status: 'applied',
    render: {
      target: target(),
      instructions: '',
      approvedAt: new Date(),
      approvedSnapshot: state.snapshot
    }
  };
  job.revisionProposalId = pid;
  expect(await production.build(job)).toBeDefined();
  media.providerReference = undefined;
  referenceResult.type = 'video';
  expect((await production.build(job)).params.startFrame.label).toBeUndefined();
  referenceResult.type = 'audio';
  expect((await production.build(job)).params.startFrame.label).toContain('Audio1');
  referenceResult.type = 'image';
  job = structuredClone(await queue());
  vi.mocked(StudioMedia.findOne).mockReturnValueOnce(query(media) as never);
  await production.processJob({
    ...job,
    status: 'importing',
    receipt: { resources: [{ mediaType: 'image', url: 'https://cdn.openart.ai/result.png' }] }
  });
  expect(fetcher).not.toHaveBeenCalled();
  openart.call.mockResolvedValueOnce({ status: 'PENDING' });
  await production.processJob({ ...job, status: 'rendering', historyId: 'known' });
  expect(currentJob.nextPollAt).toBeInstanceOf(Date);
  shot.kind = 'prop';
  shot.name = undefined;
  const prop = await queue('image', { target: { assetId: pid } });
  expect((await production.build(prop)).params.prompt).toContain('PROP SHEET');
});
