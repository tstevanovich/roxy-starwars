import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';

import type * as Studio from '../../../shared/types.ts';
import type { StudioData } from '../../../shared/types.ts';
import { createApp } from '../app.ts';
import { connectDatabase } from '../db.ts';
import {
  StudioAsset,
  StudioEpisode,
  StudioMedia,
  StudioProject,
  StudioSettings
} from '../models/Studio.ts';
import { StudioMusicCue } from '../models/Studio.ts';
import * as projects from '../projects.ts';
import { episodeView, sceneFingerprint } from '../studio-validation.ts';

let mongo: MongoMemoryServer;
let mediaDirectory: string;
let app: ReturnType<typeof createApp>;
let studio: StudioData;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
  'base64'
);
const video = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex');
const audio = Buffer.alloc(52);
audio.write('RIFF');
audio.writeUInt32LE(44, 4);
audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24);
audio.writeUInt32LE(8000, 28);
audio.writeUInt16LE(1, 32);
audio.writeUInt16LE(8, 34);
audio.write('data', 36);
audio.writeUInt32LE(8, 40);

beforeAll(async () => {
  mediaDirectory = await mkdtemp(join(tmpdir(), 'roxy-studio-media-test-'));
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri('studio_test'));
  app = createApp({ mediaDirectory, auth: false });
}, 180000);
beforeEach(async () => {
  await StudioProject.updateOne(
    { key: 'imperial-smuggler' },
    {
      $set: {
        key: 'imperial-smuggler',
        videoWorkflow: 'native-1080p',
        workflowVersion: 0,
        cinematicOnly: false,
        referenceLayout: ''
      }
    },
    { upsert: true }
  );
  await Promise.all([
    StudioAsset.deleteMany({}),
    StudioEpisode.deleteMany({}),
    StudioMedia.deleteMany({}),
    StudioSettings.deleteMany({}),
    StudioMusicCue.deleteMany({})
  ]);
  studio = (await request(app).get('/api/studio').expect(200)).body;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
  if (mediaDirectory) {
    const target = resolve(mediaDirectory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(target.includes('roxy-studio-media-test-'));
    await rm(target, { recursive: true, force: true });
  }
});
async function upload(name = 'reference.png', buffer = png) {
  return (
    await request(app)
      .post('/api/studio/media')
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent(name))
      .send(buffer)
      .expect(201)
  ).body.media;
}
async function saveAsset(asset) {
  return (await request(app).put(`/api/studio/assets/${asset._id}`).send(asset).expect(200)).body
    .asset;
}
function episodeBody(assetId, takeId = null): Studio.PersistedInput<Studio.Episode> {
  return {
    title: 'A very expensive shortcut',
    premise: 'A smuggling job goes sideways.',
    notes: '',
    scenes: [
      {
        id: 'scene-one',
        title: 'Boarding the Fortune',
        style: 'vlog',
        location: 'Boarding ramp',
        script: 'Roxy introduces the job. AL interrupts with the repair bill.',
        assetIds: [assetId],
        soundPlan: {
          notes: 'No music.',
          dialogueGainDb: 0,
          layers: [
            {
              id: 'port-bed',
              title: 'Port ambience',
              type: 'ambience',
              description: 'Continuous distant spacecraft and pedestrians.',
              loop: true,
              duration: 15
            }
          ]
        },
        clips: [
          {
            id: 'clip-one',
            title: 'The introduction',
            duration: 27,
            action: 'Roxy walks to the ramp.',
            dialogue: 'ROXY: This should be an easy job.',
            camera: 'Handheld, natural light.',
            soundEffects: 'Footsteps, ship engine idle.',
            selectedTakeId: takeId
          }
        ]
      }
    ]
  };
}
// Legacy fixtures exercise migration, shared deletion and existing export/upscale behavior.
async function legacyEpisode(body) {
  for (const scene of body.scenes)
    for (const clip of scene.clips) {
      clip.soundLegacyTakeId = clip.selectedTakeId;
      clip.upscale = null;
    }
  const record = await StudioEpisode.create(body);
  return episodeView(record.toObject(), await StudioAsset.find().lean());
}
async function createEpisode(assetId, takeId?) {
  if (takeId) return legacyEpisode(episodeBody(assetId, takeId));
  return (
    await request(app).post('/api/studio/episodes').send(episodeBody(assetId, takeId)).expect(201)
  ).body.episode;
}

