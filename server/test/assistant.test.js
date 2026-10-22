import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { makeProposal } from '../src/assistant/chat.js';
import { inspectMedia } from '../src/assistant/inspect.js';
import { Chat, Job, Message, Proposal, Run, SourceGrant } from '../src/assistant/models.js';
import { speakerVoice } from '../src/assistant/production.js';
import { createSecretStore } from '../src/assistant/store.js';
import { StudioAsset, StudioEpisode, StudioMedia } from '../src/models/Studio.js';
import { hashToken } from '../src/owner.js';
import {
  sceneFingerprint,
  soundPlanFingerprint,
  soundPlanInput
} from '../src/studio-validation.js';

let directory,
  mongo,
  app,
  store,
  providerCalls,
  providerBehavior,
  aiCalls,
  aiReplies,
  fetchOverride;
let asset, episode, image, chat, ownerPath;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
  'base64'
);
const base = '/api/studio/assistant';
const localOwner = {
  username: 'tony',
  version: 'test-owner',
  hash: '0'.repeat(128),
  salt: '0'.repeat(48)
};
before(
  async () => {
    directory = await mkdtemp(join(tmpdir(), 'roxy-assistant-test-'));
    ownerPath = join(directory, 'owner.json');
    await writeFile(ownerPath, JSON.stringify(localOwner));
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri('assistant_test'));
    await Promise.all([Message.init(), Job.init(), SourceGrant.init()]);
  },
  { timeout: 180000 }
);
beforeEach(async () => {
  for (const model of [
    Chat,
    Job,
    Message,
    Proposal,
    Run,
    SourceGrant,
    StudioAsset,
    StudioEpisode,
    StudioMedia
  ])
    await model.deleteMany({});
  await writeFile(ownerPath, JSON.stringify(localOwner));
  providerCalls = [];
  providerBehavior = null;
  fetchOverride = null;
  aiCalls = [];
  aiReplies = [];
  store = createSecretStore(join(directory, randomUUID()));
  await store.update(() => ({
    openai: { key: 'sk-test-secret', model: 'test-model' },
    chatgpt: {
      activeProfileId: 'test-profile',
      profiles: [
        {
          id: 'test-profile',
          label: 'Test account',
          email: 'test@example.com',
          clientId: 'oaiapp_test',
          subject: 'test-user',
          scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'],
          model: 'test-model',
          models: [{ id: 'test-model', name: 'Test model' }],
          tokenVersion: 'version1',
          tokens: {
            access_token: 'fixture-plan-access',
            refresh_token: 'fixture-refresh',
            expiresAt: Date.now() + 3600000
          }
        }
      ]
    },
    openart: {
      tokens: { access_token: 'secret-openart-token' },
      projectId: 'test-project',
      redirectUrl: 'https://studio.example.com/api/assistant/oauth/openart/callback'
    }
  }));
  const openart = {
    close: async () => {},
    call: async (name, args) => {
      providerCalls.push({ name, args });
      if (providerBehavior) return providerBehavior(name, args);
      if (name === 'openart_model_form_get') return { jsonSchema: {} };
      if (name === 'openart_model_cost')
        return { currency: 'credits', items: [{ totalCredits: 40, affordable: true }] };
      if (name === 'openart_generate_image')
        return { historyId: 'render-1', status: 'PENDING', pollAfterSeconds: 10 };
      if (name === 'openart_creation_get')
        return {
          historyId: 'render-1',
          status: 'COMPLETED',
          resources: [
            { id: 'result-1', mediaType: 'image', url: 'https://cdn.openart.ai/test/result.png' }
          ]
        };
      throw new Error('Unexpected mock tool');
    }
  };
  const fetcher = async (url, options) => {
    if (fetchOverride) return fetchOverride(url, options);
    if (url.includes('/api/assistant/source/') && options?.method === 'HEAD')
      return new Response(null, { headers: { 'content-type': 'image/png' } });
    if (url.startsWith('https://cdn.openart.ai/')) return new Response(png);
    if (url.startsWith('https://api.openai.com/v1/models/')) return new Response('{}');
    if (url === 'https://api.openai.com/v1/responses') {
      assert.equal(options.headers.authorization, 'Bearer fixture-plan-access');
      aiCalls.push(JSON.parse(options.body));
      const result = aiReplies.shift() ?? {
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Your new image is queued for review.' }]
          }
        ]
      };
      // Match the live plan stream: separate completed items, empty terminal output, no MIME header.
      return new Response(
        new TextEncoder().encode(
          (result.output ?? [])
            .map(
              (item, output_index) =>
                'event: response.output_item.done\ndata: ' +
                JSON.stringify({ type: 'response.output_item.done', output_index, item }) +
                '\n\n'
            )
            .join('') +
            'event: response.completed\ndata: ' +
            JSON.stringify({
              type: 'response.completed',
              response: { ...result, status: 'completed', output: [] }
            }) +
            '\n\n'
        )
      );
    }
    throw new Error('Unexpected mock network');
  };
  app = createApp({
    auth: false,
    mediaDirectory: directory,
    assistant: { store, openart, fetcher, ownerPath, remotePath: join(directory, 'remote.json') }
  });
  image = await StudioMedia.create({
    filename: 'original.png',
    originalName: 'original.png',
    kind: 'image',
    mime: 'image/png',
    bytes: png.length,
    providerReference: { id: 'original-ref', url: 'https://cdn.openart.ai/test/original.png' }
  });
  await writeFile(join(directory, 'original.png'), png);
  asset = await StudioAsset.create({
    name: 'AL-1B',
    kind: 'droid',
    brief: 'Wedge head, unequal cyan optics.',
    revision: 0,
    referenceRevision: 0,
    candidates: [],
    characterSheets: [],
    finalChoice: { id: 'original', mediaIds: [String(image._id)] }
  });
  const scene = {
    id: 'scene1',
    title: 'At the port',
    style: 'cinematic',
    location: 'Star Wars, Corellia',
    script: 'The ship remains parked.',
    assetIds: [asset._id],
    clips: [
      {
        id: 'clip1',
        title: 'Al waits',
        duration: 8,
        action: 'Al remains seated.',
        dialogue: '',
        camera: 'Fixed',
        soundEffects: 'Port traffic. No music.',
        takeIds: [],
        dialogueTakeIds: []
      }
    ]
  };
  scene.soundPlan = soundPlanInput({
    notes: 'No music.',
    layers: [
      {
        id: 'ambience',
        title: 'Port bed',
        description: 'Distant spacecraft, pedestrians and machinery.',
        type: 'ambience',
        loop: true,
        duration: 15
      }
    ]
  });
  scene.soundPlan.approval = {
    approvedAt: new Date(),
    fingerprint: soundPlanFingerprint(scene, [asset.toObject()])
  };
  scene.approval = {
    fingerprint: sceneFingerprint(scene, [asset.toObject()]),
    approvedAt: new Date()
  };
  episode = await StudioEpisode.create({
    title: 'Pilot',
    premise: '',
    notes: '',
    scenes: [scene],
    revision: 0,
    history: []
  });
  chat = await Chat.create({
    title: 'Pilot production',
    context: { episodeId: String(episode._id) }
  });
});
after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true });
});
const target = () => ({ episodeId: String(episode._id), sceneId: 'scene1', clipId: 'clip1' });
const queue = (kind, overrides = {}) =>
  app.locals.assistant.production.queue({
    chatId: chat._id,
    runId: 'test-run',
    requestId: randomUUID(),
    kind,
    target: target(),
    instructions: 'Keep the parked ship and approved Al design.',
    ...overrides
  });
