import assert from 'node:assert/strict';
import { test } from 'node:test';

import { videoCharacterReferences, withVideoCastPrompt } from '../../shared/video-cast.js';
import { videoSoundCues, withVideoSoundPrompt } from '../../shared/video-sound-prompt.js';
import { productionVideoPrompt } from '../src/studio-prompts.js';

test('custom video prompts inherit only this shot sound cues with clear local start/end times', () => {
  const clip = {
    id: 'b',
    title: 'Second',
    duration: 5,
    dialogue: 'ROXY: Hello.',
    soundEffects: 'Soft robe movement.',
    production: {
      videoPrompt: 'ACTION: Roxy stays planted.\nAUDIO: Keep the existing quiet ventilation.'
    }
  };
  const scene = {
    id: 'scene',
    clips: [{ id: 'a', duration: 5 }, clip],
    soundPlan: {
      layers: [
        { id: 'bed', type: 'ambience', start: 0, duration: 10, description: 'Steady machinery.' },
        { id: 'global', type: 'effect', start: 6, duration: 2, description: 'Distant mechanism.' },
        {
          id: 'other',
          clipId: 'a',
          type: 'effect',
          start: 1,
          duration: 1,
          description: 'Other shot only.'
        },
        {
          id: 'local',
          clipId: 'b',
          type: 'effect',
          start: 4,
          duration: 3,
          description: 'Robe settles.'
        }
      ]
    }
  };
  const original = structuredClone(scene);
  const cues = videoSoundCues(scene, clip);
  assert.deepEqual(
    cues.map((cue) => [cue.start, cue.end]),
    [
      [0, 5],
      [1, 3],
      [4, 5]
    ]
  );
  const prompt = productionVideoPrompt(scene, clip);
  for (const text of [
    'Keep the existing quiet ventilation.',
    'Soft robe movement.',
    'Ambience 0–5s: Steady machinery.',
    'Effect 1–3s: Distant mechanism.',
    'Effect 4–5s: Robe settles.'
  ])
    assert.ok(prompt.includes(text));
  assert.doesNotMatch(prompt, /Other shot only/);
  const body = withVideoSoundPrompt(clip.production.videoPrompt, scene, clip);
  assert.equal(withVideoSoundPrompt(body, scene, clip), body);
  assert.deepEqual(scene, original);
});

test('named characters bind to approved identity images after composition images without casting names merely mentioned in speech', () => {
  const first = {
    id: 'first',
    title: 'Talk - part 1 of 2',
    duration: 5,
    dialogue: 'HARKUN: Lord Zash is waiting.\nROXY: Fine.',
    action: 'Harkun faces Roxy.'
  };
  const next = { id: 'next', title: 'Talk - part 2 of 2', duration: 5 };
  const scene = { id: 'scene', assetIds: ['harkun', 'roxy', 'zash'], clips: [first, next] };
  const assets = [
    {
      _id: 'harkun',
      kind: 'character',
      name: 'Overseer Harkun',
      finalChoice: { mediaIds: ['harkun-face'] }
    },
    { _id: 'roxy', kind: 'character', name: 'Roxy Kane', finalChoice: { mediaIds: ['roxy-face'] } },
    { _id: 'zash', kind: 'character', name: 'Lord Zash', finalChoice: { mediaIds: ['zash-face'] } }
  ];
  const refs = videoCharacterReferences('episode', scene, first, assets);
  assert.deepEqual(
    refs.map((ref) => [ref.names, ref.imageNumber]),
    [
      [['HARKUN'], 3],
      [['ROXY'], 4]
    ]
  );
  const prompt = withVideoCastPrompt('Keep the room unchanged.', refs);
  assert.match(prompt, /HARKUN = Image 3 identity/);
  assert.match(prompt, /ROXY = Image 4 identity/);
  assert.doesNotMatch(prompt, /ZASH/);
  assert.equal(withVideoCastPrompt(prompt, refs), prompt);
  const noEnd = { ...first, production: { videoEndFrame: { mode: 'none' } } };
  assert.deepEqual(
    videoCharacterReferences('episode', scene, noEnd, assets).map((ref) => ref.imageNumber),
    [2, 3]
  );
  assert.equal(
    videoCharacterReferences('episode', scene, first, [
      { ...assets[0], reviewStatus: 'pending-choice' }
    ]).length,
    0
  );
});
