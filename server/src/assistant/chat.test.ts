import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';

import * as animatic from '../animatic-timing.ts';
import {
  StudioAsset,
  StudioEpisode,
  StudioMedia,
  StudioMusicCue,
  StudioProject,
  StudioReview,
  StudioSettings
} from '../models/Studio.ts';
import * as workflow from '../production-workflow.ts';
import {
  createChatEngine,
  makeProposal,
  productionProposal,
  proposeShotImage,
  studioContext
} from './chat.ts';
import { Chat, Job, Message, Proposal, Run } from './models.ts';

let mongo: MongoMemoryServer,
  directory: string,
  episode,
  asset,
  image,
  chat,
  production,
  chatgpt,
  responses,
  calls;
const key = 'chat-tests';
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-chat-'));
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('chat'));
}, 180000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const model of [
    Chat,
    Message,
    Run,
    Job,
    Proposal,
    StudioAsset,
    StudioEpisode,
    StudioMedia,
    StudioProject,
    StudioReview,
    StudioMusicCue,
    StudioSettings
  ])
    await model.deleteMany();
  await StudioProject.create({
    key,
    workflowVersion: 1,
    era: 'Old Republic',
    brief: 'Saved creative direction'
  });
  image = (
    await StudioMedia.create({
      projectKey: key,
      kind: 'image',
      mime: 'image/png',
      filename: 'image.png',
      originalName: 'Image',
      bytes: 5
    })
  ).toObject();
  await writeFile(join(directory, 'image.png'), 'image');
  asset = (
    await StudioAsset.create({
      projectKey: key,
      name: 'Harkun',
      kind: 'character',
      brief: 'Character',
      production: { items: [] },
      candidates: []
    })
  ).toObject();
  episode = (
    await StudioEpisode.create({
      projectKey: key,
      title: 'Episode',
      scenes: [
        {
          id: 'scene',
          title: 'Scene',
          style: 'cinematic',
          script: 'HARKUN: Hello.',
          assetIds: [String(asset._id)],
          clips: [
            {
              id: 'shot',
              title: 'Shot',
              duration: 5,
              dialogue: 'HARKUN: Hello.',
              action: 'Stand',
              production: {}
            }
          ]
        }
      ]
    })
  ).toObject();
  chat = (
    await Chat.create({
      projectKey: key,
      title: 'Chat',
      context: { episodeId: String(episode._id), sceneId: 'scene' }
    })
  ).toObject();
  const message = { projectKey: key, chatId: chat._id, role: 'user', text: 'Help with this shot' };
  await Message.create(message);
  production = {
    queue: vi.fn(async () => ({ _id: 'job' })),
    music: { plan: vi.fn(async () => ({})) },
    sound: {
      queueSound: vi.fn(async () => ({ job: { _id: 'sound' } })),
      queueMix: vi.fn(async () => ({ media: { _id: 'mixed' } }))
    }
  };
  calls = [];
  responses = [];
  chatgpt = {
    ready: async () => ({ profileId: 'profile', model: 'model' }),
    respond: vi.fn(async (args) => {
      calls.push(structuredClone({ ...args, signal: undefined, onText: undefined }));
      args.onText?.('Working');
      args.onText?.('Working again');
      return (
        responses.shift() ?? {
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'Saved response' }] }]
        }
      );
    })
  };
});
const tool = (name, args = {}, extra = {}) => ({
  type: 'function_call',
  name,
  arguments: JSON.stringify(args),
  call_id: name + Math.random(),
  ...extra
});
async function run(tools = [], options = {}, fields = {}) {
  if (tools.length) responses.push({ output: tools });
  const requestRecord = { projectKey: key, chatId: chat._id, status: 'running', ...fields };
  const record = (await Run.create(requestRecord)).toObject();
  await createChatEngine({ chatgpt, production, mediaDirectory: directory, ...options }).run(
    record
  );
  return Run.findById(record._id).lean();
}
const outputs = () =>
  calls
    .at(-1)
    .input.filter((item) => item.type === 'function_call_output')
    .map((item) => JSON.parse(item.output));