test('shot images belong to one clip and each option approves exactly one image', async () => {
  const episode = await createEpisode(studio.assets[0]._id);
  const one = await upload('one.png');
  const two = await upload('two.png');
  const body = {
    name: 'Clip one image',
    kind: 'environment',
    scope: 'episode' as const,
    episodeId: episode._id,
    sceneId: 'scene-one',
    clipId: 'clip-one',
    candidates: [{ id: 'a', title: 'Image A', description: '', mediaIds: [one._id] }]
  };
  await request(app)
    .post('/api/studio/assets')
    .send({ ...body, clipId: 'missing' })
    .expect(400);
  await request(app)
    .post('/api/studio/assets')
    .send({ ...body, candidates: [{ ...body.candidates[0], mediaIds: [one._id, two._id] }] })
    .expect(400);
  const asset = (
    await request(app)
      .post('/api/studio/assets')
      .send({
        ...body,
        candidates: [
          ...body.candidates,
          { id: 'b', title: 'Image B', description: '', mediaIds: [two._id] }
        ]
      })
      .expect(201)
  ).body.asset;
  const finalized = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/finalize`)
      .send({ revision: asset.revision, candidateId: 'b' })
      .expect(200)
  ).body.asset;
  assert.deepEqual(finalized.finalChoice.mediaIds, [two._id]);
  assert.equal(finalized.clipId, 'clip-one');
  await request(app)
    .post('/api/studio/assets')
    .send({
      ...body,
      name: 'Pending composition',
      candidates: [{ id: 'empty', title: 'Empty', mediaIds: [] }]
    })
    .expect(201);
});

test('episode brief download exposes current prompts and invalid scenes cannot be approved', async () => {
  const episode = await createEpisode(studio.assets[0]._id);
  expect(
    (await request(app).get(`/api/studio/episodes/${episode._id}/brief`)).body.prompts
  ).toHaveLength(1);
  const missing = new mongoose.Types.ObjectId();
  expect((await request(app).get(`/api/studio/episodes/${missing}/brief`)).status).toBe(404);
  expect((await request(app).get(`/api/studio/episodes/${missing}/package`)).status).toBe(404);
  for (const suffix of ['approve', 'sound-plan/approve'])
    expect(
      (
        await request(app)
          .post(`/api/studio/episodes/${episode._id}/scenes/missing/${suffix}`)
          .send({ revision: episode.revision })
      ).status
    ).toBe(404);
  expect(
    (
      await request(app)
        .post(`/api/studio/episodes/${episode._id}/scenes/scene-one/sound-plan/approve`)
        .send({ revision: episode.revision })
    ).status
  ).toBe(400);
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { 'scenes.0.script': '' } });
  expect(
    (
      await request(app)
        .post(`/api/studio/episodes/${episode._id}/scenes/scene-one/approve`)
        .send({ revision: episode.revision })
    ).status
  ).toBe(400);
});
test('sound plan saves reject effects without valid shot ownership and sound assets from other episodes', async () => {
  const body = episodeBody(studio.assets[0]._id);
  for (const patch of [
    { clipId: 'missing' },
    { type: 'effect' },
    { assetId: studio.assets[0]._id }
  ]) {
    const invalid = structuredClone(body);
    Object.assign(invalid.scenes[0].soundPlan.layers[0], patch);
    expect((await request(app).post('/api/studio/episodes').send(invalid)).status).toBe(400);
  }
  const sound = await StudioAsset.create({
    name: 'Foreign sound',
    kind: 'sound',
    scope: 'episode',
    episodeId: new mongoose.Types.ObjectId()
  });
  body.scenes[0].soundPlan.layers[0].assetId = String(sound._id);
  expect((await request(app).post('/api/studio/episodes').send(body)).status).toBe(400);
});

test('legacy editing preserves production, continuity, sound plans and read-only delivery pointers', async () => {
  const image = await upload();
  const asset = await StudioAsset.create({
    name: 'Legacy prop',
    kind: 'prop',
    candidates: [
      {
        id: 'choice',
        title: 'Choice',
        mediaIds: [image._id],
        continuitySources: [{ sceneId: 'earlier', clipId: 'earlier', mediaId: image._id }]
      }
    ]
  });
  await StudioAsset.collection.updateOne(
    { _id: asset._id },
    { $unset: { production: '', identitySourceMediaIds: '' } }
  );
  const body = JSON.parse(JSON.stringify(asset));
  body.candidates[0].title = 'Choice';
  delete body.production;
  const saved = await request(app).put(`/api/studio/assets/${asset._id}`).send(body);
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.asset.candidates[0].continuitySources).toHaveLength(1);
  let episode = await createEpisode(studio.assets[0]._id);
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.production.audioRepairTakeId': String(image._id) } }
  );
  episode.scenes[0].soundPlan = null;
  const edited = await request(app)
    .put(`/api/studio/episodes/${episode._id}`)
    .send(episode)
    .expect(200);
  expect(edited.body.episode.scenes[0].soundPlan.layers).toHaveLength(1);
  expect(edited.body.episode.scenes[0].clips[0].production.audioRepairTakeId).toBe(
    String(image._id)
  );
  episode = edited.body.episode;
  episode.scenes.push({
    ...episode.scenes[0],
    id: 'new-scene',
    soundPlan: null,
    clips: [{ ...episode.scenes[0].clips[0], id: 'new-shot' }]
  });
  expect((await request(app).put(`/api/studio/episodes/${episode._id}`).send(episode)).status).toBe(
    200
  );
  await request(app).get('/api/studio').expect(200);
});

test('saved legacy videos remain visible when their sound review needs attention and missing plans cannot be approved', async () => {
  const episode = await createEpisode(studio.assets[0]._id);
  const file = await upload('unreviewed.mp4', video);
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.selectedTakeId': file._id } }
  );
  const result = await request(app).get('/api/studio').expect(200);
  expect(result.body.episodes[0].scenes[0].clips[0].soundReviewStatus).toBe('needs-review');
  const scene = { ...episode.scenes[0], soundPlan: null };
  scene.approval = { fingerprint: sceneFingerprint(scene, await StudioAsset.find().lean()) };
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { 'scenes.0': scene } });
  expect(
    (
      await request(app)
        .post(`/api/studio/episodes/${episode._id}/scenes/scene-one/sound-plan/approve`)
        .send({ revision: 0 })
    ).body.message
  ).toContain('planned sound layer');
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: { 'scenes.0.clips.0.selectedTakeId': file._id },
      $unset: { 'scenes.0.clips.0.soundLegacyTakeId': '' }
    }
  );
  const saved = await StudioEpisode.findById(episode._id).lean();
  const reply = await request(app).put(`/api/studio/episodes/${episode._id}`).send(saved);
  expect(reply.status).toBe(200);
  expect(reply.body.episode.scenes[0].clips[0].soundLegacyTakeId).toBe(String(file._id));
});

test('missing referenced media and oversized bodies return useful input errors', async () => {
  const access = vi.spyOn(projects, 'assertMediaAccess').mockResolvedValueOnce(undefined);
  try {
    expect(
      (
        await request(app)
          .post('/api/studio/assets')
          .send({
            name: 'Missing reference',
            kind: 'prop',
            production: { sourceMediaIds: [String(new mongoose.Types.ObjectId())] }
          })
      ).body.message
    ).toContain('saved reference files');
  } finally {
    access.mockRestore();
  }
  expect(
    (
      await request(app)
        .post('/api/studio/assets')
        .send({ name: 'Too large', kind: 'prop', notes: 'x'.repeat(3 * 1024 * 1024) })
    ).status
  ).toBe(413);
  const settings = { ...studio.settings };
  delete settings.notes;
  await StudioProject.collection.updateOne(
    { key: 'imperial-smuggler' },
    { $unset: { workflowVersion: '' } }
  );
  expect((await request(app).put('/api/studio/settings').send(settings)).status).toBe(200);
});

test('comparison consolidation deduplicates history and enforces the option and sheet limits', async () => {
  const image = await upload();
  const source = await StudioAsset.create({
    name: 'Source prop',
    kind: 'prop',
    candidates: [{ id: 'source', mediaIds: [image._id] }]
  });
  const target = await StudioAsset.create({
    name: 'Main prop',
    kind: 'prop',
    candidates: Array.from({ length: 50 }, (_, i) => ({ id: 'option-' + i, mediaIds: [image._id] }))
  });
  const consolidate = () =>
    request(app)
      .post(`/api/studio/assets/${source._id}/consolidate`)
      .send({ revision: 0, targetId: String(target._id), targetRevision: 0 });
  expect((await consolidate()).body.message).toContain('too many options');
  await StudioAsset.updateOne({ _id: target._id }, { $set: { candidates: [] } });
  expect((await consolidate()).status).toBe(200);
  await StudioAsset.updateOne(
    { _id: source._id },
    { $set: { archived: false, relatedAssetId: null } }
  );
  const latest = await StudioAsset.findById(target._id).lean();
  expect(
    (
      await request(app)
        .post(`/api/studio/assets/${source._id}/consolidate`)
        .send({ revision: 1, targetId: String(target._id), targetRevision: latest.revision })
    ).status
  ).toBe(200);
  const full = await StudioAsset.create({
    name: 'Full prop',
    kind: 'prop',
    finalChoice: { id: 'chosen', mediaIds: [image._id] },
    characterSheets: Array.from({ length: 20 }, (_, i) => ({
      id: 'sheet-' + i,
      mediaId: image._id
    }))
  });
  expect(
    (
      await request(app)
        .post(`/api/studio/assets/${full._id}/character-sheets`)
        .send({ revision: 0 })
    ).body.message
  ).toContain('20 saved');
});

test('cinematic projects reject vlog creation and enable their approved wardrobe layout', async () => {
  await StudioProject.updateOne(
    { key: 'imperial-smuggler' },
    { $set: { cinematicOnly: true, referenceLayout: 'production-package', workflowVersion: 1 } }
  );
  expect(
    (await request(app).post('/api/studio/episodes').send(episodeBody(studio.assets[0]._id))).body
      .message
  ).toContain('entirely cinematic');
  const result = await request(app)
    .post('/api/studio/assets')
    .send({ name: 'New wardrobe', kind: 'wardrobe', brief: 'Clothing' });
  expect(result.status).toBe(201);
  expect(result.body.asset.sheetLayout).toBe('production-package');
  const episode = await StudioEpisode.create({
    title: 'Plan',
    scenes: [{ id: 'scene', title: 'Scene', clips: [] }]
  });
  expect(
    (
      await request(app)
        .post(`/api/studio/episodes/${episode._id}/scenes/scene/sound-plan/approve`)
        .send({ revision: 0 })
    ).status
  ).toBe(409);
});
test('comparison organization rejects self-links, inactive parents and incompatible consolidations', async () => {
  const asset = studio.assets[0],
    other = studio.assets.find((item) => item.kind !== asset.kind);
  const organize = (relatedAssetId) =>
    request(app)
      .patch(`/api/studio/assets/${asset._id}/organization`)
      .send({ revision: asset.revision, relatedAssetId });
  expect((await organize(asset._id)).status).toBe(400);
  expect((await organize(String(new mongoose.Types.ObjectId()))).status).toBe(400);
  const parent = await StudioAsset.create({ name: 'Parent', kind: asset.kind, archived: true });
  expect((await organize(String(parent._id))).status).toBe(400);
  await StudioAsset.updateOne(
    { _id: parent._id },
    { $set: { archived: false, relatedAssetId: other._id } }
  );
  expect((await organize(String(parent._id))).status).toBe(400);
  const consolidate = (targetId, targetRevision) =>
    request(app)
      .post(`/api/studio/assets/${asset._id}/consolidate`)
      .send({ revision: asset.revision, targetId, targetRevision });
  expect((await consolidate(asset._id, asset.revision)).status).toBe(400);
  expect((await consolidate(other._id, other.revision)).status).toBe(400);
  const same = await StudioAsset.create({ name: 'Same category', kind: asset.kind });
  await StudioAsset.create({ name: 'Comparison', kind: asset.kind, relatedAssetId: asset._id });
  expect((await consolidate(String(same._id), same.revision)).status).toBe(400);
  expect((await organize(String(same._id))).status).toBe(200);
});

test('legacy packages without optional production and sheet fields remain editable', async () => {
  const character = await request(app)
    .post('/api/studio/assets')
    .send({ name: 'New local character', kind: 'character', brief: 'Original character' })
    .expect(201);
  expect(character.body.asset.production.items).toEqual([]);
  const image = await upload();
  await StudioMedia.updateOne({ _id: image._id }, { $set: { productionJobId: 'legacy-prop' } });
  const asset = await StudioAsset.create({
    name: 'Legacy generated prop',
    kind: 'prop',
    candidates: [{ id: 'chat-legacy-prop', title: 'Prop', mediaIds: [image._id] }]
  });
  await StudioAsset.collection.updateOne({ _id: asset._id }, { $unset: { characterSheets: '' } });
  const finalized = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/finalize`)
      .send({ revision: 0, candidateId: 'chat-legacy-prop' })
      .expect(200)
  ).body.asset;
  expect(finalized.characterSheets).toHaveLength(1);
  await StudioAsset.collection.updateOne({ _id: asset._id }, { $unset: { characterSheets: '' } });
  expect(
    (
      await request(app)
        .post(`/api/studio/assets/${asset._id}/character-sheets/missing/approve`)
        .send({ revision: 1 })
    ).status
  ).toBe(404);
  await request(app)
    .post(`/api/studio/assets/${asset._id}/character-sheets`)
    .send({ revision: 1, title: 'Reference', views: ['side'], mediaId: image._id })
    .expect(201);
  const prop = await StudioAsset.create({
    name: 'Legacy workflow prop',
    kind: 'prop',
    brief: 'Prop design'
  });
  await StudioAsset.collection.updateOne({ _id: prop._id }, { $unset: { production: '' } });
  await StudioProject.updateOne({ key: 'imperial-smuggler' }, { $set: { workflowVersion: 1 } });
  const body = JSON.parse(JSON.stringify(prop));
  body.production = { sourceMode: 'original', sourceNotes: 'Owner design', items: [] };
  await request(app).put(`/api/studio/assets/${prop._id}`).send(body).expect(200);
  await StudioAsset.updateOne({ _id: prop._id }, { $unset: { 'production.items': '' } });
  await request(app).get('/api/studio').expect(200);
});
test('legacy finalization checks media kinds and keeps generated prop sheets linked to the approved option', async () => {
  const image = await upload(),
    one = await upload('one.wav', audio),
    two = await upload('two.wav', audio);
  for (const fields of [
    { kind: 'environment', clipId: 'shot', candidates: [{ id: 'choice', mediaIds: [one._id] }] },
    { kind: 'sound', candidates: [{ id: 'choice', mediaIds: [one._id, two._id] }] },
    { kind: 'prop', candidates: [{ id: 'choice', mediaIds: [one._id] }] }
  ]) {
    const asset = await StudioAsset.create({ name: 'Invalid stored option', ...fields });
    expect(
      (
        await request(app)
          .post(`/api/studio/assets/${asset._id}/finalize`)
          .send({ revision: asset.revision, candidateId: 'choice' })
      ).status
    ).toBe(400);
  }
  await StudioMedia.updateOne({ _id: image._id }, { $set: { productionJobId: 'prop-job' } });
  const asset = await StudioAsset.create({
    name: 'Generated prop',
    kind: 'prop',
    candidates: [{ id: 'chat-prop-job', title: 'Prop sheet', mediaIds: [image._id] }],
    characterSheets: [{ id: 'old', mediaId: image._id }]
  });
  const result = await request(app)
    .post(`/api/studio/assets/${asset._id}/finalize`)
    .send({ revision: 0, candidateId: 'chat-prop-job' });
  expect(result.status).toBe(200);
  expect(result.body.asset.characterSheets).toHaveLength(2);
  expect(result.body.asset.characterSheets[1].views).toContain('detail');
  const approved = await request(app)
    .post(`/api/studio/assets/${asset._id}/character-sheets/chat-prop-job/approve`)
    .send({ revision: result.body.asset.revision });
  expect(approved.status).toBe(200);
  expect(
    (
      await request(app)
        .post(`/api/studio/assets/${asset._id}/character-sheets/missing/approve`)
        .send({ revision: result.body.asset.revision })
    ).status
  ).toBe(404);
});
test('failed optimistic writes return conflicts and internal failures pass to the generic error handler', async () => {
  const asset = studio.assets[0];
  const write = vi
    .spyOn(StudioAsset, 'findOneAndUpdate')
    .mockReturnValueOnce({ lean: async () => null } as never);
  expect((await request(app).put(`/api/studio/assets/${asset._id}`).send(asset)).status).toBe(409);
  write.mockRestore();
  expect(
    (
      await request(app)
        .put('/api/studio/settings')
        .send({ ...studio.settings, revision: 999 })
    ).status
  ).toBe(409);
  const failure = vi.spyOn(StudioAsset, 'findById').mockReturnValueOnce({
    lean: async () => {
      throw new Error('Database unavailable');
    }
  } as never);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await request(app).put(`/api/studio/assets/${asset._id}`).send(asset)).status).toBe(500);
  failure.mockRestore();
  log.mockRestore();
});

