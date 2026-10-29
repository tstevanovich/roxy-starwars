import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { promisify } from 'node:util';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { Job } from '../src/assistant/models.js';
import { createSoundProduction } from '../src/assistant/sound-production.js';
import {
  StudioAsset,
  StudioEpisode,
  StudioMedia,
  StudioProject,
  StudioSettings
} from '../src/models/Studio.js';
import { mixState, validateMixedSelection } from '../src/sound-design.js';
import { saveGeneratedMedia } from '../src/studio-media.js';
import { soundPlanFingerprint, soundPlanInput } from '../src/studio-validation.js';

const execute = promisify(execFile),
  base = '/api/studio';
let mongo, directory, app, rawBytes, soundBytes, mp3Bytes, source, sound, episode;
const plan = () =>
  soundPlanInput({
    notes: 'Continuous port ambience. No music.',
    layers: [
      {
        id: 'bed',
        title: 'Busy starport',
        description:
          'Star Wars spaceport: distant spacecraft, crowds and loading machinery. No music.',
        type: 'ambience',
        duration: 2,
        loop: true,
        gainDb: -18
      }
    ]
  });
before(
  async () => {
    directory = await mkdtemp(join(tmpdir(), 'roxy-sound-test-'));
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri('sound_tests'));
    await Job.init();
    await execute(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=160x90:r=24:d=2',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        join(directory, 'fixture.mp4')
      ],
      { windowsHide: true }
    );
    await execute(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=120:duration=2',
        '-ar',
        '48000',
        '-ac',
        '2',
        join(directory, 'fixture.wav')
      ],
      { windowsHide: true }
    );
    await execute(
      'ffmpeg',
      ['-y', '-v', 'error', '-i', join(directory, 'fixture.wav'), join(directory, 'fixture.mp3')],
      { windowsHide: true }
    );
    rawBytes = await readFile(join(directory, 'fixture.mp4'));
    soundBytes = await readFile(join(directory, 'fixture.wav'));
    mp3Bytes = await readFile(join(directory, 'fixture.mp3'));
  },
  { timeout: 180000 }
);
beforeEach(async () => {
  await StudioProject.updateOne(
    { key: 'imperial-smuggler' },
    { $set: { key: 'imperial-smuggler', videoWorkflow: 'legacy-upscale' } },
    { upsert: true }
  );
  for (const model of [StudioAsset, StudioEpisode, StudioMedia, StudioSettings, Job])
    await model.deleteMany({});
  app = createApp({ auth: false, mediaDirectory: directory });
  source = (await saveGeneratedMedia(directory, rawBytes, 'original.mp4')).toObject();
  const audio = (await saveGeneratedMedia(directory, soundBytes, 'port.wav')).toObject();
  sound = (
    await StudioAsset.create({
      name: 'Port bed',
      kind: 'sound',
      scope: 'reusable',
      reviewStatus: 'development',
      candidates: [{ id: 'chosen', title: 'Port bed', mediaIds: [audio._id] }],
      finalChoice: { id: 'chosen', title: 'Port bed', mediaIds: [String(audio._id)] }
    })
  ).toObject();
  const soundPlan = plan();
  soundPlan.layers[0].assetId = String(sound._id);
  episode = (
    await request(app)
      .post(base + '/episodes')
      .send({
        title: 'Sound test',
        scenes: [
          {
            id: 'scene',
            title: 'Boarding',
            style: 'cinematic',
            location: 'Corellia port',
            script: 'Roxy speaks while the ship stays parked.',
            assetIds: [],
            soundPlan,
            clips: [
              {
                id: 'clip',
                title: 'Reply',
                duration: 2,
                action: 'Roxy stays seated.',
                dialogue: 'ROXY: Al, that costs extra.',
                camera: 'Fixed.',
                soundEffects: 'Port ambience. No music.',
                production: { cleanDialogueMediaId: String(audio._id) },
                takeIds: [String(source._id)]
              }
            ]
          }
        ]
      })
      .expect(201)
  ).body.episode;
  episode = (
    await request(app)
      .post(`${base}/episodes/${episode._id}/scenes/scene/approve`)
      .send({ revision: episode.revision })
      .expect(200)
  ).body.episode;
});
after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.match(directory, /roxy-sound-test-/);
    await rm(directory, { recursive: true, force: true });
  }
});
async function queueMix() {
  return (
    await request(app)
      .post(base + '/assistant/sound/mix')
      .send({
        episodeId: episode._id,
        sceneId: 'scene',
        clipId: 'clip',
        sourceTakeId: String(source._id),
        revision: episode.revision,
        requestId: randomUUID()
      })
      .expect(202)
  ).body.job;
}
async function renderMix() {
  const job = await queueMix();
  await app.locals.assistant.production.processJob(await Job.findById(job._id).lean());
  const done = await Job.findById(job._id).lean();
  assert.equal(done.status, 'ready', done.error);
  const mixed = await StudioMedia.findById(done.resultMediaIds[0]).lean();
  episode = (await request(app).get(base).expect(200)).body.episodes[0];
  return mixed;
}
async function select(mixed) {
  episode.scenes[0].clips[0].selectedTakeId = String(mixed._id);
  episode = (await request(app).put(`${base}/episodes/${episode._id}`).send(episode).expect(200))
    .body.episode;
}