test('chat supplies workflow and media context for assets, voices, episodes, scenes and individual shots', async () => {
  await StudioAsset.updateOne(
    { _id: asset._id },
    {
      $set: {
        'production.items': [
          { id: 'front', title: 'Front', type: 'image', requiresPlanApproval: true },
          { id: 'rear', title: 'Rear', type: 'image' }
        ]
      }
    }
  );
  const voice = await StudioAsset.create({
    projectKey: key,
    name: 'Harkun voice',
    aliases: ['Harkun'],
    kind: 'voice',
    brief: 'Voice',
    production: { characterAssetId: String(asset._id) }
  });
  await StudioMusicCue.create({
    projectKey: key,
    episodeId: episode._id,
    sceneId: 'scene',
    enabled: true
  });
  const tools = ['asset', 'episode', 'scene', 'clip'].map((scope) =>
    tool('get_workflow', {
      scope,
      recordId: scope === 'asset' ? String(asset._id) : String(episode._id),
      sceneId: 'scene',
      clipId: 'shot'
    })
  );
  tools.push(tool('get_workflow', { scope: 'asset', recordId: String(voice._id) }));
  tools.push(tool('get_context', { episodeId: String(episode._id) }));
  tools.push(tool('inspect_media', { mediaId: String(image._id) }));
  expect((await run(tools)).status).toBe('completed');
  expect(
    outputs()
      .slice(0, 5)
      .every((value) => !value.error)
  ).toBe(true);
  expect(outputs().at(-1).kind).toBe('image');
});
test('chat attaches only the last message images while retaining older and missing file metadata safely', async () => {
  const missing = new mongoose.Types.ObjectId();
  const priorMessage = {
    projectKey: key,
    chatId: chat._id,
    role: 'assistant',
    text: 'Prior',
    mediaIds: [image._id]
  };
  const latestMessage = {
    projectKey: key,
    chatId: chat._id,
    role: 'user',
    text: 'Latest',
    mediaIds: [image._id, missing]
  };
  await Message.create(priorMessage);
  await Message.create(latestMessage);
  expect((await run()).status).toBe('completed');
  const prior = calls[0].input.find((entry) => entry.role === 'assistant');
  expect(prior.content.some((entry) => entry.type === 'input_image')).toBe(false);
  expect(
    calls[0].input
      .filter((entry) => entry.role === 'user')
      .at(-1)
      .content.some((entry) => entry.type === 'input_image')
  ).toBe(true);
});
test('malformed model replies and stale account bindings fail with a retained message', async () => {
  chatgpt.ready = vi
    .fn()
    .mockRejectedValueOnce(new Error('Private connection details'))
    .mockResolvedValue({ profileId: 'profile', model: 'model' });
  expect((await run()).error).toContain('Chat could not finish');
  expect(
    (
      await run(
        [],
        {},
        {
          workflowDraft: {
            kind: 'story-asset-brief',
            assetId: String(asset._id),
            stage: 'brief',
            fingerprint: 'obsolete',
            revision: 0
          }
        }
      )
    ).error
  ).toContain('asset inputs changed');
  for (const response of [{}, { output: [] }, { output: [{ type: 'message' }] }]) {
    responses.push(response);
    expect((await run()).status).toBe('failed');
  }
  expect((await run([], {}, { profileId: 'old-profile' })).error).toContain(
    'active ChatGPT account'
  );
  expect(
    await createChatEngine({ chatgpt, production, mediaDirectory: directory }).run({
      chatId: new mongoose.Types.ObjectId()
    })
  ).toBeUndefined();
});
test('tools enforce explicit generation, operation limits and their own namespace', async () => {
  const soundArgs = { episodeId: String(episode._id), sceneId: 'scene', revision: 0 };
  await run([tool('request_render', { kind: 'image' })]);
  expect(outputs()[0].error).toContain('manual');
  await run(
    Array.from({ length: 7 }, () => tool('request_render', { kind: 'image' })),
    { automaticMediaGeneration: true }
  );
  expect(outputs()[6].error).toContain('Six production');
  await run([tool('request_sound_effect', { episodeId: String(new mongoose.Types.ObjectId()) })], {
    automaticMediaGeneration: true
  });
  expect(outputs()[0].error).toContain('Episode not found');
  await run([
    tool('prepare_scene_music', soundArgs),
    tool('request_sound_effect', soundArgs),
    tool('request_sound_mix', soundArgs),
    tool('unknown'),
    tool('get_context', {}, { namespace: 'other' })
  ]);
  expect(outputs()[0].nextStep).toContain('Review');
  expect(
    outputs()
      .slice(1)
      .every((value) => value.error)
  ).toBe(true);
  await run([tool('request_sound_effect', soundArgs), tool('request_sound_mix', soundArgs)], {
    automaticMediaGeneration: true
  });
  expect(outputs()[0].job.id).toBe('sound');
  expect(outputs()[1].cached).toBe(true);
  await run(
    Array.from({ length: 7 }, () => tool('request_sound_effect', soundArgs)),
    { automaticMediaGeneration: true }
  );
  expect(outputs().at(-1).error).toContain('Wait for these sound jobs');
  await run(
    Array.from({ length: 7 }, () => tool('read_webpage', { url: 'https://example.org' })),
    { webpageReader: async () => ({ text: 'Reference' }) }
  );
  expect(outputs().at(-1).error).toContain('Six');
});
test('shot image drafts validate focus and saved image selections rather than accepting prose-only changes', async () => {
  const args = {
    episodeId: String(episode._id),
    sceneId: 'scene',
    clipId: 'shot',
    title: 'New composition',
    explanation: 'Correction',
    imagePrompt: 'Use the same room'
  };
  await expect(proposeShotImage(chat._id, { ...args, clipId: 'missing' })).rejects.toThrow(
    'existing episode'
  );
  await Chat.updateOne(
    { _id: chat._id },
    { $set: { context: { ...chat.context, clipId: 'different' } } }
  );
  await expect(proposeShotImage(chat._id, args)).rejects.toThrow('different shot');
  await Chat.updateOne({ _id: chat._id }, { $set: { context: chat.context } });
  await expect(
    proposeShotImage(chat._id, {
      ...args,
      imageReferenceMediaIds: [String(new mongoose.Types.ObjectId())]
    })
  ).rejects.toThrow('available saved images');
  const draft = await proposeShotImage(chat._id, args);
  expect(draft.draftStage).toBe('shot-image');
});
test('production plans and scene drafts reject invalid scope, removed records and incompatible cast', async () => {
  await expect(productionProposal(chat._id, { scope: 'wrong' })).rejects.toThrow(
    'asset or episode'
  );
  await expect(
    productionProposal(chat._id, {
      scope: 'asset',
      recordId: String(new mongoose.Types.ObjectId())
    })
  ).rejects.toThrow('record not found');
  await expect(
    makeProposal(chat._id, { episodeId: String(new mongoose.Types.ObjectId()) })
  ).rejects.toThrow('Episode not found');
  await expect(
    makeProposal(chat._id, {
      episodeId: String(episode._id),
      title: 'Scene revision',
      explanation: 'Change',
      scene: { ...episode.scenes[0], assetIds: [String(new mongoose.Types.ObjectId())] }
    })
  ).rejects.toThrow('incompatible assets');
});