async function approvedShot() {
  return StudioAsset.create({
    name: 'Clip 1 image',
    kind: 'environment',
    scope: 'episode',
    episodeId: episode._id,
    sceneId: 'scene1',
    clipId: 'clip1',
    revision: 0,
    finalChoice: { id: 'shot', mediaIds: [String(image._id)] }
  });
}
test('credentials are encrypted at rest and never returned by connection or chat endpoints', async () => {
  const privateStore = createSecretStore(join(directory, 'encryption-test'));
  await privateStore.update(() => ({ key: 'a-secret-that-must-not-be-plaintext' }));
  assert.equal((await privateStore.read()).key, 'a-secret-that-must-not-be-plaintext');
  assert.equal(
    (await readFile(join(directory, 'encryption-test', 'integrations.enc'))).includes(
      Buffer.from('a-secret')
    ),
    false
  );
  const response = await request(app)
    .get(base + '/connections')
    .expect(200);
  assert.equal(response.body.chatgpt.canChat, true);
  assert.equal(response.body.chatgpt.apiKeyFallback, false);
  assert.equal(response.body.chatgpt.legacyApiKeyIgnored, true);
  assert.equal(JSON.stringify(response.body).includes('sk-test-secret'), false);
  assert.equal(JSON.stringify(response.body).includes('secret-openart-token'), false);
});
test('production chat and connections require authentication; invalid public callback and media grants disclose nothing', async () => {
  const locked = createApp({ auth: { ownerPath }, assistant: { store, ownerPath } });
  await request(locked)
    .get(base + '/chats')
    .expect(401);
  await request(locked)
    .put(base + '/connections/openai')
    .send({ key: 'x' })
    .expect(401);
  await request(locked)
    .get('/api/assistant/oauth/openart/callback?state=fake&code=fake')
    .expect(400);
  await request(locked)
    .get('/api/assistant/source/' + 'x'.repeat(43))
    .expect(404);
});
test('video requires a current scene approval and one approved image', async () => {
  await assert.rejects(queue('video'), /Approve one shot image/);
  await approvedShot();
  await queue('video');
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $set: { 'scenes.0.clips.0.action': 'New blocking' } }
  );
  await assert.rejects(queue('video'), /Approve the current scene script/);
  assert.equal(providerCalls.length, 0);
});
test('pending image replacements and dialogue performances block video even with an earlier approved image', async () => {
  const shot = await approvedShot();
  await StudioAsset.updateOne({ _id: shot._id }, { $set: { reviewStatus: 'pending-choice' } });
  await assert.rejects(queue('video'), /pending shot image/);
  await StudioAsset.updateOne({ _id: shot._id }, { $set: { reviewStatus: null } });
  await queue('image');
  await assert.rejects(queue('video'), /Wait for the requested image or dialogue/);
});
test('a changed reference blocks a queued render before credits are spent', async () => {
  const job = await queue('image');
  await StudioAsset.updateOne({ _id: asset._id }, { $inc: { referenceRevision: 1 } });
  await app.locals.assistant.production.processJob(job);
  assert.equal((await Job.findById(job._id)).status, 'failed');
  assert.equal(providerCalls.length, 0);
});
test('image request quotes correct settings, submits once, imports original file and creates one pending option', async () => {
  const requestId = randomUUID();
  const job = await queue('image', { requestId });
  assert.equal(String((await queue('image', { requestId }))._id), String(job._id));
  await app.locals.assistant.production.processJob(job);
  let saved = await Job.findById(job._id).lean();
  assert.equal(saved.historyId, 'render-1');
  const submission = providerCalls.find((c) => c.name === 'openart_generate_image');
  assert.equal(submission.args.model, 'gpt-image-2-5-sunburst');
  assert.equal(submission.args.params.resolutionTier, '2k');
  assert.equal(submission.args.params.quality, 'high');
  assert.equal(submission.args.params.imageCount, 1);
  assert.equal(submission.args.params.visualReferences[0].id, 'original-ref');
  await app.locals.assistant.production.processJob(saved);
  saved = await Job.findById(job._id).lean();
  assert.equal(saved.status, 'ready');
  const result = await StudioMedia.findById(saved.resultMediaIds[0]).lean();
  assert.deepEqual(await readFile(join(directory, result.filename)), png);
  const shot = await StudioAsset.findById(saved.resultAssetId).lean();
  assert.equal(shot.finalChoice, null);
  assert.equal(shot.reviewStatus, 'pending-choice');
  assert.equal(shot.candidates.length, 1);
  assert.equal(shot.candidates[0].mediaIds.length, 1);
  assert.equal(providerCalls.filter((c) => c.name === 'openart_generate_image').length, 1);
});
test('lost submit response becomes uncertain and is never automatically retried', async () => {
  providerBehavior = async (name) => {
    if (name === 'openart_model_cost') return { items: [{ affordable: true }] };
    if (name === 'openart_generate_image')
      throw new Error('Network closed after provider accepted');
    return {};
  };
  const job = await queue('image');
  await app.locals.assistant.production.processJob(job);
  const saved = await Job.findById(job._id).lean();
  assert.equal(saved.status, 'uncertain');
  await app.locals.assistant.tick();
  assert.equal(providerCalls.filter((c) => c.name === 'openart_generate_image').length, 1);
});

