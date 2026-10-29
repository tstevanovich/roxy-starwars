import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { studioContext } from '../src/assistant/chat.js';
import { Chat, Job, Proposal } from '../src/assistant/models.js';
import { speakerVoice } from '../src/assistant/production.js';
import { createSecretStore } from '../src/assistant/store.js';
import {
  StudioAsset,
  StudioEpisode,
  StudioMedia,
  StudioProject,
  StudioSettings
} from '../src/models/Studio.js';
import { initializeInquisitor, inquisitorKey } from '../src/old-republic.js';
import { projectEra, projectKey } from '../src/project-context.js';
import { withProject } from '../src/projects.js';
import { saveGeneratedMedia } from '../src/studio-media.js';
import { clipPrompts, productionVideoPrompt } from '../src/studio-prompts.js';
let mongo, directory, app, originalMedia, legacyData, initialized;
const base = '/api/studio',
  header = { 'X-Studio-Project': inquisitorKey };
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
  'base64'
);
before(
  async () => {
    directory = await mkdtemp(join(tmpdir(), 'roxy-project-test-'));
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri('project_tests'));
  },
  { timeout: 180000 }
);
beforeEach(async () => {
  for (const Model of [
    StudioAsset,
    StudioEpisode,
    StudioMedia,
    StudioProject,
    StudioSettings,
    Chat,
    Job,
    Proposal
  ])
    await Model.deleteMany({});
  app = createApp({ auth: false, mediaDirectory: directory });
  legacyData = (await request(app).get(base).expect(200)).body;
  originalMedia = (
    await saveGeneratedMedia(directory, png, 'legacy-roxy.png', {
      providerReference: { id: 'reference', url: 'https://cdn.openart.ai/test.png' }
    })
  ).toObject();
  await StudioAsset.updateOne(
    { seedKey: 'roxy' },
    { $set: { finalChoice: { id: 'identity', mediaIds: [String(originalMedia._id)] } } }
  );
  (
    await StudioEpisode.create({
      title: 'Original Imperial episode',
      scenes: [],
      notes: 'Preserve original choices'
    })
  ).toObject();
  legacyData = (await request(app).get(base).expect(200)).body;
  initialized = await initializeInquisitor();
});
after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true });
});
test('initialization is idempotent and preserves all original records, settings and approvals', async () => {
  await initializeInquisitor();
  const legacy = (await request(app).get(base).expect(200)).body;
  for (const key of ['assets', 'episodes', 'media', 'settings'])
    assert.deepEqual(legacy[key], legacyData[key]);
  assert.equal(await StudioProject.countDocuments(), 1);
  assert.equal(await StudioEpisode.countDocuments({ projectKey: inquisitorKey }), 1);
  assert.equal(await StudioAsset.countDocuments({ projectKey: inquisitorKey }), 5);
  const next = (await request(app).get(base).set(header).expect(200)).body;
  assert.equal(next.settings.vlogPercent, 0);
  assert.equal(next.settings.cinematicOnly, true);
  assert.equal(next.assets.length, 5);
  assert.equal(next.episodes.length, 1);
  assert.equal(next.project.classStory, 'Sith Inquisitor');
  assert.equal(next.episodes[0].sourceReferences[0].startSeconds, 1007.16);
  assert.equal(next.episodes[0].sourceReferences[0].status, 'unreviewed');
  assert.equal(next.episodes[0].decisions.length, 0);
  assert.equal(next.assets.find((a) => a.kind === 'voice').finalChoice, null);
  assert.ok(!next.assets.some((a) => a.name === 'AL-1B' || a.seedKey === 'fortune'));
  assert.ok(next.media.some((m) => m._id === String(originalMedia._id)));
});
test('workspace boundaries reject foreign edits, episode asset links, media and chat IDs', async () => {
  const legacyAsset = legacyData.assets[0];
  await request(app)
    .post(`${base}/assets/${legacyAsset._id}/reopen`)
    .set(header)
    .send({ revision: legacyAsset.revision })
    .expect(404);
  const body = {
    title: 'Bad scene',
    scenes: [
      {
        id: 'scene',
        title: 'Wrong asset',
        style: 'cinematic',
        assetIds: [legacyAsset._id],
        clips: []
      }
    ]
  };
  await request(app)
    .post(base + '/episodes')
    .set(header)
    .send(body)
    .expect(400);
  const unrelated = (await saveGeneratedMedia(directory, png, 'unshared-legacy.png')).toObject();
  await request(app).get(`${base}/media/${unrelated._id}`).set(header).expect(400);
  await request(app).get(`${base}/media/${originalMedia._id}`).set(header).expect(200);
  const chat = (
    await request(app)
      .post(base + '/assistant/chats')
      .send({ title: 'Legacy chat' })
      .expect(201)
  ).body.chat;
  await request(app)
    .get(base + '/assistant/chats/' + chat._id)
    .set(header)
    .expect(404);
  await request(app)
    .post(base + '/assistant/chats/' + chat._id + '/messages')
    .set(header)
    .send({ text: 'Foreign', requestId: 'foreign' })
    .expect(404);
  const created = (
    await request(app)
      .post(base + '/assets')
      .set(header)
      .send({ name: 'New prop', kind: 'prop', projectKey: 'imperial-smuggler' })
      .expect(201)
  ).body.asset;
  assert.equal(created.projectKey, inquisitorKey);
  await request(app)
    .post(`${base}/assets/${created._id}/reopen`)
    .send({ revision: created.revision })
    .expect(404);
});
test('new uploads and downloads retain their workspace and preserve legacy identity sources from deletion', async () => {
  const upload = (
    await request(app)
      .post(base + '/media')
      .set(header)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'new.png')
      .send(png)
      .expect(201)
  ).body.media;
  assert.equal(upload.projectKey, inquisitorKey);
  assert.match(upload.url, /project=old-republic/);
  await request(app).get(upload.url).expect(200);
  await request(app)
    .get(base + '/media/' + upload._id)
    .expect(400);
  await request(app)
    .delete(base + '/media/' + originalMedia._id)
    .set(header)
    .send({})
    .expect(409);
  await request(app)
    .delete(base + '/media/' + originalMedia._id)
    .send({})
    .expect(409);
});
test('cinematic and faithful adaptation gates require a verified source linked to the actual scene', async () => {
  const data = (await request(app).get(base).set(header).expect(200)).body;
  await request(app)
    .put(base + '/settings')
    .set(header)
    .send({ ...data.settings, vlogPercent: 33 })
    .expect(400);
  const scene = {
    id: 'scene',
    title: 'Source-based test',
    style: 'cinematic',
    location: 'Korriban',
    script: 'Original adaptation test.',
    sourceReferenceIds: ['initial-trials'],
    assetIds: [],
    soundPlan: {
      layers: [
        {
          id: 'bed',
          title: 'Wind',
          description: 'Dry wind. No music.',
          type: 'ambience',
          loop: true
        }
      ]
    },
    clips: [
      {
        id: 'clip',
        title: 'Test',
        duration: 8,
        dialogue: '',
        action: 'Acolytes wait.',
        camera: 'Fixed.',
        soundEffects: 'Wind.'
      }
    ]
  };
  let episode = { ...data.episodes[0], scenes: [{ ...scene, style: 'vlog' }] };
  await request(app)
    .put(base + '/episodes/' + episode._id)
    .set(header)
    .send(episode)
    .expect(400);
  episode.scenes = [scene];
  episode = (
    await request(app)
      .put(base + '/episodes/' + episode._id)
      .set(header)
      .send(episode)
      .expect(200)
  ).body.episode;
  const url = `${base}/episodes/${episode._id}/scenes/scene/approve`;
  await request(app).post(url).set(header).send({ revision: episode.revision }).expect(400);
  episode.sourceReferences[1].status = 'verified';
  episode = (
    await request(app)
      .put(base + '/episodes/' + episode._id)
      .set(header)
      .send(episode)
      .expect(200)
  ).body.episode;
  await request(app).post(url).set(header).send({ revision: episode.revision }).expect(400);
  episode.sourceReferences[0].status = 'verified';
  episode = (
    await request(app)
      .put(base + '/episodes/' + episode._id)
      .set(header)
      .send(episode)
      .expect(200)
  ).body.episode;
  episode = (
    await request(app).post(url).set(header).send({ revision: episode.revision }).expect(200)
  ).body.episode;
  episode.sourceReferences[0].notes += ' Updated source evidence.';
  episode = (
    await request(app)
      .put(base + '/episodes/' + episode._id)
      .set(header)
      .send(episode)
      .expect(200)
  ).body.episode;
  assert.equal(episode.scenes[0].approvalStatus, 'needs-review');
});
test('chat context, prompts and speaker lookup use the active timeline without borrowing the old voice', async () => {
  await StudioAsset.create({
    name: 'Roxy original voice',
    kind: 'voice',
    finalChoice: { voiceId: 'legacy-voice', voiceModel: 'eleven_v3' }
  });
  await withProject(inquisitorKey, async () => {
    const context = await studioContext({ episodeId: String(initialized.episode._id) });
    assert.equal(context.project.cinematicOnly, true);
    assert.ok(!context.library.some((a) => a.name === 'Roxy original voice'));
    assert.throws(
      () => speakerVoice({ dialogue: 'ROXY: I will survive.' }, context.library),
      /Finalize/
    );
    const scene = {
        title: 'Trial',
        style: 'cinematic',
        location: 'Korriban',
        script: 'Test',
        assetIds: []
      },
      clip = { title: 'Test', duration: 8, dialogue: '', action: 'Roxy stands at the academy.' };
    assert.match(clipPrompts(scene, clip, []).image, /Old Republic era/);
    assert.match(productionVideoPrompt(scene, clip), /Old Republic era/);
    assert.ok(!productionVideoPrompt(scene, clip).includes('Imperial era.'));
  });
  assert.equal(projectKey(), 'imperial-smuggler');
  assert.equal(projectEra(), 'Imperial era');
});
test('a queued background image job keeps its original project after leaving the HTTP request', async () => {
  const calls = [],
    store = createSecretStore(join(directory, 'secrets'));
  await store.update(() => ({
    openart: { tokens: { access_token: 'fixture' }, projectId: 'fixture' }
  }));
  const fake = {
    close: async () => {},
    call: async (name, args) => {
      calls.push({ name, args });
      if (name === 'openart_model_form_get') return {};
      if (name === 'openart_model_cost') return { items: [{ totalCredits: 0, affordable: true }] };
      if (name === 'openart_generate_image')
        return { historyId: 'fixture-image', pollAfterSeconds: 5 };
      if (name === 'openart_creation_get')
        return {
          status: 'COMPLETED',
          resources: [{ mediaType: 'image', url: 'https://cdn.openart.ai/result.png' }]
        };
      throw new Error('Unexpected provider call');
    }
  };
  app = createApp({
    auth: false,
    mediaDirectory: directory,
    assistant: { store, openart: fake, fetcher: async () => new Response(png) }
  });
  let job;
  await withProject(inquisitorKey, async () => {
    const asset = await StudioAsset.findOne({ kind: 'wardrobe' }).lean();
    job = await app.locals.assistant.production.queue({
      requestId: 'new-sheet',
      kind: 'image',
      target: { assetId: String(asset._id) },
      instructions: 'A complete full-body turnaround using the supplied workflow.'
    });
  });
  assert.equal(job.projectKey, inquisitorKey);
  await app.locals.assistant.production.processJob(job);
  let current = await Job.findById(job._id).lean();
  assert.equal(current.status, 'rendering', current.error);
  const generation = calls.find((c) => c.name === 'openart_generate_image');
  assert.match(generation.args.params.prompt, /Old Republic era/);
  assert.match(generation.args.params.prompt, /BODY TURNAROUND/);
  assert.match(generation.args.params.prompt, /heads and feet visible in every view/);
  assert.doesNotMatch(generation.args.params.prompt, /NO HEAD OR FACE|Four-panel/);
  assert.match(generation.args.params.prompt, /never invent an interim costume/);
  await app.locals.assistant.production.processJob(current);
  current = await Job.findById(job._id).lean();
  assert.equal(current.status, 'ready', current.error);
  const media = await StudioMedia.findById(current.resultMediaIds[0]).lean();
  assert.equal(media.projectKey, inquisitorKey);
  const asset = await StudioAsset.findById(current.resultAssetId).lean();
  assert.equal(asset.projectKey, inquisitorKey);
  assert.equal(asset.reviewStatus, 'pending-choice');
  assert.equal(asset.finalChoice, null);
});