test('reject permanently deletes an image file, its choice and historical references while preserving alternatives', async () => {
  const one = await upload('reject.png');
  const two = await upload('keep.png');
  const file = await StudioMedia.findById(one._id).lean();
  const asset = (
    await request(app)
      .post('/api/studio/assets')
      .send({
        name: 'Reference choices',
        kind: 'environment',
        candidates: [
          { id: 'a', title: 'Reject', mediaIds: [one._id] },
          { id: 'b', title: 'Keep', mediaIds: [two._id] }
        ]
      })
      .expect(201)
  ).body.asset;
  const selected = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/finalize`)
      .send({ revision: asset.revision, candidateId: 'a' })
      .expect(200)
  ).body.asset;
  await request(app)
    .delete(`/api/studio/media/${one._id}`)
    .send({ assetId: asset._id, revision: asset.revision, candidateId: 'a' })
    .expect(409);
  assert.ok((await readdir(mediaDirectory)).includes(file.filename));
  await request(app)
    .delete(`/api/studio/media/${one._id}`)
    .send({ assetId: asset._id, revision: selected.revision, candidateId: 'a' })
    .expect(200);
  await request(app).get(`/api/studio/media/${one._id}`).expect(404);
  assert.equal(await StudioMedia.countDocuments({ _id: one._id }), 0);
  assert.ok(!(await readdir(mediaDirectory)).includes(file.filename));
  const current = await StudioAsset.findById(asset._id).lean();
  assert.equal(current.finalChoice, null);
  assert.deepEqual(
    current.candidates.map((candidate) => candidate.id),
    ['b']
  );
  assert.ok(!JSON.stringify(current).includes(one._id));
  await request(app).get(`/api/studio/media/${two._id}`).expect(200);
});

test('rejecting a finalized ElevenLabs audition deletes its local audio and choice while retaining alternatives', async () => {
  const audition = await upload('eleven-v3-reject.wav', audio);
  const alternative = await upload('eleven-v3-keep.wav', audio);
  const file = await StudioMedia.findById(audition._id).lean();
  const asset = (
    await request(app)
      .post('/api/studio/assets')
      .send({
        name: 'Voice audition',
        kind: 'voice',
        candidates: [
          {
            id: 'reject',
            title: 'Rejected voice',
            mediaIds: [audition._id],
            voiceId: 'voice-one',
            voiceModel: 'eleven_v3'
          },
          {
            id: 'keep',
            title: 'Keep voice',
            mediaIds: [alternative._id],
            voiceId: 'voice-two',
            voiceModel: 'eleven_v3'
          }
        ]
      })
      .expect(201)
  ).body.asset;
  const selected = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/finalize`)
      .send({ revision: asset.revision, candidateId: 'reject' })
      .expect(200)
  ).body.asset;
  await request(app).delete(`/api/studio/media/${audition._id}`).send({}).expect(409);
  await request(app)
    .delete(`/api/studio/media/${audition._id}`)
    .send({ assetId: asset._id, revision: asset.revision, candidateId: 'reject' })
    .expect(409);
  assert.ok((await readdir(mediaDirectory)).includes(file.filename));
  await request(app)
    .delete(`/api/studio/media/${audition._id}`)
    .send({ assetId: asset._id, revision: selected.revision, candidateId: 'reject' })
    .expect(200);
  await request(app).get(`/api/studio/media/${audition._id}`).expect(404);
  assert.equal(await StudioMedia.countDocuments({ _id: audition._id }), 0);
  assert.ok(!(await readdir(mediaDirectory)).includes(file.filename));
  const current = await StudioAsset.findById(asset._id).lean();
  assert.equal(current.finalChoice, null);
  assert.equal(current.reviewStatus, 'pending-choice');
  assert.deepEqual(
    current.candidates.map((c) => c.id),
    ['keep']
  );
  assert.ok(!JSON.stringify(current).includes(audition._id));
  assert.equal(current.candidates[0].voiceId, 'voice-two');
  await request(app).get(`/api/studio/media/${alternative._id}`).expect(200);
});

