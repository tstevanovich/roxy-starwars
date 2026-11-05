import { beforeEach, expect, test, vi } from 'vitest';

import { prepareAnimaticTiming } from './animatic-timing.ts';
import { sceneApprovalBindings } from './approval-recovery.ts';
import * as dialogue from './assistant/dialogue.ts';
import { Job, Proposal, Run } from './assistant/models.ts';
import {
  StudioAsset,
  StudioAutomation,
  StudioEpisode,
  StudioMedia,
  StudioMusicCue,
  StudioProject,
  StudioReview
} from './models/Studio.ts';
import { workflowContext, workflowEnabled } from './production-workflow.ts';
import { runProjectContext } from './project-context.ts';
import * as soundDesign from './sound-design.ts';
import {
  createWorkflowAutomation,
  finalizeReviewedPackage,
  workflowAssetStatus
} from './workflow-automation.ts';

vi.mock('./production-workflow.ts', () => ({
  workflowContext: vi.fn(),
  workflowEnabled: vi.fn(() => true)
}));
vi.mock('./projects.ts', () => ({ withProject: (_key, work) => work() }));
vi.mock('./approval-recovery.ts', () => ({ sceneApprovalBindings: vi.fn() }));
vi.mock('./animatic-timing.ts', () => ({ prepareAnimaticTiming: vi.fn() }));
vi.mock('./models/Studio.ts', () => ({
  StudioAsset: { find: vi.fn(), updateOne: vi.fn() },
  StudioAutomation: { findOneAndUpdate: vi.fn(), updateOne: vi.fn(), updateMany: vi.fn() },
  StudioEpisode: { find: vi.fn() },
  StudioMedia: { find: vi.fn(), countDocuments: vi.fn(), exists: vi.fn() },
  StudioMusicCue: { find: vi.fn(), updateOne: vi.fn() },
  StudioProject: { find: vi.fn() },
  StudioReview: { find: vi.fn(), updateOne: vi.fn() }
}));
vi.mock('./assistant/models.ts', () => ({
  Job: { exists: vi.fn(), findOne: vi.fn(), find: vi.fn() },
  Proposal: { find: vi.fn(), exists: vi.fn() },
  Run: { find: vi.fn(), exists: vi.fn() }
}));
const query = (value) => ({
  lean: async () => value,
  sort: () => ({ lean: async () => value, limit: () => ({ lean: async () => value }) })
});

function episodeFixture() {
  const scene = {
    id: 'scene',
    title: 'Scene',
    location: 'Room',
    assetIds: [],
    soundPlan: { layers: [{ id: 'air' }] },
    clips: [
      {
        id: 'shot',
        title: 'Shot',
        duration: 5,
        dialogue: '',
        selectedDialogueId: null,
        production: {},
        takeIds: []
      }
    ]
  };
  parent = { _id: 'episode', revision: 0, scenes: [scene], production: { outline: 'Story' } };
  context.episodes = [parent];
  context.locate = (target) => ({
    parent,
    scene: parent.scenes.find((s) => s.id === target.sceneId) ?? scene,
    clip: scene.clips[0]
  });
  automation = createWorkflowAutomation({ queue: vi.fn() }, { automaticMediaGeneration: true });
  return {
    scene,
    clip: scene.clips[0],
    target: { scope: 'scene', recordId: 'episode', sceneId: 'scene' }
  };
}

test('episode planning limits videos across scenes and defers scenes with pending plans or revisions', async () => {
  const fixture = episodeFixture();
  context.assets = [
    { episodeId: 'episode', sceneId: 'scene', clipId: 'shot', finalChoice: { mediaIds: ['image'] } }
  ];
  parent.scenes.push({ ...fixture.scene, id: 'second' });
  expect(
    (await automation.plan({ scope: 'episode', recordId: 'episode' })).filter(
      (step) => step.kind === 'video'
    )
  ).toHaveLength(1);
  drafts = [{ render: { target: { sceneId: 'scene', clipId: 'shot' } } }];
  expect((await automation.plan(fixture.target)).some((step) => step.kind === 'video')).toBe(false);
  drafts = [];
  fixture.scene.soundPlan = null;
  vi.mocked(Proposal.exists).mockResolvedValueOnce({ _id: 'pending' } as never);
  expect(await automation.plan(fixture.target)).toEqual([]);
  parent.scenes = [];
  vi.mocked(Proposal.exists).mockResolvedValueOnce({ _id: 'pending' } as never);
  expect(await automation.plan({ scope: 'episode', recordId: 'episode' })).toEqual([]);
});

