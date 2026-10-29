import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { promisify } from 'node:util';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { makeProposal, productionProposal, studioContext } from '../src/assistant/chat.js';
import { inspectMedia } from '../src/assistant/inspect.js';
import { Chat, Job, Message, Proposal, Run, SourceGrant } from '../src/assistant/models.js';
import { speakerVoice } from '../src/assistant/production.js';
import { createSecretStore } from '../src/assistant/store.js';
import { removeDraftNotes, saveWorkingDraft } from '../src/assistant/working-drafts.js';
import {
  StudioAsset,
  StudioAutomation,
  StudioEpisode,
  StudioMedia,
  StudioProject
} from '../src/models/Studio.js';
import { StudioSourceEvidence } from '../src/models/Studio.js';
import { hashToken } from '../src/owner.js';
import { workflowContext } from '../src/production-workflow.js';
import { runProjectContext } from '../src/project-context.js';
import { saveGeneratedMedia } from '../src/studio-media.js';
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
    StudioMedia,
    StudioProject,
    StudioAutomation,
    StudioSourceEvidence
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
      if (name === 'openart_upload_sign')
        return {
          uploadId: 'uploaded-ref',
          signURL: 'https://upload.example.test/signed?secret=private',
          accessURL: 'https://cdn.openart.ai/test/uploaded.png',
          contentType: args.contentType
        };
      if (name === 'openart_upload_metadata_get')
        return {
          visualReference: {
            id: 'uploaded-ref',
            type: args.mediaType,
            url: args.mediaUrl,
            label: args.label,
            metadata: { width: 1, height: 1 }
          }
        };
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
test('chat-created workflow assets save reviewable source research and a full character package', async () => {
  await StudioProject.create({
    key: 'imperial-smuggler',
    name: 'Workflow test',
    workflowVersion: 1,
    referenceLayout: 'production-package'
  });
  const args = {
    name: 'New recurring character',
    kind: 'character',
    scope: 'reusable',
    brief: 'Keep the source costume.',
    production: {
      sourceMode: 'footage',
      sourceUrl: 'https://www.youtube.com/watch?v=example',
      sourceNotes: 'Observed face and costume; rear details unresolved.',
      sourceMediaIds: [String(image._id)]
    }
  };
  aiReplies = [
    {
      output: [
        {
          type: 'function_call',
          call_id: 'create-character',
          name: 'create_asset_draft',
          arguments: JSON.stringify(args)
        }
      ]
    }
  ];
  const run = await Run.create({ chatId: chat._id, status: 'running' });
  await Message.create({
    chatId: chat._id,
    role: 'user',
    text: 'Prepare this source-grounded character for approval.'
  });
  await runProjectContext(
    { key: 'imperial-smuggler', workflowVersion: 1, referenceLayout: 'production-package' },
    async () => {
      await app.locals.assistant.engine.run(run.toObject());
      const saved = await StudioAsset.findOne({ name: args.name }).lean();
      assert.ok(saved);
      assert.equal(saved.production.sourceNotes, args.production.sourceNotes);
      assert.equal(saved.production.sourceUrl, args.production.sourceUrl);
      assert.deepEqual(saved.production.sourceMediaIds, [String(image._id)]);
      assert.equal(saved.production.managed, true);
      assert.equal(saved.sheetLayout, 'production-package');
      assert.equal(saved.production.items.length, 9);
      const ctx = await workflowContext(),
        target = { scope: 'asset', recordId: String(saved._id) };
      assert.equal(ctx.evaluate(target, 'source').canApprove, true);
      assert.equal(ctx.evaluate(target, 'brief').canApprove, false);
      assert.equal(saved.finalChoice, null);
      assert.equal(await Job.countDocuments(), 0);
      for (const stage of ['source', 'brief']) {
        const current = await workflowContext(),
          row = current.evaluate(target, stage);
        assert.equal(row.canApprove, true);
        await request(app)
          .post('/api/studio/workflow/review')
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
      const steps = await app.locals.assistant.automation.plan(target);
      assert.equal(steps.length, 1);
      assert.equal(steps[0].target.packageItemId, 'master-portrait');
      await app.locals.assistant.automation.processNext();
      const queued = await Job.find({ 'target.assetId': String(saved._id) }).lean();
      assert.equal(queued.length, 1);
      assert.equal(queued[0].target.packageItemId, 'master-portrait');
      assert.equal(queued[0].status, 'queued');
      assert.equal(providerCalls.length, 0);
    }
  );
});

test('chat cannot silently create a managed asset with source research missing or invalid images', async () => {
  await StudioProject.create({
    key: 'imperial-smuggler',
    name: 'Workflow test',
    workflowVersion: 1
  });
  const count = await StudioAsset.countDocuments();
  const missingId = String(new mongoose.Types.ObjectId());
  for (const production of [
    undefined,
    { sourceMode: 'footage', sourceNotes: 'Known source, URL only in brief.' },
    { sourceMode: 'footage', sourceNotes: 'Missing image.', sourceMediaIds: [missingId] }
  ]) {
    const args = {
      name: 'Incomplete character',
      kind: 'character',
      scope: 'reusable',
      brief: 'https://www.youtube.com/watch?v=example',
      production
    };
    aiCalls = [];
    aiReplies = [
      {
        output: [
          {
            type: 'function_call',
            call_id: randomUUID(),
            name: 'create_asset_draft',
            arguments: JSON.stringify(args)
          }
        ]
      }
    ];
    const run = await Run.create({ chatId: chat._id, status: 'running' });
    await runProjectContext({ key: 'imperial-smuggler', workflowVersion: 1 }, () =>
      app.locals.assistant.engine.run(run.toObject())
    );
    const result = JSON.parse(
      aiCalls[1].input.find((i) => i.type === 'function_call_output').output
    );
    assert.match(result.error, /source evidence|source images|workspace/);
    assert.equal(await StudioAsset.countDocuments(), count);
    assert.equal(await Job.countDocuments(), 0);
  }
});

test('draft additions keep one current scene review, retain earlier feedback and reject old apply buttons', async () => {
  const scene = JSON.parse(JSON.stringify(episode.scenes[0]));
  const first = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Working scene',
    text: 'Scene for review.',
    scene
  });
  const second = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'First subtitle evidence',
    text: 'Evidence A: preserve the opening exchange.'
  });
  const third = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'More subtitle evidence',
    text: 'Evidence B: preserve the following response.'
  });
  const last = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Combined revised scene',
    text: 'Incorporates both evidence updates.',
    scene: { ...scene, script: 'Revised script with both source exchanges.' }
  });
  assert.equal(
    await Proposal.countDocuments({ episodeId: String(episode._id), status: 'pending' }),
    1
  );
  assert.equal(last.supportingNotes.length, 2);
  assert.deepEqual(
    last.supportingNotes.map((n) => n.text),
    ['Evidence A: preserve the opening exchange.', 'Evidence B: preserve the following response.']
  );
  for (const old of [first, second, third])
    assert.equal((await Proposal.findById(old._id).lean()).status, 'superseded');
  await request(app)
    .post(base + '/proposals/' + first._id + '/apply')
    .send({})
    .expect(409);
  assert.equal((await StudioEpisode.findById(episode._id).lean()).scenes[0].script, scene.script);
  const ctx = await studioContext({ episodeId: String(episode._id) });
  assert.equal(ctx.workingDrafts.length, 1);
  assert.equal(ctx.workingDrafts[0].scene.script, last.scene.script);
  await request(app)
    .post(base + '/proposals/' + last._id + '/apply')
    .send({})
    .expect(200);
  const saved = await StudioEpisode.findById(episode._id).lean();
  assert.equal(saved.scenes[0].script, last.scene.script);
  assert.equal(saved.researchNotes.length, 2);
  assert.equal(await Job.countDocuments(), 0);
});
test('chat removes a supporting block and later revisions cannot restore it', async () => {
  const before = await StudioEpisode.findById(episode._id).lean();
  const scene = JSON.parse(JSON.stringify(episode.scenes[0]));
  await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Working scene',
    text: 'Complete draft.',
    scene
  });
  await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Keep this evidence',
    text: 'Authoritative source detail.'
  });
  const draft = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Remove this block',
    text: 'Unwanted supporting block.'
  });
  const removedId = draft.supportingNotes[1].id;
  aiReplies = [
    {
      output: [
        {
          type: 'function_call',
          call_id: 'remove-note',
          name: 'remove_draft_notes',
          arguments: JSON.stringify({ draftId: String(draft._id), noteIds: [removedId] })
        }
      ]
    }
  ];
  const run = await Run.create({ chatId: chat._id, status: 'running' });
  await Message.create({
    chatId: chat._id,
    role: 'user',
    text: 'Remove that entire supporting block.'
  });
  await app.locals.assistant.engine.run(run.toObject());
  assert.ok(aiCalls[0].tools[0].tools.some((t) => t.name === 'remove_draft_notes'));
  const result = JSON.parse(aiCalls[1].input.find((i) => i.type === 'function_call_output').output);
  assert.equal(result.status, 'pending');
  assert.equal(result.supportingNotes.length, 1);
  assert.deepEqual(result.removedSupportingNoteIds, [removedId]);
  assert.deepEqual(result.scene, draft.scene);
  assert.equal((await Proposal.findById(draft._id).lean()).status, 'superseded');
  await request(app).post(`${base}/proposals/${draft._id}/apply`).send({}).expect(409);
  assert.deepEqual(await StudioEpisode.findById(episode._id).lean(), before);
  await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Another addition',
    text: 'New evidence.'
  });
  const revised = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Revised scene',
    text: 'Revised explanation.',
    scene: { ...scene, script: 'Updated script.' }
  });
  assert.equal(revised.supportingNotes.length, 2);
  assert.ok(revised.supportingNotes.every((n) => n.id !== removedId));
  assert.deepEqual(revised.removedSupportingNoteIds, [removedId]);
  // A stale sibling merge must also honor removal, even if its old payload
  // still contains the deleted note and does not carry the exclusion list.
  const merged = await saveWorkingDraft({
    chatId: chat._id,
    episodeId: String(episode._id),
    baseRevision: episode.revision,
    title: 'Later revision',
    text: 'Merged scene.',
    scene: revised.scene,
    supportingNotes: draft.supportingNotes
  });
  assert.equal(merged.supportingNotes.length, 2);
  assert.ok(merged.supportingNotes.every((n) => n.id !== removedId));
  const ctx = await studioContext({ episodeId: String(episode._id) });
  assert.equal(ctx.workingDrafts.length, 1);
  assert.ok(ctx.workingDrafts[0].supportingNotes.every((n) => n.id !== removedId));
  await request(app).post(`${base}/proposals/${merged._id}/apply`).send({}).expect(200);
  const saved = await StudioEpisode.findById(episode._id).lean();
  assert.equal(saved.researchNotes.length, 2);
  assert.ok(saved.researchNotes.every((n) => n.id !== removedId));
  assert.equal(await Job.countDocuments(), 0);
  assert.equal(providerCalls.length, 0);
});

