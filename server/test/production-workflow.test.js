import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { promisify } from 'node:util';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

import { animaticTimingIssue, splitDialogueForTiming } from '../../shared/animatic-timing.js';
import { nativeAudioPolicy } from '../../shared/audio-policy.js';
import { musicPrompt } from '../../shared/scene-music.js';
import { soundPlanReviewInput } from '../../shared/sound-plan-review.js';
import { createApp } from '../src/app.js';
import { approvalRecoveryPlan, sceneApprovalBindings } from '../src/approval-recovery.js';
import {
  createChatEngine,
  makeProposal,
  productionProposal,
  studioContext
} from '../src/assistant/chat.js';
import { Chat, Job, Message, Proposal, Run } from '../src/assistant/models.js';
import { audibleWindow, createMusicProduction } from '../src/assistant/music-production.js';
import { unpack } from '../src/assistant/openart.js';
import { createProduction } from '../src/assistant/production.js';
import { proposeVideoRevision } from '../src/assistant/render-revisions.js';
import { createSecretStore } from '../src/assistant/store.js';
import { createStoryQueue } from '../src/assistant/story-automation.js';
import { StudioMusicCue } from '../src/models/Studio.js';
import {
  StudioAsset,
  StudioAutomation,
  StudioEpisode,
  StudioMedia,
  StudioProject,
  StudioReview,
  StudioSourceEvidence
} from '../src/models/Studio.js';
import { omitOpeningCrawl } from '../src/omit-opening-crawl.js';
import { evaluateWorkflow, requireWorkflow, workflowContext } from '../src/production-workflow.js';
import { withProject } from '../src/projects.js';
import { restartVideoPass } from '../src/restart-video-pass.js';
import { mixState, validateMixedSelection } from '../src/sound-design.js';
import { saveGeneratedMedia } from '../src/studio-media.js';
import { clipPrompts } from '../src/studio-prompts.js';
import { createWorkflowAutomation as createManualAutomation } from '../src/workflow-automation.js';

// Keep the earlier automation regression cases as explicit legacy opt-in tests.
const createWorkflowAutomation = (production, options = {}) =>
  createManualAutomation(production, { ...options, automaticMediaGeneration: true });

const key = 'workflow-test',
  headers = { 'X-Studio-Project': key },
  base = '/api/studio';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
  'base64'
);
let mongo,
  directory,
  app,
  asset,
  episode,
  image,
  video,
  audio,
  upscale,
  sound,
  production,
  calls,
  providerHook;
before(
  async () => {
    directory = await mkdtemp(join(tmpdir(), 'roxy-workflow-'));
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri('workflow'));
    await StudioReview.init();
    await Job.init();
    await Promise.all([Chat.init(), Run.init(), Message.init()]);
    for (const [name, size] of [
      ['small', '160x90'],
      ['native-1080', '1920x1080'],
      ['upscale', '2560x1440'],
      ['upscale-rounded', '2562x1440']
    ])
      await promisify(execFile)(
        'ffmpeg',
        [
          '-y',
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          `color=c=blue:s=${size}:r=1:d=2`,
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=120:duration=2',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-shortest',
          join(directory, name + '.mp4')
        ],
        { windowsHide: true }
      );
    await promisify(execFile)(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=120:duration=2',
        join(directory, 'audio.wav')
      ],
      { windowsHide: true }
    );
  },
  { timeout: 180000 }
);
beforeEach(async () => {
  for (const Model of [
    StudioMusicCue,
    StudioReview,
    StudioSourceEvidence,
    StudioAutomation,
    StudioProject,
    StudioEpisode,
    StudioAsset,
    StudioMedia,
    Job,
    Proposal,
    Chat,
    Message,
    Run
  ])
    await Model.deleteMany({});
  await StudioProject.create({
    key,
    name: 'Workflow test',
    videoWorkflow: 'legacy-upscale',
    era: 'Old Republic era',
    workflowVersion: 1
  });
  calls = [];
  providerHook = null;
  const store = createSecretStore(join(directory, 'private'));
  await store.update(() => ({ openart: { tokens: { access_token: 'fake' }, projectId: 'fake' } }));
  production = createProduction({
    store,
    mediaDirectory: directory,
    openart: {
      call: async (name) => {
        calls.push(name);
        await providerHook?.(name);
        if (name === 'openart_model_form_get') return { jsonSchema: {} };
        if (name === 'openart_model_cost')
          return { items: [{ totalCredits: 0, affordable: true }] };
        if (name === 'openart_generate_image')
          return { historyId: 'fake-render', status: 'PENDING' };
        if (name === 'openart_generate_video')
          return { historyId: 'fake-video', status: 'PENDING' };
        throw new Error('Unexpected fake provider tool');
      }
    },
    fetcher: async () => new Response(png)
  });
  app = createApp({ auth: false, mediaDirectory: directory });
  app.locals.assistant.automation = createWorkflowAutomation(production);
  await withProject(key, async () => {
    image = (
      await saveGeneratedMedia(directory, png, 'source.png', {
        providerReference: { id: 'fake-image', url: 'https://cdn.openart.ai/fake.png' }
      })
    ).toObject();
    video = (
      await saveGeneratedMedia(
        directory,
        await readFile(join(directory, 'small.mp4')),
        'original.mp4'
      )
    ).toObject();
    upscale = (
      await saveGeneratedMedia(
        directory,
        await readFile(join(directory, 'upscale.mp4')),
        'upscale.mp4'
      )
    ).toObject();
    audio = (
      await saveGeneratedMedia(directory, await readFile(join(directory, 'audio.wav')), 'audio.wav')
    ).toObject();
    asset = (
      await StudioAsset.create({
        name: 'Test character',
        kind: 'character',
        brief: 'Approved identity and red outfit. No text.',
        scope: 'reusable',
        revision: 0,
        production: {
          managed: true,
          sourceMode: 'original',
          sourceNotes: 'Original design direction for this test.',
          sourceMediaIds: [],
          items: [
            {
              id: 'profile',
              type: 'image',
              title: 'Individual profile',
              mediaId: String(image._id),
              required: true,
              notes: 'Keep identity.'
            }
          ]
        },
        finalChoice: { id: 'master', mediaIds: [image._id] }
      })
    ).toObject();
    sound = (
      await StudioAsset.create({
        name: 'Wind',
        kind: 'sound',
        finalChoice: { id: 'wind', mediaIds: [audio._id] }
      })
    ).toObject();
    episode = (
      await StudioEpisode.create({
        title: 'Workflow episode',
        production: { sourceNotes: 'Original test story.', outline: 'The character arrives.' },
        scenes: [
          {
            id: 'scene',
            title: 'Arrival',
            style: 'cinematic',
            location: 'Star Wars Korriban',
            script: 'The character stops at a door.',
            assetIds: [asset._id],
            soundPlan: {
              notes: 'No music.',
              dialogueGainDb: 0,
              layers: [
                {
                  id: 'bed',
                  title: 'Wind',
                  description: 'Quiet wind. No music.',
                  type: 'ambience',
                  duration: 2,
                  loop: true,
                  gainDb: -20,
                  start: 0,
                  sourceStart: 0,
                  lowpassHz: 0,
                  assetId: String(sound._id)
                }
              ]
            },
            clips: [
              {
                id: 'shot',
                title: 'At the door',
                duration: 2,
                action: 'Stops at the door.',
                dialogue: '',
                camera: 'Static medium shot.',
                soundEffects: 'Wind. No music.',
                production: {
                  mode: 'image2video',
                  framing: 'Medium',
                  beats: '0–2: Stop at the door.',
                  passCondition: 'Stable identity and door; no extra limbs.'
                },
                takeIds: [video._id],
                dialogueTakeIds: []
              }
            ]
          }
        ]
      })
    ).toObject();
    await StudioAsset.create({
      name: 'Shot image',
      kind: 'environment',
      scope: 'episode',
      episodeId: episode._id,
      sceneId: 'scene',
      clipId: 'shot',
      finalChoice: { id: 'shot-image', mediaIds: [image._id] }
    });
  });
});
after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true });
});
const at = (scope, recordId, sceneId, clipId) => ({
  scope,
  recordId: String(recordId),
  ...(sceneId ? { sceneId } : {}),
  ...(clipId ? { clipId } : {})
});

test('visual scene corrections keep the approved sound plan and sound text without another approval', async () => {
  await prepare();
  const before = await StudioEpisode.findById(episode._id).lean(),
    original = before.scenes[0];
  const proposal = await withProject(key, () =>
    makeProposal(new mongoose.Types.ObjectId(), {
      episodeId: String(episode._id),
      title: 'Correct the conversational background',
      explanation: 'Only change the framing.',
      scene: {
        ...original,
        soundPlan: {
          ...original.soundPlan,
          notes: 'An unsolicited paraphrase.',
          layers: original.soundPlan.layers.map((layer) => ({
            ...layer,
            description: 'An unsolicited sound rewrite.'
          }))
        },
        clips: original.clips.map((clip) => ({
          ...clip,
          camera: 'Corrected camera framing.',
          soundEffects: 'An unsolicited effects rewrite.'
        }))
      }
    })
  );
  assert.deepEqual(proposal.scene.soundPlan, original.soundPlan);
  assert.equal(proposal.scene.clips[0].soundEffects, original.clips[0].soundEffects);
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  assert.equal((await state(sceneTarget(), 'sound-plan')).status, 'approved');
  assert.notEqual((await state(sceneTarget(), 'shot-plan')).status, 'approved');
  const saved = await StudioEpisode.findById(episode._id).lean();
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.soundPlan.layers.0.gainDb': -9 } }
  );
  assert.notEqual((await state(sceneTarget(), 'sound-plan')).status, 'approved');
  assert.deepEqual(saved.scenes[0].soundPlan, original.soundPlan);
});

test('continuous ambience survives mechanical shot splitting but changed effects and levels require review', () => {
  const clip = { id: 'room', duration: 20, soundEffects: 'Continuous room ventilation.' };
  const layer = {
    id: 'bed',
    clipId: clip.id,
    title: 'Room bed',
    type: 'ambience',
    description: 'Quiet ventilation.',
    start: 0,
    duration: 20,
    gainDb: -26,
    lowpassHz: 0,
    loop: true,
    assetId: null
  };
  const original = { soundPlan: { notes: 'No music.', layers: [layer] }, clips: [clip] };
  const split = {
    soundPlan: {
      ...original.soundPlan,
      layers: [7, 14].map((duration, index) => ({
        ...layer,
        id: 'bed-' + index,
        clipId: 'room-' + index,
        duration
      }))
    },
    clips: [7, 14].map((duration, index) => ({ ...clip, id: 'room-' + index, duration }))
  };
  assert.deepEqual(soundPlanReviewInput(split), soundPlanReviewInput(original));
  split.soundPlan.layers[1].gainDb = -8;
  assert.notDeepEqual(soundPlanReviewInput(split), soundPlanReviewInput(original));
  split.soundPlan.layers[1] = { ...split.soundPlan.layers[1], type: 'effect', start: 2 };
  assert.notDeepEqual(soundPlanReviewInput(split), soundPlanReviewInput(original));
});

test('chat and asset creation reuse an existing character package instead of restarting its images', async () => {
  await prepare();
  await StudioAsset.updateOne({ _id: asset._id }, { $set: { name: 'Kory' } });
  const before = await StudioAsset.findById(asset._id).lean();
  const reused = await request(app)
    .post(base + '/assets')
    .set(headers)
    .send({
      name: 'Kory — acolyte character production package',
      kind: 'character',
      scope: 'reusable',
      brief: 'A duplicate should not be created.'
    })
    .expect(200);
  assert.equal(reused.body.reusedExisting, true);
  assert.equal(reused.body.asset._id, String(asset._id));
  const chat = await withProject(key, () =>
    Chat.create({ title: 'Fix Kory shot', context: { episodeId: String(episode._id) } })
  );
  const run = await withProject(key, () => Run.create({ chatId: chat._id, status: 'queued' }));
  let replies = 0;
  const chatgpt = {
    ready: async () => ({ profileId: 'test-profile', model: 'test-model' }),
    respond: async ({ input }) => {
      if (++replies === 1)
        return {
          output: [
            {
              type: 'function_call',
              name: 'create_asset_draft',
              call_id: 'duplicate',
              arguments: JSON.stringify({
                name: 'Kory — acolyte character production package',
                kind: 'character',
                scope: 'reusable',
                brief: 'Kory identity.',
                production: {}
              })
            }
          ]
        };
      const result = JSON.parse(input.find((item) => item.type === 'function_call_output').output);
      assert.equal(result.reusedExisting, true);
      assert.equal(result._id, String(asset._id));
      return {
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Reusing the existing approved Kory package.' }]
          }
        ]
      };
    }
  };
  await createChatEngine({ chatgpt, production, mediaDirectory: directory }).run(run.toObject());
  assert.equal((await Run.findById(run._id).lean()).status, 'completed');
  assert.deepEqual(await StudioAsset.findById(asset._id).lean(), before);
  assert.equal(await StudioAsset.countDocuments({ kind: 'character' }), 1);
  assert.equal(await Job.countDocuments(), 0);
  const context = await withProject(key, () => studioContext({ episodeId: String(episode._id) }));
  assert.ok(context.characterDirectory.some((item) => item.name === 'Kory' && item.finalized));
  await StudioAsset.updateOne({ _id: asset._id }, { $set: { archived: true } });
  assert.deepEqual(
    await withProject(key, () => createWorkflowAutomation(production).plan(assetTarget())),
    []
  );
});

test('brief drafts apply to legacy shot assets with no production field and preserve shot ownership', async () => {
  const shot = await withProject(key, () =>
    StudioAsset.create({
      name: 'Roxy and Kory composition',
      kind: 'shot',
      episodeId: episode._id,
      sceneId: 'scene',
      clipId: 'shot',
      revision: 8,
      brief: 'Original composition.'
    })
  );
  await StudioAsset.updateOne({ _id: shot._id }, { $unset: { production: 1 } });
  const proposal = await withProject(key, () =>
    productionProposal(new mongoose.Types.ObjectId(), {
      scope: 'asset',
      recordId: String(shot._id),
      title: 'Correct conversation cast',
      explanation: 'Use Roxy and Kory.',
      brief: 'Roxy and Kory converse. Harkun must not appear.',
      production: {}
    })
  );
  assert.deepEqual(proposal.baseProduction, { items: [] });
  // Existing drafts made before the fix also lack an explicit baseline.
  await Proposal.updateOne({ _id: proposal._id }, { $unset: { baseProduction: 1 } });
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  const saved = await StudioAsset.findById(shot._id).lean();
  assert.equal(saved.brief, 'Roxy and Kory converse. Harkun must not appear.');
  assert.equal(saved.production.managed, false);
  assert.equal(saved.clipId, 'shot');
  assert.equal(saved.revision, 9);
  assert.equal(await Job.countDocuments(), 0);
});

test('sound plan approval accepts unrelated episode updates but rejects changed sound and concurrent reviews', async () => {
  await prepare();
  await review(sceneTarget(), 'sound-plan', 'unapprove');
  const shown = await state(sceneTarget(), 'sound-plan');
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { notes: 'An unrelated production update.' }, $inc: { revision: 1 } }
  );
  await StudioReview.updateOne(
    { 'target.sceneId': 'scene', stage: 'script' },
    { $inc: { revision: 1 } }
  );
  const refreshed = await state(sceneTarget(), 'sound-plan');
  assert.notEqual(refreshed.fingerprint, shown.fingerprint);
  assert.equal(refreshed.approvalFingerprint, shown.approvalFingerprint);
  const approved = await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...shown, action: 'approve' })
    .expect(200);
  assert.equal(approved.body.review.state, 'approved');
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...shown, action: 'approve' })
    .expect(409);
  const stale = await state(sceneTarget(), 'sound-plan');
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.soundPlan.notes': 'Changed sound directions.' }, $inc: { revision: 1 } }
  );
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...stale, action: 'approve' })
    .expect(409);
});

test('Creative brief drafts fill the saved field, retain source approval and protect newer owner edits', async () => {
  await StudioAsset.updateOne({ _id: asset._id }, { $set: { brief: '' } });
  await review(assetTarget(), 'source');
  const before = await StudioAsset.findById(asset._id).lean();
  const proposal = await withProject(key, () =>
    productionProposal(new mongoose.Types.ObjectId(), {
      scope: 'asset',
      recordId: String(asset._id),
      title: 'Complete character brief',
      explanation: 'Use the saved source evidence.',
      brief: 'Adult woman. Preserve the source costume and existing voice.',
      production: before.production
    })
  );
  assert.equal(proposal.baseBrief, '');
  assert.deepEqual(proposal.reviewStages, ['brief']);
  await StudioAsset.updateOne(
    { _id: asset._id },
    { $set: { notes: 'New owner note' }, $inc: { revision: 1 } }
  );
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  const saved = await StudioAsset.findById(asset._id).lean();
  assert.equal(saved.brief, proposal.brief);
  assert.equal(saved.notes, 'New owner note');
  assert.deepEqual(saved.production, before.production);
  assert.equal((await state(assetTarget(), 'source')).status, 'approved');
  assert.equal((await state(assetTarget(), 'brief')).status, 'pending-review');
  assert.equal(await Job.countDocuments(), 0);
  const revision = await withProject(key, () =>
    productionProposal(new mongoose.Types.ObjectId(), {
      scope: 'asset',
      recordId: String(asset._id),
      title: 'Brief correction',
      explanation: 'Correction for review',
      brief: 'Revised draft',
      production: saved.production
    })
  );
  await StudioAsset.updateOne(
    { _id: asset._id },
    { $set: { brief: 'Newer owner-written brief' }, $inc: { revision: 1 } }
  );
  const conflict = await request(app)
    .post(base + '/assistant/proposals/' + revision._id + '/apply')
    .set(headers)
    .send({})
    .expect(409);
  assert.match(conflict.body.message, /Creative brief has newer edits/);
});

test('creating an empty character queues one restricted Creative brief draft without media generation', async () => {
  const ready = { ready: async () => ({ profileId: 'test-profile', model: 'test-model' }) };
  const automation = createWorkflowAutomation(production, { queueStory: createStoryQueue(ready) });
  app.locals.assistant.automation = automation;
  const created = await request(app)
    .post(base + '/assets')
    .set(headers)
    .send({
      name: 'New acolyte',
      kind: 'character',
      brief: '',
      production: { sourceMode: 'original', sourceNotes: 'Adult woman, red hair, ochre tunic.' }
    })
    .expect(201);
  const target = at('asset', created.body.asset._id);
  assert.equal(await StudioAutomation.countDocuments({ status: 'queued' }), 1);
  // Simulate a missed creation event and verify periodic recovery is idempotent.
  await StudioAutomation.deleteMany({});
  await automation.reconcileProduction();
  await automation.reconcileProduction();
  assert.equal(await StudioAutomation.countDocuments({ status: 'queued' }), 1);
  await automation.processNext();
  const run = await Run.findOne().lean();
  assert.equal(run.workflowDraft.kind, 'story-asset-brief');
  assert.equal((await Chat.findById(run.chatId).lean()).context.assetId, target.recordId);
  let replies = 0;
  const chatgpt = {
    ...ready,
    respond: async ({ tools }) => {
      assert.ok(tools.some((t) => t.name === 'propose_production_plan'));
      assert.ok(!tools.some((t) => ['create_asset_draft', 'request_render'].includes(t.name)));
      if (++replies === 1)
        return {
          output: [
            {
              type: 'function_call',
              name: 'propose_production_plan',
              call_id: 'brief',
              arguments: JSON.stringify({
                scope: 'asset',
                recordId: target.recordId,
                title: 'Acolyte Creative brief',
                explanation: 'Source-grounded brief',
                brief:
                  'Adult woman with red hair and an ochre tunic. Rear costume remains unverified.',
                production: { sourceNotes: 'Must not overwrite saved research.', items: [] }
              })
            }
          ]
        };
      return {
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Creative brief draft ready for review.' }]
          }
        ]
      };
    }
  };
  await createChatEngine({ chatgpt, production, mediaDirectory: directory }).run(run);
  assert.equal((await Run.findById(run._id).lean()).status, 'completed');
  const proposal = await Proposal.findOne({ assetId: target.recordId }).lean();
  assert.match(proposal.brief, /Adult woman/);
  assert.equal(proposal.production.sourceNotes, 'Adult woman, red hair, ochre tunic.');
  assert.equal(proposal.production.items.length, created.body.asset.production.items.length);
  assert.equal((await StudioAsset.findById(target.recordId).lean()).brief, '');
  const progress = await withProject(key, () => automation.progress(target));
  assert.equal(progress.proposalId, String(proposal._id));
  const overview = await request(app).get(base).set(headers).expect(200);
  assert.ok(
    overview.body.workflowReviews.some(
      (row) =>
        row.key === 'proposal-' + proposal._id &&
        row.target.scope === 'asset' &&
        row.target.recordId === target.recordId
    )
  );
  assert.equal((await withProject(key, () => automation.plan(target))).length, 0);
  assert.equal(await Job.countDocuments(), 0);
  assert.equal(await StudioAsset.countDocuments({ name: 'New acolyte' }), 1);
});

test('applying an image instruction revision requires its own approval before one replacement queues', async () => {
  await withProject(key, async () => {
    const target = at('asset', asset._id);
    for (const stage of ['source', 'brief']) {
      const ctx = await workflowContext(),
        row = ctx.evaluate(target, stage);
      await request(app)
        .post(base + '/workflow/review')
        .set(headers)
        .send({
          target,
          stage,
          action: 'approve',
          fingerprint: row.fingerprint,
          parentRevision: row.parentRevision,
          reviewRevision: row.reviewRevision
        })
        .expect(200);
    }
    await StudioAutomation.deleteMany({});
    const record = await StudioAsset.findById(asset._id).lean();
    const proposal = await productionProposal(new mongoose.Types.ObjectId(), {
      scope: 'asset',
      recordId: String(asset._id),
      title: 'Profile realism revision',
      explanation: 'Preserve identity, correct realism.',
      production: {
        ...record.production,
        items: record.production.items.map((i) => ({
          ...i,
          imagePrompt:
            'Star Wars universe, Old Republic era. One photographic profile with real skin and practical costume.'
        }))
      }
    });
    const applied = await request(app)
      .post(base + '/assistant/proposals/' + proposal._id + '/apply')
      .set(headers)
      .send({})
      .expect(200);
    assert.equal(applied.body.nextReview.stage, 'reference-plan:profile');
    const row = (await workflowContext()).evaluate(target, 'reference-plan:profile');
    assert.equal(row.canApprove, true);
    assert.equal((await workflowContext()).evaluate(target, 'reference:profile').canApprove, false);
    assert.deepEqual(await app.locals.assistant.automation.plan(target), []);
    await assert.rejects(
      () =>
        production.queue({
          kind: 'image',
          requestId: 'unapproved-revision',
          target: { assetId: String(asset._id), packageItemId: 'profile' }
        }),
      /revision directions needs approval/
    );
    assert.equal(await Job.countDocuments(), 0);
    const board = await request(app)
      .post(base + '/workflow/board')
      .set(headers)
      .send({ target })
      .expect(200);
    assert.ok(
      board.body.groups
        .flatMap((g) => g.stages)
        .some((r) => r.stage === 'reference-plan:profile' && r.canApprove)
    );
    await request(app)
      .post(base + '/workflow/review')
      .set(headers)
      .send({
        target,
        stage: row.stage,
        action: 'approve',
        fingerprint: row.fingerprint,
        parentRevision: row.parentRevision,
        reviewRevision: row.reviewRevision
      })
      .expect(200);
    await app.locals.assistant.automation.processNext();
    assert.equal(await Job.countDocuments({ 'target.assetId': String(asset._id) }), 1);
    await app.locals.assistant.automation.processNext();
    assert.equal(await Job.countDocuments({ 'target.assetId': String(asset._id) }), 1);
    assert.equal(calls.length, 0);
  });
});