test('dialogue rejection protects shared selections and clears selected or unselected audio without touching video', async () => {
  const dialogue = await upload('eleven-v3-dialogue.wav', audio);
  const alternative = await upload('eleven-v3-alternative.wav', audio);
  const take = await upload('keep-video.mp4', video);
  const file = await StudioMedia.findById(dialogue._id).lean();
  const body = episodeBody(studio.assets[0]._id, take._id);
  body.scenes[0].clips[0].dialogueTakeIds = [dialogue._id, alternative._id];
  body.scenes[0].clips[0].selectedDialogueId = dialogue._id;
  const first = await legacyEpisode(body);
  const second = await legacyEpisode(body);
  const context = {
    episodeId: first._id,
    revision: first.revision,
    sceneId: 'scene-one',
    clipId: 'clip-one'
  };
  const blocked = await request(app)
    .delete(`/api/studio/media/${dialogue._id}`)
    .send(context)
    .expect(409);
  assert.match(blocked.body.message, /selected in/);
  await request(app).get(`/api/studio/media/${dialogue._id}`).expect(200);
  await StudioEpisode.deleteOne({ _id: second._id });
  await request(app).delete(`/api/studio/media/${dialogue._id}`).send(context).expect(200);
  const current = await StudioEpisode.findById(first._id).lean();
  const clip = current.scenes[0].clips[0];
  assert.equal(clip.selectedDialogueId, null);
  assert.deepEqual(clip.dialogueTakeIds.map(String), [alternative._id]);
  assert.equal(String(clip.selectedTakeId), take._id);
  assert.equal(clip.upscale, null);
  assert.ok(!JSON.stringify(current).includes(dialogue._id));
  assert.ok(!(await readdir(mediaDirectory)).includes(file.filename));
  await request(app).get(`/api/studio/media/${dialogue._id}`).expect(404);
  await request(app).get(`/api/studio/media/${take._id}`).expect(200);
  await request(app)
    .delete(`/api/studio/media/${alternative._id}`)
    .send({ ...context, revision: current.revision })
    .expect(200);
  const final = await StudioEpisode.findById(first._id).lean();
  assert.deepEqual(final.scenes[0].clips[0].dialogueTakeIds, []);
  assert.equal(String(final.scenes[0].clips[0].selectedTakeId), take._id);
});

test('rejecting a video protects a selection in another clip, then removes its own approval and upscale', async () => {
  const take = await upload('reject.mp4', video);
  const first = await createEpisode(studio.assets[0]._id, take._id);
  const second = await createEpisode(studio.assets[0]._id, take._id);
  const context = {
    episodeId: first._id,
    revision: first.revision,
    sceneId: 'scene-one',
    clipId: 'clip-one'
  };
  await request(app).delete(`/api/studio/media/${take._id}`).send(context).expect(409);
  await request(app).get(`/api/studio/media/${take._id}`).expect(200);
  await StudioEpisode.deleteOne({ _id: second._id });
  await request(app).delete(`/api/studio/media/${take._id}`).send(context).expect(200);
  const current = await StudioEpisode.findById(first._id).lean();
  assert.equal(current.scenes[0].clips[0].selectedTakeId, null);
  assert.equal(current.scenes[0].clips[0].upscale, null);
  assert.ok(!JSON.stringify(current).includes(take._id));
  await request(app).get(`/api/studio/media/${take._id}`).expect(404);
});
async function approve(episode) {
  return (
    await request(app)
      .post(`/api/studio/episodes/${episode._id}/scenes/scene-one/approve`)
      .send({ revision: episode.revision })
      .expect(200)
  ).body.episode;
}

