import assert from 'node:assert/strict';

import { test } from 'vitest';

import { productionVideoPrompt } from '../server/src/studio-prompts.ts';
import {
  improveVideoLipSyncPrompt,
  lipSyncDirections,
  videoDialoguePrompt,
  videoDialogueTurns
} from './dialogue-video-prompt.ts';

test('dialogue parsing preserves multiline turns and handles blank or unlabelled speech', () => {
  assert.equal(videoDialogueTurns(), null);
  assert.equal(videoDialogueTurns('Unlabelled speech'), null);
  assert.equal(videoDialogueTurns('ROXY:'), null);
  assert.deepEqual(videoDialogueTurns('  \nROXY: Hello\n continued\n\nHARKUN: Welcome'), [
    { speaker: 'ROXY', text: 'Hello\ncontinued' },
    { speaker: 'HARKUN', text: 'Welcome' }
  ]);
  assert.equal(videoDialoguePrompt(), 'No dialogue.');
  assert.equal(videoDialoguePrompt(' Unlabelled speech '), '"Unlabelled speech"');
  assert.match(lipSyncDirections('Unlabelled speech'), /Voice timbre reference/);
  assert.equal(lipSyncDirections(), '');
  assert.match(
    improveVideoLipSyncPrompt('CAMERA: Hold', 'Unlabelled speech'),
    /DIALOGUE: "Unlabelled speech"/
  );
});

test('lip-sync improvements preserve exact speaker order, dialogue and other saved shot directions', () => {
  const dialogue = "ROXY: Don't get sentimental.\nHARKUN: I won't.";
  const original = `SHOT: 10 seconds.\nDIALOGUE: ${dialogue}\nCUSTOM RULE: Keep the approved robe details.\nCAMERA: Fixed same-axis camera.\nAUDIO: Quiet ventilation; no music.`;
  const improved = improveVideoLipSyncPrompt(original, dialogue);
  assert.match(improved, /ROXY says: "Don't get sentimental\."\nHARKUN says: "I won't\."/);
  assert.ok(improved.includes('CAMERA: Fixed same-axis camera.'));
  assert.ok(improved.includes('CUSTOM RULE: Keep the approved robe details.'));
  assert.ok(improved.includes('AUDIO: Quiet ventilation; no music.'));
  assert.match(improved, /Lip sync\./);
  assert.match(improved, /Only the named speaker mouths each line/);
  assert.match(improved, /Composition references do not represent different speakers/);
  assert.equal(improveVideoLipSyncPrompt(improved, dialogue), improved);
});

test('silent shots remain unchanged and custom dialogue prompts automatically include lip sync', () => {
  assert.equal(
    improveVideoLipSyncPrompt('No speech. Hold position.', ''),
    'No speech. Hold position.'
  );
  assert.equal(lipSyncDirections(''), '');
  assert.equal(videoDialoguePrompt(''), 'No dialogue.');
  const scene = { id: 'scene', clips: [] };
  const clip = {
    id: 'clip',
    title: 'Speaking',
    duration: 5,
    dialogue: 'HARKUN: Hello.',
    production: { videoPrompt: 'Owner directions remain exact.' }
  };
  const original = structuredClone(clip);
  const custom = productionVideoPrompt(scene, clip);
  assert.ok(custom.startsWith(clip.production.videoPrompt));
  assert.match(custom, /LIP SYNC: .*Lip sync\./);
  assert.match(custom, /HARKUN says: "Hello\."/);
  assert.deepEqual(clip, original);
  const generated = productionVideoPrompt(scene, { ...clip, production: {} });
  assert.match(generated, /HARKUN says: "Hello\."/);
  assert.match(generated, /Voice timbre reference @Audio1/);
  assert.match(generated, /LIP SYNC: .*Lip sync\./);
});
