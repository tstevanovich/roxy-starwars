import express from 'express';
import request from 'supertest';
import { beforeEach, expect, test, vi } from 'vitest';

import { nativeAudioPolicy } from '../../shared/audio-policy.ts';
import { dialogueDuration, prepareAnimaticTiming } from './animatic-timing.ts';
import { Job, Proposal } from './assistant/models.ts';
import {
  StudioAutomation,
  StudioEpisode,
  StudioMedia,
  StudioMusicCue,
  StudioReview
} from './models/Studio.ts';
import { musicState } from './music-state.ts';
import { workflowContext, workflowEnabled } from './production-workflow.ts';
import { runProjectContext } from './project-context.ts';
import { sceneEditToken } from './scene-editor.ts';
import { clipPrompts, productionVideoPrompt } from './studio-prompts.ts';
import { workflowRouter } from './workflow-routes.ts';

const mediaProbe = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: (...args) => mediaProbe.run(...args)
  })
}));

vi.mock('./models/Studio.ts', () => ({
  StudioEpisode: { findById: vi.fn(), updateOne: vi.fn() },
  StudioProject: { updateOne: vi.fn() },
  StudioMedia: { findById: vi.fn(), updateOne: vi.fn() },
  StudioReview: { findOne: vi.fn(), findOneAndUpdate: vi.fn() },
  StudioMusicCue: { updateOne: vi.fn() },
  StudioAutomation: { find: vi.fn() }
}));
vi.mock('./production-workflow.ts', async (original) => ({
  ...(await original<typeof import('./production-workflow.ts')>()),
  workflowContext: vi.fn(),
  workflowEnabled: vi.fn(() => true)
}));
vi.mock('./assistant/models.ts', () => ({
  Job: { findOne: vi.fn() },
  Proposal: { find: vi.fn() }
}));
vi.mock('./animatic-timing.ts', () => ({
  prepareAnimaticTiming: vi.fn(),
  dialogueDuration: vi.fn(async () => 5)
}));
vi.mock('./projects.ts', () => ({
  assertMediaAccess: vi.fn(),
  legacyProfile: { key: 'imperial-smuggler' }
}));
vi.mock('./source-evidence.ts', () => ({ sourceEvidence: async () => [] }));
vi.mock('./workflow-automation.ts', () => ({ finalizeReviewedPackage: vi.fn() }));
vi.mock('./assistant/render-revisions.ts', () => ({
  assertNoPendingRevision: vi.fn(),
  proposeVideoRevision: vi.fn()
}));
const eid = '111111111111111111111111',
  mid = '222222222222222222222222';
const target = (scope = 'clip') => ({
  scope,
  recordId: eid,
  sceneId: 'scene',
  clipId: scope === 'clip' ? 'shot' : undefined
});
const query = (value) => ({ lean: async () => value });
const chain = (value) => ({
  ...query(value),
  sort: () => ({ limit: () => ({ ...query(value), select: () => query(value) }) })
});
let episode, scene, clip, context, automation, production, app;
beforeEach(() => {
  vi.clearAllMocks();
  clip = {
    id: 'shot',
    title: 'Shot',
    duration: 5,
    action: 'Stay',
    dialogue: '',
    camera: 'Static',
    soundEffects: '',
    production: {},
    takeIds: [],
    dialogueTakeIds: [mid]
  };
  scene = {
    id: 'scene',
    title: 'Scene',
    style: 'cinematic',
    location: 'Room',
    script: 'Story',
    assetIds: [],
    clips: [clip]
  };
  episode = { _id: eid, title: 'Episode', revision: 0, scenes: [scene] };
  context = {
    assets: [],
    media: [],
    reviews: [],
    jobs: [],
    musicJobs: [],
    musicCues: [],
    locate: () => ({ parent: episode, scene, clip }),
    evaluate: vi.fn((_target, stage) => ({
      stage,
      status: 'approved',
      canApprove: true,
      blockers: [],
      fingerprint: 'fingerprint',
      approvalFingerprint: 'approval',
      parentRevision: 0,
      reviewRevision: 0
    }))
  };
  vi.mocked(workflowContext).mockImplementation(async () => context);
  vi.mocked(workflowEnabled).mockReturnValue(true);
  vi.mocked(StudioEpisode.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);
  vi.mocked(StudioEpisode.findById).mockImplementation(() => query(episode) as never);
  vi.mocked(StudioMedia.findById).mockReturnValue(query(null) as never);
  vi.mocked(Job.findOne).mockReturnValue(query(null) as never);
  vi.mocked(Proposal.find).mockReturnValue(chain([]) as never);
  vi.mocked(StudioAutomation.find).mockReturnValue(chain([]) as never);
  vi.mocked(StudioReview.findOneAndUpdate).mockReturnValue(query({ _id: mid }) as never);
  vi.mocked(StudioReview.findOne).mockReturnValue(query(null) as never);
  mediaProbe.run.mockReset().mockResolvedValue({
    stdout: JSON.stringify({
      format: { duration: 5 },
      streams: [{ codec_type: 'video', width: 1920, height: 1080 }, { codec_type: 'audio' }]
    })
  });
  vi.mocked(StudioMusicCue.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);
  automation = {
    plan: vi.fn(async () => []),
    progress: vi.fn(async () => ({ state: 'ready', message: 'Ready' })),
    afterApproval: vi.fn(async () => []),
    retry: vi.fn(async () => []),
    advance: vi.fn(async () => [])
  };
  production = { queue: vi.fn(async () => ({ _id: 'job' })) };
  app = express();
  app.locals.assistant = { automation, production };
  app.use(express.json());
  app.use('/', workflowRouter('C:/missing-studio-fixture'));
  app.use((error, _req, res, _next) =>
    res.status(error.status ?? 500).json({ message: error.message })
  );
});
const post = (route, body = {}) =>
  request(app)
    .post(route)
    .send({ target: target(), parentRevision: 0, ...body });
