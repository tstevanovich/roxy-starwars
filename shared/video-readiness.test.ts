import assert from 'node:assert/strict';

import { test } from 'vitest';

import { productionVideoPrompt } from '../server/src/studio-prompts.ts';
import { episodeInput } from '../server/src/studio-validation.ts';
import { proposalApplication } from './production-proposals.ts';
import { shotRevisionImpact } from './shot-revisions.ts';
import { motionInput } from './video-readiness.ts';

test('motion snapshots support each independently specified field without adding unset defaults', () => {
  assert.deepEqual(motionInput(), {});
  assert.deepEqual(motionInput({ startState: 'standing' }), {
    motion: { startState: 'standing', endState: '', allowedMotion: '' }
  });
  assert.deepEqual(motionInput({ endState: 'seated' }), {
    motion: { startState: '', endState: 'seated', allowedMotion: '' }
  });
  assert.deepEqual(motionInput({ allowedMotion: 'nod' }), {
    motion: { startState: '', endState: '', allowedMotion: 'nod' }
  });
});

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
    videoGenerationHold: { active: true, reason: 'Video generation is on hold.' },
    scenes: [{ id: 'scene', clips: [{ id: 'clip', title: 'An approved shot' }] }]
  };
  assert.deepEqual(
    proposalApplication(
      { baseRevision: 1, render: { target: { sceneId: 'scene', clipId: 'clip' } } },
      record
    ),
    {
      canApply: true,
      rebased: false
    }
  );
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