test('automatic planning distinguishes blocked dialogue from unexpected failures and completed reference retries', async () => {
  const fixture = episodeFixture();
  context.assets = [
    {
      episodeId: 'episode',
      sceneId: 'scene',
      clipId: 'shot',
      candidates: [{ archived: true }, { mediaIds: ['image'] }]
    }
  ];
  fixture.clip.dialogue = 'Unlabelled speech';
  expect(
    (await automation.plan(fixture.target, { includeBlocked: true })).some(
      (step) => step.error && !step.voiceAssetId
    )
  ).toBe(true);
  const turns = vi.spyOn(dialogue, 'dialogueTurns').mockImplementationOnce(() => {
    throw new Error('Unexpected parser error');
  });
  try {
    await expect(automation.plan(fixture.target)).rejects.toThrow('Unexpected parser error');
  } finally {
    turns.mockRestore();
  }
  fixture.clip.dialogue = 'HARKUN: Hello.';
  context.assets.push({ kind: 'voice', name: 'Harkun', aliases: [], candidates: [] });
  expect(
    (await automation.plan(fixture.target, { includeBlocked: true })).some((step) => step.error)
  ).toBe(true);
  const cast = vi.spyOn(dialogue, 'dialogueCast').mockImplementation(() => {
    throw new Error('Unexpected cast error');
  });
  try {
    await expect(automation.plan(fixture.target)).rejects.toThrow('Unexpected cast error');
  } finally {
    cast.mockRestore();
  }
  fixture.clip.dialogue = '';
  context.assets = [];
  const request = (await automation.plan(fixture.target)).find((step) => step.kind === 'image');
  const failed = {
    ...request,
    _id: 'failed',
    status: 'failed',
    error: 'Too many image references; select fewer references for this request.'
  };
  vi.mocked(Job.find).mockReturnValue({ sort: () => ({ select: () => query([failed]) }) } as never);
  const retry = (await automation.plan(fixture.target)).find((step) => step.kind === 'image');
  vi.mocked(Job.find).mockReturnValue({
    sort: () => ({ select: () => query([failed, { ...retry, status: 'ready' }]) })
  } as never);
  expect((await automation.plan(fixture.target)).some((step) => step.kind === 'image')).toBe(false);
});

test('mix planning reuses cached mixes and surfaces only unexpected mixer failures', async () => {
  const fixture = episodeFixture();
  fixture.clip.takeIds = ['video'];
  fixture.clip.production = { visualTakeId: 'video' };
  const mix = vi.spyOn(soundDesign, 'mixState').mockResolvedValue({ fingerprint: 'mix' } as never);
  vi.mocked(StudioMedia.exists).mockResolvedValueOnce(null);
  const target = { ...fixture.target, scope: 'clip', clipId: 'shot' };
  try {
    expect((await automation.plan(target)).some((step) => step.kind === 'mix')).toBe(true);
    vi.mocked(StudioMedia.exists).mockResolvedValueOnce({ _id: 'mixed' } as never);
    expect(await automation.plan(target)).toEqual([]);
    mix.mockRejectedValueOnce(Object.assign(new Error('Not ready'), { status: 409 }));
    expect(await automation.plan(target)).toEqual([]);
    mix.mockRejectedValueOnce(new Error('Unexpected mixer failure'));
    await expect(automation.plan(target)).rejects.toThrow('Unexpected mixer failure');
  } finally {
    mix.mockRestore();
  }
});

test('duplicate queue races reuse only the matching job and missing returns are harmless', async () => {
  parent.production.items = [{ id: 'front', type: 'image' }];
  action = { _id: 'action', projectKey: 'fixture', target: target(), trigger: {} };
  const queue = vi.fn();
  automation = createWorkflowAutomation({ queue }, { automaticMediaGeneration: true });
  for (const existing of [null, { _id: 'existing' }]) {
    queue.mockRejectedValueOnce(Object.assign(new Error('Duplicate'), { code: 11000 }));
    vi.mocked(Job.findOne).mockReturnValueOnce(query(existing) as never);
    await automation.processNext();
  }
  queue.mockResolvedValueOnce(null);
  await automation.processNext();
  expect(StudioAutomation.updateOne).toHaveBeenCalledWith(expect.anything(), {
    $addToSet: { jobIds: 'existing' }
  });
});