test('due status polls do not starve newer unsubmitted renders', async () => {
  const older = await queue('image');
  await app.locals.assistant.production.processJob(older);
  await Job.updateOne({ _id: older._id }, { $set: { nextPollAt: new Date(0) } });
  const newer = await queue('image');
  await app.locals.assistant.tick();
  assert.equal((await Job.findById(newer._id)).status, 'rendering');
  assert.equal(providerCalls.filter((c) => c.name === 'openart_generate_image').length, 2);
  assert.equal(providerCalls.filter((c) => c.name === 'openart_creation_get').length, 0);
});
test('insufficient OpenArt credits never submit a paid generation', async () => {
  providerBehavior = async (name) =>
    name === 'openart_model_cost' ? { items: [{ affordable: false }] } : {};
  const job = await queue('image');
  await app.locals.assistant.production.processJob(job);
  assert.equal((await Job.findById(job._id)).status, 'failed');
  assert.equal(
    providerCalls.some((c) => c.name === 'openart_generate_image'),
    false
  );
});
test('Al voice lookup cannot accidentally choose a female voice containing the word finalized', () => {
  const voices = [
    {
      name: 'Roxy finalized voice',
      kind: 'voice',
      finalChoice: { voiceId: 'roxy', voiceModel: 'eleven_v3' }
    },
    { name: 'AL’s voice', kind: 'voice', finalChoice: { voiceId: 'al', voiceModel: 'eleven_v3' } }
  ];
  const speaker = speakerVoice({ dialogue: 'AL: You called, AL?' }, voices);
  assert.equal(speaker.voice.finalChoice.voiceId, 'al');
  assert.equal(speaker.spokenText, 'You called, Al?');
});
test('story proposal preserves existing episode until applied, clears approval/selections and checks revision', async () => {
  const shot = await approvedShot();
  const scene = {
    ...episode.toObject().scenes[0],
    script: 'A better scene',
    clips: episode.toObject().scenes[0].clips.map((c) => ({ ...c, action: 'New action' }))
  };
  const proposal = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Stronger opening',
    explanation: 'Tighter conflict',
    scene
  });
  assert.equal((await StudioEpisode.findById(episode._id)).revision, 0);
  await request(app).post(`${base}/proposals/${proposal._id}/apply`).send({}).expect(200);
  const changed = await StudioEpisode.findById(episode._id).lean();
  assert.equal(changed.scenes[0].script, 'A better scene');
  assert.equal(changed.scenes[0].approval, null);
  assert.equal(changed.scenes[0].clips[0].selectedTakeId, null);
  assert.equal(changed.history.length, 1);
  assert.equal((await StudioAsset.findById(shot._id)).finalChoice, null);
  const stale = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Idea',
    text: 'Something new'
  });
  await StudioEpisode.updateOne({ _id: episode._id }, { $inc: { revision: 1 } });
  await request(app).post(`${base}/proposals/${stale._id}/apply`).send({}).expect(409);
});
test('local references are private except exact expiring provider grant, revoked by owner change or deletion', async () => {
  await StudioMedia.updateOne({ _id: image._id }, { $unset: { providerReference: 1 } });
  const job = await queue('image');
  const built = await app.locals.assistant.production.build(job);
  const token = new URL(built.params.visualReferences[0].url).pathname;
  await request(app).get(token).expect(200);
  await request(app)
    .get(token + 'bad')
    .expect(404);
  await writeFile(ownerPath, JSON.stringify({ ...localOwner, version: 'changed-owner' }));
  await request(app).get(token).expect(404);
  await writeFile(ownerPath, JSON.stringify(localOwner));
  await SourceGrant.updateMany({}, { $set: { expires: new Date(Date.now() - 1000) } });
  await request(app).get(token).expect(404);
  assert.equal((await SourceGrant.findOne()).tokenHash, hashToken(token.split('/').at(-1)));
});