test('workflow policy and enablement are available for both legacy and isolated workspaces', async () => {
  expect((await request(app).get('/policy')).body.enabled).toBe(true);
  expect((await post('/enable')).body).toEqual({ enabled: true });
  await runProjectContext({ key: 'other' }, async () =>
    expect((await post('/enable')).status).toBe(200)
  );
});
test('scene save validates navigation, structural edits, exact reference files and concurrent writes', async () => {
  expect((await post('/scene/save', { scene })).status).toBe(400);
  const save = (input, editToken = sceneEditToken(scene)) =>
    post('/scene/save', { target: target('scene'), scene: input, editToken });
  expect((await save({ ...scene, title: 'Changed' }, 'missing')).status).toBe(409);
  for (const clips of [null, []]) expect((await save({ ...scene, clips })).status).toBe(400);
  for (const field of ['imageReferenceMediaIds', 'videoReferenceMediaIds']) {
    expect(
      (await save({ ...scene, clips: [{ ...clip, production: { [field]: [mid] } }] })).status
    ).toBe(400);
  }
  context.media = [{ _id: mid, kind: 'image' }];
  const input = {
    ...scene,
    clips: [
      {
        ...clip,
        dialogue: 'HARKUN: New line.',
        production: { videoReferenceMediaIds: [mid], imageReferenceMediaIds: [mid] }
      }
    ]
  };
  expect((await save(input)).status).toBe(200);
  expect(StudioEpisode.updateOne).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({
      $set: {
        'scenes.0': expect.objectContaining({
          clips: [expect.objectContaining({ selectedDialogueId: null })]
        })
      }
    })
  );
  vi.mocked(StudioEpisode.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  expect((await save(input)).status).toBe(409);
});
test('image requests validate their snapshot and reuse only a matching request ID', async () => {
  expect((await post('/shot/image', { target: target('scene') })).status).toBe(400);
  expect((await post('/shot/image', { parentRevision: 1 })).status).toBe(409);
  const prompt = clipPrompts(scene, clip, [], episode).image;
  const body = { prompt, requestId: 'request' };
  vi.mocked(Job.findOne).mockReturnValueOnce(query({ kind: 'video' }) as never);
  expect((await post('/shot/image', body)).status).toBe(409);
  context.jobs = [
    {
      kind: 'image',
      target: { episodeId: eid, sceneId: 'scene', clipId: 'shot' },
      status: 'queued'
    }
  ];
  expect((await post('/shot/image', body)).status).toBe(409);
  context.jobs = [
    {
      kind: 'image',
      target: { episodeId: eid, sceneId: 'scene', clipId: 'different' },
      status: 'ready'
    }
  ];
  expect((await post('/shot/image', body)).status).toBe(202);
});
test('dialogue selection and generation point to this shot and retain files on a save conflict', async () => {
  expect((await post('/shot/dialogue', { target: target('scene') })).status).toBe(400);
  expect((await post('/shot/dialogue/generate', { target: target('scene') })).status).toBe(400);
  expect((await post('/shot/dialogue', { mediaId: mid })).status).toBe(409);
  context.media = [{ _id: mid, kind: 'audio' }];
  vi.mocked(StudioEpisode.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  expect((await post('/shot/dialogue', { mediaId: mid })).status).toBe(409);
  expect((await post('/shot/dialogue', { mediaId: mid })).status).toBe(200);
});
test('timing repair returns either the existing creative draft or a new mechanical repair', async () => {
  expect((await post('/animatic/prepare', { target: target('asset') })).status).toBe(400);
  expect((await post('/animatic/prepare', { parentRevision: 1 })).status).toBe(409);
  vi.mocked(prepareAnimaticTiming).mockResolvedValueOnce(null);
  expect((await post('/animatic/prepare')).status).toBe(400);
  vi.mocked(prepareAnimaticTiming).mockResolvedValueOnce({ _id: mid } as never);
  expect((await post('/animatic/prepare')).status).toBe(200);
  vi.mocked(prepareAnimaticTiming).mockResolvedValueOnce({ _id: mid, timingRepair: {} } as never);
  expect((await post('/animatic/prepare', { target: target('scene') })).status).toBe(200);
});
test('every generation and approval route reports disabled workflow and bad review actions clearly', async () => {
  const reviewSnapshot = { fingerprint: 'fingerprint', reviewRevision: 0 };
  expect(
    (await post('/review', { ...reviewSnapshot, stage: 'script', action: 'wrong' })).status
  ).toBe(400);
  expect(
    (
      await post('/review', {
        ...reviewSnapshot,
        stage: 'script',
        action: 'approve',
        musicMediaId: mid
      })
    ).status
  ).toBe(400);
  expect(
    (await post('/review', { ...reviewSnapshot, stage: 'script', action: 'approve', takeId: mid }))
      .status
  ).toBe(400);
  expect((await post('/shot/approve', { target: target('scene') })).status).toBe(400);
  expect((await post('/video/import', { target: target('scene') })).status).toBe(400);
  for (const endpoint of ['/retry', '/advance'])
    expect((await post(endpoint, { parentRevision: 1 })).status).toBe(409);
  expect((await post('/advance')).status).toBe(409);
  vi.mocked(workflowEnabled).mockReturnValue(false);
  for (const endpoint of [
    '/shot/dialogue',
    '/shot/approve',
    '/animatic/prepare',
    '/video/import',
    '/review',
    '/retry',
    '/advance'
  ])
    expect((await post(endpoint)).status).toBe(409);
});

const review = (body = {}) =>
  post('/review', {
    fingerprint: 'fingerprint',
    reviewRevision: 0,
    stage: 'script',
    action: 'approve',
    ...body
  });

test('review writes handle concurrent updates, unavailable prerequisites and timing repair receipts', async () => {
  for (const error of [
    Object.assign(new Error('Duplicate'), { code: 11000 }),
    new Error('Storage offline')
  ]) {
    vi.mocked(StudioReview.findOneAndUpdate).mockReturnValueOnce({
      lean: async () => {
        throw error;
      }
    } as never);
    expect((await review()).status).toBe('code' in error ? 409 : 500);
  }
  vi.mocked(StudioReview.findOneAndUpdate).mockReturnValueOnce(query(null) as never);
  expect((await review()).status).toBe(409);
  context.evaluate.mockReturnValue({
    parentRevision: 0,
    reviewRevision: 0,
    fingerprint: 'fingerprint',
    canApprove: false,
    blockers: []
  });
  expect((await review()).body.message).toContain('not ready');
  context.evaluate.mockReturnValue({
    parentRevision: 0,
    reviewRevision: 0,
    fingerprint: 'fingerprint',
    canApprove: false,
    blockers: ['Missing prerequisite']
  });
  expect((await review()).body.message).toBe('Missing prerequisite');
  for (const timingRepair of [undefined, {}]) {
    vi.mocked(prepareAnimaticTiming).mockResolvedValueOnce({ _id: mid, timingRepair } as never);
    expect(
      (await review({ stage: 'animatic', action: 'request-changes', feedback: 'Retime' })).status
    ).toBe(200);
  }
  vi.mocked(prepareAnimaticTiming).mockResolvedValueOnce(null);
  expect(
    (
      await review({
        target: target('scene'),
        stage: 'animatic',
        action: 'request-changes',
        feedback: 'Retime'
      })
    ).status
  ).toBe(200);
  context.evaluate.mockReturnValue({
    parentRevision: 0,
    reviewRevision: 0,
    fingerprint: 'fingerprint',
    canApprove: true,
    blockers: []
  });
  clip.dialogue = 'HARKUN: Hello.';
  expect((await review({ stage: 'animatic' })).status).toBe(200);
  clip.selectedDialogueId = mid;
  vi.mocked(dialogueDuration).mockResolvedValueOnce(18);
  vi.mocked(prepareAnimaticTiming).mockResolvedValueOnce({ _id: mid } as never);
  expect((await review({ stage: 'animatic' })).body.pendingDraft).toBe(mid);
});

test('music review validates QC, prompt currency, actual audio and concurrent selection without generating', async () => {
  const cue = {
    _id: mid,
    episodeId: eid,
    sceneId: 'scene',
    enabled: true,
    revision: 0,
    prompt: 'Orchestra',
    bufferSeconds: 5,
    model: 'music_v1',
    candidates: []
  };
  context.musicCues = [cue];
  const musicReview = () => review({ target: target('scene'), stage: 'music', musicMediaId: mid });
  expect((await musicReview()).body.message).toContain('audible material');
  const option = {
    id: 'option',
    mediaIds: [mid],
    fingerprint: 'stale',
    qc: { passed: true, targetSeconds: 5 }
  };
  cue.candidates.push(option);
  expect((await musicReview()).body.message).toContain('earlier brief');
  option.fingerprint = musicState(episode, scene, cue).fingerprint;
  context.evaluate.mockImplementation((_target, stage) => ({
    parentRevision: 0,
    reviewRevision: 0,
    fingerprint: 'fingerprint',
    canApprove: true,
    status: stage === 'music-plan' ? 'draft' : 'approved'
  }));
  expect((await musicReview()).body.message).toContain('current music brief');
  context.evaluate.mockImplementation((_target, stage) => ({
    stage,
    parentRevision: 0,
    reviewRevision: 0,
    fingerprint: 'fingerprint',
    canApprove: true,
    status: 'approved'
  }));
  expect((await musicReview()).body.message).toContain('reviewed file is missing');
  vi.mocked(StudioMedia.findById).mockReturnValue(query({ filename: 'music.mp3' }) as never);
  mediaProbe.run.mockRejectedValueOnce(new Error('Invalid media'));
  expect((await musicReview()).body.message).toContain('could not be inspected');
  mediaProbe.run.mockResolvedValueOnce({ stdout: '{"streams":[],"format":{"duration":5}}' });
  expect((await musicReview()).body.message).toContain('no longer matches');
  vi.mocked(StudioMusicCue.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  expect((await musicReview()).status).toBe(409);
  const accepted = await musicReview();
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  Object.assign(cue, { selectedMediaId: mid });
  expect((await musicReview()).status).toBe(200);
  expect(production.queue).not.toHaveBeenCalled();
});

test('native imports preserve uploads when the owner or episode changed', async () => {
  const importVideo = () => post('/video/import', { mediaId: mid });
  context.media = [{ _id: mid, kind: 'image' }];
  expect((await importVideo()).body.message).toContain('original native');
  context.media = [
    {
      _id: mid,
      kind: 'video',
      nativeAudio: {
        policy: nativeAudioPolicy,
        episodeId: 'other',
        sceneId: 'scene',
        clipId: 'shot'
      }
    }
  ];
  expect((await importVideo()).body.message).toContain('another clip');
  context.media[0].nativeAudio.episodeId = eid;
  vi.mocked(StudioMedia.findById).mockReturnValue(query({ filename: 'video.mp4' }) as never);
  vi.mocked(StudioEpisode.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  expect((await importVideo()).status).toBe(409);
  clip.takeIds = [mid];
  expect((await importVideo()).status).toBe(200);
  context.media[0].videoReview = { state: 'approved' };
  expect((await importVideo()).status).toBe(200);
  context.media[0].videoReview = undefined;
  clip.selectedTakeId = mid;
  context.evaluate.mockImplementation((_target, stage) => ({
    parentRevision: 0,
    reviewRevision: 0,
    fingerprint: 'fingerprint',
    status: stage === 'visual' ? 'draft' : 'approved'
  }));
  expect((await importVideo()).status).toBe(200);
});

test('native picture reapproval distinguishes the selected soundtrack from explicit sound repair', async () => {
  clip.takeIds = [mid];
  clip.selectedTakeId = mid;
  clip.production = { visualTakeId: mid };
  context.media = [
    {
      _id: mid,
      kind: 'video',
      nativeAudio: { policy: nativeAudioPolicy, episodeId: eid, sceneId: 'scene', clipId: 'shot' }
    }
  ];
  vi.mocked(StudioMedia.findById).mockReturnValue(query({ filename: 'video.mp4' }) as never);
  expect((await review({ stage: 'visual', takeId: mid })).status).toBe(200);
  clip.production.audioRepairTakeId = mid;
  expect((await review({ stage: 'visual' })).status).toBe(409);
  clip.production.audioRepairTakeId = 'old';
  expect((await review({ stage: 'visual', takeId: mid })).status).toBe(409);
  clip.production.audioRepairTakeId = null;
  clip.selectedTakeId = null;
  expect((await review({ stage: 'visual', takeId: mid })).status).toBe(409);
});

test('joint approval preserves previous feedback in history and accepts measured dialogue within its shot', async () => {
  clip.dialogue = 'HARKUN: Hello.';
  clip.selectedDialogueId = mid;
  context.evaluate.mockImplementation((_target, stage) => ({
    stage,
    status: stage === 'sound-plan' ? 'approved' : 'draft',
    canApprove: true,
    blockers: [],
    fingerprint: 'fingerprint',
    approvalFingerprint: 'approval',
    reviewRevision: 0
  }));
  vi.mocked(StudioReview.findOne).mockReturnValue(
    query({ state: 'changes-requested', feedback: 'Retime' }) as never
  );
  expect(
    (
      await post('/shot/approve', {
        reviews: {
          storyboard: { approvalFingerprint: 'approval', reviewRevision: 0 },
          animatic: { approvalFingerprint: 'approval', reviewRevision: 0 }
        }
      })
    ).status
  ).toBe(200);
  expect(StudioReview.findOneAndUpdate).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      $push: {
        history: expect.objectContaining({
          $each: [expect.objectContaining({ feedback: 'Retime' })]
        })
      }
    }),
    expect.anything()
  );
  episode.history = [{}];
  expect(
    (
      await post('/scene/save', {
        target: target('scene'),
        editToken: 'old',
        scene: { ...scene, title: 'New' }
      })
    ).status
  ).toBe(409);
});