async function finalizeAsset(asset) {
  return (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/finalize`)
      .send({ revision: asset.revision, candidateId: asset.candidates[0].id })
      .expect(200)
  ).body.asset;
}

test('episode summaries persist separately without changing the outline or invalidating scene approval', async () => {
  const episode = await approve(await createEpisode(studio.assets[0]._id));
  const synopsis = 'Roxy accepts a costly charter from Corellia to Ord Mantell.';
  const updated = (
    await request(app)
      .put(`/api/studio/episodes/${episode._id}`)
      .send({ ...episode, synopsis })
      .expect(200)
  ).body.episode;
  assert.equal(updated.synopsis, synopsis);
  assert.equal(updated.premise, episode.premise);
  assert.equal(updated.notes, episode.notes);
  assert.deepEqual(updated.scenes, episode.scenes);
  assert.equal(updated.scenes[0].approvalStatus, 'approved');
  const loaded = (
    await request(createApp({ mediaDirectory, auth: false }))
      .get('/api/studio')
      .expect(200)
  ).body;
  assert.equal(loaded.episodes.find((e) => e._id === episode._id).synopsis, synopsis);
  await request(app)
    .put(`/api/studio/episodes/${episode._id}`)
    .send({ ...updated, synopsis: 'x'.repeat(1201) })
    .expect(400);
});

test('unselected clip takes persist without invalidating scene approval and require video media', async () => {
  const episode = await approve(await createEpisode(studio.assets[0]._id));
  const take = await upload('opening.mp4', video);
  const body = structuredClone(episode);
  body.scenes[0].clips[0].takeIds = [take._id, take._id];
  const updated = (
    await request(app).put(`/api/studio/episodes/${episode._id}`).send(body).expect(200)
  ).body.episode;
  assert.deepEqual(updated.scenes[0].clips[0].takeIds, [take._id]);
  assert.equal(updated.scenes[0].clips[0].selectedTakeId, null);
  assert.deepEqual(updated.scenes[0].approval, episode.scenes[0].approval);
  assert.equal(updated.scenes[0].approvalStatus, 'approved');
  const image = await upload('not-a-video.png');
  const invalid = structuredClone(updated);
  invalid.scenes[0].clips[0].takeIds = [image._id];
  await request(app).put(`/api/studio/episodes/${episode._id}`).send(invalid).expect(400);
  const loaded = (await request(app).get('/api/studio').expect(200)).body.episodes.find(
    (e) => e._id === episode._id
  );
  assert.deepEqual(loaded.scenes[0].clips[0].takeIds, [take._id]);
});

test('dialogue reviews persist, accept only audio, and preserve script approval and voice choices', async () => {
  const episode = await approve(await createEpisode(studio.assets[0]._id));
  const performance = await upload('scene-dialogue.wav', audio);
  const body = structuredClone(episode);
  body.scenes[0].clips[0].dialogueTakeIds = [performance._id, performance._id];
  let updated = (
    await request(app).put(`/api/studio/episodes/${episode._id}`).send(body).expect(200)
  ).body.episode;
  assert.deepEqual(updated.scenes[0].clips[0].dialogueTakeIds, [performance._id]);
  assert.equal(updated.scenes[0].clips[0].selectedDialogueId, null);
  updated.scenes[0].clips[0].selectedDialogueId = performance._id;
  updated = (
    await request(app).put(`/api/studio/episodes/${episode._id}`).send(updated).expect(200)
  ).body.episode;
  assert.deepEqual(updated.scenes[0].approval, episode.scenes[0].approval);
  assert.equal(updated.scenes[0].approvalStatus, 'approved');
  const reloaded = (
    await request(createApp({ mediaDirectory, auth: false }))
      .get('/api/studio')
      .expect(200)
  ).body;
  assert.equal(reloaded.episodes[0].scenes[0].clips[0].selectedDialogueId, performance._id);
  assert.deepEqual(reloaded.assets, studio.assets);
  const prompt = (await request(app).post('/api/studio/prompts').send(updated).expect(200)).body
    .prompts[0];
  assert.equal(prompt.dialogueMediaId, performance._id);
  assert.ok(!prompt.referenceMediaIds.includes(performance._id));
  const image = await upload();
  for (const patch of [{ dialogueTakeIds: [image._id] }, { selectedDialogueId: image._id }]) {
    const invalid = structuredClone(updated);
    Object.assign(invalid.scenes[0].clips[0], patch);
    await request(app).put(`/api/studio/episodes/${episode._id}`).send(invalid).expect(400);
  }
  updated.scenes[0].clips[0].selectedDialogueId = null;
  updated = (
    await request(app).put(`/api/studio/episodes/${episode._id}`).send(updated).expect(200)
  ).body.episode;
  assert.equal(updated.scenes[0].clips[0].selectedDialogueId, null);
  assert.deepEqual(updated.scenes[0].clips[0].dialogueTakeIds, [performance._id]);
  assert.equal(updated.scenes[0].approvalStatus, 'approved');
});

test('video approval and repeated saves never create or accept an upscale request', async () => {
  const take = await upload('approved-take.mp4', video);
  let episode = await approve(await createEpisode(studio.assets[0]._id, take._id));
  const approval = episode.scenes[0].approval;
  episode.scenes[0].clips[0].selectedTakeId = take._id;
  episode.scenes[0].clips[0].upscale = { status: 'waiting-provider', sourceTakeId: take._id };
  episode = (
    await request(app).put(`/api/studio/episodes/${episode._id}`).send(episode).expect(200)
  ).body.episode;
  assert.equal(episode.scenes[0].clips[0].upscale, null);
  assert.equal(episode.scenes[0].clips[0].selectedTakeId, take._id);
  assert.deepEqual(episode.scenes[0].approval, approval);
  episode = (
    await request(app).put(`/api/studio/episodes/${episode._id}`).send(episode).expect(200)
  ).body.episode;
  assert.equal(episode.scenes[0].clips[0].upscale, null);
  await request(app).head(`/api/studio/media/${take._id}`).expect(200);
});

test('a missing project video policy defaults to native 1080p without reviving upscale requests', async () => {
  await StudioProject.updateOne({ key: 'imperial-smuggler' }, { $unset: { videoWorkflow: '' } });
  const take = await upload('legacy-approved.mp4', video);
  let episode = await approve(await createEpisode(studio.assets[0]._id, take._id));
  episode = (
    await request(app).put(`/api/studio/episodes/${episode._id}`).send(episode).expect(200)
  ).body.episode;
  const current = (await request(app).get('/api/studio').expect(200)).body;
  assert.equal(current.settings.videoWorkflow, 'native-1080p');
  assert.equal(episode.scenes[0].clips[0].upscale, null);
});

test('retired upscale routes stay unavailable while saved historical delivery links survive ordinary edits', async () => {
  await request(app).post('/api/studio/workflow/upscale/import').send({}).expect(404);
  const take = await upload('saved-original.mp4', video);
  const delivery = await upload('saved-high-resolution.mp4', video);
  let episode = await approve(await createEpisode(studio.assets[0]._id, take._id));
  const snapshot = { status: 'imported', sourceTakeId: take._id, resultMediaId: delivery._id };
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.clips.0.upscale': snapshot,
        'scenes.0.clips.0.production.upscaleMediaId': delivery._id,
        'scenes.0.clips.0.production.upscaleSourceTakeId': take._id
      }
    }
  );
  episode = (await request(app).get('/api/studio').expect(200)).body.episodes[0];
  episode.notes = 'Updated unrelated notes.';
  episode.scenes[0].clips[0].upscale = null;
  episode.scenes[0].clips[0].production.upscaleMediaId = take._id;
  episode = (
    await request(app).put(`/api/studio/episodes/${episode._id}`).send(episode).expect(200)
  ).body.episode;
  assert.equal(episode.scenes[0].clips[0].selectedTakeId, take._id);
  assert.equal(episode.scenes[0].clips[0].production.upscaleMediaId, delivery._id);
  assert.deepEqual(episode.scenes[0].clips[0].upscale, snapshot);
  await request(app).head(`/api/studio/media/${delivery._id}`).expect(200);
});

test('organization preserves approved references and scene approval while creative edits reopen them', async () => {
  let asset = studio.assets.find((a) => a.seedKey === 'al');
  const file = await upload();
  asset.candidates[0].mediaIds = [file._id];
  asset = await finalizeAsset(await saveAsset(asset));
  asset = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/character-sheets`)
      .send({
        revision: asset.revision,
        title: 'Turnaround',
        mediaId: file._id,
        views: ['front', 'side', 'rear']
      })
      .expect(201)
  ).body.asset;
  asset = (
    await request(app)
      .post(
        `/api/studio/assets/${asset._id}/character-sheets/${asset.characterSheets[0].id}/approve`
      )
      .send({ revision: asset.revision })
      .expect(200)
  ).body.asset;
  const choice = asset.finalChoice;
  const sheets = asset.characterSheets;
  const referenceRevision = asset.referenceRevision;
  const episode = await approve(await createEpisode(asset._id));
  asset = await saveAsset({ ...asset, scope: 'episode' as const, episodeId: episode._id });
  assert.deepEqual(asset.finalChoice, choice);
  assert.deepEqual(asset.characterSheets, sheets);
  assert.equal(asset.referenceRevision, referenceRevision);
  let loaded = (await request(app).get('/api/studio').expect(200)).body;
  assert.equal(loaded.episodes[0].scenes[0].approvalStatus, 'approved');
  asset = (
    await request(app)
      .patch(`/api/studio/assets/${asset._id}/organization`)
      .send({ revision: asset.revision, reviewStatus: 'pending-choice' })
      .expect(200)
  ).body.asset;
  assert.deepEqual(asset.finalChoice, choice);
  assert.equal(asset.reviewStatus, 'pending-choice');
  await request(app)
    .patch(`/api/studio/assets/${asset._id}/organization`)
    .send({ revision: asset.revision, reviewStatus: 'finalized' })
    .expect(400);
  asset = await saveAsset({ ...asset, brief: 'A revised identity.' });
  assert.equal(asset.finalChoice, null);
  loaded = (await request(app).get('/api/studio').expect(200)).body;
  assert.equal(loaded.episodes[0].scenes[0].approvalStatus, 'needs-review');
});