test('revised image prompt review takes priority over an earlier confirmed provider failure', async () => {
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  await StudioAsset.updateOne(
    { _id: asset._id },
    {
      $set: {
        'production.items.0.requiresPlanApproval': true,
        'production.items.0.imagePrompt': 'One photographic profile on a gray background.'
      }
    }
  );
  await withProject(key, () =>
    Job.create({
      requestId: 'earlier-provider-failure',
      kind: 'image',
      status: 'failed',
      historyId: 'confirmed-failed',
      target: { assetId: String(asset._id), packageItemId: 'profile' },
      error: 'Provider rejected this generation.'
    })
  );
  const progress = await withProject(key, () =>
    app.locals.assistant.automation.progress(assetTarget())
  );
  assert.equal(progress.state, 'review');
  assert.equal(progress.review.stage, 'reference-plan:profile');
  assert.equal(await Job.countDocuments(), 1);
});

test('an incomplete asset reports its actual preparation blocker and links the source review', async () => {
  await withProject(key, async () => {
    await StudioAsset.updateOne(
      { _id: asset._id },
      {
        $set: {
          'production.sourceNotes': '',
          'production.sourceUrl': '',
          'production.sourceMediaIds': [],
          'production.sourceMode': 'footage'
        }
      }
    );
    const target = at('asset', asset._id),
      automation = createWorkflowAutomation(production);
    assert.deepEqual(await automation.plan(target), []);
    const progress = await automation.progress(target);
    assert.equal(progress.state, 'blocked');
    assert.equal(progress.review.stage, 'source');
    assert.match(progress.message, /Preparation needed: Source evidence/);
    assert.match(progress.message, /Describe the source evidence/);
    assert.match(progress.message, /Attach source frames or a source URL/);
    assert.equal(await Job.countDocuments(), 0);
  });
});

test('37-second music brief requests 42 seconds with continuous edges and no copied melody', () => {
  const prompt = musicPrompt({
    clips: [12, 7, 10, 4, 4].map((duration, i) => ({ duration, title: 'Shot ' + (i + 1) }))
  });
  assert.match(prompt, /exactly 42 seconds/);
  assert.match(prompt, /0\.0 seconds/);
  assert.match(prompt, /through 42 seconds/);
  assert.match(prompt, /No early stop/);
  assert.ok(prompt.length <= 4100);
  assert.ok(
    musicPrompt({
      title: 'A longer scene',
      clips: Array.from({ length: 100 }, (_, i) => ({ title: 'Shot ' + i, duration: 2 }))
    }).length <= 4100
  );
  assert.deepEqual(
    audibleWindow('silence_start: 0\nsilence_end: 2\nsilence_start: 39\nsilence_end: 42', 42),
    { leadingSeconds: 2, trailingSeconds: 3, audibleSeconds: 37 }
  );
  assert.equal(audibleWindow('silence_start: 0', 42).audibleSeconds, 0);
});
test('crawl omission preserves arrival, trial research, scene timings and approved file choices', () => {
  const input = {
    sourceReferences: [
      { id: 'opening-crawl' },
      { id: 'arrival-korriban' },
      { id: 'initial-trials' }
    ],
    notes: 'Begin with the Sith Inquisitor opening crawl assembled in CapCut.',
    production: {
      sourceNotes:
        '14:00–15:31: opening crawl.\n15:31–16:47: Arrival\ncrawl -> Arrival at Korriban',
      outline:
        'Separate CapCut crawl -> Arrival at Korriban\nINTRO — OPENING CRAWL\nSource 14:00–15:31.\n\n1 — ARRIVAL AT KORRIBAN\nKeep this.'
    },
    scenes: [{ id: 'scene', clips: [{ selectedTakeId: 'same', duration: 37 }] }]
  };
  const next = omitOpeningCrawl(input);
  assert.deepEqual(next.scenes, input.scenes);
  assert.equal(next.sourceReferences.length, 2);
  assert.ok(!next.production.outline.includes('INTRO — OPENING CRAWL'));
  assert.ok(next.production.outline.includes('1 — ARRIVAL'));
  assert.ok(next.production.sourceNotes.includes('15:31–16:47: Arrival'));
  assert.equal(input.sourceReferences.length, 3);
});

test('music approval queues one instrumental audition, trims silence locally and preserves video approvals', async () => {
  await prepare();
  await StudioProject.updateOne({ key }, { $set: { musicWorkflowEnabled: true } });
  await StudioMedia.updateOne(
    { _id: video._id },
    {
      $set: {
        nativeAudio: {
          policy: nativeAudioPolicy,
          episodeId: String(episode._id),
          sceneId: 'scene',
          clipId: 'shot'
        }
      }
    }
  );
  const row = await state(clipTarget(), 'visual');
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...row, action: 'approve', takeId: String(video._id) })
    .expect(200);
  const original = await StudioEpisode.findById(episode._id).lean();
  assert.equal((await StudioMusicCue.findOne({ episodeId: episode._id }).lean())?.enabled, true);
  const filename = join(directory, 'music-test.mp3');
  await promisify(execFile)(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:duration=4',
      '-af',
      'adelay=1000:all=1,apad=pad_dur=2',
      '-c:a',
      'libmp3lame',
      filename
    ],
    { windowsHide: true }
  );
  const bytes = await readFile(filename),
    requests = [];
  const oldKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'fake-music-test-key';
  try {
    const music = createMusicProduction({
      mediaDirectory: directory,
      fetcher: async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return new Response(bytes, {
          headers: { 'song-id': 'fake-song', 'character-cost': '105' }
        });
      }
    });
    app.locals.assistant.automation = createWorkflowAutomation({ ...production, music });
    await withProject(key, async () => {
      await music.plan({ episodeId: String(episode._id), sceneId: 'scene', cueRevision: 0 });
      await assert.rejects(
        () =>
          music.queue({
            episodeId: String(episode._id),
            sceneId: 'scene',
            requestId: 'before-approval'
          }),
        /approval|Approve/
      );
    });
    assert.equal(requests.length, 0);
    const approved = await review(sceneTarget(), 'music-plan');
    assert.equal(approved.status, 200, approved.body.message);
    while (await StudioAutomation.exists({ status: 'queued' }))
      await app.locals.assistant.automation.processNext();
    assert.equal(await Job.countDocuments({ kind: 'music' }), 1);
    const job = await Job.findOne({ kind: 'music' }).lean();
    assert.equal(job.quote.outputs, 1);
    await withProject(key, () => music.processJob(job));
    const done = await Job.findById(job._id).lean();
    assert.equal(done.status, 'ready', done.error);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.music_length_ms, 7000);
    assert.equal(requests[0].body.force_instrumental, true);
    assert.equal(requests[0].body.model_id, 'music_v2_5');
    let cue = await StudioMusicCue.findOne({ episodeId: episode._id }).lean();
    const option = cue.candidates[0];
    assert.equal(option.qc.passed, true);
    assert.ok(option.qc.leadingSeconds > 0.9);
    assert.ok(option.qc.trailingSeconds > 1.9);
    assert.equal(option.qc.preparedSeconds, 2);
    assert.notEqual(option.mediaIds[0], option.sourceMediaId);
    const musicReview = await state(sceneTarget(), 'music');
    await request(app)
      .post(base + '/workflow/review')
      .set(headers)
      .send({ ...musicReview, action: 'approve', musicMediaId: option.mediaIds[0] })
      .expect(200);
    assert.equal((await state(sceneTarget(), 'music')).status, 'approved');
    await StudioEpisode.updateOne(
      { _id: episode._id },
      {
        $set: { 'production.outline': 'An unrelated episode outline update.' },
        $inc: { revision: 1 }
      }
    );
    assert.equal((await state(sceneTarget(), 'music-plan')).status, 'approved');
    assert.equal((await state(sceneTarget(), 'music')).status, 'approved');
    await StudioEpisode.updateOne(
      { _id: episode._id },
      { $set: { production: original.production } }
    );
    const recoveryData = {
      assets: await StudioAsset.find().lean(),
      episodes: await StudioEpisode.find().lean(),
      media: await StudioMedia.find().lean(),
      musicCues: await StudioMusicCue.find().lean(),
      reviews: (await StudioReview.find().lean()).map((row) =>
        row.stage.startsWith('music')
          ? { ...row, approvalFingerprint: null, fingerprint: 'legacy-workflow-fingerprint' }
          : row
      )
    };
    assert.equal(
      sceneApprovalBindings(recoveryData).bindings.filter((row) => row.stage.startsWith('music'))
        .length,
      2
    );
    const changedMusic = {
      ...recoveryData,
      musicCues: recoveryData.musicCues.map((cue) => ({ ...cue, prompt: 'A changed music brief.' }))
    };
    assert.equal(
      sceneApprovalBindings(changedMusic).bindings.filter((row) => row.stage.startsWith('music'))
        .length,
      0
    );
    assert.equal((await state(clipTarget(), 'visual')).status, 'approved');
    assert.deepEqual((await StudioEpisode.findById(episode._id).lean()).scenes, original.scenes);
    await withProject(key, async () => {
      await music.queue({
        episodeId: String(episode._id),
        sceneId: 'scene',
        requestId: job.requestId
      });
      assert.equal(requests.length, 1);
      cue = await StudioMusicCue.findById(cue._id).lean();
      await music.reject({
        episodeId: String(episode._id),
        sceneId: 'scene',
        cueRevision: cue.revision,
        candidateId: option.id
      });
    });
    assert.equal(
      await StudioMedia.countDocuments({
        _id: { $in: [...option.mediaIds, option.sourceMediaId] }
      }),
      0
    );
    assert.equal((await StudioMusicCue.findById(cue._id).lean()).candidates.length, 0);
    assert.equal((await state(clipTarget(), 'visual')).status, 'approved');
    await withProject(key, async () => {
      let deniedCalls = 0;
      const denied = createMusicProduction({
        mediaDirectory: directory,
        fetcher: async () => {
          deniedCalls++;
          return new Response('{}', { status: 403 });
        }
      });
      const failed = await denied.queue({
        episodeId: String(episode._id),
        sceneId: 'scene',
        requestId: 'manual-music-denied'
      });
      await denied.processJob(failed.job);
      assert.equal((await Job.findById(failed.job._id).lean()).status, 'failed');
      assert.equal(deniedCalls, 1);
      assert.deepEqual(
        (await app.locals.assistant.automation.plan(sceneTarget())).filter(
          (j) => j.kind === 'music'
        ),
        []
      );
      assert.deepEqual(
        (await app.locals.assistant.automation.plan(sceneTarget(), { retryFailed: true })).filter(
          (j) => j.kind === 'music'
        ),
        []
      );
      let uncertainCalls = 0;
      const unknown = createMusicProduction({
        mediaDirectory: directory,
        fetcher: async () => {
          uncertainCalls++;
          throw new Error('Network disconnected');
        }
      });
      const pending = await unknown.queue({
        episodeId: String(episode._id),
        sceneId: 'scene',
        requestId: 'manual-music-unknown'
      });
      await assert.rejects(
        () =>
          unknown.plan({
            episodeId: String(episode._id),
            sceneId: 'scene',
            cueRevision: cue.revision,
            prompt: 'Different prompt'
          }),
        /active music job/
      );
      await unknown.processJob(pending.job);
      const uncertain = await Job.findById(pending.job._id).lean();
      assert.equal(uncertain.status, 'uncertain');
      await unknown.processJob(uncertain);
      assert.equal(uncertainCalls, 1);
      await assert.rejects(
        () =>
          unknown.queue({
            episodeId: String(episode._id),
            sceneId: 'scene',
            requestId: 'no-paid-retry'
          }),
        /active or uncertain/
      );
    });
  } finally {
    if (oldKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = oldKey;
  }
});
const assetTarget = () => at('asset', asset._id),
  episodeTarget = () => at('episode', episode._id),
  sceneTarget = () => at('scene', episode._id, 'scene'),
  clipTarget = () => at('clip', episode._id, 'scene', 'shot');
async function state(target, stage) {
  return withProject(key, async () => (await workflowContext()).evaluate(target, stage));
}
async function review(target, stage, action = 'approve', feedback = '') {
  const row = await state(target, stage);
  return request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...row, target, stage, action, feedback });
}
async function prepare() {
  for (const stage of ['source', 'brief', 'reference:profile'])
    assert.equal((await review(assetTarget(), stage)).status, 200);
  for (const stage of ['source', 'outline'])
    assert.equal((await review(episodeTarget(), stage)).status, 200);
  for (const stage of ['script', 'shot-plan', 'storyboard', 'animatic', 'sound-plan'])
    assert.equal((await review(sceneTarget(), stage)).status, 200);
}
test('manual generation is the default: approvals and recovery never create media jobs', async () => {
  const manual = createManualAutomation(production);
  app.locals.assistant.automation = manual;
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { 'scenes.0.clips.0.takeIds': [] } });
  await prepare();
  for (const target of [assetTarget(), episodeTarget(), sceneTarget(), clipTarget()]) {
    const steps = await withProject(key, () => manual.plan(target));
    assert.ok(steps.every((step) => step.kind.startsWith('story-')));
  }
  await manual.reconcileProduction();
  while (await StudioAutomation.exists({ status: 'queued' })) await manual.processNext();
  assert.equal(await Job.countDocuments(), 0);
  assert.deepEqual(calls, []);
});
test('dialogue generation starts only from its explicit button with the exact saved text', async () => {
  const oldKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'test-only';
  try {
    const voice = await withProject(key, () =>
      StudioAsset.create({
        name: 'Harkun voice',
        aliases: ['HARKUN'],
        kind: 'voice',
        scope: 'reusable',
        finalChoice: {
          id: 'voice',
          voiceId: 'approved-voice',
          voiceModel: 'eleven_v3',
          mediaIds: [audio._id]
        }
      })
    );
    await StudioEpisode.updateOne(
      { _id: episode._id },
      {
        $push: { 'scenes.0.assetIds': voice._id },
        $set: {
          'scenes.0.clips.0.dialogue': 'HARKUN: Hello.',
          'scenes.0.clips.0.production.mode': 'voice-reference',
          'scenes.0.clips.0.selectedDialogueId': String(audio._id)
        }
      }
    );
    app.locals.assistant.automation = createManualAutomation(production);
    await prepare();
    await StudioEpisode.updateOne(
      { _id: episode._id },
      {
        $set: {
          'scenes.0.clips.0.selectedDialogueId': null,
          'scenes.0.clips.0.dialogueTakeIds': []
        }
      }
    );
    const parent = await StudioEpisode.findById(episode._id).lean();
    const body = {
      target: clipTarget(),
      parentRevision: parent.revision,
      dialogue: 'HARKUN: Hello.',
      requestId: 'manual-dialogue-button'
    };
    assert.equal(await Job.countDocuments(), 0);
    await request(app)
      .post(base + '/workflow/shot/dialogue/generate')
      .set(headers)
      .send({ ...body, dialogue: 'Unsaved words' })
      .expect(409);
    await request(app)
      .post(base + '/workflow/shot/dialogue/generate')
      .set(headers)
      .send(body)
      .expect(202);
    await request(app)
      .post(base + '/workflow/shot/dialogue/generate')
      .set(headers)
      .send(body)
      .expect(202);
    assert.equal(await Job.countDocuments({ kind: 'dialogue' }), 1);
    assert.equal(await Job.countDocuments({ kind: { $in: ['image', 'video', 'music'] } }), 0);
    assert.deepEqual(calls, []);
  } finally {
    if (oldKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = oldKey;
  }
});
test('obsolete video hold data cannot block approved video requests or reopen reviews', async () => {
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { 'scenes.0.clips.0.takeIds': [] } });
  await prepare();
  const target = { episodeId: String(episode._id), sceneId: 'scene', clipId: 'shot' };
  const job = await withProject(key, () =>
    production.queue({ kind: 'video', target, requestId: 'before-hold' })
  );
  const before = await state(clipTarget(), 'animatic');
  await StudioEpisode.collection.updateOne(
    { _id: episode._id },
    {
      $set: {
        videoGenerationHold: {
          active: true,
          reason: 'Video generation is on hold during correction.'
        }
      }
    }
  );
  const next = await withProject(key, () =>
    production.queue({ kind: 'video', target, requestId: 'obsolete-hold-ignored' })
  );
  assert.equal(next.status, 'queued');
  assert.doesNotMatch(
    (await withProject(key, () => app.locals.assistant.automation.progress(episodeTarget())))
      .message,
    /on hold/
  );
  await production.processJob(job);
  assert.equal((await Job.findById(job._id).lean()).status, 'rendering');
  assert.equal((await state(clipTarget(), 'animatic')).fingerprint, before.fingerprint);
});

test('outline-only changes retain unchanged scene approvals while new production waits for the updated outline', async () => {
  await prepare();
  await review(clipTarget(), 'animatic', 'request-changes', 'Split or retime this shot.');
  const stages = ['script', 'shot-plan', 'sound-plan', 'storyboard', 'animatic'];
  const before = Object.fromEntries(
    await Promise.all(stages.map(async (stage) => [stage, await state(sceneTarget(), stage)]))
  );
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'production.outline': 'The character arrives; later trials remain to be planned.' } }
  );
  assert.equal((await state(episodeTarget(), 'outline')).status, 'needs-review');
  assert.equal((await state(clipTarget(), 'animatic')).status, 'needs-changes');
  assert.equal((await state(clipTarget(), 'animatic')).feedbackIsCurrent, true);
  for (const stage of stages) {
    const row = await state(sceneTarget(), stage);
    assert.equal(row.status, 'approved', stage);
    assert.equal(row.approvalFingerprint, before[stage].approvalFingerprint, stage);
  }
  await withProject(key, async () => {
    assert.deepEqual(await app.locals.assistant.automation.plan(sceneTarget()), []);
    await assert.rejects(
      () =>
        production.queue({
          kind: 'image',
          requestId: 'outline-pause',
          target: { episodeId: String(episode._id), sceneId: 'scene', clipId: 'shot' }
        }),
      /outline needs approval/i
    );
  });
  assert.equal((await review(episodeTarget(), 'outline')).status, 200);
  for (const stage of stages)
    assert.equal((await state(sceneTarget(), stage)).status, 'approved', stage);
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.script': 'A changed story event at the door.' } }
  );
  assert.equal((await state(sceneTarget(), 'script')).status, 'needs-review');
  assert.equal((await state(sceneTarget(), 'shot-plan')).status, 'needs-review');
  assert.deepEqual(calls, []);
});

test('scene source bindings ignore unrelated chapters but reopen the affected scene when its source changes', async () => {
  const source = {
    id: 'chapter',
    title: 'Arrival footage',
    url: 'https://youtu.be/abcdefghijk',
    chapter: 'Arrival',
    startSeconds: 10,
    endSeconds: 20,
    notes: 'Recorded arrival.',
    status: 'verified'
  };
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { sourceReferences: [source], 'scenes.0.sourceReferenceIds': ['chapter'] } }
  );
  await prepare();
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $push: {
        sourceReferences: {
          ...source,
          id: 'later',
          chapter: 'Later chapter',
          startSeconds: 30,
          endSeconds: 40
        }
      }
    }
  );
  assert.equal((await state(sceneTarget(), 'script')).status, 'approved');
  assert.equal((await state(sceneTarget(), 'shot-plan')).status, 'approved');
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'sourceReferences.0.notes': 'The recorded arrival evidence was corrected.' } }
  );
  assert.equal((await state(sceneTarget(), 'script')).status, 'needs-review');
  assert.equal((await state(sceneTarget(), 'shot-plan')).status, 'needs-review');
});

test('historical scene approval bindings require the exact owner-approved fingerprint', async () => {
  await prepare();
  await StudioReview.updateMany(
    { 'target.scope': 'scene' },
    { $unset: { approvalFingerprint: '' } }
  );
  const snapshot = await StudioEpisode.findById(episode._id).lean();
  delete snapshot.history;
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: { 'production.outline': 'An outline-only edit.' },
      $push: { history: { ...snapshot, savedAt: new Date() } }
    }
  );
  await withProject(key, async () => {
    const [assets, episodes, media, reviews] = await Promise.all([
      StudioAsset.find().lean(),
      StudioEpisode.find().lean(),
      StudioMedia.find().lean(),
      StudioReview.find().lean()
    ]);
    const data = { assets, episodes, media, reviews };
    const plan = sceneApprovalBindings(data);
    assert.equal(plan.bindings.length, 5);
    assert.equal(plan.skipped.length, 0);
    const bound = evaluateWorkflow({
      ...data,
      reviews: reviews.map((r) => ({
        ...r,
        approvalFingerprint:
          plan.bindings.find((b) => b.id === String(r._id))?.approvalFingerprint ??
          r.approvalFingerprint
      }))
    });
    for (const stage of ['script', 'shot-plan', 'sound-plan', 'storyboard', 'animatic'])
      assert.equal(bound.evaluate(sceneTarget(), stage).status, 'approved', stage);
    const script = reviews.find((r) => r.stage === 'script');
    script.fingerprint = 'not-the-approved-historical-inputs';
    assert.ok(sceneApprovalBindings(data).skipped.some((row) => row.id === String(script._id)));
    script.state = 'changes-requested';
    assert.ok(!sceneApprovalBindings(data).bindings.some((row) => row.id === String(script._id)));
  });
});

test('clip-scoped chat cannot store a timing revision as an episode outline', async () => {
  await withProject(key, async () => {
    const chat = await Chat.create({
      title: 'Requested timing changes',
      context: { episodeId: String(episode._id), sceneId: 'scene', clipId: 'shot' }
    });
    await assert.rejects(
      () =>
        productionProposal(chat._id, {
          scope: 'episode',
          recordId: String(episode._id),
          title: 'Timing-only revision plan',
          explanation: 'Preserve the outline; retime this shot.',
          production: { outline: 'TARGETED TIMING PLAN — split this clip.' }
        }),
      /conversation targets one clip/
    );
    assert.equal(await Proposal.countDocuments(), 0);
    const context = await studioContext(chat.context);
    assert.equal(context.selectedScene.id, 'scene');
    assert.equal(context.selectedClip.id, 'shot');
    const serialized = JSON.stringify(context);
    assert.ok(serialized.indexOf('selectedClip') < serialized.indexOf('sourceEvidence'));
    assert.equal(
      (await StudioEpisode.findById(episode._id).lean()).production.outline,
      episode.production.outline
    );
  });
});

test('gates block production before provider calls, and CAS rejects stale or foreign reviews', async () => {
  await withProject(key, async () => {
    await assert.rejects(
      () =>
        production.queue({
          requestId: 'blocked',
          kind: 'image',
          target: { assetId: String(asset._id) },
          instructions: ''
        }),
      /approval/
    );
    await assert.rejects(
      () =>
        production.queue({
          requestId: 'blocked-shot',
          kind: 'image',
          target: { episodeId: String(episode._id), sceneId: 'scene', clipId: 'shot' }
        }),
      /approval/
    );
  });
  assert.deepEqual(calls, []);
  const row = await state(assetTarget(), 'source');
  assert.equal((await review(assetTarget(), 'source')).status, 200);
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...row, action: 'approve' })
    .expect(409);
  await request(app)
    .post(base + '/workflow/board')
    .send({ target: assetTarget() })
    .expect(404);
  await request(app)
    .post(base + '/episodes/' + episode._id + '/scenes/scene/approve')
    .set(headers)
    .send({ revision: 0 })
    .expect(409);
});