test('voice handoffs skip malformed dialogue and retain an unready scene music cue', async () => {
  const fixture = episodeFixture();
  context.assets = [{ _id: 'voice', kind: 'voice', name: 'Harkun' }];
  fixture.clip.dialogue = 'Unlabelled speech';
  await automation.afterApproval({ scope: 'asset', recordId: 'voice' }, {});
  const turns = vi.spyOn(dialogue, 'dialogueTurns').mockImplementation(() => {
    throw new Error('Unexpected parser failure');
  });
  try {
    await expect(
      automation.afterApproval({ scope: 'asset', recordId: 'voice' }, {})
    ).rejects.toThrow('Unexpected parser failure');
  } finally {
    turns.mockRestore();
  }
  context.evaluate.mockImplementation((target, stage) => ({
    target,
    stage,
    status: stage === 'visual' ? 'draft' : 'approved'
  }));
  await runProjectContext({ key: 'fixture', musicWorkflowEnabled: true }, () =>
    automation.afterApproval(
      { ...fixture.target, scope: 'clip', clipId: 'shot' },
      { stage: 'visual' }
    )
  );
  expect(StudioMusicCue.updateOne).not.toHaveBeenCalled();
});
let parent, context, runs, drafts, action, automation;
const target = () => ({ scope: 'asset', recordId: 'asset' });
beforeEach(() => {
  vi.clearAllMocks();
  parent = {
    _id: 'asset',
    revision: 0,
    kind: 'prop',
    brief: 'Approved prop',
    production: { items: [] },
    candidates: []
  };
  runs = [];
  drafts = [];
  action = null;
  context = {
    assets: [parent],
    episodes: [],
    jobs: [],
    musicCues: [],
    media: [],
    locate: () => ({ parent }),
    evaluate: vi.fn((target, stage) => ({
      target,
      stage,
      title: stage,
      status: 'approved',
      fingerprint: stage,
      canApprove: true,
      blockers: []
    }))
  };
  vi.mocked(workflowContext).mockImplementation(async () => context);
  vi.mocked(workflowEnabled).mockReturnValue(true);
  vi.mocked(Proposal.find).mockImplementation(() => query(drafts) as never);
  vi.mocked(Proposal.exists).mockResolvedValue(null);
  vi.mocked(Run.find).mockImplementation(() => query(runs) as never);
  vi.mocked(Run.exists).mockResolvedValue(null);
  vi.mocked(Job.exists).mockResolvedValue(null);
  vi.mocked(Job.findOne).mockReturnValue(query(null) as never);
  vi.mocked(Job.find).mockReturnValue({ sort: () => ({ select: () => query([]) }) } as never);
  vi.mocked(StudioAutomation.findOneAndUpdate).mockImplementation(() => query(action) as never);
  for (const model of [StudioAsset, StudioEpisode, StudioMedia, StudioMusicCue, StudioReview])
    vi.mocked(model.find).mockReturnValue(query([]) as never);
  vi.mocked(StudioProject.find).mockReturnValue(query([{ key: 'fixture' }]) as never);
  vi.mocked(StudioMedia.countDocuments).mockResolvedValue(1);
  vi.mocked(sceneApprovalBindings).mockReturnValue({
    bindings: [
      { id: 'sound', stage: 'sound-plan' },
      { id: 'script', stage: 'script' }
    ],
    feedbackBindings: [{ id: 'feedback' }],
    skipped: []
  } as never);
  automation = createWorkflowAutomation({ queue: vi.fn() });
});
test('voice status reflects finalized IDs, current auditions and archived alternatives', () => {
  expect(workflowAssetStatus({ kind: 'voice', finalChoice: { voiceId: 'chosen' } }, context)).toBe(
    'finalized'
  );
  expect(
    workflowAssetStatus(
      { kind: 'voice', reviewStatus: 'pending-choice', finalChoice: { voiceId: 'chosen' } },
      context
    )
  ).toBe('finalized');
  expect(
    workflowAssetStatus(
      { kind: 'voice', candidates: [{ archived: true }, { mediaIds: ['audio'] }] },
      context
    )
  ).toBe('pending-choice');
  expect(workflowAssetStatus({ kind: 'voice', candidates: [] }, context)).toBe('development');
  expect(
    workflowAssetStatus(
      {
        ...parent,
        production: {},
        candidates: [{ archived: true }, { id: 'new', mediaIds: ['image'] }]
      },
      context
    )
  ).toBe('pending-choice');
  expect(
    workflowAssetStatus(
      {
        ...parent,
        production: { items: [{ id: 'front', requiresPlanApproval: true }] },
        candidates: [{ id: 'chosen', mediaIds: ['image'] }],
        finalChoice: { id: 'chosen' }
      },
      context
    )
  ).toBe('finalized');
});
test('progress reports durable story runs rather than appearing stuck behind generic approvals', async () => {
  for (const [status, kind, expected] of [
    ['failed', 'story-outline', 'blocked'],
    ['completed', 'story-outline', 'review'],
    ['preparing', 'story-asset-brief', 'working'],
    ['queued', 'story-scene-plan', 'working'],
    ['running', 'story-outline', 'working']
  ]) {
    runs = [{ status, chatId: 'chat', error: 'Provider unavailable', workflowDraft: { kind } }];
    expect((await automation.progress(target())).state).toBe(expected);
  }
});
test('brief planning reuses queued requests and scheduling ignores unsupported targets', async () => {
  parent.brief = '';
  vi.mocked(Run.exists).mockResolvedValueOnce({ _id: 'existing' } as never);
  expect(await automation.plan(target())).toEqual([]);
  expect(await automation.schedule({ scope: 'invalid' }, {})).toBeNull();
  vi.mocked(workflowEnabled).mockReturnValue(false);
  expect(await automation.schedule(target(), {})).toBeNull();
});
test('story preparation failures remain reviewable and missing queue support never creates media jobs', async () => {
  parent.brief = '';
  action = { _id: 'action', target: target(), projectKey: 'fixture', trigger: {} };
  await automation.processNext();
  expect(StudioAutomation.updateOne).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) })
  );
});
test('approval reconciliation binds sound and script history independently and retains feedback fingerprints', async () => {
  await automation.reconcileSceneApprovals();
  expect(StudioReview.updateOne).toHaveBeenCalledTimes(3);
  expect(StudioReview.updateOne).toHaveBeenCalledWith(
    expect.objectContaining({ _id: 'feedback', contentFingerprint: null }),
    expect.anything()
  );
});
test('package finalization validates all required images and does not repeat unchanged finalization', async () => {
  parent.production.items = [{ id: 'front', type: 'image', required: true, mediaId: 'image' }];
  vi.mocked(StudioMedia.countDocuments).mockResolvedValueOnce(0);
  await finalizeReviewedPackage(target());
  expect(StudioAsset.updateOne).not.toHaveBeenCalled();
  await finalizeReviewedPackage(target());
  const update = vi.mocked(StudioAsset.updateOne).mock.calls.at(-1)[1] as {
    $set: { finalChoice: object };
  };
  parent.finalChoice = update.$set.finalChoice;
  vi.mocked(StudioAsset.updateOne).mockClear();
  await finalizeReviewedPackage(target());
  expect(StudioAsset.updateOne).not.toHaveBeenCalled();
  parent.production = undefined;
  await finalizeReviewedPackage(target());
  expect(await automation.plan(target())).toEqual([]);
});