test('automatic scene planning enforces cast, per-shot reference selection, sound coverage and clip-relative timing', async () => {
  const scene = episode.scenes[0],
    clip = scene.clips[0];
  asset.finalChoice = { mediaIds: [image._id] };
  const supplementary = (
    await StudioAsset.create({ projectKey: key, name: 'Supplementary prop', kind: 'prop' })
  ).toObject();
  supplementary.production = {};
  scene.assetIds.push(String(supplementary._id));
  const context = {
    assets: [asset, supplementary],
    episodes: [episode],
    media: [image],
    musicCues: [],
    jobs: [],
    locate: () => ({ parent: episode, scene, clip }),
    evaluate: (_target, stage) => ({
      status: stage === 'shot-plan' ? 'draft' : 'approved',
      fingerprint: stage,
      canApprove: false,
      blockers: []
    })
  };
  const spy = vi.spyOn(workflow, 'workflowContext').mockResolvedValue(context as never);
  const draft = {
    kind: 'story-scene-plan',
    episodeId: String(episode._id),
    sceneId: 'scene',
    revision: 0,
    stage: 'script',
    fingerprint: 'script',
    references: 'references'
  };
  const fields = {
    episodeId: String(episode._id),
    title: 'Plan',
    explanation: 'Complete saved plans',
    scene: {
      ...scene,
      clips: [{ ...clip, production: { referenceMediaIds: [String(image._id)] } }],
      soundPlan: {
        layers: [
          {
            id: 'air',
            title: 'Air',
            description: 'Ventilation',
            type: 'ambience',
            loop: true,
            duration: 5,
            clipId: 'shot'
          }
        ]
      }
    }
  };
  const variants = [
    { ...fields, scene: { ...fields.scene, id: 'different' } },
    { ...fields, scene: { ...fields.scene, clips: [{ ...clip, production: {} }] } },
    { ...fields, scene: { ...fields.scene, soundPlan: null } },
    {
      ...fields,
      scene: {
        ...fields.scene,
        soundPlan: { layers: [{ ...fields.scene.soundPlan.layers[0], start: 6 }] }
      }
    },
    {
      ...fields,
      scene: {
        ...fields.scene,
        soundPlan: {
          layers: [{ ...fields.scene.soundPlan.layers[0], type: 'effect', start: 4, duration: 2 }]
        }
      }
    },
    {
      ...fields,
      scene: {
        ...fields.scene,
        soundPlan: {
          layers: [
            ...fields.scene.soundPlan.layers,
            { ...fields.scene.soundPlan.layers[0], id: 'wrong', clipId: 'missing' }
          ]
        }
      }
    },
    {
      ...fields,
      scene: {
        ...fields.scene,
        soundPlan: { layers: [{ ...fields.scene.soundPlan.layers[0], sourceStart: 1 }] }
      }
    }
  ];
  try {
    await run(
      [
        tool('get_context'),
        tool('propose_scene', { episodeId: String(episode._id), scene: episode.scenes[0] })
      ],
      {},
      { workflowDraft: { ...draft, kind: 'story-scene' } }
    );
    expect(outputs()[1].error).toContain('first scene');
    for (const args of variants) {
      await run([tool('propose_scene', args)], {}, { workflowDraft: draft });
      expect(outputs()[0].error).toBeTruthy();
    }
    await run(
      [tool('propose_scene', fields), tool('propose_scene', fields)],
      {},
      { workflowDraft: draft }
    );
    expect(outputs()[0].error).toBeUndefined();
    expect(outputs()[1].error).toContain('One draft');
    context.evaluate = (_target, stage) => ({
      status: 'approved',
      fingerprint: stage,
      canApprove: false,
      blockers: []
    });
    scene.clips[0].production = { referenceMediaIds: [String(image._id)] };
    await StudioEpisode.updateOne(
      { _id: episode._id },
      { $set: { 'scenes.0.clips.0.production': scene.clips[0].production } }
    );
    const effect = structuredClone(fields);
    effect.scene.soundPlan.layers[0].type = 'effect';
    effect.scene.soundPlan.layers[0].loop = false;
    effect.scene.soundPlan.layers[0].duration = 1;
    delete effect.scene.soundPlan.layers[0].start;
    await run([tool('propose_scene', effect)], {}, { workflowDraft: draft });
    expect(outputs()[0].error).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});

test('legacy drafts keep their brief and notes when optional saved fields were omitted', async () => {
  await Chat.collection.updateOne({ _id: chat._id }, { $unset: { projectKey: '' } });
  await Message.collection.updateMany({ chatId: chat._id }, { $unset: { mediaIds: '' } });
  await run();
  await Chat.updateOne({ _id: chat._id }, { $set: { projectKey: key, context: {} } });
  const prop = await StudioAsset.create({ projectKey: key, name: 'Legacy prop', kind: 'prop' });
  await StudioAsset.collection.updateOne({ _id: prop._id }, { $unset: { brief: '' } });
  const args = {
    scope: 'asset',
    recordId: String(prop._id),
    title: 'Brief',
    explanation: 'Prepare',
    brief: 'Saved new brief',
    production: {}
  };
  let draft = await productionProposal(chat._id, args);
  expect(draft.baseBrief).toBe('');
  draft = await productionProposal(chat._id, {
    ...args,
    brief: undefined,
    production: { sourceNotes: 'More source detail' }
  });
  expect(draft.brief).toBe('Saved new brief');
  const note = await Proposal.create({
    chatId: chat._id,
    episodeId: String(episode._id),
    title: 'Source note',
    text: 'Evidence',
    baseRevision: 0
  });
  await Proposal.collection.updateOne({ _id: note._id }, { $unset: { supportingNotes: '' } });
  await StudioEpisode.collection.updateOne(
    { _id: episode._id },
    { $unset: { 'scenes.0.clips.0.dialogue': '', 'scenes.0.clips.0.dialogueTakeIds': '' } }
  );
  const saved = await StudioEpisode.findById(episode._id).lean();
  await StudioEpisode.updateOne(
    { _id: episode._id },
    { $push: { scenes: { ...saved.scenes[0], id: 'sibling' } } }
  );
  const sceneDraft = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    scene: saved.scenes[0],
    title: 'Scene',
    explanation: 'Prepare'
  });
  expect(sceneDraft.supportingNotes[0].text).toBe('Evidence');
  await Proposal.collection.updateOne({ _id: sceneDraft._id }, { $unset: { supportingNotes: '' } });
  const attached = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    draftId: String(sceneDraft._id),
    title: 'New note',
    text: 'New evidence'
  });
  expect(attached.supportingNotes).toHaveLength(1);
});