test('source approval, requested changes and unapproval invalidate dependent work without changing choices', async () => {
  await prepare();
  const oldChoice = asset.finalChoice;
  assert.equal((await state(sceneTarget(), 'animatic')).status, 'approved');
  assert.equal(
    (await review(assetTarget(), 'source', 'request-changes', 'Check the sleeve length.')).status,
    200
  );
  assert.equal((await state(assetTarget(), 'source')).status, 'needs-changes');
  assert.equal((await state(sceneTarget(), 'animatic')).status, 'needs-review');
  assert.equal((await review(assetTarget(), 'source')).status, 200);
  assert.equal((await state(assetTarget(), 'brief')).status, 'needs-review');
  await withProject(key, async () =>
    assert.deepEqual((await StudioAsset.findById(asset._id).lean()).finalChoice, oldChoice)
  );
  assert.equal((await review(assetTarget(), 'source', 'unapprove')).status, 200);
  await withProject(key, () =>
    assert.rejects(() => requireWorkflow(sceneTarget(), 'animatic'), /approval/)
  );
});

test('change request receipts persist exact feedback and timestamp without claiming automatic revision work', async () => {
  await prepare();
  const count = await StudioAutomation.countDocuments();
  const feedback = 'We only need maybe 7 seconds of the canyon flight';
  const result = await review(clipTarget(), 'animatic', 'request-changes', feedback);
  assert.equal(result.status, 200);
  assert.equal(result.body.automation, null);
  assert.equal(result.body.receipt.feedback, feedback);
  assert.match(result.body.receipt.message, /No automatic revision or render/);
  assert.ok(Number.isFinite(Date.parse(result.body.receipt.savedAt)));
  const reloaded = await state(clipTarget(), 'animatic');
  assert.equal(reloaded.lastAction, 'request-changes');
  assert.equal(reloaded.feedbackIsCurrent, true);
  assert.equal(new Date(reloaded.savedAt).toISOString(), result.body.receipt.savedAt);
  assert.equal(reloaded.feedback, feedback);
  assert.equal(reloaded.status, 'needs-changes');
  assert.equal(await StudioAutomation.countDocuments(), count);
  assert.equal(await Job.countDocuments(), 0);
  assert.equal(await Run.countDocuments(), 0);
});

test('changed source evidence reopens reviews; result selections do not invalidate a shot plan', async () => {
  await prepare();
  await withProject(key, () =>
    StudioEpisode.updateOne(
      { _id: episode._id },
      {
        $set: { 'scenes.0.clips.0.production.visualTakeId': String(video._id) },
        $inc: { revision: 1 }
      }
    )
  );
  assert.equal((await state(sceneTarget(), 'shot-plan')).status, 'approved');
  assert.equal((await state(sceneTarget(), 'animatic')).status, 'approved');
  await withProject(key, () =>
    StudioAsset.updateOne(
      { _id: asset._id },
      { $set: { 'production.sourceNotes': 'Updated source observation.' }, $inc: { revision: 1 } }
    )
  );
  assert.equal((await state(assetTarget(), 'source')).status, 'needs-review');
  assert.equal((await state(sceneTarget(), 'storyboard')).status, 'needs-review');
});

test('dialogue planning requires voice-reference mode and the animatic rejects audio longer than the shot', async () => {
  await prepare();
  await withProject(key, () =>
    StudioEpisode.updateOne(
      { _id: episode._id },
      {
        $set: {
          'scenes.0.clips.0.dialogue': 'ROXY: Hello.',
          'scenes.0.clips.0.selectedDialogueId': audio._id,
          'scenes.0.clips.0.duration': 1
        },
        $inc: { revision: 1 }
      }
    )
  );
  assert.equal((await state(sceneTarget(), 'shot-plan')).canApprove, false);
  await withProject(key, () =>
    StudioEpisode.updateOne(
      { _id: episode._id },
      { $set: { 'scenes.0.clips.0.production.mode': 'voice-reference' }, $inc: { revision: 1 } }
    )
  );
  for (const stage of ['script', 'shot-plan', 'storyboard'])
    assert.equal((await review(sceneTarget(), stage)).status, 200);
  const tooLong = await review(sceneTarget(), 'animatic');
  assert.equal(tooLong.status, 200);
  assert.equal(tooLong.body.approved, false);
  assert.ok(tooLong.body.timingRepair);
  assert.match(tooLong.body.message, /exceeds its shot duration/);
  const timingDraft = await Proposal.findById(tooLong.body.timingRepair).lean();
  assert.equal(timingDraft.scene.clips[0].duration, 2);
  assert.equal((await StudioEpisode.findById(episode._id).lean()).scenes[0].clips[0].duration, 1);
  await Proposal.updateOne({ _id: timingDraft._id }, { $set: { status: 'dismissed' } });
  await withProject(key, () =>
    StudioEpisode.updateOne(
      { _id: episode._id },
      { $set: { 'scenes.0.clips.0.duration': 3 }, $inc: { revision: 1 } }
    )
  );
  for (const stage of ['shot-plan', 'storyboard', 'animatic'])
    assert.equal((await review(sceneTarget(), stage)).status, 200);
});

test('18-second selected dialogue automatically creates a repeatable split draft and applying it preserves unrelated work', async () => {
  await promisify(execFile)(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=200:duration=18.88',
      join(directory, 'long-dialogue.wav')
    ],
    { windowsHide: true }
  );
  const long = await withProject(key, async () =>
    saveGeneratedMedia(
      directory,
      await readFile(join(directory, 'long-dialogue.wav')),
      'long-dialogue.wav'
    )
  );
  const dialogue =
    "HARKUN: Lord Zash has tasked me with sorting through you refuse to find one worthy of being her apprentice, and I intend to do just that.\nROXY: Don't get all sentimental on us. We've only just met.\nHARKUN: I won't.\nHARKUN: Now, the rest of you gutter trash already know your trial. Get going while I bring our latecomer up to speed.";
  const original = await StudioEpisode.findById(episode._id).lean();
  const clip = {
    ...original.scenes[0].clips[0],
    duration: 24,
    dialogue,
    dialogueTakeIds: [long._id],
    selectedDialogueId: long._id,
    takeIds: [],
    selectedTakeId: null,
    production: {
      ...original.scenes[0].clips[0].production,
      mode: 'voice-reference',
      visualTakeId: null
    }
  };
  const tail = { ...original.scenes[0].clips[0], id: 'unrelated-shot', title: 'Untouched shot' };
  const soundPlan = {
    ...original.scenes[0].soundPlan,
    layers: [clip, tail].map((shot, index) => ({
      ...original.scenes[0].soundPlan.layers[0],
      id: 'room-bed-' + index,
      clipId: shot.id,
      start: 0,
      sourceStart: 0,
      assetId: null,
      loop: true,
      type: 'ambience',
      duration: shot.duration
    }))
  };
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: { 'scenes.0.clips': [clip, tail], 'scenes.0.soundPlan': soundPlan },
      $inc: { revision: 1 }
    }
  );
  const before = await StudioEpisode.findById(episode._id).lean();
  const board = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: episodeTarget() })
    .expect(200);
  const row = board.body.groups
    .flatMap((group) => group.stages)
    .find(
      (row) =>
        row.stage === 'animatic' && row.target.scope === 'clip' && row.target.clipId === clip.id
    );
  assert.equal(row.canApprove, false);
  assert.equal(row.timingIssues[0].audioSeconds, 18.88);
  const automation = createWorkflowAutomation(production, { mediaDirectory: directory });
  await automation.reconcileProduction();
  await automation.reconcileProduction();
  const proposal = await Proposal.findOne({
    episodeId: String(episode._id),
    status: 'pending'
  }).lean();
  assert.ok(proposal.timingRepair);
  assert.equal(await Proposal.countDocuments({ status: 'pending' }), 1);
  const parts = proposal.scene.clips.filter((part) => part.id !== tail.id);
  assert.deepEqual(soundPlanReviewInput(proposal.scene), soundPlanReviewInput(before.scenes[0]));
  assert.ok(parts.length > 1);
  assert.ok(
    parts.every(
      (part) => part.duration <= 30 && !part.selectedDialogueId && part.dialogueTakeIds.length === 0
    )
  );
  const spoken = (text) =>
    text
      .replace(/^[A-Z]+:\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  assert.equal(spoken(parts.map((part) => part.dialogue).join('\n')), spoken(dialogue));
  assert.deepEqual(proposal.scene.clips.at(-1), before.scenes[0].clips.at(-1));
  assert.equal(proposal.scene.script, before.scenes[0].script);
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  const saved = await StudioEpisode.findById(episode._id).lean();
  assert.deepEqual(saved.production, before.production);
  assert.deepEqual(saved.sourceReferences, before.sourceReferences);
  assert.deepEqual(saved.scenes[0].clips.at(-1), before.scenes[0].clips.at(-1));
  assert.ok(
    saved.scenes[0].clips
      .slice(0, -1)
      .every((part) => !part.selectedDialogueId && part.dialogueTakeIds.length === 0)
  );
  assert.equal(await StudioMedia.countDocuments({ _id: long._id }), 1);
  assert.equal(await Job.countDocuments(), 0);
});

test('timing splits preserve speaker order and all words, including a single long sentence', () => {
  const text =
    'AL: ' + Array.from({ length: 90 }, (_, i) => 'word' + i).join(' ') + '.\nROXY: Absolutely.';
  const parts = splitDialogueForTiming(text, 40, 40);
  assert.ok(parts.every((part) => part.duration <= 30));
  const spoken = (value) =>
    value
      .replace(/^[A-Z]+:\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  assert.equal(spoken(parts.map((part) => part.dialogue).join('\n')), spoken(text));
  assert.ok(parts[0].dialogue.startsWith('AL: '));
  assert.ok(parts.at(-1).dialogue.includes('ROXY: Absolutely.'));
  assert.equal(animaticTimingIssue({ dialogue: 'ROXY: Hello.', duration: 15 }, 15), null);
  assert.equal(animaticTimingIssue({ dialogue: 'HARKUN: Begin.', duration: 16 }, 14.72), null);
  assert.equal(animaticTimingIssue({ dialogue: 'HARKUN: Begin.', duration: 24 }, 14.72), null);
  assert.ok(animaticTimingIssue({ dialogue: 'HARKUN: Begin.', duration: 14 }, 14.72));
  assert.ok(animaticTimingIssue({ dialogue: 'ROXY: Hello.', duration: 15 }, 15.001));
});

test('video queuing remeasures dialogue and rejects an oversized file behind an earlier animatic approval', async () => {
  await prepare();
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.clips.0.dialogue': 'ROXY: Hello.',
        'scenes.0.clips.0.duration': 3,
        'scenes.0.clips.0.selectedDialogueId': audio._id,
        'scenes.0.clips.0.production.mode': 'voice-reference'
      }
    }
  );
  for (const stage of ['script', 'shot-plan', 'storyboard', 'animatic', 'sound-plan'])
    assert.equal((await review(sceneTarget(), stage)).status, 200);
  const file = await StudioMedia.findById(audio._id).lean();
  await promisify(execFile)(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=200:duration=18.88',
      join(directory, file.filename)
    ],
    { windowsHide: true }
  );
  assert.equal((await StudioMedia.findById(audio._id).lean()).durationSeconds, 2);
  await assert.rejects(
    () =>
      withProject(key, () =>
        production.queue({
          kind: 'video',
          requestId: 'must-remeasure-dialogue',
          target: { episodeId: String(episode._id), sceneId: 'scene', clipId: 'shot' }
        })
      ),
    /audio asset must be at most 15 seconds/
  );
  assert.equal(await Job.countDocuments(), 0);
  assert.deepEqual(calls, []);
});

test('saving an exact image prompt preserves prior source decisions and requires prompt review', async () => {
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  const before = await StudioAsset.findById(asset._id).lean();
  const prompt =
    'Star Wars universe, Old Republic era. One realistic profile, exact costume, plain gray backdrop.';
  const result = await request(app)
    .put(base + '/assets/' + asset._id)
    .set(headers)
    .send({
      ...JSON.parse(JSON.stringify(before)),
      production: {
        ...before.production,
        items: before.production.items.map((i) => ({ ...i, imagePrompt: prompt }))
      }
    })
    .expect(200);
  assert.equal(result.body.asset.production.items[0].imagePrompt, prompt);
  assert.equal(result.body.asset.production.items[0].requiresPlanApproval, true);
  assert.deepEqual(result.body.asset.finalChoice, JSON.parse(JSON.stringify(before.finalChoice)));
  const ctx = await withProject(key, workflowContext);
  assert.equal(ctx.evaluate(assetTarget(), 'source').status, 'approved');
  assert.equal(ctx.evaluate(assetTarget(), 'brief').status, 'approved');
  assert.equal(ctx.evaluate(assetTarget(), 'reference-plan:profile').canApprove, true);
  assert.equal(await Job.countDocuments(), 0);
});

test('package renders send the exact reviewed prompt and place the approved master before costume evidence', async () => {
  const costume = await withProject(key, () =>
    saveGeneratedMedia(directory, png, 'costume.png', {
      providerReference: { id: 'costume-reference', url: 'https://cdn.openart.ai/costume.png' }
    })
  );
  const exact =
    'Star Wars universe, Old Republic era. One photographic full-body FRONT view. Gray background. No text.';
  await StudioAsset.updateOne(
    { _id: asset._id },
    {
      $set: {
        sheetLayout: 'production-package',
        brief: 'UNFINALIZED production package. Voice auditions. Credits and approval steps.',
        'production.sourceMediaIds': [],
        'production.sourceNotes': 'Recorded source transcript at 17:03; not generation directions.',
        'production.items': [
          {
            id: 'master-portrait',
            title: 'Master portrait',
            type: 'image',
            required: true,
            mediaId: String(image._id),
            notes: 'Approved identity.'
          },
          {
            id: 'costume-reference',
            title: 'Costume reference',
            type: 'image',
            required: true,
            mediaId: String(costume._id),
            notes: 'Exact approved costume.'
          },
          {
            id: 'view-front',
            title: 'Individual front',
            type: 'image',
            required: true,
            mediaId: null,
            notes: 'Internal planning stays here.',
            imagePrompt: exact,
            referenceMediaIds: [String(costume._id)]
          }
        ]
      }
    }
  );
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  await review(assetTarget(), 'reference:master-portrait');
  assert.deepEqual(
    await withProject(key, () => app.locals.assistant.automation.plan(assetTarget())),
    []
  );
  await review(assetTarget(), 'reference:costume-reference');
  const job = await withProject(key, () =>
    production.queue({
      kind: 'image',
      requestId: 'exact-front',
      target: { assetId: String(asset._id), packageItemId: 'view-front' }
    })
  );
  const built = await withProject(key, () => production.build(job));
  assert.ok(built.params.prompt.startsWith(exact));
  assert.match(built.params.prompt, /@image1: Test character.*Master portrait/);
  assert.match(built.params.prompt, /@image2: Test character.*Costume reference/);
  assert.deepEqual(
    built.params.visualReferences.map((r) => r.id),
    ['fake-image', 'costume-reference']
  );
  assert.equal(built.params.resolutionTier, '2k');
  assert.equal(built.params.quality, 'high');
  assert.equal(calls.length, 0);
});

test('queued jobs recheck approvals, package renders produce one unapproved item and use source references', async () => {
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  const job = await withProject(key, () =>
    production.queue({
      requestId: 'package-one',
      kind: 'image',
      target: { assetId: String(asset._id), packageItemId: 'profile' },
      instructions: 'Profile only.'
    })
  );
  const built = await withProject(key, () => production.build(job));
  assert.match(built.params.prompt, /Create Individual profile/);
  assert.equal(built.params.imageCount, 1);
  await review(assetTarget(), 'brief', 'unapprove');
  await production.processJob(job);
  assert.deepEqual(calls, []);
  assert.equal((await Job.findById(job._id).lean()).status, 'failed');
  await review(assetTarget(), 'brief');
  const next = await withProject(key, () =>
    production.queue({
      requestId: 'package-two',
      kind: 'image',
      target: { assetId: String(asset._id), packageItemId: 'profile' }
    })
  );
  await production.processJob(next);
  let rendering = await Job.findById(next._id).lean();
  assert.equal(rendering.status, 'rendering');
  const fakeImport = createProduction({
    mediaDirectory: directory,
    store: { read: async () => ({}) },
    openart: {
      call: async () => ({
        status: 'COMPLETED',
        resources: [{ id: 'result', mediaType: 'image', url: 'https://cdn.openart.ai/result.png' }]
      })
    },
    fetcher: async () => new Response(png)
  });
  await fakeImport.processJob(rendering);
  rendering = await Job.findById(next._id).lean();
  assert.equal(rendering.status, 'ready');
  const updated = await StudioAsset.findById(asset._id).lean();
  assert.notEqual(updated.production.items[0].mediaId, String(image._id));
  assert.equal((await state(assetTarget(), 'reference:profile')).status, 'pending-review');
  assert.deepEqual(updated.finalChoice, asset.finalChoice);
});

test('rejecting a package file removes the file and leaves its required review slot blocked', async () => {
  await prepare();
  // Use a distinct package file so the master reference remains intact.
  const extra = await withProject(key, () => saveGeneratedMedia(directory, png, 'profile.png'));
  await withProject(key, () =>
    StudioAsset.updateOne(
      { _id: asset._id },
      { $set: { 'production.items.0.mediaId': String(extra._id) }, $inc: { revision: 1 } }
    )
  );
  const beforeDelete = await StudioAsset.findById(asset._id).lean();
  await request(app)
    .delete(base + '/media/' + extra._id)
    .set(headers)
    .send({ assetId: String(asset._id), revision: beforeDelete.revision, packageItemId: 'profile' })
    .expect(200);
  const updated = await StudioAsset.findById(asset._id).lean();
  assert.equal(updated.production.items.length, 1);
  assert.equal(updated.production.items[0].required, true);
  assert.equal(updated.production.items[0].mediaId, null);
  assert.equal(await StudioMedia.exists({ _id: extra._id }), null);
  assert.notEqual((await state(sceneTarget(), 'references')).status, 'approved');
});

test('visual review gates sound mixing; real 1440p QC and package approval gate export', async () => {
  await prepare();
  await withProject(key, () =>
    StudioEpisode.updateOne(
      { _id: episode._id },
      {
        $set: { 'scenes.0.clips.0.production.visualTakeId': String(video._id) },
        $inc: { revision: 1 }
      }
    )
  );
  let current = await StudioEpisode.findById(episode._id).lean();
  await withProject(key, () =>
    assert.rejects(
      () => mixState(current, current.scenes[0], current.scenes[0].clips[0], video._id),
      /approval/
    )
  );
  assert.equal((await review(clipTarget(), 'visual')).status, 200);
  const mixedState = await withProject(key, () =>
    mixState(current, current.scenes[0], current.scenes[0].clips[0], video._id)
  );
  const mixed = await withProject(key, async () =>
    saveGeneratedMedia(directory, await readSmall(), 'mixed.mp4')
  );
  await StudioMedia.updateOne(
    { _id: mixed._id },
    {
      $set: {
        soundMix: {
          episodeId: String(episode._id),
          sceneId: 'scene',
          clipId: 'shot',
          sourceTakeId: String(video._id),
          stemMediaId: String(audio._id),
          fingerprint: mixedState.fingerprint
        }
      }
    }
  );
  await withProject(key, () =>
    StudioEpisode.updateOne(
      { _id: episode._id },
      {
        $set: {
          'scenes.0.clips.0.selectedTakeId': mixed._id,
          'scenes.0.clips.0.takeIds': [video._id, mixed._id],
          'scenes.0.clips.0.production.upscaleMediaId': String(video._id),
          'scenes.0.clips.0.production.upscaleSourceTakeId': String(mixed._id)
        },
        $inc: { revision: 1 }
      }
    )
  );
  await request(app)
    .get(base + '/episodes/' + episode._id + '/package')
    .set(headers)
    .expect(409);
  assert.equal((await review(clipTarget(), 'upscale')).status, 400);
  await withProject(key, () =>
    StudioEpisode.updateOne(
      { _id: episode._id },
      {
        $set: { 'scenes.0.clips.0.production.upscaleMediaId': String(upscale._id) },
        $inc: { revision: 1 }
      }
    )
  );
  assert.equal((await review(clipTarget(), 'upscale')).status, 200);
  assert.equal((await review(episodeTarget(), 'export')).status, 200);
  await request(app)
    .get(base + '/episodes/' + episode._id + '/package')
    .set(headers)
    .expect(200)
    .expect('Content-Type', /zip/);
  await review(clipTarget(), 'visual', 'unapprove');
  await request(app)
    .get(base + '/episodes/' + episode._id + '/package')
    .set(headers)
    .expect(409);
});
async function readSmall() {
  return readFile(join(directory, 'small.mp4'));
}

test('image jobs use reviewed source frames and do not pass linked voice audio to the image model', async () => {
  const source = await withProject(key, () =>
    saveGeneratedMedia(directory, png, 'gameplay-frame.png', {
      providerReference: { id: 'fake-source', url: 'https://cdn.openart.ai/source.png' }
    })
  );
  await withProject(key, () =>
    StudioAsset.updateOne(
      { _id: asset._id },
      { $set: { 'production.sourceMediaIds': [String(source._id)] } }
    )
  );
  await prepare();
  const job = await withProject(key, () =>
    production.queue({
      requestId: 'source-evidence',
      kind: 'image',
      target: { assetId: String(asset._id) }
    })
  );
  const built = await withProject(key, () => production.build(job));
  assert.ok(built.params.visualReferences.some((r) => r.id === 'fake-source'));
  assert.match(built.params.prompt, /VISUAL DETAILS: Original design direction for this test/);
  const voice = {
    _id: new mongoose.Types.ObjectId(),
    kind: 'voice',
    name: 'Roxy voice',
    finalChoice: { mediaIds: [audio._id] }
  };
  const scene = { ...episode.scenes[0], assetIds: [asset._id, voice._id] };
  const prompts = clipPrompts(scene, scene.clips[0], [asset, voice]);
  assert.ok(!prompts.referenceMediaIds.includes(String(audio._id)));
});

test('completing a different package item does not cancel queued reference renders', async () => {
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  const job = await withProject(key, () =>
    production.queue({
      requestId: 'sibling-reference',
      kind: 'image',
      target: { assetId: String(asset._id), packageItemId: 'profile' }
    })
  );
  await withProject(key, () =>
    StudioAsset.updateOne(
      { _id: asset._id },
      {
        $push: {
          'production.items': {
            id: 'other',
            type: 'image',
            title: 'Other view',
            required: true,
            mediaId: String(image._id),
            notes: 'Another independent view.'
          }
        },
        $inc: { revision: 1 }
      }
    )
  );
  const request = await withProject(key, () => production.build(job));
  assert.equal(request.params.imageCount, 1);
});

test('brief approval durably queues only missing images, keeps approvals separate and prevents duplicates', async () => {
  await StudioAsset.updateOne(
    { _id: asset._id },
    {
      $set: {
        'production.items.0.mediaId': null,
        finalChoice: null,
        reviewStatus: 'pending-choice'
      }
    }
  );
  await review(assetTarget(), 'source');
  assert.equal(await StudioAutomation.countDocuments(), 0);
  const response = await review(assetTarget(), 'brief');
  assert.equal(response.status, 200);
  assert.equal(response.body.automation.status, 'queued');
  assert.equal(await Job.countDocuments(), 0);
  await app.locals.assistant.automation.processNext();
  const job = await Job.findOne().lean();
  assert.equal(job.status, 'queued');
  assert.equal(job.target.packageItemId, 'profile');
  assert.equal((await state(assetTarget(), 'reference:profile')).status, 'draft');
  const studio = await request(app).get(base).set(headers);
  assert.equal(
    studio.body.assets.find((a) => a._id === String(asset._id)).workflowStatus,
    'development'
  );
  await review(assetTarget(), 'brief');
  await app.locals.assistant.automation.processNext();
  assert.equal(await Job.countDocuments(), 1);
  assert.deepEqual(calls, []);
});