test('note removal validates IDs atomically, handles all notes and rejects obsolete or foreign drafts', async () => {
  const scene = JSON.parse(JSON.stringify(episode.scenes[0]));
  await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Scene',
    text: 'Draft.',
    scene
  });
  const draft = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'A note',
    text: 'Remove this.'
  });
  const noteId = draft.supportingNotes[0].id;
  for (const noteIds of [[], null, [17], [''], Array(51).fill(noteId)])
    await assert.rejects(
      () => removeDraftNotes(chat._id, { draftId: String(draft._id), noteIds }),
      /supporting note IDs/
    );
  await assert.rejects(
    () =>
      removeDraftNotes(chat._id, {
        draftId: String(draft._id),
        noteIds: [noteId, 'wrong-note']
      }),
    /does not belong/
  );
  assert.equal(await Proposal.countDocuments({ status: 'pending' }), 1);
  assert.equal((await Proposal.findById(draft._id).lean()).supportingNotes.length, 1);
  const { runProjectContext } = await import('../src/project-context.js');
  await assert.rejects(
    () =>
      runProjectContext({ key: 'another-project' }, () =>
        removeDraftNotes(chat._id, {
          draftId: String(draft._id),
          noteIds: [noteId]
        })
      ),
    /no longer pending/
  );
  const removed = await removeDraftNotes(chat._id, {
    draftId: String(draft._id),
    noteIds: [noteId, noteId]
  });
  assert.equal(removed.supportingNotes.length, 0);
  assert.deepEqual(removed.removedSupportingNoteIds, [noteId]);
  await assert.rejects(
    () =>
      removeDraftNotes(chat._id, {
        draftId: String(draft._id),
        noteIds: [noteId]
      }),
    /no longer pending/
  );
  assert.equal(await Proposal.countDocuments({ status: 'pending' }), 1);
  assert.equal(await Job.countDocuments(), 0);
});