test('shot asset proposals require one changed image prompt and never combine voice and visual revisions', async () => {
  const shot = await StudioAsset.create({
    name: 'Shot image',
    kind: 'environment',
    scope: 'episode',
    episodeId: episode._id,
    sceneId: 'scene',
    clipId: 'shot',
    production: {
      items: [
        { id: 'one', imagePrompt: 'Old one' },
        { id: 'two', imagePrompt: 'Old two' }
      ]
    }
  });
  const args = {
    scope: 'asset',
    recordId: String(shot._id),
    title: 'Correction',
    explanation: 'Fix composition'
  };
  await expect(
    productionProposal(chat._id, {
      ...args,
      production: {
        items: [
          { id: 'one', imagePrompt: 'New one' },
          { id: 'two', imagePrompt: 'New two' }
        ]
      }
    })
  ).rejects.toThrow('one shot');
  const draft = await productionProposal(chat._id, {
    ...args,
    production: {
      items: [
        { id: 'one', imagePrompt: 'New one', sourceMediaIds: [String(image._id)] },
        { id: 'two', imagePrompt: 'Old two' }
      ]
    }
  });
  expect(draft.scene.clips[0].production.imageReferenceMediaIds).toEqual([String(image._id)]);
  await StudioAsset.updateOne({ _id: shot._id }, { $set: { sceneId: 'deleted' } });
  await expect(
    productionProposal(chat._id, { ...args, production: { imagePrompt: 'New view' } })
  ).rejects.toThrow('no longer belongs');
  const voiceArgs = {
    scope: 'asset',
    recordId: String(asset._id),
    title: 'Voice',
    explanation: 'Change voice'
  };
  await expect(
    productionProposal(chat._id, {
      ...voiceArgs,
      brief: 'New visual design',
      production: { voiceDescription: 'New voice', sourceNotes: 'New research' }
    })
  ).rejects.toThrow('separately');
  await StudioAsset.updateOne(
    { _id: asset._id },
    { $set: { 'production.voiceDescription': 'Saved voice' } }
  );
  const visual = await productionProposal(chat._id, {
    ...voiceArgs,
    brief: 'Revised visual design',
    production: { voiceDescription: 'Saved voice' }
  });
  expect(visual.brief).toBe('Revised visual design');
  const sameVoice = await productionProposal(chat._id, {
    ...voiceArgs,
    production: { voiceDescription: 'Saved voice' }
  });
  expect(sameVoice.assetId).not.toBe(String(asset._id));
});