test('localhost OpenArt sign-in shares local files through the current public tunnel', async () => {
  await store.update((s) => ({
    ...s,
    openart: {
      ...s.openart,
      redirectUrl: 'http://127.0.0.1:5000/api/assistant/oauth/openart/callback'
    }
  }));
  await writeFile(
    join(directory, 'remote.json'),
    JSON.stringify({ origin: 'https://current.trycloudflare.com' })
  );
  await StudioMedia.updateOne({ _id: image._id }, { $unset: { providerReference: 1 } });
  const job = await queue('image');
  const built = await app.locals.assistant.production.build(job);
  const url = new URL(built.params.visualReferences[0].url);
  assert.equal(url.origin, 'https://current.trycloudflare.com');
  await request(app)
    .head(url.pathname)
    .expect(200)
    .expect('Content-Type', /image\/png/);
  const connection = await request(app)
    .post(base + '/connections/openart/test')
    .send({})
    .expect(200);
  assert.equal(connection.body.referenceSharing.origin, url.origin);
  assert.equal(
    providerCalls.some((c) => c.name.includes('generate')),
    false
  );
  await rm(join(directory, 'remote.json'));
});

test('unreachable local references fail before any provider quote or generation', async () => {
  await StudioMedia.updateOne({ _id: image._id }, { $unset: { providerReference: 1 } });
  const job = await queue('image');
  fetchOverride = async () => new Response(null, { status: 503 });
  await app.locals.assistant.production.processJob(job);
  assert.equal((await Job.findById(job._id)).status, 'failed');
  assert.match((await Job.findById(job._id)).error, /no render was submitted/);
  assert.equal(providerCalls.length, 0);
});

