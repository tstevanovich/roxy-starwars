import assert from 'node:assert/strict';
import { test } from 'node:test';

import { proposalApplication } from '../../shared/production-proposals.js';
import { shotRevisionImpact } from '../../shared/shot-revisions.js';
import { motionInput } from '../../shared/video-readiness.js';
import { productionVideoPrompt } from '../src/studio-prompts.js';
import { episodeInput } from '../src/studio-validation.js';

test('a multi-speaker shot can approve a video revision without a speaker-count blocker', () => {
  const record = {
    revision: 1,
    scenes: [
      {
        id: 'scene',
        clips: [{ id: 'clip', title: 'Exchange', dialogue: 'ROXY: Really?\nHARKUN: Leave.' }]
      }
    ]
  };
  assert.equal(
    proposalApplication(
      { baseRevision: 1, render: { target: { sceneId: 'scene', clipId: 'clip' } } },
      record
    ).canApply,
    true
  );
});

test('obsolete hold metadata does not block owner revision approval', () => {
  const record = {
    revision: 1,
    videoGenerationHold: { active: true, reason: 'Video generation is on hold.' }
  };
  assert.deepEqual(proposalApplication({ baseRevision: 1, render: {} }, record), {
    canApply: true,
    rebased: false
  });
  assert.equal(
    proposalApplication({ baseRevision: 1, production: { outline: 'A planning draft' } }, record)
      .canApply,
    true
  );
});

test('stage movement replaces obsolete action, survives validation and changes only its motion review', () => {
  const production = {
    startState: 'Roxy and Harkun face each other in the approved room.',
    allowedMotion:
      'Roxy and Harkun remain planted; only unnamed acolytes may leave after the cue. Camera stays static.',
    endState: 'Roxy and Harkun remain at the same marks for the next stage.'
  };
  const before = {
    id: 'scene',
    assetIds: [],
    clips: [
      {
        id: 'shot',
        title: 'Dismissal',
        duration: 5,
        action: 'Everyone walks away.',
        dialogue: '',
        camera: 'Same established axis.'
      },
      { id: 'other', title: 'Next stage', duration: 5 }
    ]
  };
  const validated = episodeInput({
    title: 'Test episode',
    scenes: [
      {
        id: 'scene',
        title: 'Academy',
        style: 'cinematic',
        location: 'Academy',
        script: 'Dismissal.',
        assetIds: [],
        clips: [{ ...before.clips[0], production }]
      }
    ]
  }).scenes[0].clips[0].production;
  const after = {
    ...before,
    clips: [{ ...before.clips[0], production: validated }, before.clips[1]]
  };
  const prompt = productionVideoPrompt(before, after.clips[0]);
  assert.ok(prompt.includes(production.startState));
  assert.ok(prompt.includes(production.endState));
  assert.ok(prompt.includes(production.allowedMotion));
  assert.ok(!prompt.includes('Everyone walks away'));
  const impacts = shotRevisionImpact(before, after);
  assert.equal(impacts[0].image, false);
  assert.equal(impacts[0].timing, true);
  assert.equal(impacts[0].sound, false);
  assert.equal(impacts[1].changed, false);
  assert.deepEqual(motionInput({}), {});
});