test('episode-only assets require an existing episode and cannot be linked elsewhere', async () => {
  const asset = studio.assets[0];
  const episode = await createEpisode(asset._id);
  const fields = { name: 'Dock clamp', kind: 'prop', scope: 'episode' as const };
  await request(app).post('/api/studio/assets').send(fields).expect(400);
  await request(app)
    .post('/api/studio/assets')
    .send({ ...fields, episodeId: new mongoose.Types.ObjectId().toString() })
    .expect(400);
  const local = (
    await request(app)
      .post('/api/studio/assets')
      .send({ ...fields, episodeId: episode._id })
      .expect(201)
  ).body.asset;
  await request(app)
    .put(`/api/studio/episodes/${episode._id}`)
    .send({ ...episode, ...episodeBody(local._id) })
    .expect(200);
  await request(app).post('/api/studio/episodes').send(episodeBody(local._id)).expect(400);
  const other = await createEpisode(asset._id);
  await request(app)
    .patch(`/api/studio/assets/${asset._id}/organization`)
    .send({ revision: asset.revision, scope: 'episode' as const, episodeId: episode._id })
    .expect(400);
  await request(app)
    .put(`/api/studio/episodes/${other._id}`)
    .send({ ...other, ...episodeBody(local._id) })
    .expect(400);
});

test('un-finalize preserves media and decision history and allows a new final choice', async () => {
  let asset = studio.assets[0];
  const file = await upload();
  asset.candidates[0].mediaIds = [file._id];
  asset = await finalizeAsset(await saveAsset(asset));
  const choice = asset.finalChoice;
  asset = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/reopen`)
      .send({ revision: asset.revision })
      .expect(200)
  ).body.asset;
  assert.equal(asset.finalChoice, null);
  assert.equal(asset.reviewStatus, 'pending-choice');
  assert.deepEqual(asset.candidates[0].mediaIds, [file._id]);
  assert.ok(asset.history.some((h) => h.finalChoice?.id === choice.id));
  asset = await finalizeAsset(asset);
  assert.equal(asset.reviewStatus, null);
  assert.equal(asset.finalChoice.id, choice.id);
});

test('completed voice comparisons become history without changing the approved production voice', async () => {
  let target = studio.assets.find((a) => a.seedKey === 'roxy-voice');
  const file = await upload('approved.wav', audio);
  target.candidates[0] = {
    ...target.candidates[0],
    mediaIds: [file._id],
    voiceId: 'roxy-approved',
    voiceModel: 'eleven_v3'
  };
  target = await finalizeAsset(await saveAsset(target));
  let source = (
    await request(app)
      .post('/api/studio/assets')
      .send({
        name: 'Roxy model comparison',
        kind: 'voice',
        candidates: [
          target.candidates[0],
          {
            ...target.candidates[0],
            id: 'older-test',
            voiceModel: 'eleven_multilingual_v2'
          }
        ]
      })
      .expect(201)
  ).body.asset;
  source = await finalizeAsset(source);
  const response = await request(app)
    .post(`/api/studio/assets/${source._id}/consolidate`)
    .send({ revision: source.revision, targetId: target._id, targetRevision: target.revision })
    .expect(200);
  assert.deepEqual(response.body.asset.finalChoice, target.finalChoice);
  assert.equal(response.body.asset.referenceRevision, target.referenceRevision);
  assert.equal(response.body.asset.reviewStatus, null);
  assert.ok(
    response.body.asset.candidates
      .filter((c) => c.id.startsWith('comparison-'))
      .every((c) => c.archived)
  );
  assert.equal(response.body.archivedAsset.archived, true);
  assert.equal(response.body.archivedAsset.relatedAssetId, target._id);
  assert.deepEqual(response.body.archivedAsset.candidates, source.candidates);
  await request(app)
    .post(`/api/studio/assets/${source._id}/consolidate`)
    .send({ revision: source.revision, targetId: target._id, targetRevision: target.revision })
    .expect(409);
});

test('pending comparisons move new options into the main voice while retaining the approved voice', async () => {
  let target = studio.assets.find((a) => a.seedKey === 'al-voice');
  const original = await upload('original.wav', audio);
  const alternative = await upload('alternative.wav', audio);
  target.candidates[0].mediaIds = [original._id];
  target = await finalizeAsset(await saveAsset(target));
  const source = (
    await request(app)
      .post('/api/studio/assets')
      .send({
        name: 'Al v3 comparison',
        kind: 'voice',
        candidates: [
          target.candidates[0],
          {
            ...target.candidates[0],
            id: 'v3',
            mediaIds: [alternative._id],
            voiceModel: 'eleven_v3'
          }
        ]
      })
      .expect(201)
  ).body.asset;
  await request(app)
    .post(`/api/studio/assets/${source._id}/consolidate`)
    .send({ revision: source.revision, targetId: target._id, targetRevision: target.revision + 1 })
    .expect(409);
  const merged = (
    await request(app)
      .post(`/api/studio/assets/${source._id}/consolidate`)
      .send({ revision: source.revision, targetId: target._id, targetRevision: target.revision })
      .expect(200)
  ).body.asset;
  assert.deepEqual(merged.finalChoice, target.finalChoice);
  assert.equal(merged.reviewStatus, 'pending-choice');
  assert.ok(merged.candidates.some((c) => !c.archived && c.mediaIds.includes(alternative._id)));
  assert.ok(
    merged.candidates.some(
      (c) => c.archived && c.id.startsWith('comparison-') && c.mediaIds.includes(original._id)
    )
  );
});

test('initializes confirmed identities and proposals without replacing saved choices', async () => {
  assert.equal(studio.assets.length, 12);
  assert.equal(studio.settings.vlogPercent, 33);
  const fortune = studio.assets.find((a) => a.seedKey === 'fortune');
  assert.deepEqual(fortune.aliases, ['the Fortune']);
  assert.equal(fortune.finalChoice, null);
  const saved = await saveAsset({ ...fortune, notes: 'Keep these custom notes.' });
  const again = (await request(app).get('/api/studio').expect(200)).body;
  assert.equal(again.assets.length, 12);
  assert.equal(again.assets.find((a) => a._id === fortune._id).notes, 'Keep these custom notes.');
  assert.equal(again.assets.find((a) => a._id === fortune._id).updatedAt, saved.updatedAt);
});

test('persists the current image policy when saving legacy series settings', async () => {
  assert.equal(
    (studio.settings.imageGeneration as { model?: string }).model,
    'gpt-image-2-5-sunburst'
  );
  await StudioSettings.updateOne({ key: 'series' }, { $unset: { imageGeneration: 1 } });
  const legacySettings = structuredClone(studio.settings);
  delete legacySettings.imageGeneration;
  const updated = (
    await request(app)
      .put('/api/studio/settings')
      .send({
        ...legacySettings,
        imageGeneration: { model: 'nano-banana-2-1' },
        notes: 'Keep these custom series notes.'
      })
      .expect(200)
  ).body.settings;
  assert.equal(updated.imageGeneration.model, 'gpt-image-2-5-sunburst');
  assert.equal(updated.imageGeneration.params.quality, 'high');
  assert.equal(updated.notes, 'Keep these custom series notes.');
  const again = (await request(app).get('/api/studio').expect(200)).body;
  assert.deepEqual(again.settings.imageGeneration, updated.imageGeneration);
  assert.deepEqual(again.assets, studio.assets);
});

test('stores originals on disk and supports HEAD, byte ranges, and safe downloads', async () => {
  const file = await upload();
  assert.equal(file.kind, 'image');
  assert.equal(file.bytes, png.length);
  assert.ok(!file.filename);
  assert.ok((await readdir(mediaDirectory)).some((name) => name.endsWith('.png')));
  const full = await request(app).get(file.url).expect(200);
  assert.deepEqual(full.body, png);
  await request(app).head(file.url).expect('Accept-Ranges', 'bytes').expect(200);
  const partial = await request(app).get(file.url).set('Range', 'bytes=0-7').expect(206);
  assert.deepEqual(partial.body, png.subarray(0, 8));
  await request(app)
    .get(`${file.url}?download=1`)
    .expect('Content-Disposition', /attachment/)
    .expect(200);
  for (const name of ['../escape.png', 'not-an-image.html', 'fake.png']) {
    await request(app)
      .post('/api/studio/media')
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent(name))
      .send(Buffer.from('not a valid image payload'))
      .expect(400);
  }
  await request(app).get('/api/studio/media/not-an-id').expect(400);
});

test('final choices require saved references, retain snapshots, and reject stale saves', async () => {
  let asset = studio.assets.find((a) => a.seedKey === 'fortune');
  await request(app)
    .post(`/api/studio/assets/${asset._id}/finalize`)
    .send({ revision: 0, candidateId: asset.candidates[0].id })
    .expect(400);
  const file = await upload();
  asset.candidates[0].mediaIds.push(file._id);
  asset = await saveAsset(asset);
  const finalized = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/finalize`)
      .send({ revision: asset.revision, candidateId: asset.candidates[0].id })
      .expect(200)
  ).body.asset;
  assert.equal(finalized.finalChoice.mediaIds[0], file._id);
  const restarted = createApp({ mediaDirectory, auth: false });
  const loaded = (await request(restarted).get('/api/studio').expect(200)).body.assets.find(
    (a) => a._id === asset._id
  );
  assert.equal(loaded.finalChoice.title, finalized.finalChoice.title);
  await request(app).put(`/api/studio/assets/${asset._id}`).send(asset).expect(409);
  const edited = await saveAsset({ ...loaded, notes: 'Try a different cockpit.' });
  assert.equal(edited.finalChoice, null);
  assert.ok(edited.history.some((h) => h.finalChoice?.mediaIds[0] === file._id));
  assert.equal((await request(app).get(file.url).expect(200)).body.length, png.length);
});