test('sound plan input strips forged approval and rejects invalid timing, duplicate layers and nonfinite levels', () => {
  const value = { ...plan(), approval: { fingerprint: 'forged' } };
  assert.equal(soundPlanInput(value).approval, undefined);
  for (const patch of [{ duration: 31 }, { gainDb: NaN }, { loop: 'yes' }, { type: 'music' }])
    assert.throws(() => soundPlanInput({ ...value, layers: [{ ...value.layers[0], ...patch }] }));
  assert.throws(() => soundPlanInput({ ...value, layers: [value.layers[0], value.layers[0]] }));
  const scene = episode.scenes[0];
  const before = soundPlanFingerprint(scene, []);
  scene.soundPlan.layers[0].assetId = null;
  assert.equal(soundPlanFingerprint(scene, []), before);
  scene.soundPlan.layers[0].gainDb = -12;
  assert.notEqual(soundPlanFingerprint(scene, []), before);
});
test('new scene approval requires a saved sound plan and raw video cannot bypass approval through PUT or POST', async () => {
  const missing = structuredClone(episode);
  missing.scenes[0].soundPlan = null;
  missing.scenes[0].clips[0].selectedTakeId = String(source._id);
  await request(app)
    .post(base + '/episodes')
    .send(missing)
    .expect(400);
  const selected = structuredClone(episode);
  selected.scenes[0].clips[0].selectedTakeId = String(source._id);
  selected.scenes[0].clips[0].soundLegacyTakeId = String(source._id);
  const blocked = await request(app)
    .put(`${base}/episodes/${episode._id}`)
    .send(selected)
    .expect(400);
  assert.match(blocked.body.message, /sound mix/);
  const draft = (
    await request(app)
      .post(base + '/episodes')
      .send({
        ...missing,
        scenes: [
          { ...missing.scenes[0], clips: [{ ...missing.scenes[0].clips[0], selectedTakeId: null }] }
        ]
      })
      .expect(201)
  ).body.episode;
  await request(app)
    .post(`${base}/episodes/${draft._id}/scenes/scene/approve`)
    .send({ revision: draft.revision })
    .expect(400);
});
test('FFmpeg mixes locally, keeps original video packets and dialogue, saves effects stem and queues upscale only after approval', async () => {
  const mixed = await renderMix();
  assert.notEqual(String(mixed._id), String(source._id));
  assert.equal(mixed.soundMix.sourceTakeId, String(source._id));
  const originalHash = await execute(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      join(directory, source.filename),
      '-map',
      '0:v:0',
      '-c',
      'copy',
      '-f',
      'hash',
      '-hash',
      'sha256',
      '-'
    ],
    { windowsHide: true }
  );
  const mixedHash = await execute(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      join(directory, mixed.filename),
      '-map',
      '0:v:0',
      '-c',
      'copy',
      '-f',
      'hash',
      '-hash',
      'sha256',
      '-'
    ],
    { windowsHide: true }
  );
  assert.equal(mixedHash.stdout, originalHash.stdout);
  assert.deepEqual(await readFile(join(directory, source.filename)), rawBytes);
  const stem = await StudioMedia.findById(mixed.soundMix.stemMediaId).lean();
  assert.equal(stem.kind, 'audio');
  assert.ok(stem.bytes > 1000);
  assert.equal(episode.scenes[0].clips[0].selectedTakeId, null);
  assert.equal(episode.scenes[0].clips[0].upscale, null);
  const job = await Job.findOne({ kind: 'mix' }).lean();
  assert.equal(job.quote.estimatedCredits, 0);
  await select(mixed);
  assert.equal(episode.scenes[0].clips[0].upscale.settings.height, 1440);
  assert.equal(episode.scenes[0].clips[0].upscale.sourceTakeId, String(mixed._id));
  assert.equal(episode.scenes[0].clips[0].soundLegacyTakeId, null);
  const cached = await request(app)
    .post(base + '/assistant/sound/mix')
    .send({
      episodeId: episode._id,
      sceneId: 'scene',
      clipId: 'clip',
      sourceTakeId: String(source._id),
      revision: episode.revision,
      requestId: randomUUID()
    })
    .expect(202);
  assert.equal(cached.body.media._id, String(mixed._id));
  assert.equal(cached.body.media.filename, undefined);
  assert.equal(await Job.countDocuments({ kind: 'mix' }), 1);
  const response = await request(app)
    .get(`${base}/episodes/${episode._id}/package`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
  assert.ok(response.body.includes(Buffer.from(stem.originalName)));
  assert.ok(response.body.includes(Buffer.from(source.originalName)));
});
test('changed plans do not grandfather mixed takes, and stale mixes cannot be newly selected or exported', async () => {
  const mixed = await renderMix();
  await select(mixed);
  episode.scenes[0].soundPlan.layers[0].gainDb = -9;
  episode = (await request(app).put(`${base}/episodes/${episode._id}`).send(episode).expect(200))
    .body.episode;
  episode = (await request(app).put(`${base}/episodes/${episode._id}`).send(episode).expect(200))
    .body.episode;
  assert.equal(episode.scenes[0].clips[0].soundLegacyTakeId, null);
  await request(app).get(`${base}/episodes/${episode._id}/package`).expect(400);
  episode.scenes[0].clips[0].selectedTakeId = null;
  episode = (await request(app).put(`${base}/episodes/${episode._id}`).send(episode).expect(200))
    .body.episode;
  episode = (
    await request(app)
      .post(`${base}/episodes/${episode._id}/scenes/scene/sound-plan/approve`)
      .send({ revision: episode.revision })
      .expect(200)
  ).body.episode;
  episode.scenes[0].clips[0].selectedTakeId = String(mixed._id);
  await request(app).put(`${base}/episodes/${episode._id}`).send(episode).expect(400);
});
test('pending sounds, absent audio and invalid clip timing block mixing without spending credits', async () => {
  await StudioAsset.updateOne({ _id: sound._id }, { $set: { reviewStatus: 'pending-choice' } });
  await assert.rejects(
    () => mixState(episode, episode.scenes[0], episode.scenes[0].clips[0], String(source._id)),
    /Approve one sound/
  );
  await StudioAsset.updateOne({ _id: sound._id }, { $set: { reviewStatus: 'development' } });
  const scene = episode.scenes[0];
  scene.soundPlan.layers[0].type = 'effect';
  scene.soundPlan.layers[0].clipId = 'clip';
  scene.soundPlan.layers[0].start = 1;
  scene.soundPlan.approval.fingerprint = soundPlanFingerprint(scene, []);
  await assert.rejects(
    () => mixState(episode, scene, scene.clips[0], String(source._id)),
    /timing/
  );
  assert.equal(await Job.countDocuments(), 0);
});
test('legacy video selections remain valid, cannot be forged by clients, and source/stem deletion protects derived mixes', async () => {
  const mixed = await renderMix();
  const clip = episode.scenes[0].clips[0];
  await validateMixedSelection(
    episode,
    { ...episode.scenes[0], soundPlan: null },
    { ...clip, selectedTakeId: source._id, soundLegacyTakeId: source._id }
  );
  await request(app)
    .delete(`${base}/media/${source._id}`)
    .send({ episodeId: episode._id, revision: episode.revision, sceneId: 'scene', clipId: 'clip' })
    .expect(409);
  await request(app).delete(`${base}/media/${mixed.soundMix.stemMediaId}`).send({}).expect(409);
  await request(app)
    .delete(`${base}/media/${mixed._id}`)
    .send({ episodeId: episode._id, revision: episode.revision, sceneId: 'scene', clipId: 'clip' })
    .expect(200);
  await request(app).get(`${base}/media/${mixed._id}`).expect(404);
  await request(app).get(`${base}/media/${source._id}`).expect(200);
});
test('ElevenLabs effects are individually pending, billed receipt is retained and duplicate requests submit only once', async () => {
  const original = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'fixture-not-a-secret';
  let calls = 0;
  try {
    const production = createSoundProduction({
      mediaDirectory: directory,
      fetcher: async (url, options) => {
        calls++;
        assert.match(url, /sound-generation/);
        const body = JSON.parse(options.body);
        assert.equal(body.model_id, 'eleven_text_to_sound_v2');
        assert.equal(body.loop, true);
        assert.match(body.text, /No intelligible speech/);
        return new Response(mp3Bytes, { headers: { 'character-cost': '80' } });
      }
    });
    const args = {
      episodeId: episode._id,
      sceneId: 'scene',
      layerId: 'bed',
      revision: episode.revision,
      requestId: randomUUID()
    };
    const queued = await production.queueSound(args);
    assert.equal(queued.job.quote.estimatedCredits, 80);
    const again = await production.queueSound(args);
    assert.equal(String(again.job._id), String(queued.job._id));
    await production.processJob(queued.job);
    await production.processJob(await Job.findById(queued.job._id).lean());
    assert.equal(calls, 1);
    const job = await Job.findById(queued.job._id).lean();
    assert.equal(job.status, 'ready', job.error);
    assert.equal(job.receipt.creditsCharged, 80);
    const updated = await StudioAsset.findById(sound._id).lean();
    assert.equal(updated.reviewStatus, 'pending-choice');
    assert.equal(updated.candidates.length, 2);
    assert.equal(updated.finalChoice.id, 'chosen');
  } finally {
    if (original === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = original;
  }
});
test('uncertain paid effect submission is never automatically retried', async () => {
  const original = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'fixture-not-a-secret';
  let calls = 0;
  try {
    const production = createSoundProduction({
      mediaDirectory: directory,
      fetcher: async () => {
        calls++;
        throw new Error('lost response');
      }
    });
    const queued = await production.queueSound({
      episodeId: episode._id,
      sceneId: 'scene',
      layerId: 'bed',
      revision: episode.revision,
      requestId: randomUUID()
    });
    await production.processJob(queued.job);
    const job = await Job.findById(queued.job._id).lean();
    assert.equal(job.status, 'uncertain');
    await production.processJob(job);
    assert.equal(calls, 1);
  } finally {
    if (original === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = original;
  }
});
test('sound audio import needs an approved plan and creates one unapproved sound choice', async () => {
  const audio = await StudioMedia.findById(sound.finalChoice.mediaIds[0]).lean();
  const result = await request(app)
    .post(base + '/assistant/sound/import')
    .send({
      episodeId: episode._id,
      sceneId: 'scene',
      layerId: 'bed',
      revision: episode.revision,
      mediaId: String(audio._id)
    })
    .expect(200);
  assert.equal(result.body.asset.reviewStatus, 'pending-choice');
  assert.equal(result.body.asset.candidates.at(-1).mediaIds.length, 1);
  assert.equal(result.body.episode.scenes[0].soundApprovalStatus, 'approved');
  await request(app)
    .get(base + '/assistant/sound/jobs?episodeId=' + episode._id)
    .expect(200);
  const protectedApp = createApp({
    auth: { ownerPath: join(directory, 'missing-owner.json') },
    mediaDirectory: directory
  });
  await request(protectedApp)
    .post(base + '/assistant/sound/mix')
    .send({})
    .expect(401);
});

test('mixes exclude the generator soundtrack and reject missing clean speech', async () => {
  const originalScene = episode.scenes[0];
  const noStem = JSON.parse(JSON.stringify(originalScene));
  noStem.clips[0].production.cleanDialogueMediaId = null;
  await assert.rejects(
    () => mixState(episode, noStem, noStem.clips[0], String(source._id)),
    /dialogue-only audio stem/
  );
  const mixed = await renderMix();
  assert.equal(mixed.soundMix.audioPolicy, 'isolated-dialogue-and-approved-effects-v1');
  assert.ok(mixed.soundMix.cleanDialogueMediaId);
  const decode = async (filename) =>
    (
      await execute(
        'ffmpeg',
        [
          '-v',
          'error',
          '-i',
          filename,
          '-ss',
          '0.4',
          '-t',
          '1',
          '-vn',
          '-ar',
          '48000',
          '-ac',
          '1',
          '-f',
          'f32le',
          '-'
        ],
        { encoding: 'buffer', maxBuffer: 1000000, windowsHide: true }
      )
    ).stdout;
  const amplitude = (buffer, frequency) => {
    let cosine = 0,
      sine = 0;
    const count = buffer.length / 4;
    for (let i = 0; i < count; i++) {
      const sample = buffer.readFloatLE(i * 4),
        angle = (2 * Math.PI * frequency * i) / 48000;
      cosine += sample * Math.cos(angle);
      sine += sample * Math.sin(angle);
    }
    return Math.hypot(cosine, sine) / count;
  };
  const input = await decode(join(directory, source.filename)),
    output = await decode(join(directory, mixed.filename));
  assert.ok(
    amplitude(output, 440) < amplitude(input, 440) * 0.02,
    'The 440Hz generated soundtrack must be excluded.'
  );
  assert.ok(amplitude(output, 120) > 0.01, 'Approved dialogue/effects remain audible.');
});