test('scene drafts preserve omitted sound plans, insert sibling shots and bind notes to an explicitly chosen draft', async () => {
  await Chat.updateOne({ _id: chat._id }, { $set: { context: {} } });
  const fields = {
    episodeId: String(episode._id),
    title: 'Plan',
    explanation: 'Split shots',
    reviewStages: ['shot-plan'],
    scene: {
      ...episode.scenes[0],
      clips: [
        { ...episode.scenes[0].clips[0], action: 'New action', production: { framing: 'Close' } },
        { ...episode.scenes[0].clips[0], id: 'second' }
      ]
    }
  };
  const draft = await makeProposal(chat._id, fields);
  expect(draft.scene.clips).toHaveLength(2);
  const note = await makeProposal(chat._id, {
    episodeId: String(episode._id),
    draftId: String(draft._id),
    title: 'Evidence',
    explanation: 'Source observation'
  });
  expect(note.supportingNotes[0].text).toBe('Source observation');
  await StudioAsset.updateOne(
    { _id: asset._id },
    { $set: { scope: 'episode', episodeId: new mongoose.Types.ObjectId() } }
  );
  await expect(
    makeProposal(chat._id, { ...fields, scene: { ...fields.scene, id: 'new-scene' } })
  ).rejects.toThrow('incompatible assets');
  await StudioAsset.updateOne({ _id: asset._id }, { $set: { scope: 'reusable', episodeId: null } });
  const inserted = await makeProposal(chat._id, {
    ...fields,
    scene: { ...fields.scene, id: 'new-scene', soundPlan: null },
    draftStage: 'shot-image'
  });
  expect(inserted.scene.id).toBe('new-scene');
  expect(inserted.draftStage).toBe('shot-image');
});