test('voice approval requires an audio audition', async () => {
  let voice = studio.assets.find((a) => a.seedKey === 'roxy-voice');
  const image = await upload();
  voice.candidates[0].mediaIds = [image._id];
  voice = await saveAsset(voice);
  await request(app)
    .post(`/api/studio/assets/${voice._id}/finalize`)
    .send({ revision: voice.revision, candidateId: voice.candidates[0].id })
    .expect(400);
  const audition = await upload('audition.wav', audio);
  voice.candidates[0].mediaIds = [audition._id];
  voice.candidates[0].voiceId = 'saved-elevenlabs-voice';
  voice = await saveAsset(voice);
  const result = await request(app)
    .post(`/api/studio/assets/${voice._id}/finalize`)
    .send({ revision: voice.revision, candidateId: voice.candidates[0].id })
    .expect(200);
  assert.equal(result.body.asset.finalChoice.voiceId, 'saved-elevenlabs-voice');
});

test('character sheets preserve the identity and enter prompts and exports only after approval', async () => {
  let asset = studio.assets.find((a) => a.seedKey === 'al');
  const original = await upload('al-original.png');
  asset.candidates[0].mediaIds = [original._id];
  asset = await saveAsset(asset);
  asset = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/finalize`)
      .send({ revision: asset.revision, candidateId: asset.candidates[0].id })
      .expect(200)
  ).body.asset;
  const identity = asset.finalChoice;
  const image = await upload('al-sheet.png');
  const body = {
    revision: asset.revision,
    title: 'AL turnaround',
    mediaId: image._id,
    views: ['front', 'side', 'rear'],
    approvedAt: new Date().toISOString()
  };
  asset = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/character-sheets`)
      .send(body)
      .expect(201)
  ).body.asset;
  assert.deepEqual(asset.finalChoice, identity);
  assert.equal(asset.characterSheets[0].approvedAt, null);
  await request(app)
    .post(`/api/studio/assets/${asset._id}/character-sheets`)
    .send(body)
    .expect(409);
  let prompt = (
    await request(app).post('/api/studio/prompts').send(episodeBody(asset._id)).expect(200)
  ).body.prompts[0];
  assert.ok(!prompt.referenceMediaIds.includes(image._id));
  const url = `/api/studio/assets/${asset._id}/character-sheets/${asset.characterSheets[0].id}/approve`;
  asset = (await request(app).post(url).send({ revision: asset.revision }).expect(200)).body.asset;
  assert.ok(asset.characterSheets[0].approvedAt);
  assert.deepEqual(asset.finalChoice, identity);
  prompt = (await request(app).post('/api/studio/prompts').send(episodeBody(asset._id)).expect(200))
    .body.prompts[0];
  assert.ok(prompt.referenceMediaIds.includes(image._id));
  assert.match(prompt.image, /@image\d+:.*AL turnaround/);
  const pending = await upload('pending-sheet.png');
  asset = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/character-sheets`)
      .send({
        revision: asset.revision,
        title: 'Unreviewed sheet',
        mediaId: pending._id,
        views: ['face']
      })
      .expect(201)
  ).body.asset;
  const take = await upload('take.mp4', video);
  let episode = await createEpisode(asset._id, take._id);
  episode = await approve(episode);
  const result = await request(app)
    .get(`/api/studio/episodes/${episode._id}/package`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Uint8Array[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  const zip = result.body;
  const nameLength = zip.readUInt16LE(26);
  const manifest = JSON.parse(
    zip.toString('utf8', 30 + nameLength, 30 + nameLength + zip.readUInt32LE(18))
  );
  assert.ok(manifest.media.some((m) => m.id === image._id));
  assert.ok(!manifest.media.some((m) => m.id === pending._id));
  asset = await saveAsset({ ...asset, brief: 'Updated identity requires review.' });
  asset = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/finalize`)
      .send({ revision: asset.revision, candidateId: identity.id })
      .expect(200)
  ).body.asset;
  await request(app).post(url).send({ revision: asset.revision }).expect(400);
  prompt = (await request(app).post('/api/studio/prompts').send(episodeBody(asset._id)).expect(200))
    .body.prompts[0];
  assert.ok(!prompt.referenceMediaIds.includes(image._id));
});

