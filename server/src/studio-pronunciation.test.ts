import assert from 'node:assert/strict';

import { test } from 'vitest';

import { clipPrompts } from './studio-prompts.ts';
import { spokenDialogue } from './studio-pronunciation.ts';

test('speaks Al as a name while retaining speaker labels and the formal designation', () => {
  assert.equal(
    spokenDialogue('ROXY: AL, seal the hatch. AL’s right.\nAL: Call me Al.\nTAVIN: AL-1B?'),
    'ROXY: Al, seal the hatch. Al’s right.\nAL: Call me Al.\nTAVIN: AL-1B?'
  );
  assert.equal(spokenDialogue('SALT, ALLOY, PAL and Al.'), 'SALT, ALLOY, PAL and Al.');
});

test('video dialogue gets pronunciation direction without renaming references or saved scripts', () => {
  const dialogue = 'ROXY: AL, seal the hatch.\nAL: Already done.';
  const scene = {
    assetIds: ['al'],
    title: 'A quick departure',
    location: 'Fortune cockpit',
    script: 'Roxy calls AL from the cockpit.',
    style: 'cinematic'
  };
  const clip = { duration: 10, action: 'AL closes the hatch.', dialogue };
  const assets = [
    { _id: 'al', name: 'AL-1B', kind: 'droid', brief: 'Copilot.', characterSheets: [] }
  ];
  const prompt = clipPrompts(scene, clip, assets);
  assert.match(
    prompt.video,
    /DIALOGUE: ROXY says: "Al, seal the hatch\."\nAL says: "Already done\."/
  );
  assert.match(prompt.video, /one syllable, rhyming with "pal"/);
  assert.match(prompt.video, /REFERENCES: AL-1B:/);
  assert.doesNotMatch(prompt.image, /PRONUNCIATION/);
  assert.equal(clip.dialogue, dialogue);
  assert.equal(scene.script, 'Roxy calls AL from the cockpit.');
});