test('removing supporting notes from an episode plan survives subsequent plan updates', async () => {
  const planArgs = {
    scope: 'episode',
    recordId: String(episode._id),
    title: 'Research',
    explanation: 'Source changes.',
    production: { sourceNotes: 'Updated source.' }
  };
  await productionProposal(chat._id, planArgs);
  const draft = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Unwanted source block',
    text: 'Remove this reference.'
  });
  const noteId = draft.supportingNotes[0].id;
  await removeDraftNotes(chat._id, { draftId: String(draft._id), noteIds: [noteId] });
  const revised = await productionProposal(chat._id, {
    ...planArgs,
    production: { sourceNotes: 'More source detail.' }
  });
  assert.equal(revised.supportingNotes.length, 0);
  assert.deepEqual(revised.removedSupportingNoteIds, [noteId]);
  assert.equal(await Proposal.countDocuments({ status: 'pending' }), 1);
  assert.equal(await Job.countDocuments(), 0);
});

test('a new scene draft absorbs pending research notes but leaves another scene review independent', async () => {
  await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Opening evidence',
    text: 'Keep this original source note.'
  });
  const scene = JSON.parse(JSON.stringify(episode.scenes[0]));
  const draft = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Scene draft',
    text: 'Complete scene.',
    scene
  });
  assert.equal(draft.supportingNotes[0].text, 'Keep this original source note.');
  assert.equal(await Proposal.countDocuments({ status: 'pending' }), 1);
  await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Second scene',
    text: 'Independent scene.',
    scene: { ...scene, id: 'scene-two', title: 'Another scene' }
  });
  await assert.rejects(
    () =>
      makeProposal(chat._id, {
        episodeId: String(episode._id),
        title: 'Ambiguous feedback',
        text: 'Do not guess its scene.'
      }),
    /Choose the sceneId/
  );
  await makeProposal(chat._id, {
    episodeId: String(episode._id),
    sceneId: scene.id,
    title: 'Targeted evidence',
    text: 'Only the first scene gets this.'
  });
  const pending = await Proposal.find({ status: 'pending' }).lean();
  assert.equal(pending.length, 2);
  assert.equal(pending.find((p) => p.scene.id === 'scene-two').supportingNotes.length, 0);
});
test('asset instruction drafts survive deleted media without restoring it and expose application state in chat', async () => {
  await StudioAsset.updateOne(
    { _id: asset._id },
    {
      $set: {
        production: {
          managed: true,
          sourceMode: 'original',
          sourceNotes: 'Known identity.',
          sourceUrl: '',
          sourceMediaIds: [],
          items: [
            {
              id: 'master-portrait',
              title: 'Master portrait',
              type: 'image',
              required: true,
              notes: 'Old directions.',
              mediaId: String(image._id)
            },
            {
              id: 'profile',
              title: 'Profile',
              type: 'image',
              required: true,
              notes: 'Keep profile.',
              mediaId: null
            }
          ]
        }
      }
    }
  );
  const saved = await StudioAsset.findById(asset._id).lean();
  const proposal = await productionProposal(chat._id, {
    scope: 'asset',
    recordId: String(asset._id),
    title: 'Realistic portrait',
    explanation: 'Correct style only.',
    production: {
      ...saved.production,
      items: saved.production.items.map((i) =>
        i.id === 'master-portrait' ? { ...i, notes: 'Photograph a real person.' } : i
      )
    }
  });
  await StudioMedia.deleteOne({ _id: image._id });
  await StudioAsset.updateOne(
    { _id: asset._id },
    {
      $set: {
        'production.items.0.mediaId': null,
        'production.items.1.notes': 'Newer unrelated profile notes.'
      },
      $inc: { revision: 1 }
    }
  );
  const detail = await request(app).get(`${base}/chats/${chat._id}`).expect(200);
  assert.equal(detail.body.proposals[0].application.canApply, true);
  assert.equal(detail.body.proposals[0].application.rebased, true);
  await request(app).post(`${base}/proposals/${proposal._id}/apply`).send({}).expect(200);
  const result = await StudioAsset.findById(asset._id).lean();
  assert.equal(result.production.items[0].mediaId, null);
  assert.equal(result.production.items[0].notes, 'Photograph a real person.');
  assert.equal(result.production.items[1].notes, 'Newer unrelated profile notes.');
  assert.equal(await Job.countDocuments(), 0);
});