test('a queued next step rechecks approval after unapproval and never calls a provider', async () => {
  await StudioAsset.updateOne({ _id: asset._id }, { $set: { 'production.items.0.mediaId': null } });
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  await review(assetTarget(), 'brief', 'unapprove');
  await app.locals.assistant.automation.processNext();
  assert.equal(await Job.countDocuments(), 0);
  const action = await StudioAutomation.findOne().lean();
  assert.equal(action.status, 'failed');
  assert.match(action.error, /inputs changed/);
  assert.deepEqual(calls, []);
});

test('character brief generates master first and master approval unlocks the remaining views', async () => {
  await StudioAsset.updateOne(
    { _id: asset._id },
    {
      $set: {
        sheetLayout: 'production-package',
        finalChoice: null,
        'production.items': [
          {
            id: 'master-portrait',
            title: 'Master portrait',
            type: 'image',
            required: true,
            mediaId: null,
            notes: 'Portrait only.'
          },
          {
            id: 'view-front',
            title: 'Front view',
            type: 'image',
            required: true,
            mediaId: null,
            notes: 'Full body with head and feet.'
          }
        ]
      }
    }
  );
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  await app.locals.assistant.automation.processNext();
  assert.deepEqual(
    (await Job.find().lean()).map((j) => j.target.packageItemId),
    ['master-portrait']
  );
  await Job.updateMany({}, { $set: { status: 'ready', resultMediaIds: [String(image._id)] } });
  await StudioAsset.updateOne(
    { _id: asset._id },
    { $set: { 'production.items.0.mediaId': String(image._id) } }
  );
  const reviewed = await review(assetTarget(), 'reference:master-portrait');
  assert.equal(reviewed.status, 200);
  await app.locals.assistant.automation.processNext();
  assert.equal(await Job.countDocuments({ 'target.packageItemId': 'view-front' }), 1);
  assert.equal((await state(assetTarget(), 'reference:view-front')).status, 'draft');
});

test('approved non-character reference package finalizes only after each required item is approved', async () => {
  await StudioAsset.updateOne({ _id: asset._id }, { $set: { kind: 'prop', finalChoice: null } });
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  assert.equal((await StudioAsset.findById(asset._id).lean()).finalChoice, null);
  await review(assetTarget(), 'reference:profile');
  const approved = await StudioAsset.findById(asset._id).lean();
  assert.deepEqual(approved.finalChoice.mediaIds, [String(image._id)]);
  assert.match(approved.finalChoice.id, /^package-/);
  await review(assetTarget(), 'reference:profile', 'unapprove');
  assert.equal((await StudioAsset.findById(asset._id).lean()).finalChoice, null);
});

test('next-step connection failures preserve the approval and can be retried without paid retry loops', async () => {
  await StudioAsset.updateOne({ _id: asset._id }, { $set: { 'production.items.0.mediaId': null } });
  let attempts = 0;
  const automation = createWorkflowAutomation({
    queue: async () => {
      ++attempts;
      throw Object.assign(new Error('Connect OpenArt first.'), { status: 400 });
    }
  });
  app.locals.assistant.automation = automation;
  await review(assetTarget(), 'source');
  const response = await review(assetTarget(), 'brief');
  assert.equal(response.status, 200);
  await automation.processNext();
  await automation.processNext();
  assert.equal(attempts, 1);
  assert.equal((await state(assetTarget(), 'brief')).status, 'approved');
  assert.match((await StudioAutomation.findOne().lean()).error, /Connect OpenArt/);
  const retry = await request(app)
    .post(base + '/workflow/advance')
    .set(headers)
    .send({ target: assetTarget(), parentRevision: 0 });
  assert.equal(retry.status, 200);
  await automation.processNext();
  assert.equal(attempts, 2);
});

test('one queue failure records its target and does not prevent other approved requests', async () => {
  await StudioAsset.updateOne(
    { _id: asset._id },
    {
      $set: {
        kind: 'prop',
        'production.items': [
          { id: 'profile', type: 'image', title: 'Profile', notes: 'One profile.', mediaId: null },
          { id: 'front', type: 'image', title: 'Front', notes: 'One front view.', mediaId: null }
        ]
      }
    }
  );
  const attempted = [];
  const automation = createWorkflowAutomation({
    queue: async (item) => {
      attempted.push(item.target.packageItemId);
      if (item.target.packageItemId === 'profile')
        throw Object.assign(new Error('Too many image references.'), { status: 400 });
      return production.queue(item);
    }
  });
  app.locals.assistant.automation = automation;
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  await automation.processNext();
  assert.deepEqual(attempted, ['profile', 'front']);
  const action = await StudioAutomation.findOne().lean();
  assert.equal(action.status, 'failed');
  assert.equal(action.failures.length, 1);
  assert.equal(action.failures[0].target.packageItemId, 'profile');
  assert.equal(action.failures[0].error, 'Too many image references.');
  assert.equal(await Job.countDocuments({ 'target.packageItemId': 'front' }), 1);
  assert.equal((await state(assetTarget(), 'brief')).status, 'approved');
  assert.deepEqual(calls, []);
});

test('missing dialogue voices automatically queue auditions before the multi-speaker performance', async () => {
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.clips.0.dialogue': 'ROXY: Hello.\nHARKUN: Leave.',
        'scenes.0.clips.0.production.mode': 'voice-reference'
      }
    }
  );
  for (const stage of ['source', 'brief', 'reference:profile'])
    assert.equal((await review(assetTarget(), stage)).status, 200);
  for (const stage of ['source', 'outline'])
    assert.equal((await review(episodeTarget(), stage)).status, 200);
  for (const stage of ['script', 'shot-plan'])
    assert.equal((await review(sceneTarget(), stage)).status, 200);
  const response = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: episodeTarget() })
    .expect(200);
  assert.equal(
    response.body.nextSteps.some((s) => s.kind === 'dialogue'),
    false
  );
  assert.equal(response.body.blockedSteps.length, 1);
  assert.equal(response.body.blockedSteps[0].target.clipId, 'shot');
  assert.match(
    response.body.blockedSteps[0].error,
    /Voice auditions need approval for: ROXY, HARKUN/
  );
  assert.deepEqual(
    response.body.nextSteps.filter((step) => step.kind === 'voice').map((step) => step.speaker),
    ['ROXY', 'HARKUN']
  );
  assert.deepEqual(calls, []);
});

test('automatic voice auditions wait for owner selection then generate a multi-speaker performance', async (t) => {
  await promisify(execFile)(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=150:duration=1',
      join(directory, 'multi-speaker.mp3')
    ],
    { windowsHide: true }
  );
  const originalKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'test-key';
  t.after(() => {
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalKey;
  });
  const requests = [],
    mp3 = await readFile(join(directory, 'multi-speaker.mp3'));
  let preview = 0;
  const automated = createProduction({
    store: createSecretStore(join(directory, 'private')),
    mediaDirectory: directory,
    openart: {
      call: async () => {
        throw new Error('Unexpected OpenArt call');
      }
    },
    fetcher: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      if (url.includes('/text-to-voice/design'))
        return Response.json({
          previews: [
            { generated_voice_id: `preview-${++preview}`, audio_base_64: mp3.toString('base64') }
          ],
          text: 'Audition sample.'
        });
      if (url.endsWith('/text-to-voice'))
        return Response.json({ voice_id: `saved-${body.generated_voice_id}` });
      if (url.includes('/text-to-dialogue')) return new Response(mp3);
      throw new Error('Unexpected ElevenLabs request');
    }
  });
  const automation = createWorkflowAutomation(automated);
  app.locals.assistant.production = automated;
  app.locals.assistant.automation = automation;
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.clips.0.dialogue': 'ROXY: Hello.\nHARKUN: Leave.\nROXY: Gladly.',
        'scenes.0.clips.0.production.mode': 'voice-reference'
      }
    }
  );
  for (const stage of ['source', 'brief', 'reference:profile']) await review(assetTarget(), stage);
  for (const stage of ['source', 'outline']) await review(episodeTarget(), stage);
  for (const stage of ['script', 'shot-plan'])
    assert.equal((await review(sceneTarget(), stage)).status, 200);
  await automation.reconcileProduction();
  await automation.processNext();
  await automation.processNext();
  const voiceJobs = await Job.find({ kind: 'voice' }).sort({ createdAt: 1 }).lean();
  assert.equal(voiceJobs.length, 2);
  for (const job of voiceJobs) await automated.processJob(job);
  assert.equal(requests.filter((request) => request.url.includes('/design')).length, 2);
  assert.equal(await Job.countDocuments({ kind: 'dialogue' }), 0);
  const voices = await StudioAsset.find({ kind: 'voice' }).lean();
  assert.equal(voices.length, 2);
  assert.ok(
    voices.every(
      (voice) =>
        !voice.finalChoice &&
        voice.reviewStatus === 'pending-choice' &&
        voice.candidates.length === 1
    )
  );
  await automation.reconcileProduction();
  await automation.processNext();
  assert.equal(await Job.countDocuments({ kind: 'voice' }), 2);
  for (const voice of voices)
    await request(app)
      .post(base + '/assets/' + voice._id + '/finalize')
      .set(headers)
      .send({ revision: voice.revision, candidateId: voice.candidates[0].id })
      .expect(200);
  await automation.processNext();
  const dialogue = await Job.findOne({ kind: 'dialogue' }).lean();
  assert.ok(dialogue);
  await automated.processJob(dialogue);
  const call = requests.find((request) => request.url.includes('/text-to-dialogue'));
  assert.ok(call);
  assert.deepEqual(
    call.body.inputs.map((input) => input.text),
    ['Hello.', 'Leave.', 'Gladly.']
  );
  assert.equal(call.body.inputs[0].voice_id, call.body.inputs[2].voice_id);
  assert.notEqual(call.body.inputs[0].voice_id, call.body.inputs[1].voice_id);
  assert.equal((await Job.findById(dialogue._id).lean()).status, 'ready');
  assert.equal(
    (await StudioEpisode.findById(episode._id).lean()).scenes[0].clips[0].selectedDialogueId,
    null
  );
});

test('applying corrected voice directions supersedes old auditions and automatically queues the saved description', async (t) => {
  const originalKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'test-key';
  t.after(() => {
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalKey;
  });
  const descriptions = [],
    mp3 = Buffer.from('ID3voice-correction-audio-data');
  const automated = createProduction({
    store: createSecretStore(join(directory, 'private')),
    mediaDirectory: directory,
    openart: {},
    fetcher: async (_url, options) => {
      descriptions.push(JSON.parse(options.body).voice_description);
      return Response.json({
        previews: [{ generated_voice_id: 'female-preview', audio_base_64: mp3.toString('base64') }]
      });
    }
  });
  const automation = createWorkflowAutomation(automated);
  app.locals.assistant.production = automated;
  app.locals.assistant.automation = automation;
  const oldDescription = 'A generic cinematic character voice with natural clear speech.';
  const femaleDescription =
    'Kory is an adult woman with a slight, natural English accent. Clear feminine speech and expressive cinematic delivery. No music or sound effects.';
  const voice = await withProject(key, async () => {
    const media = await saveGeneratedMedia(directory, mp3, 'old-kory-audition.mp3', {
      voiceDesign: { generatedVoiceId: 'old-preview' }
    });
    return StudioAsset.create({
      name: 'Kory voice auditions',
      aliases: ['KORY'],
      kind: 'voice',
      seedKey: `workflow-voice-${key}-kory`,
      brief: oldDescription,
      production: { voiceDescription: oldDescription },
      candidates: [
        {
          id: 'old-male-audition',
          title: 'Old audition',
          description: oldDescription,
          mediaIds: [media._id],
          generatedVoiceId: 'old-preview',
          voiceModel: 'eleven_v3'
        }
      ],
      reviewStatus: 'pending-choice'
    });
  });
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.clips.0.dialogue': 'KORY: Good luck.',
        'scenes.0.clips.0.production.mode': 'voice-reference'
      }
    }
  );
  for (const stage of ['source', 'brief', 'reference:profile']) await review(assetTarget(), stage);
  for (const stage of ['source', 'outline']) await review(episodeTarget(), stage);
  for (const stage of ['script', 'shot-plan']) await review(sceneTarget(), stage);
  assert.equal(await Job.countDocuments({ kind: 'voice' }), 0);
  const proposal = await withProject(key, () =>
    productionProposal(new mongoose.Types.ObjectId(), {
      scope: 'asset',
      recordId: String(voice._id),
      title: 'Kory is female with a slight English accent',
      explanation: 'Owner rejected the male auditions. Use the corrected female voice directions.',
      production: {
        voiceDescription: femaleDescription,
        sourceNotes: 'Owner-confirmed female voice and slight English accent.',
        items: []
      }
    })
  );
  const applied = await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  assert.equal(applied.body.automation.status, 'queued');
  let saved = await StudioAsset.findById(voice._id).lean();
  assert.equal(saved.brief, femaleDescription);
  assert.equal(saved.production.voiceDescription, femaleDescription);
  assert.equal(saved.production.managed, false);
  assert.ok(saved.candidates[0].archived);
  assert.ok(await StudioMedia.exists({ _id: saved.candidates[0].mediaIds[0] }));
  await automation.processNext();
  const job = await Job.findOne({ kind: 'voice' }).lean();
  assert.equal(job.payload.description, femaleDescription);
  assert.equal(String(job.chatId), String(proposal.chatId));
  await automated.processJob(job);
  assert.deepEqual(descriptions, [femaleDescription]);
  saved = await StudioAsset.findById(voice._id).lean();
  assert.equal(saved.candidates.filter((candidate) => !candidate.archived).length, 1);
  assert.equal(saved.finalChoice, null);
  await automation.reconcileProduction();
  await automation.processNext();
  assert.equal(await Job.countDocuments({ kind: 'voice' }), 1);
  const editedDescription = femaleDescription + ' Softer delivery.';
  const edited = await request(app)
    .put(base + '/assets/' + voice._id)
    .set(headers)
    .send({ ...saved, brief: editedDescription })
    .expect(200);
  assert.equal(edited.body.asset.production.voiceDescription, editedDescription);
  assert.equal(edited.body.automation.status, 'queued');
  assert.ok(edited.body.asset.candidates.every((candidate) => candidate.archived));
});

test('an unknown voice-design submission is retained and never automatically submitted again', async (t) => {
  const originalKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'test-key';
  t.after(() => {
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalKey;
  });
  let attempts = 0;
  const automated = createProduction({
    store: createSecretStore(join(directory, 'private')),
    mediaDirectory: directory,
    openart: {},
    fetcher: async () => {
      attempts++;
      throw new Error('Connection lost after submission');
    }
  });
  const automation = createWorkflowAutomation(automated);
  app.locals.assistant.automation = automation;
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.clips.0.dialogue': 'HARKUN: Leave.',
        'scenes.0.clips.0.production.mode': 'voice-reference'
      }
    }
  );
  for (const stage of ['source', 'brief', 'reference:profile']) await review(assetTarget(), stage);
  for (const stage of ['source', 'outline']) await review(episodeTarget(), stage);
  for (const stage of ['script', 'shot-plan']) await review(sceneTarget(), stage);
  await automation.processNext();
  const job = await Job.findOne({ kind: 'voice' }).lean();
  assert.ok(job);
  await automated.processJob(job);
  assert.equal((await Job.findById(job._id).lean()).status, 'uncertain');
  await automation.reconcileProduction();
  await automation.processNext();
  await automated.processJob(job);
  assert.equal(await Job.countDocuments({ kind: 'voice' }), 1);
  assert.equal(attempts, 1);
});

test('image reference budgeting preserves primary references and records omitted fallback views', async () => {
  await withProject(key, async () => {
    const refs = [];
    for (let i = 0; i < 20; i++)
      refs.push(
        String(
          (
            await saveGeneratedMedia(directory, png, `reference-${i}.png`, {
              providerReference: {
                id: `reference-${i}`,
                url: `https://cdn.openart.ai/reference-${i}.png`
              }
            })
          )._id
        )
      );
    await StudioAsset.updateOne(
      { _id: asset._id },
      {
        $set: {
          kind: 'prop',
          identitySourceMediaIds: refs,
          finalChoice: null,
          'production.items.0.mediaId': null
        }
      }
    );
    await review(assetTarget(), 'source');
    await review(assetTarget(), 'brief');
    const job = await production.queue({
      kind: 'image',
      requestId: 'reference-budget',
      target: { assetId: String(asset._id), packageItemId: 'profile' }
    });
    const built = await production.build(job);
    assert.equal(built.params.visualReferences.length, 16);
    const saved = await Job.findById(job._id).lean();
    assert.deepEqual(saved.payload.referenceSelection.selected, refs.slice(0, 16));
    assert.deepEqual(saved.payload.referenceSelection.omitted, refs.slice(16));
  });
  assert.deepEqual(calls, []);
});

test('recovery resumes a reference-budget preparation failure once without retrying submitted renders', async () => {
  await prepare();
  await StudioAutomation.deleteMany({});
  await StudioAsset.updateOne(
    { episodeId: episode._id, clipId: 'shot' },
    { $set: { finalChoice: null } }
  );
  const automation = app.locals.assistant.automation;
  const step = await withProject(key, async () =>
    (await automation.plan(sceneTarget())).find((step) => step.kind === 'image')
  );
  assert.ok(step);
  const failed = await withProject(key, () =>
    Job.create({
      ...step,
      status: 'failed',
      error: 'Too many image references; select fewer references for this request.'
    })
  );
  await automation.reconcileProduction();
  await automation.reconcileProduction();
  await automation.processNext();
  assert.equal(await Job.countDocuments({ kind: 'image' }), 2);
  const replacement = await Job.findOne({ retryOf: String(failed._id) }).lean();
  assert.ok(replacement);
  assert.equal(replacement.status, 'queued');
  await automation.reconcileProduction();
  await automation.processNext();
  assert.equal(await Job.countDocuments({ kind: 'image' }), 2);
  assert.deepEqual(calls, []);
});

test('scene automation waits for animatic and sound approval before requesting any video', async () => {
  await prepare();
  // Remove an existing fixture take; approved script, storyboard, animatic and sound plan remain valid.
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { 'scenes.0.clips.0.takeIds': [] } });
  const plan = await withProject(key, () => app.locals.assistant.automation.plan(sceneTarget()));
  assert.deepEqual(
    plan.map((j) => j.kind),
    ['video']
  );
  await review(sceneTarget(), 'animatic', 'unapprove');
  assert.deepEqual(
    await withProject(key, () => app.locals.assistant.automation.plan(sceneTarget())),
    []
  );
  assert.equal(await Job.countDocuments(), 0);
});

test('visual approval queues a free local mix with approved sounds but does not select the mix', async () => {
  await prepare();
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.production.visualTakeId': String(video._id) } }
  );
  const response = await review(clipTarget(), 'visual');
  assert.equal(response.status, 200);
  assert.equal(response.body.automation.status, 'queued');
  await app.locals.assistant.automation.processNext();
  const job = await Job.findOne({ kind: 'mix' }).lean();
  assert.equal(job.payload.sourceTakeId, String(video._id));
  assert.equal(job.quote.estimatedCredits, 0);
  assert.equal(
    (await StudioEpisode.findById(episode._id).lean()).scenes[0].clips[0].selectedTakeId,
    null
  );
});

test('reference-specific source selection keeps other environments out of an image request', async () => {
  const other = await withProject(key, () =>
    saveGeneratedMedia(directory, png, 'different-set.png', {
      providerReference: { id: 'other-set', url: 'https://cdn.openart.ai/other.png' }
    })
  );
  await StudioAsset.updateOne(
    { _id: asset._id },
    {
      $set: {
        'production.sourceMediaIds': [String(image._id), String(other._id)],
        'production.items.0.sourceMediaIds': [String(image._id)],
        'production.items.0.mediaId': null,
        finalChoice: null
      }
    }
  );
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  await app.locals.assistant.automation.processNext();
  const job = await Job.findOne({ kind: 'image' }).lean();
  const built = await withProject(key, () => production.build(job));
  assert.deepEqual(
    built.params.visualReferences.map((r) => r.id),
    ['fake-image']
  );
});

test('an explicit submit rejection is failed rather than uncertain and is not automatically retried', async () => {
  await StudioAsset.updateOne({ _id: asset._id }, { $set: { 'production.items.0.mediaId': null } });
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  await app.locals.assistant.automation.processNext();
  const job = await Job.findOne({ kind: 'image' }).lean();
  const rejecting = createProduction({
    mediaDirectory: directory,
    store: { read: async () => ({ openart: { tokens: {} } }) },
    openart: {
      call: async (name) => {
        if (name === 'openart_model_form_get') return {};
        if (name === 'openart_model_cost')
          return { items: [{ totalCredits: 0, affordable: true }] };
        return unpack({
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'FAILED',
                historyId: 'submit-failed',
                failedCode: 'upstream_unavailable',
                errorDisplayCode: '1004: upstream_unavailable'
              })
            }
          ]
        });
      }
    }
  });
  await rejecting.processJob(job);
  const saved = await Job.findById(job._id).lean();
  assert.equal(saved.status, 'failed');
  assert.equal(saved.receipt.failedCode, 'upstream_unavailable');
  assert.match(saved.error, /No render ID was issued/);
  assert.equal(
    await withProject(key, () => app.locals.assistant.automation.plan(assetTarget())).then(
      (items) => items.length
    ),
    0
  );
});

test('failed prerequisites remain visible after approval and explicit retries are idempotent and preserve approval', async () => {
  await StudioAsset.updateOne({ _id: asset._id }, { $set: { 'production.items.0.mediaId': null } });
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  await app.locals.assistant.automation.processNext();
  const failed = await Job.findOne().lean();
  await Job.updateOne(
    { _id: failed._id },
    { $set: { status: 'failed', error: 'Reference transfer failed.' } }
  );
  const board = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: assetTarget() });
  assert.equal(board.body.progress.state, 'blocked');
  assert.match(board.body.progress.message, /approvals are saved/);
  assert.equal(board.body.progress.retrySteps.length, 1);
  const body = { target: assetTarget(), parentRevision: 0, requestId: 'owner-retry-one' };
  const first = await request(app)
    .post(base + '/workflow/retry')
    .set(headers)
    .send(body);
  const second = await request(app)
    .post(base + '/workflow/retry')
    .set(headers)
    .send(body);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.automation._id, second.body.automation._id);
  await app.locals.assistant.automation.processNext();
  await app.locals.assistant.automation.processNext();
  assert.equal(await Job.countDocuments(), 2);
  assert.equal((await Job.findOne({ retryOf: String(failed._id) }).lean()).status, 'queued');
  assert.equal((await state(assetTarget(), 'brief')).status, 'approved');
  assert.equal(
    (
      await request(app)
        .post(base + '/workflow/board')
        .set(headers)
        .send({ target: assetTarget() })
    ).body.progress.state,
    'working'
  );
});

test('unknown submit outcomes are visible and cannot be retried through the pre-submission retry action', async () => {
  await StudioAsset.updateOne({ _id: asset._id }, { $set: { 'production.items.0.mediaId': null } });
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  await app.locals.assistant.automation.processNext();
  await Job.updateMany({}, { $set: { status: 'uncertain' } });
  const board = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: assetTarget() });
  assert.equal(board.body.progress.state, 'blocked');
  assert.equal(board.body.progress.retrySteps.length, 0);
  assert.match(board.body.progress.message, /unknown outcome/);
  assert.equal(
    (
      await request(app)
        .post(base + '/workflow/retry')
        .set(headers)
        .send({ target: assetTarget(), parentRevision: 0, requestId: 'unsafe-retry' })
    ).status,
    409
  );
});

