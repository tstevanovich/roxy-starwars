import { expect, test } from 'vitest';

import { shotImageInputs, shotRevisionImpact, unchangedShotImage } from './shot-revisions.ts';

test('image inputs omit unset options, normalize references and preserve explicit empty selections', () => {
  expect(shotImageInputs({}, undefined)).toBeNull();
  expect(shotImageInputs(undefined, {})).toMatchObject({ style: '', location: '', references: [] });
  expect(
    shotImageInputs({ style: 'film', location: 'room', assetIds: ['b', 'a'] }, {})
  ).toMatchObject({ style: 'film', location: 'room', references: ['a', 'b'] });
  expect(
    shotImageInputs(
      {},
      {
        production: {
          location: 'hall',
          environment: 'stone',
          physicalConstraints: 'fixed',
          framing: 'wide',
          imagePrompt: 'portrait',
          imageReferenceMediaIds: [],
          referenceMediaIds: ['z', 'a']
        },
        action: 'stand',
        camera: 'locked'
      }
    )
  ).toMatchObject({
    location: 'hall',
    imagePrompt: 'portrait',
    imageReferenceMediaIds: [],
    references: ['a', 'z']
  });
  expect(unchangedShotImage(undefined, undefined, 'missing')).toBe(true);
  expect(unchangedShotImage({ clips: [{ id: 'one' }] }, { clips: [] }, 'one')).toBe(false);
});

test('revision impact distinguishes image, timing and sound changes without affecting siblings', () => {
  const before = {
    clips: [
      { id: 'one', title: 'Opening', duration: 5 },
      { id: 'two', duration: 5 }
    ]
  };
  expect(shotRevisionImpact(before, before).every((c) => !c.changed)).toBe(true);
  expect(shotRevisionImpact(before, undefined)).toEqual([]);
  expect(shotRevisionImpact(undefined, before)[0]).toMatchObject({
    changed: true,
    image: true,
    timing: true
  });
  expect(
    shotRevisionImpact(before, {
      ...before,
      clips: [{ ...before.clips[0], dialogue: 'A: Hello' }, before.clips[1]]
    })
  ).toMatchObject([{ image: false, timing: true, sound: false }, { changed: false }]);
  const layer = {
    type: 'ambience',
    description: 'wind',
    start: 1,
    duration: 3,
    assetId: 'sound',
    sourceStart: 2,
    gainDb: -10,
    lowpassHz: 1000,
    loop: true
  };
  const after = {
    ...before,
    soundPlan: {
      layers: [{ ...layer, clipId: 'one' }, { type: 'effect' }, { clipId: 'elsewhere' }]
    },
    clips: [
      {
        ...before.clips[0],
        soundEffects: 'cloth',
        production: {
          mode: 'voice-reference',
          beats: 'pause',
          passCondition: 'clear',
          videoPrompt: 'speak',
          videoReferenceMediaIds: [],
          videoTransitionPrompt: 'hold',
          videoEndFrame: { mode: 'none' }
        }
      },
      before.clips[1]
    ]
  };
  expect(shotRevisionImpact(before, after)[0]).toMatchObject({
    image: false,
    timing: true,
    sound: true
  });
  expect(shotRevisionImpact(after, after).every((c) => !c.changed)).toBe(true);
  expect(shotRevisionImpact({ clips: [] }, { clips: [{ id: 'new' }] })[0].changed).toBe(true);
});