test('asset drafts reject concurrent changes to the same instructions instead of overwriting them', async () => {
  await StudioAsset.updateOne(
    { _id: asset._id },
    {
      $set: {
        production: {
          sourceMode: 'original',
          sourceNotes: 'Identity.',
          items: [
            {
              id: 'portrait',
              title: 'Portrait',
              type: 'image',
              required: true,
              mediaId: null,
              notes: 'Before.'
            }
          ]
        }
      }
    }
  );
  const record = await StudioAsset.findById(asset._id).lean();
  const proposal = await productionProposal(chat._id, {
    scope: 'asset',
    recordId: String(asset._id),
    title: 'Change portrait',
    explanation: 'One change.',
    production: {
      ...record.production,
      items: record.production.items.map((i) => ({ ...i, notes: 'Proposed.' }))
    }
  });
  await StudioAsset.updateOne(
    { _id: asset._id },
    { $set: { 'production.items.0.notes': 'Different owner edit.' }, $inc: { revision: 1 } }
  );
  const response = await request(app)
    .post(`${base}/proposals/${proposal._id}/apply`)
    .send({})
    .expect(409);
  assert.match(response.body.message, /conflicts with newer edits/);
  assert.equal(
    (await StudioAsset.findById(asset._id).lean()).production.items[0].notes,
    'Different owner edit.'
  );
  const detail = await request(app).get(`${base}/chats/${chat._id}`).expect(200);
  assert.equal(detail.body.proposals[0].application.canApply, false);
});