test('the final linked reference approval automatically resumes an already-approved scene shot plan', async () => {
  await StudioAsset.updateOne({ clipId: 'shot' }, { $set: { finalChoice: null, candidates: [] } });
  await review(assetTarget(), 'source');
  await review(assetTarget(), 'brief');
  for (const stage of ['source', 'outline']) await review(episodeTarget(), stage);
  for (const stage of ['script', 'shot-plan']) await review(sceneTarget(), stage);
  assert.equal(await StudioAutomation.countDocuments(), 0);
  const last = await review(assetTarget(), 'reference:profile');
  assert.equal(last.status, 200);
  assert.equal(last.body.automation.target.scope, 'scene');
  await app.locals.assistant.automation.processNext();
  const job = await Job.findOne().lean();
  assert.equal(job.kind, 'image');
  assert.equal(job.target.clipId, 'shot');
  assert.equal((await state(sceneTarget(), 'shot-plan')).status, 'approved');
});

test('shot plans can select useful individual views and reject images outside the linked references', async () => {
  await prepare();
  const clip = episode.scenes[0].clips[0];
  const extra = await withProject(key, () => saveGeneratedMedia(directory, png, 'individual.png'));
  const linkedAsset = {
    ...asset,
    production: {
      ...asset.production,
      items: [{ ...asset.production.items[0], mediaId: String(extra._id) }]
    }
  };
  const selected = await withProject(key, () =>
    clipPrompts(
      episode.scenes[0],
      { ...clip, production: { ...clip.production, referenceMediaIds: [String(extra._id)] } },
      [linkedAsset]
    )
  );
  assert.deepEqual(selected.referenceMediaIds, [String(extra._id)]);
  await withProject(key, () =>
    StudioEpisode.updateOne(
      { _id: episode._id },
      {
        $set: { 'scenes.0.clips.0.production.referenceMediaIds': [String(extra._id)] },
        $inc: { revision: 1 }
      }
    )
  );
  const row = await state(sceneTarget(), 'shot-plan');
  assert.equal(row.canApprove, false);
  assert.match(row.blockers.join(' '), /linked designs/);
});

test('chat applies plans without approvals and preserves existing generated takes when revising a scene', async () => {
  const plan = await Proposal.create({
    scope: 'asset',
    assetId: String(asset._id),
    projectKey: key,
    title: 'New package plan',
    production: { ...asset.production, sourceNotes: 'Review this new observation.' },
    baseRevision: 0,
    status: 'pending'
  });
  await request(app)
    .post(base + '/assistant/proposals/' + plan._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  assert.equal(await StudioReview.countDocuments(), 0);
  assert.equal((await state(assetTarget(), 'source')).status, 'pending-review');
  const proposal = await withProject(key, () =>
    makeProposal(new mongoose.Types.ObjectId(), {
      episodeId: String(episode._id),
      title: 'Revise action',
      explanation: 'Keep existing media available.',
      scene: {
        ...episode.scenes[0],
        clips: episode.scenes[0].clips.map((c) => ({
          ...c,
          action: 'Stops and looks at the door.'
        }))
      }
    })
  );
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  const saved = await StudioEpisode.findById(episode._id).lean();
  assert.deepEqual(saved.scenes[0].clips[0].takeIds.map(String), [String(video._id)]);
  assert.equal(
    saved.scenes[0].clips[0].production.passCondition,
    episode.scenes[0].clips[0].production.passCondition
  );
  assert.equal((await state(sceneTarget(), 'script')).status, 'blocked');
  const context = await request(app).get(base).set(headers).expect(200);
  assert.ok(context.body.workflowReviews.some((r) => r.target.recordId === String(asset._id)));
  const refs = clipPrompts(episode.scenes[0], episode.scenes[0].clips[0], [
    asset
  ]).referenceMediaIds;
  assert.ok(refs.includes(String(image._id)));
});

test('overview exposes unverified episode research even after all creative choices are approved', async () => {
  await StudioProject.updateOne({ key }, { $set: { faithfulAdaptation: true } });
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        scenes: [],
        sourceReferences: [
          {
            id: 'chapter',
            title: 'Initial Sith Trials',
            chapter: 'Initial Sith Trials',
            url: 'https://www.youtube.com/watch?v=ojIORTFv7WU',
            startSeconds: 1007,
            endSeconds: 2043,
            status: 'unreviewed',
            notes: 'Recorded events awaiting owner review.'
          }
        ]
      }
    }
  );
  for (const stage of ['source', 'brief', 'reference:profile']) await review(assetTarget(), stage);
  const before = await StudioAsset.findById(asset._id).lean();
  const result = await request(app).get(base).set(headers).expect(200);
  const preparation = result.body.workflowReviews.filter(
    (r) => r.target.recordId === String(episode._id)
  );
  assert.equal(preparation.length, 1);
  assert.equal(preparation[0].stage, 'source');
  assert.equal(preparation[0].status, 'draft');
  const progress = await withProject(key, () =>
    app.locals.assistant.automation.progress(episodeTarget())
  );
  assert.match(progress.message, /Next step: Source research/);
  assert.deepEqual(await StudioAsset.findById(asset._id).lean(), before);
  assert.equal(await Job.countDocuments(), 0);
});

test('owner verifies individual source ranges on the board and unlocks the existing outline', async () => {
  await StudioProject.updateOne({ key }, { $set: { faithfulAdaptation: true } });
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        scenes: [],
        sourceReferences: ['chapter', 'crawl'].map((id) => ({
          id,
          title: id,
          url: 'https://www.youtube.com/watch?v=ojIORTFv7WU',
          startSeconds: 0,
          endSeconds: 100,
          status: 'unreviewed'
        }))
      }
    }
  );
  const row = await state(episodeTarget(), 'source');
  const payload = { ...row, action: 'approve', verifiedSourceIds: ['chapter'] };
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...payload, verifiedSourceIds: ['foreign'] })
    .expect(400);
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send(payload)
    .expect(200);
  const saved = await StudioEpisode.findById(episode._id).lean();
  assert.equal(saved.sourceReferences.find((r) => r.id === 'chapter').status, 'verified');
  assert.equal(saved.sourceReferences.find((r) => r.id === 'crawl').status, 'unreviewed');
  assert.equal(saved.history.length, 1);
  assert.equal((await state(episodeTarget(), 'source')).status, 'approved');
  assert.equal((await state(episodeTarget(), 'outline')).status, 'pending-review');
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send(payload)
    .expect(409);
  assert.equal(await Job.countDocuments(), 0);
});

test('outline approval durably queues one restricted first-scene draft without media jobs or auto approvals', async () => {
  const originalScene = JSON.parse(JSON.stringify(episode.scenes[0]));
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { scenes: [] } });
  const chatgpt = {
    ready: async () => ({ profileId: 'test-profile', model: 'test-model' }),
    respond: async ({ tools }) => {
      assert.ok(!tools.some((t) => t.name === 'request_render' || t.name === 'create_asset_draft'));
      return {
        output: [
          {
            type: 'function_call',
            name: 'propose_scene',
            call_id: 'scene-draft',
            arguments: JSON.stringify({
              episodeId: String(episode._id),
              title: 'Arrival scene draft',
              explanation: 'Draft from the approved outline.',
              scene: originalScene
            })
          }
        ]
      };
    }
  };
  const automation = createWorkflowAutomation(production, {
    queueStory: createStoryQueue(chatgpt)
  });
  app.locals.assistant.automation = automation;
  await review(episodeTarget(), 'source');
  const approved = await review(episodeTarget(), 'outline');
  assert.equal(approved.status, 200);
  assert.equal(approved.body.automation.status, 'queued');
  await automation.processNext();
  assert.equal(await Run.countDocuments(), 1);
  const run = await Run.findOne().lean();
  assert.equal(run.status, 'queued');
  assert.equal((await StudioEpisode.findById(episode._id).lean()).scenes.length, 0);
  await withProject(key, async () => {
    assert.equal((await automation.plan(episodeTarget())).length, 0);
    await automation.afterApproval(episodeTarget(), {
      stage: 'outline',
      fingerprint: (await workflowContext()).evaluate(episodeTarget(), 'outline').fingerprint
    });
  });
  assert.equal(await StudioAutomation.countDocuments(), 1);
  let replies = 0;
  const respond = chatgpt.respond;
  chatgpt.respond = async (args) =>
    ++replies === 1
      ? respond(args)
      : {
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Scene draft ready for owner review.' }]
            }
          ]
        };
  await createChatEngine({ chatgpt, production, mediaDirectory: directory }).run(run);
  assert.equal((await Run.findById(run._id).lean()).status, 'completed');
  const proposal = await withProject(key, () => Proposal.findOne().lean());
  assert.equal(proposal.scene.title, originalScene.title);
  assert.equal(proposal.status, 'pending');
  assert.equal((await StudioEpisode.findById(episode._id).lean()).scenes.length, 0);
  assert.equal(await Job.countDocuments(), 0);
  const board = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: episodeTarget() })
    .expect(200);
  assert.equal(board.body.progress.chatId, String(run.chatId));
  const overview = await request(app).get(base).set(headers).expect(200);
  assert.ok(
    overview.body.workflowReviews.some(
      (r) => r.stage === 'story-draft' && r.chatId === String(run.chatId)
    )
  );
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  const applied = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: episodeTarget() })
    .expect(200);
  assert.equal(
    applied.body.progress.chatId,
    undefined,
    'Applied drafts must not keep masking the scene reviews.'
  );
  assert.equal(await Job.countDocuments(), 0);
});

test('automatic story runs stop when their approved episode changes and cannot call render tools', async () => {
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { scenes: [] } });
  await review(episodeTarget(), 'source');
  await review(episodeTarget(), 'outline');
  const ready = { ready: async () => ({ profileId: 'test-profile', model: 'test-model' }) };
  const automation = createWorkflowAutomation(production);
  const item = await withProject(key, async () => (await automation.plan(episodeTarget()))[0]);
  const run = await withProject(key, () => createStoryQueue(ready)(item));
  await StudioEpisode.updateOne({ _id: episode._id }, { $inc: { revision: 1 } });
  const engine = createChatEngine({
    chatgpt: {
      ...ready,
      respond: async () => {
        throw Error('Must not call model with stale inputs');
      }
    },
    production,
    mediaDirectory: directory
  });
  await engine.run(run);
  assert.equal((await Run.findById(run._id).lean()).status, 'failed');
  assert.match((await Run.findById(run._id).lean()).error, /inputs changed/);
  assert.equal(await Job.countDocuments(), 0);
  assert.equal(await Proposal.countDocuments(), 0);
});

test('source approval queues a missing outline, and a connection failure preserves approval with an in-app retry', async () => {
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { scenes: [], premise: '', 'production.outline': '' } }
  );
  let connected = false;
  const chatgpt = {
    ready: async () => {
      if (!connected)
        throw Object.assign(new Error('Connect ChatGPT to write the next draft.'), { status: 409 });
      return { profileId: 'test-profile', model: 'test-model' };
    }
  };
  const automation = createWorkflowAutomation(production, {
    queueStory: createStoryQueue(chatgpt)
  });
  app.locals.assistant.automation = automation;
  const result = await review(episodeTarget(), 'source');
  assert.equal(result.body.automation.status, 'queued');
  await automation.processNext();
  assert.equal((await StudioAutomation.findOne().lean()).status, 'failed');
  assert.equal((await state(episodeTarget(), 'source')).status, 'approved');
  assert.equal(await Run.countDocuments(), 0);
  connected = true;
  await request(app)
    .post(base + '/workflow/advance')
    .set(headers)
    .send({ target: episodeTarget(), parentRevision: 0 })
    .expect(200);
  await automation.processNext();
  assert.equal((await Run.findOne().lean()).workflowDraft.kind, 'story-outline');
  assert.equal(await StudioAutomation.findOne({ status: 'failed' }).lean(), null);
  assert.equal(await Job.countDocuments(), 0);
});

test('automatic drafting rejects a model render request at the tool boundary', async () => {
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { scenes: [] } });
  await review(episodeTarget(), 'source');
  await review(episodeTarget(), 'outline');
  const ready = { ready: async () => ({ profileId: 'test-profile', model: 'test-model' }) };
  const item = await withProject(
    key,
    async () => (await createWorkflowAutomation(production).plan(episodeTarget()))[0]
  );
  const run = await withProject(key, () => createStoryQueue(ready)(item));
  let replies = 0;
  const engine = createChatEngine({
    chatgpt: {
      ...ready,
      respond: async ({ input, tools }) => {
        assert.ok(!tools.some((t) => t.name === 'request_render'));
        if (++replies === 1)
          return {
            output: [
              {
                type: 'function_call',
                name: 'request_render',
                call_id: 'bad-render',
                arguments: JSON.stringify({ kind: 'image', assetId: String(asset._id) })
              }
            ]
          };
        assert.ok(
          input.some(
            (i) => i.type === 'function_call_output' && /cannot render media/.test(i.output)
          )
        );
        return {
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'No media was generated. Drafting only.' }]
            }
          ]
        };
      }
    },
    production,
    mediaDirectory: directory
  });
  await engine.run(run);
  assert.equal(await Job.countDocuments(), 0);
  assert.equal(await Proposal.countDocuments(), 0);
});

test('source revisions are visible on the board before application and apply ranges with research without granting verification', async () => {
  await StudioProject.updateOne({ key }, { $set: { faithfulAdaptation: true } });
  const chapter = {
    id: 'chapter',
    title: 'Source',
    chapter: 'Initial Sith Trials',
    url: 'https://www.youtube.com/watch?v=ojIORTFv7WU',
    startSeconds: 1007.16,
    endSeconds: 2043.639,
    status: 'verified',
    notes: 'Previously reviewed chapter.'
  };
  const crawl = {
    ...chapter,
    id: 'crawl',
    chapter: 'Old crawl locator',
    startSeconds: 0,
    endSeconds: 353.433
  };
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { scenes: [], sourceReferences: [chapter, crawl] } }
  );
  const before = await StudioEpisode.findById(episode._id).lean();
  await review(
    episodeTarget(),
    'source',
    'request-changes',
    'Include arrival, correct crawl timings, allow longer runtime and creative combat.'
  );
  const proposal = await withProject(key, () =>
    productionProposal(new mongoose.Types.ObjectId(), {
      scope: 'episode',
      recordId: String(episode._id),
      title: 'Revised chapter scope',
      explanation: 'Apply the requested source correction.',
      production: {
        sourceNotes:
          'Crawl 14:00�15:31; arrival 15:31�16:47; trials follow. Runtime may exceed ten minutes. Creative combat preserves events and outcomes.'
      },
      sourceReferences: [
        chapter,
        {
          ...crawl,
          chapter: 'Opening crawl',
          startSeconds: 840,
          endSeconds: 931,
          status: 'verified'
        },
        {
          ...chapter,
          id: 'arrival',
          chapter: 'Arrival at Korriban',
          startSeconds: 931,
          endSeconds: 1007.16,
          status: 'verified',
          notes: 'Owner-specified range; footage still needs verification.'
        }
      ]
    })
  );
  assert.deepEqual(await StudioEpisode.findById(episode._id).lean(), before);
  const board = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: episodeTarget() })
    .expect(200);
  assert.equal(board.body.proposals[0]._id, String(proposal._id));
  assert.equal(
    board.body.proposals[0].sourceReferences.find((r) => r.id === 'arrival').startSeconds,
    931
  );
  assert.equal(board.body.proposals[0].production.outlineNeedsRevision, true);
  assert.equal(
    (await review(episodeTarget(), 'source')).status,
    409,
    'The old research must not be approved while a corrected draft is pending.'
  );
  const context = await withProject(key, () => studioContext({ episodeId: String(episode._id) }));
  assert.match(context.requestedChanges[0].feedback, /Include arrival/);
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  const saved = await StudioEpisode.findById(episode._id).lean();
  assert.equal(saved.sourceReferences.find((r) => r.id === 'chapter').status, 'verified');
  assert.equal(saved.sourceReferences.find((r) => r.id === 'crawl').status, 'unreviewed');
  assert.equal(saved.sourceReferences.find((r) => r.id === 'arrival').status, 'unreviewed');
  assert.equal(saved.production.outlineNeedsRevision, true);
  assert.equal(saved.history.length, 1);
  assert.deepEqual(saved.history[0].sourceReferences, before.sourceReferences);
  assert.equal((await state(episodeTarget(), 'outline')).canApprove, false);
  assert.equal((await review(episodeTarget(), 'source')).status, 200);
  const next = await withProject(key, () => app.locals.assistant.automation.plan(episodeTarget()));
  assert.equal(
    next[0].kind,
    'story-outline',
    'Source approval must revise the obsolete outline instead of unlocking it unchanged.'
  );
  const outline = await withProject(key, () =>
    productionProposal(new mongoose.Types.ObjectId(), {
      scope: 'episode',
      recordId: String(episode._id),
      title: 'Revised episode outline',
      explanation: 'Arrival before trials, flexible runtime.',
      production: {
        outline:
          'CapCut crawl, Arrival at Korriban, then Initial Sith Trials. Runtime follows the scenes.'
      }
    })
  );
  assert.equal(outline.production.outlineNeedsRevision, undefined);
  await request(app)
    .post(base + '/assistant/proposals/' + outline._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  assert.equal((await state(episodeTarget(), 'source')).status, 'approved');
  assert.equal((await state(episodeTarget(), 'outline')).status, 'pending-review');
  const refreshed = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: episodeTarget() })
    .expect(200);
  assert.equal(refreshed.body.proposals.length, 0);
  assert.equal(await Job.countDocuments(), 0);
});

test('pending revisions retain revision conflicts and cannot be applied from another project', async () => {
  const proposal = await withProject(key, () =>
    productionProposal(new mongoose.Types.ObjectId(), {
      scope: 'episode',
      recordId: String(episode._id),
      title: 'Source correction',
      explanation: 'Review this correction.',
      production: { sourceNotes: 'A corrected source research draft.' }
    })
  );
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set('X-Studio-Project', 'imperial-smuggler')
    .send({})
    .expect(409);
  await StudioEpisode.updateOne({ _id: episode._id }, { $inc: { revision: 1 } });
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set(headers)
    .send({})
    .expect(409);
  assert.equal((await Proposal.findById(proposal._id).lean()).status, 'pending');
  assert.equal(
    (await StudioEpisode.findById(episode._id).lean()).production.sourceNotes,
    episode.production.sourceNotes
  );
});

test('applying an outline supersedes older alternatives across chats and keeps source approval intact', async () => {
  await review(episodeTarget(), 'source');
  const source = await state(episodeTarget(), 'source');
  const originalSource = episode.production.sourceNotes;
  const first = await withProject(key, () =>
    productionProposal(new mongoose.Types.ObjectId(), {
      scope: 'episode',
      recordId: String(episode._id),
      title: 'Automatic outline',
      explanation: 'First draft.',
      production: { outline: 'First outline alternative.' }
    })
  );
  const selected = await withProject(key, () =>
    productionProposal(new mongoose.Types.ObjectId(), {
      scope: 'episode',
      recordId: String(episode._id),
      title: 'Owner requested outline',
      explanation: 'Preferred draft.',
      production: { outline: 'Chosen outline alternative.' }
    })
  );
  assert.deepEqual(selected.reviewStages, ['outline']);
  const unrelated = await withProject(key, () =>
    productionProposal(new mongoose.Types.ObjectId(), {
      scope: 'episode',
      recordId: String(episode._id),
      title: 'Separate source correction',
      explanation: 'Keep this separate request.',
      production: { sourceNotes: 'Different research requiring a separate decision.' }
    })
  );
  await request(app)
    .post(base + '/assistant/proposals/' + selected._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  const old = await Proposal.findById(first._id).lean();
  assert.equal(old.status, 'superseded');
  assert.equal(old.supersededBy, String(selected._id));
  assert.equal((await Proposal.findById(unrelated._id).lean()).status, 'pending');
  assert.equal((await state(episodeTarget(), 'source')).status, 'approved');
  assert.equal((await state(episodeTarget(), 'source')).fingerprint, source.fingerprint);
  assert.equal(
    (await StudioEpisode.findById(episode._id).lean()).production.sourceNotes,
    originalSource
  );
  // Reproduce a legacy automatic draft left pending at an earlier episode revision.
  const legacy = await Proposal.create({
    projectKey: key,
    scope: 'episode',
    episodeId: String(episode._id),
    baseRevision: 0,
    status: 'pending',
    title: 'Legacy automatic outline',
    production: { ...episode.production, outline: 'Older automatic alternative.' }
  });
  const replacement = await withProject(key, () =>
    productionProposal(new mongoose.Types.ObjectId(), {
      scope: 'episode',
      recordId: String(episode._id),
      title: 'Final outline revision',
      explanation: 'Updated pacing.',
      production: { outline: 'Latest applied outline.' }
    })
  );
  await request(app)
    .post(base + '/assistant/proposals/' + replacement._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  assert.equal((await Proposal.findById(legacy._id).lean()).status, 'superseded');
  assert.equal((await Proposal.findById(legacy._id).lean()).supersededBy, String(replacement._id));
  assert.equal(
    (await review(episodeTarget(), 'outline')).status,
    200,
    'An obsolete alternative must not block approval of the applied outline.'
  );
  const context = await withProject(key, () => studioContext({ episodeId: String(episode._id) }));
  assert.equal(
    context.selectedEpisodeWorkflow.stages.find((r) => r.stage === 'source').status,
    'approved'
  );
  const board = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: episodeTarget() })
    .expect(200);
  assert.ok(
    !board.body.proposals.some((p) => p._id === String(first._id) || p._id === String(legacy._id))
  );
  assert.equal(await Job.countDocuments(), 0);
});

test('matching source evidence reaches chat and the board without changing approved research or creative choices', async () => {
  const ref = {
    id: 'arrival',
    title: 'Arrival footage',
    url: 'https://www.youtube.com/watch?v=ojIORTFv7WU',
    chapter: 'Arrival at Korriban',
    startSeconds: 931,
    endSeconds: 1007.16,
    status: 'verified',
    notes: 'Owner verified source range.'
  };
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { sourceReferences: [ref] } });
  await review(episodeTarget(), 'source');
  await review(episodeTarget(), 'outline');
  const sourceBefore = await state(episodeTarget(), 'source');
  const episodeBefore = await StudioEpisode.findById(episode._id).lean();
  const assetBefore = await StudioAsset.findById(asset._id).lean();
  await withProject(key, () =>
    StudioSourceEvidence.create({
      episodeId: String(episode._id),
      sourceId: ref.id,
      sourceUrl: ref.url,
      startSeconds: ref.startSeconds,
      endSeconds: ref.endSeconds,
      title: 'Actual arrival source',
      observations:
        'Starships approach Korriban, followed by a landing-platform view. No dialogue is transcribed.',
      limitations: 'Frame observations and captions, not an audio evaluation.',
      videoMediaId: String(video._id),
      frames: [{ mediaId: String(image._id), sourceSeconds: 963, overview: true }],
      captions: []
    })
  );
  const context = await withProject(key, () => studioContext({ episodeId: String(episode._id) }));
  assert.equal(context.sourceEvidence.length, 1);
  assert.match(context.sourceEvidence[0].observations, /Korriban/);
  const board = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: episodeTarget() })
    .expect(200);
  assert.equal(board.body.sourceEvidence[0].frames[0].mediaId, String(image._id));
  assert.equal((await state(episodeTarget(), 'source')).fingerprint, sourceBefore.fingerprint);
  assert.equal((await state(episodeTarget(), 'source')).status, 'approved');
  assert.deepEqual(await StudioEpisode.findById(episode._id).lean(), episodeBefore);
  assert.deepEqual(await StudioAsset.findById(asset._id).lean(), assetBefore);
  assert.equal(
    (
      await withProject('imperial-smuggler', () =>
        studioContext({ episodeId: String(episode._id) })
      )
    ).sourceEvidence.length,
    0
  );
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'sourceReferences.0.startSeconds': 932 } }
  );
  const stale = await withProject(key, () => studioContext({ episodeId: String(episode._id) }));
  assert.equal(
    stale.sourceEvidence.length,
    0,
    'Do not reuse evidence after source boundaries change.'
  );
  assert.equal(await Job.countDocuments(), 0);
});

