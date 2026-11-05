import { beforeEach, expect, test, vi } from 'vitest';

import { dialogueDuration, prepareAnimaticTiming } from './animatic-timing.ts';
import { Chat, Proposal } from './assistant/models.ts';
import { saveWorkingDraft } from './assistant/working-drafts.ts';
import { StudioEpisode, StudioMedia } from './models/Studio.ts';

const execute = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: execute })
}));
vi.mock('./models/Studio.ts', () => ({
  StudioEpisode: { findById: vi.fn() },
  StudioMedia: { findById: vi.fn(), updateOne: vi.fn() }
}));
vi.mock('./assistant/models.ts', () => ({
  Proposal: { findOne: vi.fn() },
  Chat: { findOneAndUpdate: vi.fn() }
}));
vi.mock('./assistant/working-drafts.ts', () => ({
  saveWorkingDraft: vi.fn(async (fields) => fields)
}));
vi.mock('./projects.ts', () => ({ assertMediaAccess: vi.fn() }));
let episode, media;
const query = (value) => ({ lean: async () => value });
const fields = () => ({
  episodeId: 'episode',
  sceneId: 'scene',
  clipIds: undefined,
  mediaDirectory: '/fixture'
});
beforeEach(() => {
  vi.clearAllMocks();
  media = { _id: 'audio', kind: 'audio', filename: 'audio.mp3', durationSeconds: 18 };
  episode = {
    _id: 'episode',
    revision: 0,
    scenes: [
      {
        id: 'scene',
        title: 'Scene',
        clips: [
          {
            id: 'shot',
            title: 'Shot',
            duration: 18,
            dialogue:
              'HARKUN: Hello there. Welcome to the Academy. You have a great deal to learn before your trials begin.',
            selectedDialogueId: 'audio',
            production: {}
          },
          { id: 'silent', duration: 2 }
        ]
      }
    ]
  };
  vi.mocked(StudioEpisode.findById).mockImplementation(() => query(episode) as never);
  vi.mocked(StudioMedia.findById).mockImplementation(() => query(media) as never);
  vi.mocked(Proposal.findOne).mockReturnValue(query(null) as never);
  vi.mocked(Chat.findOneAndUpdate).mockReturnValue(query({ _id: 'chat' }) as never);
  execute.mockResolvedValue({ stdout: '{"format":{"duration":10}}' });
});
test('dialogue measurement uses its cached duration unless explicitly refreshed and rejects invalid files', async () => {
  expect(await dialogueDuration('audio', '/fixture')).toBe(18);
  expect(await dialogueDuration('audio', '/fixture', { refresh: true })).toBe(10);
  for (const stdout of ['{"format":{}}', '{"format":{"duration":0}}']) {
    execute.mockResolvedValueOnce({ stdout });
    await expect(dialogueDuration('audio', '/fixture', { refresh: true })).rejects.toThrow(
      'could not be verified'
    );
  }
  media = null;
  await expect(dialogueDuration('audio', '/fixture')).rejects.toThrow('existing dialogue');
});
test('timing repairs keep ambience and trim effects to the correct split shots', async () => {
  episode.scenes[0].soundPlan = {
    layers: [
      { id: 'whole-bed', type: 'ambience', loop: true, duration: 20 },
      { id: 'shot-bed', clipId: 'shot', type: 'ambience', loop: true, duration: 18 },
      {
        id: 'effect',
        clipId: 'shot',
        type: 'effect',
        duration: 18,
        assetId: 'effect-audio',
        sourceStart: 2,
        start: 0
      },
      { id: 'late', clipId: 'shot', type: 'effect', duration: 1, start: 17 },
      { id: 'early', clipId: 'shot', type: 'effect', duration: 1 },
      { id: 'other', clipId: 'silent', type: 'effect', duration: 1 }
    ]
  };
  const result = await prepareAnimaticTiming(fields());
  expect(result.scene.clips.length).toBeGreaterThan(2);
  expect(
    result.scene.soundPlan.layers.filter((layer) => layer.id.startsWith('shot-bed'))
  ).toHaveLength(result.scene.clips.length - 1);
  expect(result.scene.soundPlan.layers.find((layer) => layer.id === 'whole-bed').duration).toBe(
    result.scene.clips.reduce((sum, clip) => sum + clip.duration, 0)
  );
  expect(result.scene.soundPlan.layers.find((layer) => layer.id === 'effect').sourceStart).toBe(2);
  expect(result.scene.soundPlan.layers.find((layer) => layer.id === 'other')).toBeTruthy();
});
test('repair preparation never replaces pending drafts or invents an unsafe split', async () => {
  media.durationSeconds = 5;
  expect(await prepareAnimaticTiming(fields())).toBeNull();
  vi.mocked(Proposal.findOne).mockReturnValueOnce(query({ _id: 'pending' }) as never);
  expect(await prepareAnimaticTiming(fields())).toEqual({ _id: 'pending' });
  media.durationSeconds = 18;
  episode.scenes[0].clips[0].dialogue = 'HARKUN: Hi.';
  await expect(prepareAnimaticTiming(fields())).rejects.toThrow('too little spoken material');
  episode.scenes[0].clips[0].dialogue =
    'HARKUN: First sentence. Second sentence. Third sentence. Fourth sentence.';
  episode.scenes[0].clips.push(
    ...Array.from({ length: 58 }, (_, i) => ({ id: 'other-' + i, duration: 2 }))
  );
  await expect(prepareAnimaticTiming(fields())).rejects.toThrow('more than 60');
  episode = null;
  await expect(prepareAnimaticTiming(fields())).rejects.toThrow('scene needing');
});
test('retiming handles a plan without layers and a single selected shot', async () => {
  episode.scenes[0].soundPlan = {};
  media.durationSeconds = 8;
  episode.scenes[0].clips[0].duration = 5;
  const result = await prepareAnimaticTiming({ ...fields(), clipIds: ['shot'] });
  expect(result.scene.clips[0].duration).toBe(8);
  expect(saveWorkingDraft).toHaveBeenCalled();
});