test('episode plan revisions merge unapplied fields and leave one review across conversations', async () => {
  const first = await productionProposal(chat._id, {
    scope: 'episode',
    recordId: String(episode._id),
    title: 'Research revision',
    explanation: 'Source addition.',
    production: { sourceNotes: 'New source evidence.', outline: 'Complete revised outline.' }
  });
  const second = await productionProposal(new mongoose.Types.ObjectId(), {
    scope: 'episode',
    recordId: String(episode._id),
    title: 'Outline revision',
    explanation: 'Add outline details.',
    production: { sourceNotes: 'Additional source evidence.' }
  });
  assert.equal(second.production.sourceNotes, 'Additional source evidence.');
  assert.equal(second.production.outline, 'Complete revised outline.');
  assert.equal(await Proposal.countDocuments({ status: 'pending' }), 1);
  assert.equal((await Proposal.findById(first._id).lean()).status, 'superseded');
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
  await request(app).post(`${base}/proposals/${stale._id}/apply`).send({}).expect(200);
  assert.match((await StudioEpisode.findById(episode._id)).notes, /Something new/);
});
test('scene draft survives saved notes and take decisions without restoring deleted media', async () => {
  const proposal = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Correct carrier continuity',
    explanation: 'One transport only',
    scene: { ...episode.toObject().scenes[0], script: 'One transport crosses the canyon.' }
  });
  const baseline = await StudioEpisode.findById(episode._id).lean();
  delete baseline.history;
  const obsolete = new mongoose.Types.ObjectId(),
    kept = new mongoose.Types.ObjectId();
  await Proposal.updateOne(
    { _id: proposal._id },
    { $set: { 'scene.clips.0.takeIds': [String(obsolete)] } }
  );
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        notes: 'Sound is added in the later pass.',
        'scenes.0.clips.0.takeIds': [kept],
        'scenes.0.clips.0.production.visualTakeId': String(kept)
      },
      $inc: { revision: 1 },
      $push: { history: baseline }
    }
  );
  const detail = await request(app).get(`${base}/chats/${chat._id}`).expect(200);
  assert.equal(detail.body.proposals[0].application.canApply, true);
  assert.equal(detail.body.proposals[0].application.rebased, true);
  const board = await request(app)
    .post('/api/studio/workflow/board')
    .send({
      target: { scope: 'episode', recordId: String(episode._id) }
    })
    .expect(200);
  assert.equal(board.body.record.revision, 1);
  assert.equal(board.body.record.notes, 'Sound is added in the later pass.');
  assert.equal(board.body.record.history, undefined);
  assert.equal(board.body.proposals[0].application.canApply, true);
  await request(app).post(`${base}/proposals/${proposal._id}/apply`).send({}).expect(200);
  const changed = await StudioEpisode.findById(episode._id).lean();
  assert.equal(changed.revision, 2);
  assert.equal(changed.notes, 'Sound is added in the later pass.');
  assert.equal(changed.scenes[0].script, 'One transport crosses the canyon.');
  assert.deepEqual(changed.scenes[0].clips[0].takeIds.map(String), [String(kept)]);
  assert.equal(changed.scenes[0].clips[0].production.visualTakeId, String(kept));
  assert.equal(changed.scenes[0].approval, null);
  assert.equal(providerCalls.length, 0);
  await request(app).post(`${base}/proposals/${proposal._id}/apply`).send({}).expect(409);
});