test('approved scripts and designs automatically prepare missing plans once, with locked story content and owner review', async () => {
  const original = JSON.parse(JSON.stringify(episode.scenes[0]));
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.soundPlan': null,
        'scenes.0.clips.0.production.referenceMediaIds': [String(video._id)]
      }
    }
  );
  await StudioAsset.deleteMany({ clipId: 'shot' });
  let replies = 0;
  const chatgpt = {
    ready: async () => ({ profileId: 'test-profile', model: 'test-model' }),
    respond: async ({ tools, input }) => {
      const schema = tools.find((t) => t.name === 'propose_scene').parameters;
      assert.ok(schema.properties.scene.properties.soundPlan);
      assert.ok(!tools.some((t) => t.name === 'request_render'));
      replies++;
      if (replies <= 3) {
        if (replies === 2)
          assert.ok(
            input.some(
              (i) => i.type === 'function_call_output' && /Gameplay evidence/.test(i.output)
            )
          );
        if (replies === 3)
          assert.ok(
            input.some(
              (i) =>
                i.type === 'function_call_output' &&
                /New sound layers must use sourceStart 0/.test(i.output)
            )
          );
        return {
          output: [
            {
              type: 'function_call',
              name: 'propose_scene',
              call_id: 'planning-' + replies,
              arguments: JSON.stringify({
                episodeId: String(episode._id),
                title: 'Shot and sound plan',
                explanation: 'Complete planning; preserve approved story.',
                scene: {
                  ...original,
                  script: 'A model must not overwrite the approved script.',
                  soundPlan: {
                    ...original.soundPlan,
                    layers: original.soundPlan.layers.map((l) => ({
                      ...l,
                      assetId: null,
                      clipId: 'shot',
                      sourceStart: replies === 2 ? 12 : 0
                    }))
                  },
                  clips: original.clips.map((c) => ({
                    ...c,
                    dialogue: 'Must stay silent.',
                    production: {
                      ...c.production,
                      referenceMediaIds: [String(replies === 1 ? video._id : image._id)]
                    }
                  }))
                }
              })
            }
          ]
        };
      }
      return {
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Planning draft ready for owner review.' }]
          }
        ]
      };
    }
  };
  const automation = createWorkflowAutomation(production, {
    queueStory: createStoryQueue(chatgpt)
  });
  app.locals.assistant.automation = automation;
  for (const stage of ['source', 'brief', 'reference:profile']) await review(assetTarget(), stage);
  for (const stage of ['source', 'outline']) await review(episodeTarget(), stage);
  const result = await review(sceneTarget(), 'script');
  assert.equal(result.status, 200);
  assert.equal((await state(sceneTarget(), 'references')).status, 'approved');
  const scriptFingerprint = (await state(sceneTarget(), 'script')).fingerprint;
  const overview = await request(app).get(base).set(headers).expect(200);
  assert.ok(
    overview.body.workflowReviews.some((r) => r.stage === 'shot-plan' && r.status === 'draft')
  );
  await automation.processNext();
  const run = await Run.findOne().lean();
  assert.equal(run.workflowDraft.kind, 'story-scene-plan');
  assert.equal(run.workflowDraft.sceneId, 'scene');
  await withProject(key, async () => {
    assert.equal((await automation.plan(sceneTarget())).length, 0);
    await automation.reconcilePlanning();
  });
  assert.equal(await Run.countDocuments(), 1);
  assert.equal(await StudioAutomation.countDocuments({ status: 'queued' }), 0);
  await createChatEngine({ chatgpt, production, mediaDirectory: directory }).run(run);
  assert.equal((await Run.findById(run._id).lean()).status, 'completed');
  const proposal = await Proposal.findOne().lean();
  assert.deepEqual(proposal.reviewStages, ['shot-plan', 'sound-plan']);
  assert.equal(proposal.scene.script, original.script);
  assert.equal(proposal.scene.clips[0].dialogue, '');
  assert.equal(proposal.scene.clips[0].duration, 2);
  assert.deepEqual(proposal.scene.clips[0].production.referenceMediaIds, [String(image._id)]);
  assert.equal(proposal.scene.soundPlan.layers[0].clipId, 'shot');
  const plannedOverview = await request(app).get(base).set(headers).expect(200);
  assert.ok(plannedOverview.body.workflowReviews.some((r) => r.stage === 'story-draft'));
  assert.ok(!plannedOverview.body.workflowReviews.some((r) => r.stage === 'shot-plan'));
  assert.equal(await Job.countDocuments(), 0);
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  assert.equal((await state(sceneTarget(), 'script')).fingerprint, scriptFingerprint);
  for (const stage of ['source', 'outline'])
    assert.equal((await state(episodeTarget(), stage)).status, 'approved');
  assert.equal((await state(sceneTarget(), 'script')).status, 'approved');
  assert.equal((await state(sceneTarget(), 'shot-plan')).status, 'pending-review');
  const reviewable = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: episodeTarget() })
    .expect(200);
  assert.match(reviewable.body.progress.message, /Next step: Arrival \/ Shot plan/);
  await review(sceneTarget(), 'shot-plan');
  assert.equal((await state(sceneTarget(), 'sound-plan')).status, 'pending-review');
  await automation.processNext();
  const jobs = await Job.find().lean();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].kind, 'image');
  assert.deepEqual(jobs[0].referenceIds, [String(image._id)]);
  assert.equal(calls.length, 0, 'Queueing does not submit paid renders in this test.');
});

test('startup recovery repairs a missed planning handoff and a sound-only proposal preserves approved pictures', async () => {
  await prepare();
  const scriptFingerprint = (await state(sceneTarget(), 'script')).fingerprint;
  const shotFingerprint = (await state(sceneTarget(), 'shot-plan')).fingerprint;
  const shotImage = await withProject(key, () => StudioAsset.findOne({ clipId: 'shot' }).lean());
  await StudioAutomation.deleteMany({});
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { 'scenes.0.soundPlan': null } });
  let replies = 0;
  const chatgpt = {
    ready: async () => ({ profileId: 'test-profile', model: 'test-model' }),
    respond: async () =>
      ++replies === 1
        ? {
            output: [
              {
                type: 'function_call',
                name: 'propose_scene',
                call_id: 'sound-only',
                arguments: JSON.stringify({
                  episodeId: String(episode._id),
                  title: 'Sound plan',
                  explanation: 'Prepare missing sound plan.',
                  scene: {
                    ...episode.scenes[0],
                    soundPlan: episode.scenes[0].soundPlan,
                    clips: episode.scenes[0].clips.map((c) => ({
                      ...c,
                      production: { ...c.production, framing: 'Must not replace approved framing.' }
                    }))
                  }
                })
              }
            ]
          }
        : {
            output: [
              { type: 'message', content: [{ type: 'output_text', text: 'Sound draft ready.' }] }
            ]
          }
  };
  const automation = createWorkflowAutomation(production, {
    queueStory: createStoryQueue(chatgpt)
  });
  await automation.reconcilePlanning();
  await automation.reconcilePlanning();
  assert.equal(await StudioAutomation.countDocuments(), 1);
  await automation.processNext();
  const run = await Run.findOne().lean();
  await createChatEngine({ chatgpt, production, mediaDirectory: directory }).run(run);
  const proposal = await Proposal.findOne().lean();
  assert.deepEqual(proposal.reviewStages, ['sound-plan']);
  const blocked = await review(sceneTarget(), 'sound-plan');
  assert.equal(
    blocked.status,
    409,
    'Apply the pending replacement before approving its saved stage.'
  );
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  assert.equal((await state(sceneTarget(), 'script')).fingerprint, scriptFingerprint);
  assert.equal((await state(sceneTarget(), 'shot-plan')).fingerprint, shotFingerprint);
  assert.equal((await state(sceneTarget(), 'shot-plan')).status, 'approved');
  assert.deepEqual(
    (await StudioAsset.findById(shotImage._id).lean()).finalChoice,
    shotImage.finalChoice
  );
  assert.equal(await Job.countDocuments(), 0);
});

test('video revision directions require explicit owner approval and queue exactly once', async () => {
  await prepare();
  app.locals.assistant.production = production;
  const target = { episodeId: String(episode._id), sceneId: 'scene', clipId: 'shot' };
  await withProject(key, () =>
    assert.rejects(
      () =>
        production.queue({
          kind: 'video',
          requestId: 'unreviewed-directions',
          target,
          instructions: 'Unreviewed new directions.'
        }),
      /Approve the video revision directions/
    )
  );
  const proposal = await withProject(key, () =>
    proposeVideoRevision({
      requestId: 'revision-one',
      target,
      instructions: 'One ship continues forward through the canyon.'
    })
  );
  assert.equal(proposal.status, 'pending');
  assert.equal(await Job.countDocuments(), 0);
  assert.deepEqual(calls, []);
  await withProject(key, () =>
    assert.rejects(
      () =>
        production.queue({
          kind: 'video',
          requestId: 'bypass',
          target,
          instructions: proposal.render.instructions
        }),
      /pending revision/
    )
  );
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set(headers)
    .send({})
    .expect(409);
  const approved = await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/approve-render')
    .set(headers)
    .send({})
    .expect(200);
  assert.equal(approved.body.job.status, 'queued');
  assert.equal(await Job.countDocuments(), 1);
  assert.deepEqual(calls, []);
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/approve-render')
    .set(headers)
    .send({})
    .expect(200);
  assert.equal(await Job.countDocuments(), 1);
  const job = await Job.findById(approved.body.job._id).lean();
  await production.processJob(job);
  const submitted = await Job.findById(job._id).lean();
  assert.equal(submitted.status, 'rendering', submitted.error);
  assert.match(submitted.settings.params.prompt, /One ship continues forward/);
  assert.equal(calls.filter((name) => name === 'openart_generate_video').length, 1);
  assert.equal((await StudioEpisode.findById(episode._id)).scenes[0].clips[0].selectedTakeId, null);
});

test('a pending replacement stops an already queued video before provider calls', async () => {
  await prepare();
  const target = { episodeId: String(episode._id), sceneId: 'scene', clipId: 'shot' };
  const initial = await withProject(key, () =>
    proposeVideoRevision({ requestId: 'earlier-request', target })
  );
  const job = await withProject(key, () => production.approveRevision(String(initial._id)));
  const first = await withProject(key, () =>
    proposeVideoRevision({ requestId: 'draft-a', target, instructions: 'First correction.' })
  );
  const second = await withProject(key, () =>
    proposeVideoRevision({ requestId: 'draft-b', target, instructions: 'Revised correction.' })
  );
  assert.equal((await Proposal.findById(first._id)).status, 'superseded');
  assert.equal((await Proposal.findById(second._id)).status, 'pending');
  await production.processJob(job);
  assert.equal((await Job.findById(job._id)).status, 'failed');
  assert.deepEqual(calls, []);
  const board = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: sceneTarget() })
    .expect(200);
  assert.equal(board.body.proposals.length, 1);
  assert.equal(board.body.nextSteps.length, 0);
  assert.match(board.body.progress.message, /Video revision ready/);
});

test('a newer revision arriving during a quote still blocks paid video submission', async () => {
  await prepare();
  const target = { episodeId: String(episode._id), sceneId: 'scene', clipId: 'shot' };
  const proposal = await withProject(key, () =>
    proposeVideoRevision({
      requestId: 'approved-before-quote',
      target,
      instructions: 'Reviewed direction.'
    })
  );
  const job = await withProject(key, () => production.approveRevision(String(proposal._id)));
  providerHook = async (name) => {
    if (name === 'openart_model_cost')
      await proposeVideoRevision({
        requestId: 'new-feedback-during-quote',
        target,
        instructions: 'New unapproved correction.'
      });
  };
  await production.processJob(job);
  assert.equal((await Job.findById(job._id)).status, 'failed');
  assert.ok(calls.includes('openart_model_cost'));
  assert.ok(!calls.includes('openart_generate_video'));
});

test('video revision survives unrelated notes while newer creative changes remain a conflict', async () => {
  await prepare();
  app.locals.assistant.production = production;
  const target = { episodeId: String(episode._id), sceneId: 'scene', clipId: 'shot' };
  const draft = await withProject(key, () =>
    proposeVideoRevision({ requestId: 'note-safe', target, instructions: 'Keep one transport.' })
  );
  const before = await StudioEpisode.findById(episode._id).lean();
  delete before.history;
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: { notes: 'A saved production clarification.' },
      $inc: { revision: 1 },
      $push: { history: before }
    }
  );
  const board = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: episodeTarget() })
    .expect(200);
  assert.equal(board.body.proposals[0].application.canApply, true);
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.camera': 'New owner camera direction.' } }
  );
  await request(app)
    .post(base + '/assistant/proposals/' + draft._id + '/approve-render')
    .set(headers)
    .send({})
    .expect(409);
  assert.equal(await Job.countDocuments(), 0);
  assert.deepEqual(calls, []);
});

test('non-dialogue Wan requests enable native effects and ambience without prompt enhancement', async () => {
  await prepare();
  const proposal = await withProject(key, () =>
    proposeVideoRevision({
      requestId: 'silent-no-music',
      target: { episodeId: String(episode._id), sceneId: 'scene', clipId: 'shot' }
    })
  );
  await Proposal.updateOne({ _id: proposal._id }, { $set: { 'render.resolution': '480p' } });
  await withProject(key, () =>
    assert.rejects(
      () => production.approveRevision(String(proposal._id)),
      /fresh native 1080p revision/
    )
  );
  assert.equal(await Job.countDocuments(), 0);
  await Proposal.updateOne({ _id: proposal._id }, { $set: { 'render.resolution': '1080p' } });
  const job = await withProject(key, () => production.approveRevision(String(proposal._id)));
  await production.processJob(job);
  const submitted = await Job.findById(job._id).lean();
  assert.equal(submitted.status, 'rendering', submitted.error);
  assert.equal(submitted.settings.params.audio, true);
  assert.equal(submitted.settings.params.resolution, '1080p');
  assert.equal(submitted.snapshot.audioPolicy, nativeAudioPolicy);
  assert.match(
    submitted.settings.params.prompt,
    /Generate location ambience and action sounds with the picture/
  );
  assert.match(submitted.settings.params.prompt, /No music, score/);
  assert.equal(submitted.settings.params.promptExtend, false);
  assert.equal(submitted.settings.mode, 'image2video');
});

test('native 1080p workflow verifies imports, approves once and exports without upscale gates', async () => {
  await prepare();
  await StudioProject.updateOne({ key }, { $set: { videoWorkflow: 'native-1080p' } });
  const target = clipTarget();
  const before = await StudioEpisode.findById(episode._id).lean();
  await request(app)
    .post(base + '/workflow/video/import')
    .set(headers)
    .send({ target, parentRevision: before.revision, mediaId: String(video._id) })
    .expect(400);
  const bytes = await readFile(join(directory, 'native-1080.mp4'));
  const file = await withProject(key, () =>
    saveGeneratedMedia(directory, bytes, 'corrected-1080.mp4')
  );
  const imported = await request(app)
    .post(base + '/workflow/video/import')
    .set(headers)
    .send({ target, parentRevision: before.revision, mediaId: String(file._id) })
    .expect(200);
  assert.equal(imported.body.media.videoVerification.height, 1080);
  assert.equal(imported.body.media.videoReview.state, 'pending');
  assert.equal(imported.body.episode.scenes[0].clips[0].selectedTakeId, null);
  await request(app)
    .post(base + '/workflow/video/import')
    .set(headers)
    .send({ target, parentRevision: before.revision, mediaId: String(file._id) })
    .expect(409);
  const row = await state(target, 'visual');
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...row, action: 'approve', takeId: String(file._id) })
    .expect(200);
  const current = await StudioEpisode.findById(episode._id).lean();
  assert.equal(current.scenes[0].clips[0].upscale, null);
  assert.equal((await StudioMedia.findById(file._id).lean()).videoReview.state, 'approved');
  assert.equal(String(current.scenes[0].clips[0].selectedTakeId), String(file._id));
  const board = await request(app)
    .post(base + '/workflow/board')
    .set(headers)
    .send({ target: episodeTarget() })
    .expect(200);
  assert.ok(!board.body.groups.some((g) => g.stages.some((r) => r.stage === 'upscale')));
  const overview = await request(app).get(base).set(headers).expect(200);
  assert.ok(!overview.body.workflowReviews.some((r) => r.stage === 'upscale'));
  assert.equal((await review(episodeTarget(), 'export')).status, 200);
  const zip = await request(app)
    .get(base + '/episodes/' + episode._id + '/package')
    .set(headers)
    .expect(200);
  assert.match(zip.headers['content-type'], /zip/);
});
test('native picture and sound approval selects the exact take without a mandatory mix and gates export', async () => {
  await prepare();
  await StudioMedia.updateOne(
    { _id: video._id },
    {
      $set: {
        nativeAudio: {
          policy: nativeAudioPolicy,
          episodeId: String(episode._id),
          sceneId: 'scene',
          clipId: 'shot'
        }
      }
    }
  );
  const row = await state(clipTarget(), 'visual');
  const approved = await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({
      ...row,
      action: 'approve',
      takeId: String(video._id)
    });
  assert.equal(approved.status, 200, approved.body.message);
  let current = await StudioEpisode.findById(episode._id).lean();
  assert.equal(String(current.scenes[0].clips[0].selectedTakeId), String(video._id));
  assert.equal(current.scenes[0].clips[0].upscale.sourceTakeId, String(video._id));
  await withProject(key, async () => {
    await validateMixedSelection(current, current.scenes[0], current.scenes[0].clips[0]);
    assert.deepEqual(await app.locals.assistant.automation.plan(clipTarget()), []);
  });
  assert.equal(await Job.countDocuments({ kind: 'mix' }), 0);
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.clips.0.production.upscaleMediaId': String(upscale._id),
        'scenes.0.clips.0.production.upscaleSourceTakeId': String(video._id)
      }
    }
  );
  assert.equal((await review(clipTarget(), 'upscale')).status, 200);
  assert.equal((await review(episodeTarget(), 'export')).status, 200);
  await review(clipTarget(), 'visual', 'unapprove');
  current = await StudioEpisode.findById(episode._id).lean();
  await withProject(key, () =>
    assert.rejects(
      () => validateMixedSelection(current, current.scenes[0], current.scenes[0].clips[0]),
      /approval/
    )
  );
  assert.notEqual((await state(episodeTarget(), 'export')).status, 'approved');
});

test('native approval rejects missing audio and foreign clip provenance without selecting a take', async () => {
  await prepare();
  const silentFile = join(directory, 'silent-native.mp4');
  await promisify(execFile)(
    'ffmpeg',
    ['-y', '-v', 'error', '-i', join(directory, 'small.mp4'), '-an', '-c:v', 'copy', silentFile],
    { windowsHide: true }
  );
  const media = await withProject(key, async () =>
    saveGeneratedMedia(directory, await readFile(silentFile), 'silent-native.mp4', {
      nativeAudio: {
        policy: nativeAudioPolicy,
        episodeId: String(episode._id),
        sceneId: 'scene',
        clipId: 'shot'
      }
    })
  );
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $addToSet: { 'scenes.0.clips.0.takeIds': media._id } }
  );
  let row = await state(clipTarget(), 'visual');
  const result = await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...row, action: 'approve', takeId: String(media._id) });
  assert.equal(result.status, 400);
  assert.match(result.body.message, /readable soundtrack/);
  assert.equal(
    (await StudioEpisode.findById(episode._id).lean()).scenes[0].clips[0].selectedTakeId,
    null
  );
  row = await state(clipTarget(), 'visual');
  const repair = await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...row, action: 'approve', takeId: String(media._id), audioRepair: true });
  assert.equal(repair.status, 200, repair.body.message);
  const saved = await StudioEpisode.findById(episode._id).lean();
  assert.equal(saved.scenes[0].clips[0].production.audioRepairTakeId, String(media._id));
  assert.equal(saved.scenes[0].clips[0].selectedTakeId, null);
  await withProject(key, async () => {
    const plan = await app.locals.assistant.automation.plan(clipTarget());
    assert.equal(plan[0]?.kind, 'mix');
    const forged = { ...saved.scenes[0].clips[0], selectedTakeId: media._id };
    await assert.rejects(
      () => validateMixedSelection(saved, saved.scenes[0], forged),
      /native picture and sound/
    );
  });
  await StudioMedia.updateOne(
    { _id: media._id },
    { $set: { 'nativeAudio.clipId': 'different-clip' } }
  );
  row = await state(clipTarget(), 'visual');
  const foreign = await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...row, action: 'approve', takeId: String(media._id) });
  assert.equal(foreign.status, 400);
  assert.match(foreign.body.message, /another clip/);
});

test('restarting the episode video pass preserves creative inputs and files without granting approvals', async () => {
  await prepare();
  const before = await StudioEpisode.findById(episode._id).lean();
  const restarted = await withProject(key, () =>
    restartVideoPass(String(episode._id), before.revision)
  );
  assert.equal(restarted.videoPass.policy, nativeAudioPolicy);
  assert.deepEqual(restarted.scenes[0].clips[0].takeIds, []);
  assert.equal(restarted.scenes[0].clips[0].selectedTakeId, null);
  assert.equal(restarted.scenes[0].script, before.scenes[0].script);
  assert.deepEqual(restarted.scenes[0].soundPlan, before.scenes[0].soundPlan);
  assert.deepEqual(restarted.history.at(-1).scenes[0].clips[0].takeIds.map(String), [
    String(video._id)
  ]);
  assert.ok(await StudioMedia.exists({ _id: video._id }));
  assert.equal((await state(sceneTarget(), 'animatic')).status, 'approved');
  assert.notEqual((await state(clipTarget(), 'visual')).status, 'approved');
  const requests = await withProject(key, () =>
    app.locals.assistant.automation.plan(sceneTarget())
  );
  assert.equal(requests.filter((r) => r.kind === 'video').length, 1);
  await withProject(key, async () => {
    await Job.create({
      kind: 'video',
      requestId: 'busy',
      target: { episodeId: String(episode._id) },
      status: 'rendering'
    });
    await assert.rejects(
      () => restartVideoPass(String(episode._id), restarted.revision),
      /unfinished/
    );
  });
});

test('a scene spanning orbit and surface cannot approve ambiguous shot locations', async () => {
  await prepare();
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.location': 'Korriban orbit and Academy landing platform' } }
  );
  await review(sceneTarget(), 'script');
  const blocked = await state(sceneTarget(), 'shot-plan');
  assert.equal(blocked.canApprove, false);
  assert.ok(
    blocked.blockers.some((reason) => /own location and physical environment/.test(reason))
  );
  const overview = await request(app).get(base).set(headers).expect(200);
  assert.ok(
    !overview.body.workflowReviews.some(
      (row) => ['storyboard', 'animatic', 'sound-plan'].includes(row.stage) && !row.canApprove
    ),
    'Blocked downstream stages are not actionable pending choices.'
  );
});

