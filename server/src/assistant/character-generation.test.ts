import express from 'express';
import request from 'supertest';
import { beforeEach, expect, test, vi } from 'vitest';

import { characterPackageLayout } from '../../../shared/character-package.ts';
import { StudioAsset } from '../models/Studio.ts';
import { workflowContext } from '../production-workflow.ts';
import {
  characterGenerationRouter,
  characterVoice,
  characterVoicePrompt,
  ensureCharacterVoice,
  voicePromptSource
} from './character-generation.ts';
import { Job } from './models.ts';

vi.mock('../models/Studio.ts', () => ({
  StudioAsset: { findById: vi.fn(), find: vi.fn(), findOneAndUpdate: vi.fn(), findOne: vi.fn() }
}));
vi.mock('../production-workflow.ts', () => ({
  workflowContext: vi.fn(),
  workflowEnabled: () => true
}));
vi.mock('./models.ts', () => ({ Job: { find: vi.fn(), exists: vi.fn() } }));
const aid = '111111111111111111111111',
  vid = '222222222222222222222222',
  mid = '333333333333333333333333';
let character, voice, assets, evaluate;
const query = (value) => ({ lean: async () => value });
beforeEach(() => {
  vi.clearAllMocks();
  character = {
    _id: aid,
    name: 'Overseer Harkun',
    kind: 'character',
    revision: 0,
    aliases: [],
    production: {},
    sheetLayout: characterPackageLayout
  };
  voice = {
    _id: vid,
    name: 'Harkun voice',
    kind: 'voice',
    revision: 1,
    aliases: ['Harkun'],
    production: { characterAssetId: aid, voiceDescription: 'Clear baritone' }
  };
  assets = [character, voice];
  evaluate = vi.fn(() => ({ title: 'Brief', status: 'approved', blockers: [] }));
  vi.mocked(StudioAsset.findById).mockImplementation(() => query(character) as never);
  vi.mocked(StudioAsset.find).mockImplementation(() => query(assets) as never);
  vi.mocked(StudioAsset.findOneAndUpdate).mockImplementation(() => query(voice) as never);
  vi.mocked(StudioAsset.findOne).mockImplementation(() => query(voice) as never);
  vi.mocked(Job.exists).mockResolvedValue(null);
  vi.mocked(Job.find).mockReturnValue({
    sort: () => ({ limit: () => ({ select: () => query([]) }) })
  } as never);
  vi.mocked(workflowContext).mockImplementation(
    async () => ({ assets, media: [], evaluate }) as never
  );
});
function api() {
  const app = express();
  app.use(express.json());
  app.use('/', characterGenerationRouter());
  app.use((error, _req, res, _next) =>
    res.status(error.status ?? 500).json({ message: error.message })
  );
  return app;
}
test('voice matching prefers explicit links, rejects ambiguous names, and normalizes aliases', () => {
  expect(characterVoice(character, assets)).toBe(voice);
  delete voice.production.characterAssetId;
  expect(characterVoice(character, assets)).toBe(voice);
  expect(characterVoice(character, [voice, { ...voice, _id: mid }])).toBeNull();
  expect(
    characterVoice({ ...character, name: "AL-1B's - Reference", aliases: undefined }, [
      { ...voice, name: 'AL - voice', aliases: undefined }
    ])
  ).toBeTruthy();
});
test('voice direction provenance reflects the exact saved field and uses sensible fallbacks', () => {
  expect(voicePromptSource(character, voice)).toBe('saved-voice');
  expect(characterVoicePrompt(character, voice)).toBe('Clear baritone');
  voice.production = {};
  character.production.voiceDescription = 'Soft voice';
  expect(voicePromptSource(character, voice)).toBe('saved-character');
  expect(characterVoicePrompt(character, voice)).toBe('Soft voice');
  character.production = {};
  voice.brief = 'Older direction';
  expect(voicePromptSource(character, voice)).toBe('saved-voice-brief');
  expect(characterVoicePrompt(character, voice)).toBe('Older direction');
  voice.brief = '';
  voice.aliases = undefined;
  character.aliases = undefined;
  expect(voicePromptSource(character, voice)).toBe('suggested-default');
  expect(characterVoicePrompt(character, voice)).toContain('Natural clear speech');
  expect(characterVoicePrompt(character, null)).toContain('Natural clear speech');
});
test('voice creation reuses identities and resolves unique-key races without hiding other database errors', async () => {
  expect(await ensureCharacterVoice(character, assets)).toBe(voice);
  expect(await ensureCharacterVoice(character, [], 'New voice')).toBe(voice);
  const race = Object.assign(new Error('Duplicate'), { code: 11000 });
  vi.mocked(StudioAsset.findOneAndUpdate).mockReturnValueOnce({
    lean: async () => {
      throw race;
    }
  } as never);
  expect(await ensureCharacterVoice({ ...character, name: 'AL-1B', aliases: ['Al'] }, [])).toBe(
    voice
  );
  vi.mocked(StudioAsset.findOneAndUpdate).mockReturnValueOnce({
    lean: async () => {
      throw race;
    }
  } as never);
  voice = null;
  await expect(ensureCharacterVoice(character, [])).rejects.toBe(race);
  vi.mocked(StudioAsset.findOneAndUpdate).mockReturnValueOnce({
    lean: async () => {
      throw new Error('Offline');
    }
  } as never);
  await expect(ensureCharacterVoice(character, [])).rejects.toThrow('Offline');
  character.aliases = undefined;
  await expect(ensureCharacterVoice(character, [])).resolves.toBeNull();
});
test('generation details show the source character and actionable image plan blockers', async () => {
  character.production.items = [
    { id: 'master-portrait', title: 'Master', type: 'image', required: true, mediaId: mid },
    {
      id: 'costume',
      title: 'Costume',
      type: 'image',
      required: true,
      requiresPlanApproval: true,
      imageReferenceMediaIds: [mid]
    }
  ];
  evaluate.mockImplementation((_target, stage) =>
    stage === 'brief'
      ? { title: 'Creative brief', status: 'needs-review', blockers: ['Check source'] }
      : { status: 'draft', canApprove: false, blockers: ['Check plan'] }
  );
  let result = await request(api()).get('/' + aid);
  expect(result.status).toBe(200);
  expect(result.body.images[1].blockers).toContain('Approve Creative brief.');
  expect(result.body.characterSource.assetId).toBe(aid);
  vi.mocked(Job.find).mockReturnValueOnce({
    sort: () => ({
      limit: () => ({
        select: () =>
          query([
            { kind: 'image', target: { packageItemId: 'costume' } },
            { kind: 'voice', status: 'ready' },
            { kind: 'voice', status: 'queued' }
          ])
      })
    })
  } as never);
  character.production.items[1].imageReferenceMediaIds.push(vid);
  evaluate.mockReturnValue({ status: 'approved', blockers: [] });
  result = await request(api()).get('/' + aid);
  expect(result.body.voiceJob.status).toBe('queued');
  expect(result.body.images[1].job.kind).toBe('image');
  character = voice;
  result = await request(api()).get('/' + vid);
  expect(result.body.characterSource.assetId).toBe(aid);
  delete voice.production.characterAssetId;
  expect((await request(api()).get('/' + vid)).body.characterSource.assetId).toBe(aid);
  assets = [voice];
  expect((await request(api()).get('/' + vid)).body.characterSource).toBeNull();
  character = null;
  expect((await request(api()).get('/' + aid)).status).toBe(404);
});
test('saving voice directions checks character, voice, running jobs and concurrent writes', async () => {
  const save = (body) =>
    request(api())
      .put('/' + aid + '/voice')
      .send(body);
  expect((await save({ revision: 5 })).status).toBe(409);
  expect((await save({ revision: 0, prompt: 'New direction', voiceRevision: 0 })).status).toBe(409);
  vi.mocked(Job.exists).mockResolvedValueOnce({ _id: 'job' } as never);
  expect((await save({ revision: 0, prompt: 'New direction', voiceRevision: 1 })).status).toBe(409);
  expect((await save({ revision: 0, prompt: 'New direction', voiceRevision: 1 })).status).toBe(200);
  vi.mocked(StudioAsset.findOneAndUpdate).mockReturnValueOnce(query(null) as never);
  expect((await save({ revision: 0, prompt: 'New direction', voiceRevision: 1 })).status).toBe(409);
  expect((await save({ revision: 0, prompt: 'Clear baritone', voiceRevision: 1 })).status).toBe(
    200
  );
  assets = [character];
  expect((await save({ revision: 0, prompt: 'Different' })).status).toBe(409);
  voice.production.voiceDescription = 'Created';
  expect((await save({ revision: 0, prompt: 'Created' })).status).toBe(200);
  character = voice;
  expect((await save({ revision: 1, prompt: 'Voice edit', voiceRevision: 1 })).status).toBe(200);
});