test('scene draft still rejects concurrent creative edits and changed episode preparation', async () => {
  const proposal = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    title: 'Scene correction',
    explanation: 'A proposed change',
    scene: { ...episode.toObject().scenes[0], script: 'Proposed scene.' }
  });
  const baseline = await StudioEpisode.findById(episode._id).lean();
  delete baseline.history;
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: { 'scenes.0.script': 'Owner edited scene.' },
      $inc: { revision: 1 },
      $push: { history: baseline }
    }
  );
  const conflict = await request(app)
    .post(`${base}/proposals/${proposal._id}/apply`)
    .send({})
    .expect(409);
  assert.match(conflict.body.message, /conflicts with newer scene/);
  assert.equal((await StudioEpisode.findById(episode._id)).scenes[0].script, 'Owner edited scene.');
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        'scenes.0.script': baseline.scenes[0].script,
        production: { outline: 'New outline.' }
      }
    }
  );
  await request(app).post(`${base}/proposals/${proposal._id}/apply`).send({}).expect(409);
  assert.equal((await Proposal.findById(proposal._id)).status, 'pending');
});

test('legacy expiring provider grants remain private and revocable during transition', async () => {
  const secret = 'a'.repeat(43),
    token = '/api/assistant/source/' + secret;
  await SourceGrant.create({
    tokenHash: hashToken(secret),
    mediaId: String(image._id),
    ownerVersion: localOwner.version,
    expires: new Date(Date.now() + 60000),
    jobId: 'legacy'
  });
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

test('local reference delivery uploads and verifies in OpenArt storage independently of the tunnel', async () => {
  await store.update((s) => ({
    ...s,
    openart: {
      ...s.openart,
      redirectUrl: 'http://127.0.0.1:5000/api/assistant/oauth/openart/callback'
    }
  }));
  await StudioMedia.updateOne({ _id: image._id }, { $unset: { providerReference: 1 } });
  fetchOverride = async (url, options) => {
    assert.equal(options.method, 'PUT');
    assert.deepEqual(options.body, png);
    return new Response(null, { status: 200 });
  };
  const job = await queue('image');
  const built = await app.locals.assistant.production.build(job);
  const url = new URL(built.params.visualReferences[0].url);
  assert.equal(url.origin, 'https://cdn.openart.ai');
  assert.deepEqual(
    providerCalls.map((c) => c.name),
    ['openart_upload_sign', 'openart_upload_metadata_get']
  );
  await app.locals.assistant.production.build(job);
  assert.equal(providerCalls.length, 2);
  assert.equal(await SourceGrant.countDocuments(), 0);
  const connection = await request(app)
    .post(base + '/connections/openart/test')
    .send({})
    .expect(200);
  assert.equal(connection.body.referenceSharing.source, 'OpenArt storage');
  assert.equal(
    providerCalls.some((c) => c.name.includes('generate')),
    false
  );
});

test('rejected reference transfers fail before any provider quote or generation', async () => {
  await StudioMedia.updateOne({ _id: image._id }, { $unset: { providerReference: 1 } });
  const job = await queue('image');
  fetchOverride = async () => new Response(null, { status: 503 });
  await app.locals.assistant.production.processJob(job);
  assert.equal((await Job.findById(job._id)).status, 'failed');
  assert.match((await Job.findById(job._id)).error, /no render was submitted/);
  assert.deepEqual(
    providerCalls.map((c) => c.name),
    ['openart_upload_sign']
  );
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
test('production chat captures source subtitle frames and sends the actual images back to its model', async () => {
  const path = join(directory, 'source-chat.mp4');
  await promisify(execFile)(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=10:duration=4',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      path
    ],
    { windowsHide: true }
  );
  await StudioEpisode.updateOne(
    { _id: episode._id },
    {
      $set: {
        sourceReferences: [
          {
            id: 'trials',
            title: 'Trials',
            url: 'https://www.youtube.com/watch?v=ojIORTFv7WU',
            startSeconds: 1000,
            endSeconds: 1100,
            status: 'verified'
          }
        ]
      }
    }
  );
  await saveGeneratedMedia(directory, await readFile(path), 'source-chat.mp4', {
    sourceVideo: {
      episodeId: String(episode._id),
      sourceId: 'trials',
      sourceUrl: 'https://www.youtube.com/watch?v=ojIORTFv7WU',
      startSeconds: 1036.5,
      endSeconds: 1040.5
    }
  });
  const before = JSON.parse(JSON.stringify(await StudioEpisode.findById(episode._id).lean()));
  aiReplies = [
    {
      output: [
        {
          type: 'function_call',
          call_id: 'capture',
          name: 'capture_source_frames',
          arguments: JSON.stringify({
            episodeId: String(episode._id),
            sourceId: 'trials',
            timestamp: '17:18',
            nearbySeconds: 1
          })
        }
      ]
    },
    {
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: 'The source frames are saved for dialogue review.' }
          ]
        }
      ]
    }
  ];
  const run = await Run.create({ chatId: chat._id, status: 'running' });
  await Message.create({
    chatId: chat._id,
    role: 'user',
    text: 'Read the subtitle at 17:18.',
    mediaIds: []
  });
  await app.locals.assistant.engine.run(run.toObject());
  assert.equal((await Run.findById(run._id).lean()).status, 'completed');
  assert.equal(aiCalls.length, 2);
  const observation = aiCalls[1].input
    .filter((i) => i.role === 'user')
    .flatMap((i) => i.content ?? []);
  assert.equal(observation.filter((c) => c.type === 'input_image').length, 6);
  assert.ok(observation.some((c) => c.text?.includes('1038s')));
  const reply = await Message.findOne({ role: 'assistant' }).lean();
  assert.equal(reply.mediaIds.length, 3);
  const detail = await request(app)
    .get(base + '/chats/' + chat._id)
    .expect(200);
  assert.equal(detail.body.media.filter((m) => reply.mediaIds.includes(String(m._id))).length, 3);
  assert.ok(detail.body.media.every((m) => !m.filename));
  assert.equal(await Job.countDocuments(), 0);
  assert.deepEqual(providerCalls, []);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await StudioEpisode.findById(episode._id).lean())),
    before
  );
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
  const result = JSON.parse(aiCalls[1].input.find((i) => i.type === 'function_call_output').output);
  assert.equal(result.queued, false);
  assert.equal(result.proposal.status, 'pending');
  assert.equal(result.proposal.render.instructions, 'Do it now.');
  const approval = await request(app)
    .post(`${base}/proposals/${result.proposal._id}/approve-render`)
    .send({})
    .expect(400);
  assert.match(approval.body.message, /Approve one shot image/);
  assert.equal((await Proposal.findById(result.proposal._id)).status, 'pending');
  assert.equal(providerCalls.length, 0);
});
test('clip feedback cannot masquerade as an applied episode-note revision', async () => {
  await Chat.updateOne(
    { _id: chat._id },
    { $set: { context: { episodeId: String(episode._id), sceneId: 'scene1', clipId: 'clip1' } } }
  );
  aiReplies = [
    {
      output: [
        {
          type: 'function_call',
          call_id: 'note-for-clip',
          name: 'save_story_note',
          arguments: JSON.stringify({
            episodeId: String(episode._id),
            title: 'Wrong landing spot',
            text: 'Use the left platform.'
          })
        }
      ]
    }
  ];
  const run = await Run.create({ chatId: chat._id, status: 'running' });
  await Message.create({ chatId: chat._id, role: 'user', text: 'Correct the landing location.' });
  await app.locals.assistant.engine.run(run.toObject());
  assert.equal(await Proposal.countDocuments(), 0);
  assert.equal(await Job.countDocuments(), 0);
  assert.match(
    aiCalls[1].input.find((i) => i.type === 'function_call_output').output,
    /Use propose_scene/
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
