import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  multipartShot,
  shotTransition,
  videoTransitionPrompt
} from '../../shared/shot-transitions.js';
import { productionVideoPrompt } from '../src/studio-prompts.js';

const clips = [1, 2, 3].map((part) => ({
  id: `part-${part}`,
  title: `Exchange - part ${part} of 3`,
  duration: 8,
  dialogue: 'ROXY: Hello.',
  production: {}
}));
const scene = { id: 'room', clips };
const assets = clips.map((clip, index) => ({
  episodeId: 'episode',
  sceneId: scene.id,
  clipId: clip.id,
  finalChoice: { mediaIds: [`image-${index + 1}`] }
}));
const media = [1, 2, 3].map((part) => ({ _id: `image-${part}`, kind: 'image' }));

test('ordinary shots can choose only the next shot image in this episode or opt out', () => {
  const clip = {
    ...clips[0],
    title: 'Ordinary conversation',
    production: { videoEndFrame: { mode: 'image', assetId: 'foreign', mediaId: 'foreign-image' } }
  };
  const foreign = {
    _id: 'foreign',
    name: 'Following shot',
    episodeId: 'episode',
    sceneId: 'room',
    clipId: 'part-2',
    finalChoice: { mediaIds: ['foreign-image'] }
  };
  const plan = shotTransition(
    'episode',
    scene,
    clip,
    [...assets, foreign],
    [...media, { _id: 'foreign-image', kind: 'image' }]
  );
  assert.deepEqual(plan.imageIds, ['image-1', 'foreign-image']);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.nextEpisodeId, 'episode');
  assert.equal(
    shotTransition(
      'episode',
      scene,
      clip,
      [...assets, { ...foreign, episodeId: 'another-episode' }],
      media
    ).endImageId,
    null
  );
  assert.match(videoTransitionPrompt(scene, clip), /owner-selected END reference/);
  const disabled = { ...clips[0], production: { videoEndFrame: { mode: 'none' } } };
  assert.deepEqual(shotTransition('episode', scene, disabled, assets, media).imageIds, ['image-1']);
  assert.doesNotMatch(videoTransitionPrompt(scene, disabled), /Image 2/);
  const changed = { ...foreign, finalChoice: { mediaIds: ['replacement'] } };
  assert.equal(
    shotTransition('episode', scene, clip, [...assets, changed], media).errors.length,
    1
  );
});

test('the next shot can be in the following scene of the same episode', () => {
  const clip = {
    ...clips[0],
    title: 'Ordinary',
    production: { videoEndFrame: { mode: 'image', assetId: 'next', mediaId: 'next-image' } }
  };
  const first = { ...scene, clips: [clip] },
    second = { id: 'second', clips: [{ id: 'next-shot', title: 'Next' }] };
  const nextAsset = {
    _id: 'next',
    episodeId: 'episode',
    sceneId: 'second',
    clipId: 'next-shot',
    finalChoice: { mediaIds: ['next-image'] }
  };
  assert.deepEqual(
    shotTransition(
      'episode',
      first,
      clip,
      [...assets, nextAsset],
      [...media, { _id: 'next-image', kind: 'image' }],
      [first, second]
    ).imageIds,
    ['image-1', 'next-image']
  );
});

test('three numbered parts link only forward within their own sequence and the last has no end image', () => {
  const plans = clips.map((clip) => shotTransition('episode', scene, clip, assets, media));
  assert.deepEqual(
    plans.map((plan) => plan.imageIds),
    [['image-1', 'image-2'], ['image-2', 'image-3'], ['image-3']]
  );
  assert.ok(plans.every((plan) => !plan.errors.length));
  const changed = {
    ...scene,
    clips: [clips[0], { ...clips[1], title: 'Unrelated - part 2 of 3' }, clips[2]]
  };
  assert.equal(multipartShot(changed, clips[0]).nextClipId, null);
  assert.equal(shotTransition('episode', changed, clips[0], assets, media).errors.length, 1);
  assert.equal(multipartShot(scene, { id: 'ordinary', title: 'Ordinary shot' }), null);
});

test('only an approved live next image qualifies; next video and dialogue reviews are not needed', () => {
  const pending = assets.map((asset, index) =>
    index === 1 ? { ...asset, reviewStatus: 'pending-choice' } : asset
  );
  assert.equal(shotTransition('episode', scene, clips[0], pending, media).endImageId, null);
  assert.equal(
    shotTransition('episode', scene, clips[0], assets, media.slice(0, 1)).errors.length,
    1
  );
  assert.deepEqual(shotTransition('episode', scene, clips[2], pending, media).imageIds, [
    'image-3'
  ]);
});

test('saved body prompts retain owner wording and expose editable numbered reference instructions', () => {
  const clip = {
    ...clips[0],
    production: { videoPrompt: 'Owner camera and dialogue directions.' }
  };
  const prompt = productionVideoPrompt(scene, clip);
  assert.ok(prompt.startsWith(clip.production.videoPrompt));
  assert.match(prompt, /@Image1 is the START/);
  assert.match(prompt, /@Image2 is the END/);
  assert.match(prompt, /@Audio1 is the approved voice/);
  assert.doesNotMatch(videoTransitionPrompt(scene, clips[2]), /Image 2/);
  const edited = {
    ...clip,
    production: {
      ...clip.production,
      videoTransitionPrompt: 'Custom transition: hold both actors at their marks.'
    }
  };
  assert.ok(productionVideoPrompt(scene, edited).includes(edited.production.videoTransitionPrompt));
  assert.match(productionVideoPrompt(scene, edited), /@Image2 defines the ending composition/);
  const base = productionVideoPrompt(scene, clip, '', { includeTransition: false });
  assert.ok(base.startsWith(clip.production.videoPrompt));
  assert.match(base, /LIP SYNC: .*Lip sync\./);
  assert.doesNotMatch(base, /NUMBERED SHOT CONTINUITY/);
});
