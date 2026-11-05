import { expect, test } from 'vitest';

import { soundPlanReviewInput } from './sound-plan-review.ts';

test('continuous ambience approval survives mechanical shot splitting while effects retain shot timing', () => {
  const clip = { id: 'shot', duration: 10, soundEffects: 'Ventilation' };
  const layer = {
    id: 'bed',
    type: 'ambience',
    loop: true,
    duration: 10,
    description: 'Quiet ventilation'
  };
  const scene = { clips: [clip], soundPlan: { approval: { fingerprint: 'old' }, layers: [layer] } };
  const original = soundPlanReviewInput(scene);
  expect(original).toHaveProperty('continuousAmbience', true);
  expect(original.plan).not.toHaveProperty('approval');
  const split = {
    clips: [
      { ...clip, id: 'a', duration: 5 },
      { ...clip, id: 'b', duration: 5 }
    ],
    soundPlan: {
      layers: [
        { ...layer, id: 'a', clipId: 'a', duration: 5 },
        { ...layer, id: 'b', clipId: 'b', duration: 5 }
      ]
    }
  };
  expect(soundPlanReviewInput(split)).toEqual(original);
  expect(soundPlanReviewInput(scene, { legacy: true })).toHaveProperty('shots');
  for (const patch of [
    { type: 'effect' },
    { loop: false },
    { start: 1 },
    { assetId: 'audio', sourceStart: 1 },
    { clipId: 'missing' },
    { duration: 1 }
  ])
    expect(
      soundPlanReviewInput({ ...scene, soundPlan: { layers: [{ ...layer, ...patch }] } })
    ).toHaveProperty('shots');
  expect(
    soundPlanReviewInput({ ...split, soundPlan: { layers: [split.soundPlan.layers[0]] } })
  ).toHaveProperty('shots');
  expect(soundPlanReviewInput({ clips: [clip], soundPlan: { layers: [] } })).toHaveProperty(
    'shots'
  );
  expect(soundPlanReviewInput({ clips: [clip] })).toHaveProperty('shots');
  expect(
    soundPlanReviewInput({
      clips: [{ ...clip, soundEffects: undefined }],
      soundPlan: { layers: [{ ...layer, assetId: 'audio' }] }
    })
  ).toHaveProperty('continuousAmbience', true);
});
