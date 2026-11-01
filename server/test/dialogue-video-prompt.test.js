import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  improveVideoLipSyncPrompt,
  lipSyncDirections,
  videoDialoguePrompt
} from '../../shared/dialogue-video-prompt.js';
import { productionVideoPrompt } from '../src/studio-prompts.js';

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