test('chat reports unexpected tool errors, rejects missing source media and can reuse the exact saved creation', async () => {
  await Chat.updateOne({ _id: chat._id }, { $set: { context: {} } });
  const unexpected = vi.spyOn(StudioAsset, 'findOne').mockReturnValueOnce({
    lean: async () => {
      throw new Error('Storage unavailable');
    }
  } as never);
  try {
    await run([tool('create_asset_draft', {})]);
    expect(outputs()[0].error).toContain('Tool request failed');
  } finally {
    unexpected.mockRestore();
  }
  await StudioMedia.updateOne({ _id: image._id }, { $set: { kind: 'video' } });
  const fields = {
    name: 'New prop',
    kind: 'prop',
    brief: 'A prop',
    production: {
      sourceMode: 'original',
      sourceNotes: 'Owner design',
      sourceMediaIds: [String(image._id)]
    }
  };
  await run([tool('create_asset_draft', fields)]);
  expect(outputs()[0].error).toContain('saved source images');
  await run([
    tool('create_asset_draft', {
      ...fields,
      scope: 'episode',
      episodeId: String(new mongoose.Types.ObjectId()),
      production: { sourceMode: 'original', sourceNotes: 'Owner design' }
    })
  ]);
  expect(outputs()[0].error).toContain('Episode not found');
  const saved = vi
    .spyOn(StudioAsset, 'findOne')
    .mockReturnValueOnce({ lean: async () => asset } as never);
  try {
    await run([tool('create_asset_draft', fields)]);
    expect(outputs()[0]._id).toBe(String(asset._id));
  } finally {
    saved.mockRestore();
  }
  const realUpdate = Run.updateOne.bind(Run);
  const update = vi.spyOn(Run, 'updateOne');
  let rejected = false;
  update.mockImplementation(((filter, value) => {
    if (!rejected && value.$set?.preview) {
      rejected = true;
      return Promise.reject(new Error('Preview write failed'));
    }
    return realUpdate(filter, value);
  }) as never);
  try {
    expect((await run()).status).toBe('completed');
  } finally {
    update.mockRestore();
  }
});
test('automatic outlines and briefs cannot rewrite source research, another record or saved package work', async () => {
  episode.production = { sourceNotes: 'Research', outline: '' };
  await StudioEpisode.updateOne({ _id: episode._id }, { $set: { production: episode.production } });
  let parent = episode;
  const spy = vi.spyOn(workflow, 'workflowContext').mockImplementation(
    async () =>
      ({
        assets: [asset],
        episodes: [episode],
        media: [image],
        musicCues: [],
        locate: () => ({ parent }),
        evaluate: (_target, stage) => ({ status: 'approved', fingerprint: stage })
      }) as never
  );
  const draft = {
    kind: 'story-outline',
    episodeId: String(episode._id),
    revision: 0,
    stage: 'source',
    fingerprint: 'source'
  };
  const fields = {
    scope: 'episode',
    recordId: String(episode._id),
    title: 'Outline',
    explanation: 'Saved outline',
    production: { outline: 'New outline' }
  };
  try {
    for (const args of [
      { ...fields, scope: 'asset' },
      { ...fields, sourceReferences: [] },
      { ...fields, recordId: String(asset._id) },
      { ...fields, production: { wrong: 'value' } },
      { ...fields, production: undefined },
      { ...fields, production: { sourceNotes: 'Unsolicited research rewrite' } }
    ]) {
      await run([tool('propose_production_plan', args)], {}, { workflowDraft: draft });
      expect(outputs()[0].error).toContain(
        args.production === undefined ? 'Tool request failed' : 'Only the episode outline'
      );
    }
    await run([tool('propose_production_plan', fields)], {}, { workflowDraft: draft });
    expect(outputs()[0].error).toBeUndefined();
    parent = asset;
    await run(
      [
        tool('propose_production_plan', {
          scope: 'asset',
          recordId: String(asset._id),
          title: 'Brief',
          explanation: 'Prepare',
          production: {}
        })
      ],
      {},
      {
        workflowDraft: {
          kind: 'story-asset-brief',
          assetId: String(asset._id),
          revision: 0,
          stage: 'brief',
          fingerprint: 'brief'
        }
      }
    );
    expect(outputs()[0].error).toContain('missing Creative brief');
  } finally {
    spy.mockRestore();
  }
});

