import assert from 'node:assert/strict';

import { test } from 'vitest';

import { productionVideoPrompt } from '../server/src/studio-prompts.ts';
import {
  multipartShot,
  startOnlyVideoPrompt,
  videoTransitionPrompt,
  withoutManagedVideoTransition
} from './shot-transitions.ts';
const clip = {
  id: 'first',
  title: 'Talk - part 1 of 3',
  duration: 7,
  dialogue: 'HARKUN: Hello.',
  production: {}
};
const scene = { id: 'scene', clips: [clip] };

test('numbered parts identify only the adjacent matching continuation', () => {
  const first = { id: 'a', title: 'Talk part 1' };
  const next = { id: 'b', title: 'Talk part 2' };
  assert.deepEqual(multipartShot({ clips: [first, next] }, first), {
    part: 1,
    total: null,
    needsEnd: true,
    nextClipId: 'b',
    nextTitle: 'Talk part 2'
  });
  for (const title of ['Talk part 0', 'Talk part 3 of 2', 'part 1', 'Ordinary'])
    assert.equal(multipartShot({ clips: [] }, { title }), null);
  assert.equal(multipartShot({ clips: [] }, first), null);
  for (const title of ['Other part 2', 'Talk part 3', 'Talk part 2 of 4', 'Talk part 2 of 3']) {
    const start = { ...first, title: 'Talk part 1 of 3' };
    const result = multipartShot({ clips: [start, { ...next, title }] }, start);
    assert.equal(result.nextClipId, title === 'Talk part 2 of 3' ? 'b' : null);
  }
  assert.equal(multipartShot({ clips: [first] }, first).needsEnd, false);
  const final = { ...first, title: 'Talk part 2 of 2' };
  assert.equal(multipartShot({ clips: [final] }, final).needsEnd, false);
});

test('custom cuts remain explicit while managed transitions and end frames are retired', () => {
  const ordinary = { id: 'one' };
  assert.equal(videoTransitionPrompt({ clips: [ordinary] }, ordinary), '');
  assert.match(
    videoTransitionPrompt(scene, clip, 'CAMERA: Hard cut to profile.'),
    /Follow the saved shot timing/
  );
  assert.match(videoTransitionPrompt(scene, clip), /Generate one continuous shot/);
  assert.equal(
    withoutManagedVideoTransition('SHOT CONTINUITY: Generate one continuous shot.'),
    'SHOT CONTINUITY: Generate one continuous shot.'
  );
  assert.equal(withoutManagedVideoTransition(), '');
  assert.equal(startOnlyVideoPrompt({ clips: [ordinary] }, ordinary), '');
  assert.equal(
    startOnlyVideoPrompt(
      { clips: [ordinary] },
      ordinary,
      'Hold the camera. Match the ending frame. Keep the face.'
    ),
    'Hold the camera.\nKeep the face.'
  );
  assert.equal(
    startOnlyVideoPrompt(
      scene,
      { ...clip, production: { videoEndFrame: { mode: 'none' } } },
      'Hold the frame.'
    ),
    'Hold the frame.'
  );
});

test('numbered and ordinary shots ignore saved end selections and never require the next image', () => {
  for (const title of [clip.title, 'Ordinary shot']) {
    const saved = {
      ...clip,
      title,
      production: { videoEndFrame: { mode: 'image', assetId: 'missing', mediaId: 'missing' } }
    };
    const prompt = productionVideoPrompt(scene, saved);
    assert.match(prompt, /Generate one continuous shot/);
    assert.match(prompt, /@Image1 is the START/);
    assert.doesNotMatch(prompt, /@Image2|END reference|ending composition/);
  }
});

test('legacy end-image directions are omitted while identity tags follow the new attachment order', () => {
  const saved = {
    ...clip,
    production: {
      videoPrompt:
        'Start on Image 1. Move toward Image 2 at seven seconds. Match Harkun to Image 3. Preserve his red forehead mark.',
      videoEndFrame: { mode: 'image', mediaId: 'old-end' }
    }
  };
  const refs = [{ names: ['HARKUN'], imageNumber: 2 }];
  const prompt = productionVideoPrompt(scene, saved, '', { characterReferences: refs });
  assert.doesNotMatch(prompt, /Move toward|Image3|END reference/);
  assert.match(prompt, /Match Harkun to @Image2/);
  assert.match(prompt, /HARKUN = @Image2 identity/);
  assert.match(prompt, /Preserve his red forehead mark/);
  assert.equal(saved.production.videoEndFrame.mediaId, 'old-end');
  const again = productionVideoPrompt(
    scene,
    { ...saved, production: { ...saved.production, videoPrompt: prompt } },
    '',
    { characterReferences: refs }
  );
  assert.equal(again, prompt);
});

test('old camera moves to the next image disappear without changing quoted dialogue', () => {
  const dialogue = 'HARKUN: Use Image 2 as the ending frame.';
  const saved = {
    ...clip,
    dialogue,
    production: {
      videoEndFrame: { mode: 'image' },
      videoPrompt:
        'One continuous 7-second shot. Begin with Image 1 and move toward Image 2, reaching it at 7 seconds. Keep everyone planted.\nDIALOGUE: HARKUN says: "Use Image 2 as the ending frame."'
    }
  };
  const prompt = productionVideoPrompt(scene, saved);
  assert.doesNotMatch(prompt, /move toward|reaching it/);
  assert.match(prompt, /HARKUN says: "Use Image 2 as the ending frame\."/);
  assert.doesNotMatch(prompt, /__START_ONLY_TEXT/);
  assert.match(prompt, /Keep everyone planted/);
});

test('new character references remain valid despite historical end settings', () => {
  const saved = { ...clip, production: { videoEndFrame: { mode: 'image' } } };
  const directions =
    'Use Image 2 for Harkun.\nCAST REFERENCES:\n- HARKUN = Image 2 identity; match them in the compositions.\n- Identity images define faces only.';
  assert.equal(startOnlyVideoPrompt(scene, saved, directions), directions);
});

test('normal directions and custom non-end camera instructions are retained', () => {
  const directions = 'Hold framing. Keep everyone planted. No music.';
  assert.equal(startOnlyVideoPrompt(scene, clip, directions), directions);
  const saved = {
    ...clip,
    production: {
      videoTransitionPrompt: 'CAMERA: Keep eye level. Image 2 is the ending composition.'
    }
  };
  const result = startOnlyVideoPrompt(scene, saved, directions);
  assert.match(result, /Keep eye level/);
  assert.doesNotMatch(result, /ending composition/);
});
