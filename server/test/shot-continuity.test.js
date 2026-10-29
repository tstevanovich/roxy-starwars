import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shotContinuity } from '../../shared/shot-continuity.js';
import { clipPrompts } from '../src/studio-prompts.js';

function fixture() {
  const scene = {
    id: 'arrival',
    location: 'Korriban',
    assetIds: [],
    clips: [
      {
        id: 'orbit',
        title: 'Orbit',
        production: { location: 'Korriban orbit', environment: 'space-exterior' }
      },
      {
        id: 'landing',
        title: 'Landing',
        production: { location: 'Left turret platform', environment: 'surface-exterior' }
      },
      {
        id: 'exit',
        title: 'Roxy exits',
        production: { location: 'Left turret platform, open ramp', environment: 'surface-exterior' }
      },
      {
        id: 'hold',
        title: 'Parked ship',
        production: { location: 'Left turret platform', environment: 'surface-exterior' }
      }
    ]
  };
  const episode = { _id: 'episode', scenes: [scene] };
  for (const c of scene.clips) c.dialogue = '';
  const assets = scene.clips.slice(0, 3).map((c) => ({
    _id: c.id,
    episodeId: 'episode',
    sceneId: scene.id,
    clipId: c.id,
    finalChoice: { mediaIds: [c.id + '-image'] }
  }));
  const media = assets.map((a) => ({ _id: a.finalChoice.mediaIds[0], kind: 'image' }));
  return { scene, episode, assets, media, clip: scene.clips.at(-1) };
}
test('automatic continuity carries the establishing and latest approved same-set images, never orbital scenery', () => {
  const f = fixture(),
    plan = shotContinuity(f.episode, f.scene, f.clip, f.assets, f.media);
  assert.deepEqual(plan.mediaIds, ['landing-image', 'exit-image']);
  assert.deepEqual(plan.errors, []);
  const prompt = clipPrompts(f.scene, f.clip, f.assets, f.episode);
  assert.deepEqual(prompt.referenceMediaIds, ['landing-image', 'exit-image']);
  assert.match(prompt.image, /metal walkway\/causeway/);
  assert.match(prompt.image, /Continuity image 1: Landing/);
  assert.ok(!prompt.referenceMediaIds.includes('orbit-image'));
});
test('unapproved or missing continuity sources block dependent renders instead of silently substituting a different view', () => {
  const f = fixture();
  f.assets[2].reviewStatus = 'pending-choice';
  assert.match(
    shotContinuity(f.episode, f.scene, f.clip, f.assets, f.media).errors.join(' '),
    /Approve.*Roxy exits/
  );
  f.assets[2].reviewStatus = null;
  f.media.pop();
  assert.match(
    shotContinuity(f.episode, f.scene, f.clip, f.assets, f.media).errors.join(' '),
    /Approve.*Roxy exits/
  );
});
test('explicit earlier-episode shots support continuity across scenes and reject self or future references', () => {
  const f = fixture();
  const next = {
    ...f.scene,
    id: 'next',
    clips: [
      {
        ...f.clip,
        production: {
          ...f.clip.production,
          continuityMode: 'explicit',
          continuitySources: [{ sceneId: 'arrival', clipId: 'landing' }]
        }
      }
    ]
  };
  f.episode.scenes.push(next);
  assert.deepEqual(shotContinuity(f.episode, next, next.clips[0], f.assets, f.media).mediaIds, [
    'landing-image'
  ]);
  f.clip.production = {
    ...f.clip.production,
    continuityMode: 'explicit',
    continuitySources: [{ sceneId: 'next', clipId: 'hold' }]
  };
  assert.match(
    shotContinuity(f.episode, f.scene, f.clip, f.assets, f.media).invalidSources.join(' '),
    /earlier shot/
  );
});
test('a deliberate new setup resets automatic inheritance, and unrelated episodes cannot supply sources', () => {
  const f = fixture();
  f.scene.clips[2].production.continuityMode = 'new-setup';
  assert.deepEqual(
    shotContinuity(f.episode, f.scene, f.scene.clips[2], f.assets, f.media).sources,
    []
  );
  assert.deepEqual(shotContinuity(f.episode, f.scene, f.clip, f.assets, f.media).mediaIds, [
    'exit-image'
  ]);
  f.assets[2].episodeId = 'another-episode';
  assert.ok(shotContinuity(f.episode, f.scene, f.clip, f.assets, f.media).errors.length);
});