test('video automation waits for picture approval before advancing to the next clip', async () => {
  const first = JSON.parse(JSON.stringify(episode.scenes[0].clips[0]));
  first.takeIds = [];
  const second = { ...first, id: 'second', title: 'Second shot' };
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips': [first, second] } }
  );
  await withProject(key, () =>
    StudioAsset.create({
      name: 'Second approved shot',
      kind: 'environment',
      scope: 'episode',
      episodeId: episode._id,
      sceneId: 'scene',
      clipId: 'second',
      finalChoice: { id: 'second-image', mediaIds: [image._id] }
    })
  );
  await prepare();
  const automation = createWorkflowAutomation(production);
  let steps = await withProject(key, () => automation.plan(sceneTarget()));
  assert.deepEqual(
    steps.filter((s) => s.kind === 'video').map((s) => s.target.clipId),
    ['shot']
  );
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.takeIds': [video._id] } }
  );
  steps = await withProject(key, () => automation.plan(sceneTarget()));
  assert.equal(steps.filter((s) => s.kind === 'video').length, 0);
  assert.equal(
    (
      await withProject(key, () => automation.plan(at('clip', episode._id, 'scene', 'second')))
    ).filter((s) => s.kind === 'video').length,
    0,
    'An individual approval cannot bypass an unreviewed video.'
  );
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.production.visualTakeId': String(video._id) } }
  );
  await review(clipTarget(), 'visual');
  steps = await withProject(key, () => automation.plan(sceneTarget()));
  assert.deepEqual(
    steps.filter((s) => s.kind === 'video').map((s) => s.target.clipId),
    ['second']
  );
});

test('one-click picture approval chooses the exact original take and records only its visual review', async () => {
  await prepare();
  const data = (await request(app).get(base).set(headers).expect(200)).body;
  const clip = data.episodes.find((e) => e._id === String(episode._id)).scenes[0].clips[0];
  const payload = { ...clip.pictureReview, takeId: String(video._id), action: 'approve' };
  const result = await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send(payload)
    .expect(200);
  assert.equal(result.body.review.state, 'approved');
  const current = await StudioEpisode.findById(episode._id).lean();
  assert.equal(current.scenes[0].clips[0].production.visualTakeId, String(video._id));
  assert.equal(
    current.scenes[0].clips[0].selectedTakeId,
    null,
    'Picture approval must not approve a final mix.'
  );
  assert.equal((await state(clipTarget(), 'visual')).status, 'approved');
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send(payload)
    .expect(409);
  assert.equal(
    await Job.countDocuments(),
    0,
    'Review only schedules supported work; no provider calls in this test.'
  );
  assert.deepEqual(calls, []);
});

test('an existing video has actionable clip prerequisites while another shot image is unfinished', async () => {
  const first = JSON.parse(JSON.stringify(episode.scenes[0].clips[0]));
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.clips': [
          first,
          { ...first, id: 'unfinished', title: 'Unfinished landing image', takeIds: [] }
        ]
      }
    }
  );
  for (const stage of ['source', 'brief', 'reference:profile'])
    assert.equal((await review(assetTarget(), stage)).status, 200);
  for (const stage of ['source', 'outline'])
    assert.equal((await review(episodeTarget(), stage)).status, 200);
  for (const stage of ['script', 'shot-plan', 'sound-plan'])
    assert.equal((await review(sceneTarget(), stage)).status, 200);
  assert.equal((await state(sceneTarget(), 'storyboard')).canApprove, false);
  let data = (await request(app).get(base).set(headers).expect(200)).body;
  assert.ok(
    data.workflowReviews.some(
      (row) =>
        row.target.scope === 'clip' && row.target.clipId === 'shot' && row.stage === 'storyboard'
    )
  );
  assert.equal((await state(clipTarget(), 'storyboard')).canApprove, true);
  await review(clipTarget(), 'storyboard').then((r) => assert.equal(r.status, 200));
  await review(clipTarget(), 'animatic').then((r) => assert.equal(r.status, 200));
  data = (await request(app).get(base).set(headers).expect(200)).body;
  const savedScene = data.episodes.find((e) => e._id === String(episode._id)).scenes[0];
  assert.ok(savedScene.pictureReviewBlockers.includes('Storyboard continuity'));
  assert.deepEqual(savedScene.clips[0].pictureReviewBlockers, []);
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({
      ...savedScene.clips[0].pictureReview,
      action: 'approve',
      takeId: String(video._id)
    })
    .expect(200);
  assert.equal((await state(clipTarget(), 'visual')).status, 'approved');
  assert.notEqual((await state(sceneTarget(), 'storyboard')).status, 'approved');
  assert.notEqual((await state(sceneTarget(), 'animatic')).status, 'approved');
  await withProject(key, () =>
    assert.rejects(
      () =>
        production.queue({
          kind: 'video',
          requestId: 'replacement-still-needs-revision-review',
          target: { episodeId: String(episode._id), sceneId: 'scene', clipId: 'shot' }
        }),
      /Approve the video revision directions/
    )
  );
  assert.equal(await Job.countDocuments(), 0);
  assert.deepEqual(calls, []);
  const oldFingerprint = (await state(clipTarget(), 'visual')).fingerprint;
  await withProject(key, () =>
    StudioAsset.create({
      name: 'Later approved sibling image',
      kind: 'environment',
      scope: 'episode',
      episodeId: episode._id,
      sceneId: 'scene',
      clipId: 'unfinished',
      finalChoice: { id: 'sibling', mediaIds: [image._id] }
    })
  );
  assert.equal((await state(clipTarget(), 'visual')).fingerprint, oldFingerprint);
  assert.equal((await state(clipTarget(), 'visual')).status, 'approved');
  const newComposition = await withProject(key, () =>
    saveGeneratedMedia(directory, png, 'changed-composition.png')
  );
  await StudioAsset.updateOne(
    { episodeId: episode._id, clipId: 'shot' },
    {
      $set: { 'finalChoice.id': 'changed-own-image', 'finalChoice.mediaIds': [newComposition._id] }
    }
  );
  assert.equal((await state(clipTarget(), 'storyboard')).status, 'needs-review');
  assert.equal((await state(clipTarget(), 'visual')).canApprove, false);
});

test('whole-scene storyboard and animatic approvals cover each clip without duplicate decisions', async () => {
  await prepare();
  for (const stage of ['storyboard', 'animatic']) {
    const row = await state(clipTarget(), stage);
    assert.equal(row.status, 'approved');
    assert.equal(row.coveredByScene, true);
    assert.equal(row.reviewRevision, 0);
  }
});

for (const clipScoped of [false, true])
  test(`adding a character for another shot preserves accepted work (${clipScoped ? 'clip-scoped' : 'scene-wide'})`, async () => {
    const first = JSON.parse(JSON.stringify(episode.scenes[0].clips[0]));
    const second = { ...first, id: 'second', title: 'Landing', takeIds: [] };
    await StudioEpisode.updateOne(
      { _id: episode._id },
      { $set: { 'scenes.0.clips': [first, second] } }
    );
    const secondImage = await withProject(key, () =>
      StudioAsset.create({
        name: 'Landing image',
        kind: 'environment',
        scope: 'episode',
        episodeId: episode._id,
        sceneId: 'scene',
        clipId: 'second',
        finalChoice: { id: 'second-image', mediaIds: [image._id] }
      })
    );
    await prepare();
    await StudioMedia.updateOne(
      { _id: video._id },
      {
        $set: {
          nativeAudio: {
            policy: nativeAudioPolicy,
            episodeId: String(episode._id),
            sceneId: 'scene',
            clipId: 'shot'
          }
        }
      }
    );
    const row = await state(clipTarget(), 'visual');
    await request(app)
      .post(base + '/workflow/review')
      .set(headers)
      .send({ ...row, action: 'approve', takeId: String(video._id) })
      .expect(200);
    const before = await StudioEpisode.findById(episode._id).lean();
    const composition = await StudioAsset.findOne({
      episodeId: episode._id,
      clipId: 'shot'
    }).lean();
    const extra = await withProject(key, () =>
      saveGeneratedMedia(directory, png, 'kory-reference.png')
    );
    const kory = await withProject(key, () =>
      StudioAsset.create({
        name: 'Kory',
        kind: 'character',
        finalChoice: { id: 'kory', mediaIds: [extra._id] },
        production: { managed: false, items: [] }
      })
    );
    const chat = clipScoped
      ? await withProject(key, () =>
          Chat.create({
            title: 'Fix second image',
            context: { episodeId: String(episode._id), sceneId: 'scene', clipId: 'second' }
          })
        )
      : null;
    const scene = JSON.parse(JSON.stringify(before.scenes[0]));
    scene.assetIds.push(String(kory._id));
    scene.script += '\nThe landing shot changes; the door shot is unchanged.';
    if (clipScoped) scene.clips[0].action = 'An unrelated rewrite must be ignored.';
    scene.clips[1].action = 'Deploy gear before descending.';
    scene.clips[1].duration = 5;
    const proposal = await withProject(key, () =>
      makeProposal(chat?._id, {
        episodeId: String(episode._id),
        title: 'Revise landing only',
        explanation: 'Revise only the second shot.',
        scene
      })
    );
    assert.deepEqual(
      proposal.scene.clips[0].production.referenceAssetIds,
      before.scenes[0].assetIds.map(String)
    );
    assert.equal(proposal.scene.clips[0].action, before.scenes[0].clips[0].action);
    if (clipScoped) assert.equal(proposal.scene.script, before.scenes[0].script);
    await request(app)
      .post(base + '/assistant/proposals/' + proposal._id + '/apply')
      .set(headers)
      .send({})
      .expect(200);
    const after = await StudioEpisode.findById(episode._id).lean();
    const allAssets = await StudioAsset.find().lean();
    const intentionallyRevised = {
      ...after.scenes[0].clips[0],
      production: { ...after.scenes[0].clips[0].production, referenceMediaIds: [String(extra._id)] }
    };
    assert.ok(
      clipPrompts(
        after.scenes[0],
        intentionallyRevised,
        allAssets,
        after
      ).referenceMediaIds.includes(String(extra._id))
    );
    assert.ok(
      !clipPrompts(
        after.scenes[0],
        after.scenes[0].clips[0],
        allAssets,
        after
      ).referenceMediaIds.includes(String(extra._id))
    );
    assert.ok(
      clipPrompts(
        after.scenes[0],
        after.scenes[0].clips[1],
        allAssets,
        after
      ).referenceMediaIds.includes(String(extra._id))
    );
    assert.deepEqual(
      (await StudioAsset.findById(composition._id).lean()).finalChoice,
      composition.finalChoice
    );
    assert.equal((await StudioAsset.findById(secondImage._id).lean()).finalChoice, null);
    for (const stage of ['storyboard', 'animatic', 'visual']) {
      const kept = await state(clipTarget(), stage);
      assert.equal(kept.status, 'approved', stage);
      assert.equal(kept.retainedApproval, true, stage);
      assert.deepEqual(kept.blockers, []);
    }
    assert.equal(String(after.scenes[0].clips[0].selectedTakeId), String(video._id));
    assert.notEqual(
      (await state(at('clip', episode._id, 'scene', 'second'), 'storyboard')).status,
      'approved'
    );
    await withProject(key, () =>
      validateMixedSelection(after, after.scenes[0], after.scenes[0].clips[0])
    );
    assert.equal(await Job.countDocuments(), 0);
  });

test('timing changes retain the composition review but reopen that shot timing and video acceptance', async () => {
  await prepare();
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.production.visualTakeId': String(video._id) } }
  );
  await review(clipTarget(), 'visual');
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { 'scenes.0.clips.0.duration': 5 } });
  assert.equal((await state(clipTarget(), 'storyboard')).status, 'approved');
  assert.notEqual((await state(clipTarget(), 'animatic')).status, 'approved');
  assert.notEqual((await state(clipTarget(), 'visual')).status, 'approved');
  assert.ok(
    (await StudioAsset.findOne({ episodeId: episode._id, clipId: 'shot' }).lean()).finalChoice
  );
});
test('movement-only corrections retain the still and sound approvals while reopening the changed animatic', async () => {
  await prepare();
  const imageBefore = (await StudioAsset.findOne({ episodeId: episode._id, clipId: 'shot' }).lean())
    .finalChoice;
  const soundBefore = await state(sceneTarget(), 'sound-plan');
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.clips.0.production.startState': 'Standing at the approved marks.',
        'scenes.0.clips.0.production.allowedMotion': 'Only speak; hold positions and camera.',
        'scenes.0.clips.0.production.endState': 'Same marks for the next stage.'
      }
    }
  );
  assert.equal((await state(clipTarget(), 'storyboard')).status, 'approved');
  assert.notEqual((await state(clipTarget(), 'animatic')).status, 'approved');
  assert.equal((await state(sceneTarget(), 'sound-plan')).status, 'approved');
  assert.equal(
    (await state(sceneTarget(), 'sound-plan')).approvalFingerprint,
    soundBefore.approvalFingerprint
  );
  assert.deepEqual(
    (await StudioAsset.findOne({ episodeId: episode._id, clipId: 'shot' }).lean()).finalChoice,
    imageBefore
  );
});

test('accepted replacement mixes survive unrelated story edits but still reject changed local sound levels', async () => {
  await prepare();
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.production.visualTakeId': String(video._id) } }
  );
  await review(clipTarget(), 'visual');
  let current = await StudioEpisode.findById(episode._id).lean();
  const state = await withProject(key, () =>
    mixState(current, current.scenes[0], current.scenes[0].clips[0], String(video._id))
  );
  const file = await withProject(key, async () =>
    saveGeneratedMedia(directory, await readSmall(), 'accepted-mix.mp4', {
      soundMix: {
        episodeId: String(episode._id),
        sceneId: 'scene',
        clipId: 'shot',
        sourceTakeId: String(video._id),
        fingerprint: state.fingerprint,
        inputFingerprint: state.inputFingerprint
      }
    })
  );
  current.scenes[0].clips[0].takeIds.push(file._id);
  current.scenes[0].clips[0].selectedTakeId = file._id;
  await request(app)
    .put(base + '/episodes/' + episode._id)
    .set(headers)
    .send(current)
    .expect(200);
  const selectedBefore = await StudioEpisode.findById(episode._id).lean();
  const legacy = await withProject(key, () =>
    mixState(
      selectedBefore,
      selectedBefore.scenes[0],
      selectedBefore.scenes[0].clips[0],
      String(video._id)
    )
  );
  const scene = JSON.parse(JSON.stringify(selectedBefore.scenes[0]));
  scene.script += '\nA later arrival beat changes.';
  const proposal = await withProject(key, () =>
    makeProposal(undefined, {
      episodeId: String(episode._id),
      title: 'Story note correction',
      explanation: 'Keep the approved door shot.',
      scene
    })
  );
  await request(app)
    .post(base + '/assistant/proposals/' + proposal._id + '/apply')
    .set(headers)
    .send({})
    .expect(200);
  const after = await StudioEpisode.findById(episode._id).lean();
  await withProject(key, () =>
    validateMixedSelection(after, after.scenes[0], after.scenes[0].clips[0])
  );
  await StudioMedia.updateOne(
    { _id: file._id },
    {
      $set: { 'soundMix.fingerprint': legacy.fingerprint },
      $unset: { 'soundMix.inputFingerprint': 1 }
    }
  );
  await withProject(key, () =>
    validateMixedSelection(after, after.scenes[0], after.scenes[0].clips[0])
  );
  after.scenes[0].soundPlan.layers[0].gainDb += 2;
  await withProject(key, () =>
    assert.rejects(
      () => validateMixedSelection(after, after.scenes[0], after.scenes[0].clips[0]),
      /fresh mix/
    )
  );
});

test('image recovery restores only an unchanged final choice cleared during a matching proposal application', () => {
  const scene = { id: 'scene', clips: [{ id: 'shot', action: 'Approved canyon flight.' }] };
  const before = { revision: 2, updatedAt: '2026-10-24T10:00:00Z', scenes: [scene] };
  const after = {
    revision: 3,
    updatedAt: '2026-10-24T10:01:00Z',
    scenes: [{ ...scene, script: 'Revise another shot.' }]
  };
  const finalChoice = { id: 'chosen', mediaIds: ['image'], finalizedAt: '2026-10-24T09:00:00Z' };
  const asset = {
    _id: 'asset',
    episodeId: 'episode',
    sceneId: 'scene',
    clipId: 'shot',
    revision: 5,
    updatedAt: '2026-10-24T10:01:00.200Z',
    reviewStatus: 'pending-choice',
    finalChoice: null,
    candidates: [{ id: 'chosen', mediaIds: ['image'] }],
    history: [{ revision: 4, finalChoice }]
  };
  const data = {
    assets: [asset],
    episodes: [{ ...after, _id: 'episode', history: [before] }],
    media: [{ _id: 'image', kind: 'image' }],
    reviews: []
  };
  const proposals = [
    {
      _id: 'proposal',
      status: 'applied',
      episodeId: 'episode',
      scene: { id: 'scene' },
      baseRevision: 2,
      updatedAt: '2026-10-24T10:01:00.300Z'
    }
  ];
  const recovered = approvalRecoveryPlan(data, proposals).restorations;
  assert.equal(recovered.length, 1);
  assert.deepEqual(recovered[0].finalChoice, finalChoice);
  data.episodes[0].scenes = [
    { ...scene, clips: [{ id: 'shot', action: 'Different landing composition.' }] }
  ];
  assert.equal(approvalRecoveryPlan(data, proposals).restorations.length, 0);
  data.episodes[0].scenes = [scene];
  data.media = [];
  assert.equal(approvalRecoveryPlan(data, proposals).restorations.length, 0);
  data.media = [{ _id: 'image', kind: 'image' }];
  asset.updatedAt = '2026-10-24T11:00:00Z';
  assert.equal(approvalRecoveryPlan(data, proposals).restorations.length, 0);
});

test('completed upscales validate and save immediately without reapproving the picture or starting production', async () => {
  await prepare();
  await StudioMedia.updateOne(
    { _id: video._id },
    {
      $set: {
        nativeAudio: {
          policy: nativeAudioPolicy,
          episodeId: String(episode._id),
          sceneId: 'scene',
          clipId: 'shot'
        }
      }
    }
  );
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.production.visualTakeId': String(video._id) } }
  );
  await review(clipTarget(), 'visual');
  let saved = await StudioEpisode.findById(episode._id).lean();
  const selected = saved.scenes[0].clips[0].selectedTakeId;
  const visual = await StudioReview.findOne({ stage: 'visual' }).lean();
  const jobs = await Job.countDocuments();
  const submit = async (mediaId, revision = saved.revision) =>
    request(app)
      .post(base + '/workflow/upscale/import')
      .set(headers)
      .send({
        target: clipTarget(),
        parentRevision: revision,
        sourceTakeId: String(selected),
        mediaId: String(mediaId)
      });
  const bad = await submit(video._id);
  assert.equal(bad.status, 400);
  assert.equal((await StudioEpisode.findById(episode._id).lean()).revision, saved.revision);
  const wrong = await StudioMedia.create({ projectKey: key, kind: 'video', filename: 'small.mp4' });
  const dimensions = await submit(wrong._id);
  assert.equal(dimensions.status, 400);
  assert.match(dimensions.body.message, /2560/);
  const result = await submit(upscale._id);
  assert.equal(result.status, 200, result.body.message);
  saved = await StudioEpisode.findById(episode._id).lean();
  const clip = saved.scenes[0].clips[0];
  assert.equal(clip.production.upscaleMediaId, String(upscale._id));
  assert.equal(clip.production.upscaleSourceTakeId, String(selected));
  assert.equal(clip.upscale.status, 'imported');
  assert.equal(clip.upscale.verified.width, 2560);
  assert.equal(String(clip.selectedTakeId), String(selected));
  assert.deepEqual(await StudioReview.findOne({ stage: 'visual' }).lean(), visual);
  assert.equal(await Job.countDocuments(), jobs);
  assert.equal((await state(clipTarget(), 'upscale')).status, 'pending-review');
  await submit(upscale._id, saved.revision - 1).then((r) => assert.equal(r.status, 409));
  await review(clipTarget(), 'upscale');
  assert.equal((await state(clipTarget(), 'upscale')).status, 'approved');
  const rounded = await withProject(key, async () =>
    saveGeneratedMedia(
      directory,
      await readFile(join(directory, 'upscale-rounded.mp4')),
      'upscale-rounded.mp4'
    )
  );
  const imported = await submit(rounded._id);
  assert.equal(imported.status, 200, imported.body.message);
  saved = await StudioEpisode.findById(episode._id).lean();
  assert.equal(saved.scenes[0].clips[0].upscale.verified.width, 2562);
  assert.equal((await state(clipTarget(), 'upscale')).status, 'needs-review');
  assert.equal((await state(clipTarget(), 'visual')).status, 'approved');
  assert.equal((await review(clipTarget(), 'upscale')).status, 200);
});

test('historical approval recovery verifies owner evidence and skips requested changes and unknown fingerprints', async () => {
  await prepare();
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.production.visualTakeId': String(video._id) } }
  );
  await review(clipTarget(), 'visual');
  await withProject(key, async () => {
    const [assets, episodes, media, reviews] = await Promise.all([
      StudioAsset.find().lean(),
      StudioEpisode.find().lean(),
      StudioMedia.find().lean(),
      StudioReview.find().lean()
    ]);
    for (const r of reviews) delete r.approvalFingerprint;
    const data = { assets, episodes, media, reviews };
    const plan = approvalRecoveryPlan(data, []);
    assert.equal(plan.bindings.find((b) => b.stage === 'visual').target.clipId, 'shot');
    const visual = reviews.find((r) => r.target.scope === 'clip' && r.stage === 'visual');
    visual.fingerprint = 'unverifiable';
    assert.ok(approvalRecoveryPlan(data, []).skipped.some((s) => s.id === String(visual._id)));
    visual.state = 'changes-requested';
    assert.ok(!approvalRecoveryPlan(data, []).bindings.some((s) => s.id === String(visual._id)));
  });
});

test('continuity images are actual primary provider references and changed source choices stop a queued image before a charge', async () => {
  const first = JSON.parse(JSON.stringify(episode.scenes[0].clips[0]));
  const next = { ...first, id: 'next', title: 'Matching set', takeIds: [] };
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips': [first, next] } }
  );
  const source = await withProject(key, () =>
    saveGeneratedMedia(directory, png, 'continuity-source.png', {
      providerReference: {
        id: 'fake-continuity',
        url: 'https://cdn.openart.ai/continuity-source.png'
      }
    })
  );
  await StudioAsset.updateOne(
    { episodeId: episode._id, clipId: 'shot' },
    { $set: { 'finalChoice.mediaIds': [source._id] } }
  );
  for (const stage of ['source', 'brief', 'reference:profile']) await review(assetTarget(), stage);
  for (const stage of ['source', 'outline']) await review(episodeTarget(), stage);
  for (const stage of ['script', 'shot-plan', 'sound-plan'])
    assert.equal((await review(sceneTarget(), stage)).status, 200);
  const target = { episodeId: String(episode._id), sceneId: 'scene', clipId: 'next' };
  const job = await withProject(key, () =>
    production.queue({ requestId: 'continuity-image', kind: 'image', target })
  );
  assert.equal(job.snapshot.continuity.sources[0].clipId, 'shot');
  const built = await withProject(key, () => production.build(job));
  assert.equal(built.params.visualReferences[0].id, 'fake-continuity');
  assert.equal(built.params.visualReferences[1].id, 'fake-image');
  assert.match(built.params.prompt, /SHOT-TO-SHOT CONTINUITY/);
  await StudioAsset.updateOne(
    { episodeId: episode._id, clipId: 'shot' },
    { $set: { reviewStatus: 'pending-choice' } }
  );
  await production.processJob(job);
  const failed = await Job.findById(job._id).lean();
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /Approve the continuity image/);
  assert.deepEqual(calls, []);
});