test('picture and source approvals preserve records after optimistic write conflicts', async () => {
  clip.takeIds = [mid];
  context.media = [{ _id: mid, kind: 'video' }];
  vi.mocked(StudioEpisode.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  expect((await review({ stage: 'visual', takeId: mid })).body.message).toContain(
    'episode changed'
  );
  expect((await review({ stage: 'visual', takeId: mid })).body.message).toContain(
    'picture review changed'
  );
  episode.sourceReferences = [{ id: 'source' }, { id: 'other' }];
  const body = {
    target: { scope: 'episode', recordId: eid },
    stage: 'source',
    verifiedSourceIds: ['source']
  };
  vi.mocked(StudioEpisode.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  expect((await review(body)).body.message).toContain('episode changed');
  expect((await review(body)).body.message).toContain('source review changed');
  clip.production = { visualTakeId: mid };
  expect((await review({ stage: 'visual' })).status).toBe(200);
  clip.production = {};
  expect((await review({ stage: 'visual' })).status).toBe(400);
});

test('board navigation exposes section music and invalid dialogue never prevents opening the board', async () => {
  clip.dialogue = 'Unlabelled speech';
  context.musicCues = [
    { enabled: false },
    { enabled: true, episodeId: 'other' },
    { enabled: true, episodeId: eid, sceneId: 'other' },
    { enabled: true, episodeId: eid, sceneId: 'scene' }
  ];
  const result = await post('/board', { target: { scope: 'episode', recordId: eid } });
  expect(result.status).toBe(200);
  expect(result.body.groups.some((group) => group.title.includes('Background music'))).toBe(true);
  expect(result.body.voicePrompts).toEqual([]);
});

test('joint approval rechecks the exact inputs again at the generation boundary', async () => {
  const body = {
    generate: true,
    prompt: productionVideoPrompt(scene, clip, '', { assets: [], media: [] }),
    reviews: {
      storyboard: { approvalFingerprint: 'approval', reviewRevision: 0 },
      animatic: { approvalFingerprint: 'approval', reviewRevision: 0 }
    }
  };
  const fresh = {
    ...context,
    evaluate: () => ({ status: 'draft', approvalFingerprint: 'approval' })
  };
  vi.mocked(workflowContext)
    .mockResolvedValueOnce(context)
    .mockResolvedValueOnce(context)
    .mockResolvedValueOnce(context)
    .mockResolvedValueOnce(fresh as never);
  expect((await post('/shot/approve', body)).body.message).toContain('changed while preparing');
  expect(production.queue).not.toHaveBeenCalled();
});

test('download failures from storage propagate rather than being mistaken for missing files', async () => {
  clip.takeIds = undefined;
  clip.selectedTakeId = mid;
  context.media = [
    { _id: mid, kind: 'video', filename: 'video.mp4', originalName: 'Video', mime: 'video/mp4' }
  ];
  const download = vi
    .spyOn(express.response, 'sendFile')
    .mockImplementation(function (_path, _options, callback) {
      callback(Object.assign(new Error('Storage denied'), { code: 'EACCES' }));
      return this;
    });
  try {
    expect((await request(app).get(`/shot/${eid}/scene/shot/video`)).status).toBe(500);
  } finally {
    download.mockRestore();
  }
});
test('download errors are JSON and preserve access to existing takes independent of readiness', async () => {
  clip.takeIds = [mid];
  context.media = [
    {
      _id: mid,
      kind: 'video',
      originalName: 'saved.mp4',
      filename: 'missing.mp4',
      mime: 'video/mp4'
    }
  ];
  const result = await request(app).get(`/shot/${eid}/scene/shot/video`);
  expect(result.status).toBe(404);
  expect(result.body.message).toContain('Restore it from your backup');
});

test('joint shot approval saves independently of generation and handles stale reviews and concurrent claims', async () => {
  const body = () => ({
    prompt: productionVideoPrompt(scene, clip, '', {
      assets: context.assets,
      media: context.media
    }),
    reviews: {
      storyboard: { approvalFingerprint: 'approval', reviewRevision: 0 },
      animatic: { approvalFingerprint: 'approval', reviewRevision: 0 }
    }
  });
  expect((await post('/shot/approve', body())).status).toBe(200);
  expect(production.queue).not.toHaveBeenCalled();
  context.evaluate.mockImplementation((_target, stage) => ({
    stage,
    status: stage === 'sound-plan' ? 'draft' : 'approved'
  }));
  expect((await post('/shot/approve', body())).status).toBe(409);
  context.evaluate.mockReturnValue({
    status: 'approved',
    canApprove: true,
    blockers: [],
    fingerprint: 'fingerprint',
    approvalFingerprint: 'approval',
    reviewRevision: 0
  });
  clip.takeIds = [mid];
  context.media = [{ _id: mid, kind: 'video' }];
  expect((await post('/shot/approve', body())).status).toBe(409);
  clip.takeIds = [];
  clip.dialogue = 'HARKUN: Hello.';
  clip.selectedDialogueId = mid;
  vi.mocked(dialogueDuration).mockResolvedValueOnce(18);
  expect((await post('/shot/approve', body())).status).toBe(409);
  clip.dialogue = '';
  context.evaluate.mockImplementation((_target, stage) => ({
    stage,
    status: stage === 'sound-plan' ? 'approved' : 'draft',
    canApprove: false,
    blockers: [],
    fingerprint: 'fingerprint',
    approvalFingerprint: 'approval',
    reviewRevision: 0
  }));
  expect((await post('/shot/approve', body())).body.message).toContain('prerequisites');
  context.evaluate.mockImplementation((_target, stage) => ({
    stage,
    status: stage === 'sound-plan' ? 'approved' : 'draft',
    canApprove: true,
    blockers: [],
    fingerprint: 'fingerprint',
    approvalFingerprint: 'approval',
    reviewRevision: 0
  }));
  for (const error of [
    Object.assign(new Error('Duplicate'), { code: 11000 }),
    new Error('Storage unavailable')
  ]) {
    vi.mocked(StudioReview.findOneAndUpdate).mockReturnValueOnce({
      lean: async () => {
        throw error;
      }
    } as never);
    expect((await post('/shot/approve', body())).status).toBe('code' in error ? 409 : 500);
  }
  vi.mocked(StudioReview.findOneAndUpdate).mockReturnValueOnce(query(null) as never);
  expect((await post('/shot/approve', body())).status).toBe(409);
  expect((await post('/shot/approve', body())).status).toBe(200);
  vi.mocked(workflowContext)
    .mockResolvedValueOnce(context)
    .mockResolvedValueOnce({
      ...context,
      evaluate: () => ({ approvalFingerprint: 'changed' })
    } as never);
  expect((await post('/shot/approve', body())).status).toBe(409);
});