test('progress distinguishes multiple failed requests from other ready work and exposes reference revision reviews', async () => {
  parent.production.items = [
    { id: 'front', type: 'image' },
    { id: 'rear', type: 'image' }
  ];
  automation = createWorkflowAutomation({ queue: vi.fn() }, { automaticMediaGeneration: true });
  let jobs = [{ kind: 'video', status: 'failed', target: { assetId: 'asset' } }];
  context.jobs = jobs;
  vi.mocked(Job.find).mockImplementation(
    () => ({ sort: () => ({ select: () => query(jobs), limit: () => query(jobs) }) }) as never
  );
  expect((await automation.progress(target())).message).toContain('2 other ready requests');
  parent.production.items.pop();
  expect((await automation.progress(target())).message).toContain('1 other ready request can');
  parent.production.items.push({ id: 'rear', type: 'image' });
  jobs = (await automation.plan(target())).map((step, i) => ({
    ...step,
    _id: 'failed-' + i,
    status: 'failed'
  }));
  context.jobs = jobs;
  expect((await automation.progress(target())).message).toContain(
    '2 reference or production requests have'
  );
  jobs = [];
  context.jobs = jobs;
  parent.production.items = [
    { id: 'front', type: 'image', mediaId: 'image', requiresPlanApproval: true }
  ];
  context.evaluate.mockImplementation((target, stage) => ({
    target,
    stage,
    title: stage,
    fingerprint: stage,
    status: stage.startsWith('reference-plan:') ? 'draft' : 'approved',
    canApprove: false,
    blockers: []
  }));
  expect((await automation.progress(target())).review.stage).toBe('reference-plan:front');
});

test('reconciliation prepares only missing plans and times clips that have selected audio without a video', async () => {
  const fixture = episodeFixture();
  vi.mocked(StudioEpisode.find).mockReturnValue(query([parent]) as never);
  fixture.scene.soundPlan = null;
  await automation.reconcilePlanning();
  expect(StudioAutomation.findOneAndUpdate).toHaveBeenCalled();
  fixture.scene.soundPlan = { layers: [{ id: 'air' }] };
  await automation.reconcilePlanning();
  fixture.clip.selectedDialogueId = 'audio';
  parent.scenes.push({ ...fixture.scene, id: 'empty', clips: [] });
  automation = createWorkflowAutomation({ queue: vi.fn() }, { mediaDirectory: 'C:/fixture' });
  await automation.reconcileProduction();
  expect(prepareAnimaticTiming).toHaveBeenCalledWith(
    expect.objectContaining({ clipIds: ['shot'] })
  );
  vi.mocked(workflowContext).mockRejectedValueOnce(new Error('Unexpected storage failure'));
  action = { _id: 'action', projectKey: 'fixture', target: target(), trigger: {} };
  await automation.processNext();
  expect(StudioAutomation.updateOne).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      $set: expect.objectContaining({ error: expect.stringContaining('Check connections') })
    })
  );
});