test('overlong video directions are rejected before a misleading queued result', async () => {
  await approvedShot();
  await assert.rejects(
    queue('video', { instructions: 'A precise instruction. '.repeat(200) }),
    /Wan allows 4500|under 3000/
  );
  assert.equal(await Job.countDocuments(), 0);
  assert.equal(providerCalls.length, 0);
});
test('assistant uses real tool results to queue jobs, saves replies and sends no credentials in its context', async () => {
  aiReplies = [
    {
      output: [
        {
          type: 'function_call',
          call_id: 'call1',
          name: 'request_render',
          arguments: JSON.stringify({
            kind: 'image',
            ...target(),
            instructions: 'Improve the lighting.'
          })
        }
      ]
    },
    {
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: 'One image option is queued. Review it when ready.' }
          ]
        }
      ]
    }
  ];
  const run = await Run.create({ chatId: chat._id, status: 'running' });
  await Chat.updateOne({ _id: chat._id }, { $set: { activeRun: String(run._id) } });
  await Message.create({
    chatId: chat._id,
    role: 'user',
    text: 'Make a new image for clip 1.',
    mediaIds: []
  });
  await app.locals.assistant.engine.run(run.toObject());
  assert.equal((await Run.findById(run._id)).status, 'completed');
  assert.equal((await Chat.findById(chat._id)).activeRun, null);
  assert.equal(await Job.countDocuments(), 1);
  assert.equal(
    (await Message.findOne({ role: 'assistant' })).text,
    'One image option is queued. Review it when ready.'
  );
  assert.equal(aiCalls.length, 2);
  assert.equal(aiCalls[0].store, false);
  assert.equal(aiCalls[0].stream, true);
  assert.equal(aiCalls[0].tools[0].type, 'namespace');
  assert.equal(aiCalls[0].tools[0].name, 'studio');
  assert.equal('max_output_tokens' in aiCalls[0], false);
  assert.equal(JSON.stringify(aiCalls).includes('sk-test-secret'), false);
  assert.equal(JSON.stringify(aiCalls).includes('secret-openart-token'), false);
});
test('chat cannot bypass image approval by requesting video in a tool call', async () => {
  aiReplies = [
    {
      output: [
        {
          type: 'function_call',
          call_id: 'video1',
          name: 'request_render',
          arguments: JSON.stringify({ kind: 'video', ...target(), instructions: 'Do it now.' })
        }
      ]
    }
  ];
  const run = await Run.create({ chatId: chat._id, status: 'running' });
  await Message.create({ chatId: chat._id, role: 'user', text: 'Generate the video.' });
  await app.locals.assistant.engine.run(run.toObject());
  assert.equal(await Job.countDocuments(), 0);
  assert.match(
    aiCalls[1].input.find((i) => i.type === 'function_call_output').output,
    /Approve one shot image/
  );
  assert.equal(providerCalls.length, 0);
});
test('recovery marks uncertain submits without resubmission and preserves known provider history', async () => {
  const job = await Job.create({ requestId: randomUUID(), kind: 'image', status: 'submitting' });
  const known = await Job.create({
    requestId: randomUUID(),
    kind: 'image',
    status: 'rendering',
    historyId: 'known',
    nextPollAt: new Date(Date.now() + 60000)
  });
  await app.locals.assistant.start();
  await app.locals.assistant.stop();
  assert.equal((await Job.findById(job._id)).status, 'uncertain');
  assert.equal((await Job.findById(known._id)).historyId, 'known');
  assert.equal(providerCalls.length, 0);
});
test('transient status failures retain the known render and schedule a read-only retry', async () => {
  const job = await queue('image');
  await app.locals.assistant.production.processJob(job);
  providerBehavior = async () => {
    throw new Error('Temporary network problem');
  };
  await app.locals.assistant.production.processJob(await Job.findById(job._id).lean());
  const saved = await Job.findById(job._id).lean();
  assert.equal(saved.status, 'rendering');
  assert.equal(saved.historyId, 'render-1');
  assert.ok(saved.nextPollAt > new Date());
  assert.equal(providerCalls.filter((c) => c.name === 'openart_generate_image').length, 1);
});
test('approving a generated character sheet registers that exact approved multiview image', async () => {
  const job = await queue('image', { target: { assetId: String(asset._id) } });
  await app.locals.assistant.production.processJob(job);
  await app.locals.assistant.production.processJob(await Job.findById(job._id).lean());
  const current = await StudioAsset.findById(asset._id).lean();
  const option = current.candidates.at(-1);
  assert.equal(current.finalChoice.id, 'original');
  const response = await request(app)
    .post(`/api/studio/assets/${asset._id}/finalize`)
    .send({ revision: current.revision, candidateId: option.id })
    .expect(200);
  const sheet = response.body.asset.characterSheets.at(-1);
  assert.equal(sheet.mediaId, String(option.mediaIds[0]));
  assert.equal(sheet.sourceCandidateId, option.id);
  assert.ok(sheet.approvedAt);
  assert.equal(sheet.sourceFinalizedAt, response.body.asset.finalChoice.finalizedAt);
});
test('dialogue uses the exact finalized Eleven v3 voice and imports an unselected audition', async () => {
  const voice = await StudioAsset.create({
    name: 'AL’s voice',
    kind: 'voice',
    revision: 0,
    finalChoice: {
      id: 'voice',
      voiceId: 'approved-al-voice',
      voiceModel: 'eleven_v3',
      mediaIds: []
    }
  });
  const current = await StudioEpisode.findById(episode._id).lean();
  current.scenes[0].clips[0].dialogue = 'AL: That is optimistic, AL.';
  current.scenes[0].approval.fingerprint = sceneFingerprint(current.scenes[0], [asset.toObject()]);
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { scenes: current.scenes } });
  let submitted;
  fetchOverride = async (url, options) => {
    assert.match(url, /text-to-speech\/approved-al-voice\?output_format=mp3_44100_192$/);
    submitted = JSON.parse(options.body);
    assert.equal(options.headers['xi-api-key'], 'fixture-elevenlabs-key');
    const mp3 = Buffer.alloc(32);
    mp3.write('ID3');
    return new Response(mp3);
  };
  const savedKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'fixture-elevenlabs-key';
  try {
    const job = await queue('dialogue');
    await app.locals.assistant.production.processJob(job);
    const saved = await Job.findById(job._id).lean();
    assert.equal(saved.status, 'ready');
    assert.deepEqual(submitted, {
      model_id: 'eleven_v3',
      text: 'That is optimistic, Al.',
      voice_settings: { stability: 0.5 },
      seed: 42020,
      apply_text_normalization: 'on'
    });
    const updated = await StudioEpisode.findById(episode._id).lean();
    assert.equal(updated.scenes[0].clips[0].selectedDialogueId, null);
    assert.equal(String(updated.scenes[0].clips[0].dialogueTakeIds[0]), saved.resultMediaIds[0]);
    assert.equal((await StudioAsset.findById(voice._id)).finalChoice.voiceId, 'approved-al-voice');
  } finally {
    if (savedKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = savedKey;
  }
});
test('an interrupted plan response never executes a partial render tool call', async () => {
  const events = [
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        type: 'function_call',
        call_id: 'partial-render',
        name: 'request_render',
        arguments: JSON.stringify({
          kind: 'image',
          ...target(),
          instructions: 'Partial tool request'
        })
      }
    },
    {
      type: 'response.failed',
      response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } }
    }
  ];
  fetchOverride = async () =>
    new Response(events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''), {
      headers: { 'content-type': 'text/event-stream' }
    });
  const run = await Run.create({ chatId: chat._id, status: 'running' });
  await Message.create({ chatId: chat._id, role: 'user', text: 'Make a new image.' });
  await app.locals.assistant.engine.run(run.toObject());
  assert.equal(
    (await Run.findById(run._id)).providerErrorCode,
    'subscription_sharing_usage_limit_exceeded'
  );
  assert.equal(await Job.countDocuments(), 0);
  assert.equal(providerCalls.length, 0);
});
test('old API key setup cannot enable billed chat, and remote ChatGPT setup is blocked', async () => {
  await store.update((s) => ({ ...s, chatgpt: undefined }));
  const response = await request(app)
    .put(base + '/connections/openai')
    .send({ key: 'billed-key' })
    .expect(410);
  assert.match(response.body.message, /API-key billing is disabled/);
  await request(app)
    .post(`${base}/chats/${chat._id}/messages`)
    .send({ requestId: randomUUID(), text: 'Hello.' })
    .expect(409);
  await request(app)
    .post(base + '/connections/chatgpt/connect')
    .set('Origin', 'https://studio.example.com')
    .set('X-Forwarded-Proto', 'https')
    .send({})
    .expect(400);
  assert.equal(aiCalls.length, 0);
});
test('audio inspection returns saved script context without calling a transcription API', async () => {
  const audio = await StudioMedia.create({
    filename: 'audio.mp3',
    kind: 'audio',
    mime: 'audio/mpeg',
    originalName: 'Al audition.mp3',
    bytes: 32
  });
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.clips.0.dialogueTakeIds': [audio._id],
        'scenes.0.clips.0.dialogue': 'AL: I object.'
      }
    }
  );
  const result = await inspectMedia(String(audio._id), { mediaDirectory: directory });
  assert.equal(result.info.savedDialogue[0].script, 'AL: I object.');
  assert.match(result.info.limitation, /not a transcription/);
  assert.equal('transcript' in result.info, false);
});