async function prepareIndividualShots() {
  const first = JSON.parse(JSON.stringify(episode.scenes[0].clips[0]));
  first.takeIds = [];
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.clips': [first, { ...first, id: 'unfinished', title: 'Unfinished sibling image' }]
      }
    }
  );
  for (const stage of ['source', 'brief', 'reference:profile'])
    assert.equal((await review(assetTarget(), stage)).status, 200);
  for (const stage of ['source', 'outline'])
    assert.equal((await review(episodeTarget(), stage)).status, 200);
  for (const stage of ['script', 'shot-plan', 'sound-plan'])
    assert.equal((await review(sceneTarget(), stage)).status, 200);
}

async function jointShotReview() {
  const reviews = {};
  for (const stage of ['storyboard', 'animatic']) {
    const row = await state(clipTarget(), stage);
    reviews[stage] = {
      approvalFingerprint: row.approvalFingerprint,
      reviewRevision: row.reviewRevision
    };
  }
  return {
    target: clipTarget(),
    parentRevision: (await StudioEpisode.findById(episode._id).lean()).revision,
    reviews
  };
}

test('scene-local saves retain other scenes and generated files, preserve custom prompts, and do not start paid work', async () => {
  const later = JSON.parse(JSON.stringify(episode.scenes[0]));
  later.id = 'later';
  later.clips[0].id = 'later-shot';
  await StudioEpisode.updateOne({ _id: episode._id }, { $push: { scenes: later } });
  await prepare();
  const board = (
    await request(app)
      .post(base + '/workflow/board')
      .set(headers)
      .send({ target: episodeTarget() })
      .expect(200)
  ).body;
  const original = await StudioEpisode.findById(episode._id).lean();
  const scene = structuredClone(board.record.scenes[1]);
  scene.clips[0].production.imagePrompt =
    'Exact editable Star Wars image prompt. Preserve the approved character.';
  scene.clips[0].production.videoPrompt = 'Animate only the selected frame. No exits or music.';
  const body = {
    target: { scope: 'scene', recordId: String(episode._id), sceneId: 'later' },
    editToken: scene.editToken,
    scene
  };
  // An unrelated episode revision is compatible with this scene edit token.
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { synopsis: 'An unrelated summary update.' }, $inc: { revision: 1 } }
  );
  await request(app)
    .post(base + '/workflow/scene/save')
    .set(headers)
    .send(body)
    .expect((response) => assert.equal(response.status, 200, response.body.message));
  const after = await StudioEpisode.findById(episode._id).lean();
  assert.deepEqual(after.scenes[0], original.scenes[0]);
  assert.equal(after.scenes[1].production.manualGeneration, true);
  assert.equal(
    after.scenes[1].clips[0].production.imagePrompt,
    scene.clips[0].production.imagePrompt
  );
  assert.equal(
    after.scenes[1].clips[0].production.videoPrompt,
    scene.clips[0].production.videoPrompt
  );
  assert.deepEqual(after.scenes[1].clips[0].takeIds, original.scenes[1].clips[0].takeIds);
  assert.equal(after.synopsis, 'An unrelated summary update.');
  await request(app)
    .post(base + '/workflow/scene/save')
    .set(headers)
    .send(body)
    .expect(409);
  assert.equal(await Job.countDocuments(), 0);
});

test('the image button quotes and sends the exact saved prompt once without automatically generating a video', async () => {
  await prepare();
  const board = (
    await request(app)
      .post(base + '/workflow/board')
      .set(headers)
      .send({ target: episodeTarget() })
      .expect(200)
  ).body;
  const scene = board.record.scenes[0];
  scene.clips[0].production.imagePrompt =
    'Star Wars universe. Exact saved image prompt. Same approved adult, same door, 16:9. No text.';
  await request(app)
    .post(base + '/workflow/scene/save')
    .set(headers)
    .send({ target: sceneTarget(), editToken: scene.editToken, scene })
    .expect((response) => assert.equal(response.status, 200, response.body.message));
  const current = await StudioEpisode.findById(episode._id).lean();
  const preview = (
    await request(app)
      .post(base + '/workflow/board')
      .set(headers)
      .send({ target: episodeTarget() })
      .expect(200)
  ).body.shotPrompts.find((shot) => shot.clipId === scene.clips[0].id);
  assert.ok(preview.image.startsWith(scene.clips[0].production.imagePrompt));
  assert.match(preview.image, /@image1:/);
  const body = {
    target: clipTarget(),
    parentRevision: current.revision,
    prompt: preview.image,
    imageReferenceIds: preview.imageReferences.selected,
    requestId: 'manual-image-button'
  };
  await request(app)
    .post(base + '/workflow/shot/image')
    .set(headers)
    .send({ ...body, prompt: 'Wrong draft' })
    .expect(409);
  await request(app)
    .post(base + '/workflow/shot/image')
    .set(headers)
    .send({ ...body, imageReferenceIds: ['stale-preview'] })
    .expect(409);
  const first = (
    await request(app)
      .post(base + '/workflow/shot/image')
      .set(headers)
      .send(body)
      .expect(202)
  ).body;
  const repeated = (
    await request(app)
      .post(base + '/workflow/shot/image')
      .set(headers)
      .send(body)
      .expect(202)
  ).body;
  assert.equal(first.jobId, repeated.jobId);
  await production.processJob(await Job.findById(first.jobId).lean());
  const job = await Job.findById(first.jobId).lean();
  assert.equal(job.status, 'rendering', job.error);
  assert.equal(job.settings.params.prompt, body.prompt);
  assert.match(job.settings.params.visualReferences[0].label, /^image1 - /);
  assert.ok(
    job.settings.params.visualReferences.every((reference) => !reference.label.startsWith('@'))
  );
  assert.equal(await Job.countDocuments({ kind: 'video' }), 0);
  assert.ok(
    !(await withProject(key, () => app.locals.assistant.automation.plan(sceneTarget()))).some(
      (step) => ['image', 'video'].includes(step.kind)
    )
  );
});

test('scene image selections persist exact attachments and an empty selection without changing other shot inputs', async () => {
  await prepare();
  async function board() {
    return (
      await request(app)
        .post(base + '/workflow/board')
        .set(headers)
        .send({ target: episodeTarget() })
        .expect(200)
    ).body;
  }
  const before = await board();
  const original = before.record.scenes[0];
  const siblings = structuredClone(original.clips.slice(1));
  const sixteen = await withProject(key, () =>
    Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        StudioMedia.create({
          ...image,
          _id: undefined,
          originalName: `reference-${i}.png`,
          metadata: {
            ...image.metadata,
            providerReference: { id: `fake-image-${i}`, url: 'https://cdn.openart.ai/fake.png' }
          }
        })
      )
    )
  );
  for (const ids of [[String(image._id)], sixteen.map((file) => String(file._id)), []]) {
    const current = await board();
    const scene = current.record.scenes[0];
    scene.clips[0].production.imageReferenceMediaIds = ids;
    scene.clips[0].production.imagePrompt = 'Exact image directions.';
    await request(app)
      .post(base + '/workflow/scene/save')
      .set(headers)
      .send({ target: sceneTarget(), editToken: scene.editToken, scene })
      .expect(200);
    const updated = await board();
    assert.deepEqual(updated.record.scenes[0].clips[0].production.imageReferenceMediaIds, ids);
    assert.deepEqual(updated.record.scenes[0].clips.slice(1), siblings);
    assert.deepEqual(
      updated.record.scenes[0].clips[0].production.referenceMediaIds,
      original.clips[0].production.referenceMediaIds
    );
    const preview = updated.shotPrompts.find((shot) => shot.clipId === scene.clips[0].id);
    assert.deepEqual(preview.imageReferences.selected, ids);
    if (!ids.length) assert.equal(preview.image, 'Exact image directions.');
    else assert.match(preview.image, /@image1:/);
  }
  assert.equal(await Job.countDocuments(), 0);
});
test('the explicit video button uses the saved video prompt, retains an existing take, and queues only one replacement', async () => {
  await prepareIndividualShots();
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.takeIds': [video._id] } }
  );
  const board = (
    await request(app)
      .post(base + '/workflow/board')
      .set(headers)
      .send({ target: episodeTarget() })
      .expect(200)
  ).body;
  const scene = board.record.scenes[0];
  scene.clips[0].production.videoPrompt =
    'Star Wars universe. Animate the approved frame. Locked camera and fixed background. The character stays planted. Wind ambience, no speech or music.';
  await request(app)
    .post(base + '/workflow/scene/save')
    .set(headers)
    .send({ target: sceneTarget(), editToken: scene.editToken, scene })
    .expect(200);
  const body = {
    ...(await jointShotReview()),
    generate: true,
    prompt: (
      await request(app)
        .post(base + '/workflow/board')
        .set(headers)
        .send({ target: episodeTarget() })
        .expect(200)
    ).body.shotPrompts.find((shot) => shot.clipId === scene.clips[0].id).video,
    requestId: 'explicit-video-replacement'
  };
  await request(app)
    .post(base + '/workflow/shot/approve')
    .set(headers)
    .send({ ...body, prompt: 'Unsaved text' })
    .expect(409);
  const response = (
    await request(app)
      .post(base + '/workflow/shot/approve')
      .set(headers)
      .send(body)
      .expect(202)
  ).body;
  assert.equal(await Job.countDocuments({ kind: 'video' }), 1);
  const repeated = (
    await request(app)
      .post(base + '/workflow/shot/approve')
      .set(headers)
      .send(body)
      .expect(200)
  ).body;
  assert.equal(repeated.jobId, response.jobId);
  const job = await Job.findById(response.jobId).lean();
  await production.processJob(job);
  const submitted = await Job.findById(job._id).lean();
  assert.equal(submitted.status, 'rendering', submitted.error);
  assert.equal(submitted.settings.params.prompt, body.prompt);
  assert.ok(
    (await StudioEpisode.findById(episode._id).lean()).scenes[0].clips[0].takeIds
      .map(String)
      .includes(String(video._id))
  );
  assert.equal(calls.filter((call) => call === 'openart_generate_video').length, 1);
});

test('one shot approval covers composition and timing and queues only that shot, with repeat clicks retaining the same reviews and job', async () => {
  await prepareIndividualShots();
  const board = (
    await request(app)
      .post(base + '/workflow/board')
      .set(headers)
      .send({ target: episodeTarget() })
      .expect(200)
  ).body;
  assert.equal(board.layout, 'scenes');
  assert.equal((await state(clipTarget(), 'storyboard')).status, 'pending-review');
  const body = await jointShotReview();
  const approved = await request(app)
    .post(base + '/workflow/shot/approve')
    .set(headers)
    .send(body)
    .expect(200);
  assert.equal(approved.body.approved, true);
  for (const stage of ['storyboard', 'animatic'])
    assert.equal((await state(clipTarget(), stage)).status, 'approved');
  const before = await StudioReview.find({ 'target.clipId': 'shot' })
    .select('stage revision')
    .lean();
  await request(app)
    .post(base + '/workflow/shot/approve')
    .set(headers)
    .send(body)
    .expect(200);
  assert.deepEqual(
    await StudioReview.find({ 'target.clipId': 'shot' }).select('stage revision').lean(),
    before
  );
  while (await StudioAutomation.exists({ status: 'queued' }))
    await app.locals.assistant.automation.processNext();
  const jobs = await Job.find({ kind: 'video' }).lean();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].target.clipId, 'shot');
  assert.equal(jobs[0].status, 'queued');
  assert.notEqual(
    (await state({ ...clipTarget(), clipId: 'unfinished' }, 'animatic')).status,
    'approved'
  );
  assert.deepEqual(calls, []);
});

test('joint shot approval rejects stale reviewed inputs and uncertain submissions for this same shot', async () => {
  await prepareIndividualShots();
  const body = await jointShotReview();
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: { 'scenes.0.clips.0.production.endState': 'Hold the final mark.' }
    }
  );
  assert.match(
    (
      await request(app)
        .post(base + '/workflow/shot/approve')
        .set(headers)
        .send(body)
        .expect(409)
    ).body.message,
    /review changed/
  );
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $unset: { 'scenes.0.clips.0.production.endState': '' } }
  );
  await withProject(key, () =>
    Job.create({
      kind: 'video',
      status: 'uncertain',
      requestId: 'other-in-flight',
      target: { episodeId: String(episode._id), sceneId: 'scene', clipId: 'shot' }
    })
  );
  assert.match(
    (
      await request(app)
        .post(base + '/workflow/shot/approve')
        .set(headers)
        .send(body)
        .expect(409)
    ).body.message,
    /This shot has a video submission with an unknown outcome/
  );
  assert.equal(await StudioReview.countDocuments({ 'target.scope': 'clip', state: 'approved' }), 0);
  assert.deepEqual(calls, []);
});
test('an earlier shot can generate while a later shot has an unreviewed take and an active request', async () => {
  await prepareIndividualShots();
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.1.takeIds': [video._id] } }
  );
  await withProject(key, () =>
    Job.create({
      kind: 'video',
      status: 'rendering',
      requestId: 'later-shot-active',
      target: { episodeId: String(episode._id), sceneId: 'scene', clipId: 'unfinished' }
    })
  );
  const board = (
    await request(app)
      .post(base + '/workflow/board')
      .set(headers)
      .send({ target: episodeTarget(), boardVersion: 3 })
      .expect(200)
  ).body;
  const body = {
    ...(await jointShotReview()),
    generate: true,
    prompt: board.shotPrompts.find((prompt) => prompt.clipId === 'shot').video,
    requestId: 'earlier-shot-manual'
  };
  const result = (
    await request(app)
      .post(base + '/workflow/shot/approve')
      .set(headers)
      .send(body)
      .expect(202)
  ).body;
  const job = await Job.findById(result.jobId).lean();
  assert.equal(job.target.clipId, 'shot');
  assert.equal(job.status, 'queued');
  assert.notEqual(
    (await state({ ...clipTarget(), clipId: 'unfinished' }, 'visual')).status,
    'approved'
  );
  assert.equal((await Job.findOne({ requestId: 'later-shot-active' }).lean()).status, 'rendering');
  assert.deepEqual(calls, []);
});

test('dialogue approval on the shot board saves only the selected take and rejects a foreign shot or stale episode', async () => {
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.clips.0.dialogue': 'ROXY: Hello.',
        'scenes.0.clips.0.dialogueTakeIds': [String(audio._id)]
      }
    }
  );
  const before = await StudioEpisode.findById(episode._id).lean();
  const body = {
    target: clipTarget(),
    parentRevision: before.revision,
    mediaId: String(audio._id)
  };
  await request(app)
    .post(base + '/workflow/shot/dialogue')
    .set(headers)
    .send({ ...body, mediaId: String(image._id) })
    .expect(409);
  const saved = (
    await request(app)
      .post(base + '/workflow/shot/dialogue')
      .set(headers)
      .send(body)
      .expect(200)
  ).body.episode;
  assert.equal(saved.scenes[0].clips[0].selectedDialogueId, String(audio._id));
  assert.equal(saved.revision, before.revision + 1);
  assert.deepEqual(saved.scenes[0].clips[0].takeIds, before.scenes[0].clips[0].takeIds.map(String));
  assert.equal(saved.scenes[0].script, before.scenes[0].script);
  await request(app)
    .post(base + '/workflow/shot/dialogue')
    .set(headers)
    .send(body)
    .expect(409);
  assert.equal(await Job.countDocuments(), 0);
});

test('an approved shot downloads without an episode package or music approval and remains approved when another scene changes', async () => {
  await StudioProject.updateOne({ key }, { $set: { videoWorkflow: 'native-1080p' } });
  const later = JSON.parse(JSON.stringify(episode.scenes[0]));
  later.id = 'later-scene';
  later.title = 'Later scene';
  later.clips = [{ ...later.clips[0], id: 'later-shot', title: 'Later shot', takeIds: [] }];
  await StudioEpisode.updateOne({ _id: episode._id }, { $push: { scenes: later } });
  await prepare();
  const path = base + '/workflow/shot/' + episode._id + '/scene/shot/video';
  await request(app).get(path).set(headers).expect(200);
  const bytes = await readFile(join(directory, 'native-1080.mp4'));
  const native = await withProject(key, () =>
    saveGeneratedMedia(directory, bytes, 'approved-opening.mp4', {
      nativeAudio: {
        policy: nativeAudioPolicy,
        episodeId: String(episode._id),
        sceneId: 'scene',
        clipId: 'shot'
      }
    })
  );
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.takeIds': [native._id] } }
  );
  const row = await state(clipTarget(), 'visual');
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...row, action: 'approve', takeId: String(native._id) })
    .expect(200);
  const first = await request(app).get(path).set(headers).expect(200);
  assert.match(first.headers['content-disposition'], /attachment;.*approved-opening\.mp4/);
  assert.match(first.headers['content-type'], /video\/mp4/);
  assert.notEqual((await state(episodeTarget(), 'export')).status, 'approved');
  const before = await state(clipTarget(), 'visual');
  const updated = await StudioEpisode.findById(episode._id).lean();
  updated.scenes[1].script += ' A different staging direction.';
  updated.scenes[1].clips[0].action = 'A new camera-side action for only the later scene.';
  await request(app)
    .put(base + '/episodes/' + episode._id)
    .set(headers)
    .send(updated)
    .expect(200);
  assert.equal((await state(clipTarget(), 'visual')).status, 'approved');
  assert.equal(
    (await state(clipTarget(), 'visual')).approvalFingerprint,
    before.approvalFingerprint
  );
  await request(app).get(path).set(headers).expect(200);
  await request(app)
    .get(base + '/workflow/shot/' + episode._id + '/later-scene/later-shot/video')
    .set(headers)
    .expect(404);
  assert.equal(await Job.countDocuments({ kind: 'video' }), 0);
});

test('individual storyboard unlocks timing, then timing queues one native video without sibling images or batch reviews', async () => {
  await prepareIndividualShots();
  let data = (await request(app).get(base).set(headers).expect(200)).body;
  assert.ok(
    data.workflowReviews.some((r) => r.target.clipId === 'shot' && r.stage === 'storyboard')
  );
  assert.ok(
    !data.workflowReviews.some(
      (r) => r.target.scope === 'scene' && ['storyboard', 'animatic'].includes(r.stage)
    )
  );
  const storyboard = await review(clipTarget(), 'storyboard');
  assert.equal(storyboard.status, 200);
  assert.match(storyboard.body.progress.message, /Timed animatic/);
  assert.equal(await Job.countDocuments({ kind: 'video' }), 0);
  const timed = await review(clipTarget(), 'animatic');
  assert.equal(timed.status, 200);
  assert.equal(timed.body.automation?.status, 'queued');
  const busy = await withProject(key, () =>
    Job.create({
      requestId: 'other-active-video',
      kind: 'video',
      target: { episodeId: String(episode._id), sceneId: 'another-scene', clipId: 'another-shot' },
      status: 'rendering'
    })
  );
  assert.deepEqual(
    await withProject(key, () => app.locals.assistant.automation.plan(clipTarget())),
    []
  );
  await Job.deleteOne({ _id: busy._id });
  const steps = await withProject(key, () => app.locals.assistant.automation.plan(clipTarget()));
  const sceneSteps = await withProject(key, () =>
    app.locals.assistant.automation.plan(sceneTarget())
  );
  assert.equal(steps[0]?.kind, 'video');
  assert.equal(steps[0].requestId, sceneSteps.find((r) => r.kind === 'video').requestId);
  while (await StudioAutomation.exists({ status: 'queued' }))
    await app.locals.assistant.automation.processNext();
  assert.equal(await Job.countDocuments({ kind: 'video' }), 1);
  const job = await Job.findOne({ kind: 'video' }).lean();
  await production.processJob(job);
  const rendered = await Job.findById(job._id).lean();
  assert.equal(rendered.status, 'rendering', rendered.error);
  assert.equal(rendered.settings.params.audio, true);
  assert.match(rendered.settings.params.prompt, /No music/);
  assert.equal(calls.filter((c) => c === 'openart_generate_video').length, 1);
  assert.notEqual((await state(sceneTarget(), 'animatic')).status, 'approved');
  assert.equal((await state(clipTarget(), 'animatic')).status, 'approved');
  assert.deepEqual(
    await withProject(key, () => app.locals.assistant.automation.plan(clipTarget())),
    []
  );
  data = (
    await request(app)
      .post(base + '/workflow/board')
      .set(headers)
      .send({ target: episodeTarget() })
      .expect(200)
  ).body;
  assert.ok(data.groups.some((g) => g.optional && g.stages.some((r) => r.stage === 'animatic')));
});

test('a queued individual video rechecks its own storyboard approval before any provider calls', async () => {
  await prepareIndividualShots();
  await review(clipTarget(), 'storyboard');
  await review(clipTarget(), 'animatic');
  const steps = await withProject(key, () => app.locals.assistant.automation.plan(clipTarget()));
  const job = await withProject(key, () => production.queue(steps[0]));
  await review(clipTarget(), 'storyboard', 'unapprove');
  await production.processJob(job);
  const failed = await Job.findById(job._id).lean();
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /Timed animatic needs approval/);
  assert.deepEqual(calls, []);
});

test('an individually approved later shot can render while an earlier composition is unfinished', async () => {
  await prepareIndividualShots();
  await StudioAsset.updateOne(
    { episodeId: episode._id, clipId: 'shot' },
    { $set: { finalChoice: null } }
  );
  await withProject(key, () =>
    StudioAsset.create({
      name: 'Later shot composition',
      kind: 'environment',
      scope: 'episode',
      episodeId: episode._id,
      sceneId: 'scene',
      clipId: 'unfinished',
      finalChoice: { id: 'later', mediaIds: [image._id] }
    })
  );
  const later = at('clip', episode._id, 'scene', 'unfinished');
  await review(later, 'storyboard');
  const approval = await review(later, 'animatic');
  assert.equal(approval.body.automation?.status, 'queued');
  const steps = await withProject(key, () => app.locals.assistant.automation.plan(later));
  assert.equal(steps[0]?.target.clipId, 'unfinished');
  const job = await withProject(key, () => production.queue(steps[0]));
  assert.equal(job.status, 'queued');
  assert.deepEqual(
    await withProject(key, () => app.locals.assistant.automation.plan(sceneTarget())).then((r) =>
      r.filter((step) => step.kind === 'video')
    ),
    []
  );
});

test('picture approval rejects foreign takes and missing prerequisites without changing the selected picture', async () => {
  let row = await state(clipTarget(), 'visual');
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...row, action: 'approve', takeId: String(video._id) })
    .expect(409);
  assert.equal((await StudioEpisode.findById(episode._id).lean()).revision, 0);
  assert.equal(
    (await StudioEpisode.findById(episode._id).lean()).scenes[0].clips[0].production.visualTakeId,
    undefined
  );
  await prepare();
  row = await state(clipTarget(), 'visual');
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...row, action: 'approve', takeId: String(upscale._id) })
    .expect(400);
  assert.equal(
    (await StudioEpisode.findById(episode._id).lean()).scenes[0].clips[0].production.visualTakeId,
    undefined
  );
  await review(sceneTarget(), 'animatic', 'unapprove');
  row = await state(clipTarget(), 'visual');
  await request(app)
    .post(base + '/workflow/review')
    .set(headers)
    .send({ ...row, action: 'approve', takeId: String(video._id) })
    .expect(409);
  assert.equal(
    (await StudioEpisode.findById(episode._id).lean()).scenes[0].clips[0].production.visualTakeId,
    undefined
  );
  assert.equal(await Job.countDocuments(), 0);
});