test('manual character creation, optional workflow context and scene timing drafts use their saved scope', async () => {
  await StudioAsset.updateOne({ _id: asset._id }, { $unset: { 'production.items': '' } });
  await run([
    tool('get_workflow', { scope: 'asset', recordId: String(asset._id) }),
    tool('get_workflow', { scope: 'scene', recordId: String(episode._id), sceneId: 'scene' })
  ]);
  expect(outputs().every((value) => !value.error)).toBe(true);
  const timing = vi
    .spyOn(animatic, 'prepareAnimaticTiming')
    .mockResolvedValue({ _id: 'timing' } as never);
  try {
    await run([
      tool('prepare_animatic_timing', { episodeId: String(episode._id), sceneId: 'scene' })
    ]);
    expect(outputs()[0]._id).toBe('timing');
  } finally {
    timing.mockRestore();
  }
  await StudioProject.updateOne(
    { key },
    { $set: { workflowVersion: 0, referenceLayout: 'production-package' } }
  );
  await run([
    tool('create_asset_draft', {
      name: 'New clothing',
      kind: 'wardrobe',
      brief: 'Clothing',
      production: {}
    })
  ]);
  expect(outputs()[0].sheetLayout).toBe('production-package');
  await run([
    tool('create_asset_draft', {
      name: 'New local prop',
      kind: 'prop',
      brief: 'Prop',
      production: {}
    })
  ]);
  expect(outputs()[0].kind).toBe('prop');
  expect(outputs()[0].sheetLayout).toBeUndefined();
  expect(production.queue).not.toHaveBeenCalled();
});
test('chat can prepare timing, propose a shot image and report the limits of source capture without submitting renders', async () => {
  const source = await import('./source-capture.ts');
  const capture = vi.spyOn(source, 'createSourceCapture').mockReturnValue({
    capture: async () => ({ info: { frames: [{ mediaId: String(image._id) }] }, images: [] })
  } as never);
  try {
    await run([
      ...Array.from({ length: 5 }, () => tool('capture_source_frames', {})),
      tool('prepare_animatic_timing', {
        episodeId: String(episode._id),
        sceneId: 'scene',
        clipId: 'shot'
      }),
      tool('propose_shot_image', {
        episodeId: String(episode._id),
        sceneId: 'scene',
        clipId: 'shot',
        title: 'Image correction',
        explanation: 'Correction',
        imagePrompt: 'Same room',
        imageReferenceMediaIds: [String(image._id)]
      })
    ]);
    expect(outputs()[4].error).toContain('Four');
    expect(outputs()[5].message).toContain('No selected dialogue');
    expect(outputs()[6].proposal.draftStage).toBe('shot-image');
    expect(production.queue).not.toHaveBeenCalled();
  } finally {
    capture.mockRestore();
  }
});
test('saved voice focus supplies its character evidence and protected image drafts cannot target sibling shots', async () => {
  const voice = await StudioAsset.create({
    name: 'Harkun voice',
    kind: 'voice',
    production: { characterAssetId: String(asset._id), voiceDescription: 'Baritone' }
  });
  const context = await studioContext({ assetId: String(voice._id) });
  expect(context.selectedAsset.kind).toBe('voice');
  await expect(
    makeProposal(chat._id, {
      episodeId: String(episode._id),
      draftId: String(new mongoose.Types.ObjectId()),
      title: 'Note',
      text: 'Note'
    })
  ).rejects.toThrow('no longer pending');
  await Chat.updateOne(
    { _id: chat._id },
    { $set: { context: { ...chat.context, clipId: 'shot' } } }
  );
  const fields = {
    episodeId: String(episode._id),
    scene: episode.scenes[0],
    title: 'Revision',
    explanation: 'Update'
  };
  await expect(makeProposal(chat._id, { ...fields, targetClipId: 'different' })).rejects.toThrow();
  await expect(
    makeProposal(chat._id, { ...fields, scene: { ...fields.scene, id: 'different' } })
  ).rejects.toThrow();
  await expect(
    makeProposal(chat._id, { ...fields, scene: { ...fields.scene, clips: [] } })
  ).rejects.toThrow();
});