test('props support object views and approved sheets become reusable references', async () => {
  let asset = studio.assets.find((a) => a.seedKey === 'blaster');
  const original = await upload('prop-original.png');
  asset.candidates[0].mediaIds = [original._id];
  asset = await saveAsset(asset);
  asset = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/finalize`)
      .send({ revision: asset.revision, candidateId: asset.candidates[0].id })
      .expect(200)
  ).body.asset;
  const choice = asset.finalChoice;
  const image = await upload('prop-sheet.png');
  const sheet = {
    revision: asset.revision,
    title: 'Pistol reference sheet',
    mediaId: image._id,
    views: ['side', 'opposite-side', 'top', 'rear', 'detail']
  };
  await request(app)
    .post(`/api/studio/assets/${asset._id}/character-sheets`)
    .send({ ...sheet, views: ['face'] })
    .expect(400);
  asset = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/character-sheets`)
      .send(sheet)
      .expect(201)
  ).body.asset;
  assert.deepEqual(asset.finalChoice, choice);
  let prompt = (
    await request(app).post('/api/studio/prompts').send(episodeBody(asset._id)).expect(200)
  ).body.prompts[0];
  assert.ok(!prompt.referenceMediaIds.includes(image._id));
  asset = (
    await request(app)
      .post(
        `/api/studio/assets/${asset._id}/character-sheets/${asset.characterSheets[0].id}/approve`
      )
      .send({ revision: asset.revision })
      .expect(200)
  ).body.asset;
  assert.deepEqual(asset.finalChoice, choice);
  prompt = (await request(app).post('/api/studio/prompts').send(episodeBody(asset._id)).expect(200))
    .body.prompts[0];
  assert.ok(prompt.referenceMediaIds.includes(image._id));
  assert.match(prompt.image, /@image\d+:.*Pistol reference sheet/);
});

test('character sheet registration rejects unfinalized identities, non-images and invalid views', async () => {
  let asset = studio.assets.find((a) => a.seedKey === 'roxy');
  const image = await upload();
  const sheet = {
    revision: asset.revision,
    title: 'Roxy sheet',
    mediaId: image._id,
    views: ['front']
  };
  await request(app)
    .post(`/api/studio/assets/${asset._id}/character-sheets`)
    .send(sheet)
    .expect(400);
  asset.candidates[0].mediaIds = [image._id];
  asset = await saveAsset(asset);
  asset = (
    await request(app)
      .post(`/api/studio/assets/${asset._id}/finalize`)
      .send({ revision: asset.revision, candidateId: asset.candidates[0].id })
      .expect(200)
  ).body.asset;
  const sound = await upload('voice.wav', audio);
  await request(app)
    .post(`/api/studio/assets/${asset._id}/character-sheets`)
    .send({ ...sheet, revision: asset.revision, mediaId: sound._id })
    .expect(400);
  for (const views of [[], ['not-a-view'], ['top']])
    await request(app)
      .post(`/api/studio/assets/${asset._id}/character-sheets`)
      .send({ ...sheet, revision: asset.revision, views })
      .expect(400);
});

test('scene approval is server controlled and becomes stale after script or asset changes', async () => {
  const asset = studio.assets[0];
  let episode = await createEpisode(asset._id);
  assert.equal(episode.scenes[0].approvalStatus, 'draft');
  assert.equal(episode.scenes[0].clips[0].duration, 27);
  episode = await approve(episode);
  assert.equal(episode.scenes[0].approvalStatus, 'approved');
  await saveAsset({ ...asset, notes: 'New identity detail.' });
  let loaded = (await request(app).get('/api/studio').expect(200)).body.episodes[0];
  assert.equal(loaded.scenes[0].approvalStatus, 'needs-review');
  episode = await approve(loaded);
  episode.scenes[0].script += ' AL walks away.';
  loaded = (await request(app).put(`/api/studio/episodes/${episode._id}`).send(episode).expect(200))
    .body.episode;
  assert.equal(loaded.scenes[0].approvalStatus, 'needs-review');
  await request(app).put(`/api/studio/episodes/${episode._id}`).send(episode).expect(409);
});

test('rejects invalid clip lengths, malformed records, and non-video selected takes', async () => {
  const body = episodeBody(studio.assets[0]._id);
  body.scenes[0].clips[0].duration = 31;
  await request(app).post('/api/studio/episodes').send(body).expect(400);
  body.scenes[0].clips = [null];
  await request(app).post('/api/studio/episodes').send(body).expect(400);
  const file = await upload();
  await request(app)
    .post('/api/studio/episodes')
    .send(episodeBody(studio.assets[0]._id, file._id))
    .expect(400);
  await request(app)
    .put(`/api/studio/assets/${studio.assets[0]._id}`)
    .send({ revision: 0, name: { $set: 'injection' }, kind: 'character' })
    .expect(400);
});

test('builds different image/video prompts with flexible durations and no music', async () => {
  const result = await request(app)
    .post('/api/studio/prompts')
    .send(episodeBody(studio.assets[0]._id))
    .expect(200);
  const prompt = result.body.prompts[0];
  assert.match(prompt.image, /2K/);
  assert.ok(!prompt.image.includes('ROXY:'));
  assert.match(prompt.video, /27 seconds/);
  assert.match(prompt.video, /ROXY says: "This should be an easy job/);
  assert.match(prompt.video, /No music, score, soundtrack, or musical bed/);
});

test('exports a portable ZIP only after approved scenes have selected takes', async () => {
  let episode = await createEpisode(studio.assets[0]._id);
  await request(app).get(`/api/studio/episodes/${episode._id}/package`).expect(400);
  const take = await upload('take.mp4', video);
  const dialogue = await upload('selected-dialogue.wav', audio);
  const alternate = await upload('unused-dialogue.wav', audio);
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.soundLegacyTakeId': take._id } }
  );
  episode.scenes[0].clips[0].selectedTakeId = take._id;
  episode.scenes[0].clips[0].dialogueTakeIds = [dialogue._id, alternate._id];
  episode.scenes[0].clips[0].selectedDialogueId = dialogue._id;
  episode = (
    await request(app).put(`/api/studio/episodes/${episode._id}`).send(episode).expect(200)
  ).body.episode;
  episode = await approve(episode);
  const response = await request(app)
    .get(`/api/studio/episodes/${episode._id}/package`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Uint8Array[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  const zip = response.body;
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  const nameLength = zip.readUInt16LE(26);
  assert.equal(zip.toString('utf8', 30, 30 + nameLength), 'manifest.json');
  const manifest = JSON.parse(
    zip.toString('utf8', 30 + nameLength, 30 + nameLength + zip.readUInt32LE(18))
  );
  assert.equal(manifest.episode.scenes[0].clips[0].duration, 27);
  assert.ok(zip.includes(video));
  assert.match(manifest.media[0].file, /take\.mp4$/);
  assert.ok(manifest.media.some((m) => m.id === dialogue._id));
  assert.ok(!manifest.media.some((m) => m.id === alternate._id));
  assert.ok(zip.includes(audio));
  const stored = await StudioEpisode.findById(episode._id).lean();
  delete stored.scenes[0].soundPlan;
  stored.scenes[0].approval = {
    fingerprint: sceneFingerprint(stored.scenes[0], await StudioAsset.find().lean())
  };
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { scenes: stored.scenes } });
  await request(app).get(`/api/studio/episodes/${episode._id}/package`).expect(200);
});

test('new workflow characters receive the complete reference package even when only a portrait is supplied', async () => {
  await StudioProject.updateOne({ key: 'imperial-smuggler' }, { $set: { workflowVersion: 1 } });
  const portrait = {
    id: 'master-portrait',
    title: 'Master portrait',
    type: 'image',
    required: true,
    notes: 'Owner framing.',
    imagePrompt: 'Exact original portrait directions.',
    mediaId: null
  };
  const response = await request(app)
    .post('/api/studio/assets')
    .send({
      name: 'New workflow character',
      kind: 'character',
      brief: 'A new adult character design.',
      notes: '',
      scope: 'reusable' as const,
      production: {
        sourceMode: 'original',
        sourceNotes: 'Owner original character design.',
        items: [portrait]
      },
      candidates: []
    })
    .expect(201);
  const created = response.body.asset;
  assert.equal(created.sheetLayout, 'production-package');
  assert.equal(created.production.items.length, 9);
  assert.equal(
    created.production.items.find((item) => item.id === 'master-portrait').imagePrompt,
    portrait.imagePrompt
  );
  assert.ok(created.production.items.some((item) => item.id === 'body-turnaround'));
});
