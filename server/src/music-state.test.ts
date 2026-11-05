import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { test } from 'vitest';

import type * as Studio from '../../shared/types.ts';
import { musicCandidateCurrent, musicState } from './music-state.ts';
import { evaluateWorkflow, reviewKey } from './production-workflow.ts';
import { approvalHash } from './review-continuity.ts';

function fixture() {
  const selected = new mongoose.Types.ObjectId();
  const scene: Studio.SceneInput = {
    id: 'arrival',
    clips: [{ id: 'landing', title: 'Landing', duration: 37 }]
  };
  const episode = { _id: 'episode', revision: 5, scenes: [scene] };
  const option = {
    id: 'audition',
    fingerprint: 'legacy-title-dependent-hash',
    prompt: 'Saved orchestral cue',
    mediaIds: [String(selected)],
    qc: { passed: true, preparedSeconds: 37 }
  };
  const cue = {
    _id: 'cue',
    episodeId: 'episode',
    sceneId: scene.id,
    enabled: true,
    prompt: option.prompt,
    model: 'music_v2_5',
    bufferSeconds: 5,
    selectedMediaId: selected,
    candidates: [option]
  };
  const media = [{ _id: selected, sha256: 'unchanged-audio', kind: 'audio' }];
  const job = {
    kind: 'music',
    status: 'ready',
    snapshot: { fingerprint: option.fingerprint },
    payload: {
      cueId: cue._id,
      prompt: cue.prompt,
      model: cue.model,
      targetSeconds: 37,
      generatedSeconds: 42
    },
    resultMediaIds: [String(selected)]
  };
  const target = { scope: 'scene' as const, recordId: 'episode', sceneId: scene.id };
  const plan = {
    targetKey: reviewKey(target, 'music-plan'),
    stage: 'music-plan',
    state: 'approved',
    fingerprint: 'old-plan',
    approvalFingerprint: 'owner-approved-plan'
  };
  const take: {
    targetKey: string;
    stage?: string;
    state: string;
    fingerprint: string;
    approvalFingerprint: string;
  } = {
    targetKey: reviewKey(target, 'music'),
    stage: 'music',
    state: 'approved',
    fingerprint: 'old-take',
    approvalFingerprint: approvalHash({
      stage: 'music',
      input: {
        enabled: true,
        brief: option.fingerprint,
        selected,
        files: [{ id: String(selected), sha: media[0].sha256, exists: true }],
        qc: option.qc
      },
      dependencies: [{ key: plan.targetKey, fingerprint: plan.approvalFingerprint }]
    })
  };
  return {
    scene,
    episode,
    option,
    cue,
    job,
    target,
    plan,
    take,
    data: {
      assets: [],
      episodes: [episode],
      media,
      reviews: [plan, take],
      musicCues: [cue],
      musicJobs: [job]
    }
  };
}

test('music inputs follow the saved prompt and total duration, independently of shot edits', () => {
  const { episode, scene, cue } = fixture();
  const original = musicState(episode, scene, cue).fingerprint;
  scene.clips[0] = {
    ...scene.clips[0],
    id: 'replacement',
    title: 'Toward the Academy',
    videoPrompt: 'New video direction',
    selectedDialogueId: 'different'
  };
  assert.equal(musicState(episode, scene, cue).fingerprint, original);
  for (const change of [{ prompt: 'Changed' }, { model: 'different' }, { bufferSeconds: 4 }])
    assert.notEqual(musicState(episode, scene, { ...cue, ...change }).fingerprint, original);
  scene.clips[0].duration++;
  assert.notEqual(musicState(episode, scene, cue).fingerprint, original);
});

test('legacy auditions need a matching completed job receipt for their actual music inputs and outputs', () => {
  const { episode, scene, cue, option, job } = fixture();
  assert.equal(musicCandidateCurrent(episode, scene, cue, option, [job]), true);
  assert.equal(musicCandidateCurrent(episode, scene, cue, option, []), false);
  for (const change of [
    { cueId: 'other' },
    { prompt: 'Changed' },
    { model: 'other' },
    { targetSeconds: 36 },
    { generatedSeconds: 41 }
  ])
    assert.equal(
      musicCandidateCurrent(episode, scene, cue, option, [
        { ...job, payload: { ...job.payload, ...change } }
      ]),
      false
    );
  assert.equal(
    musicCandidateCurrent(episode, scene, cue, option, [{ ...job, resultMediaIds: [] }]),
    false
  );
  assert.equal(
    musicCandidateCurrent(episode, scene, cue, option, [{ ...job, status: 'failed' }]),
    false
  );
});

test('unchanged legacy music retains the exact owner-approved audio after shot renaming without video approvals', () => {
  const { data, scene, target, cue, option } = fixture();
  scene.clips[0].title = 'Toward the Academy';
  scene.clips[0].videoPrompt = 'Revised video only';
  const before = JSON.stringify(data);
  for (const stage of ['music-plan', 'music']) {
    const row = evaluateWorkflow(data).evaluate(target, stage);
    assert.equal(row.status, 'approved');
    assert.equal(row.retainedApproval, true);
    assert.deepEqual(row.blockers, []);
  }
  assert.equal(JSON.stringify(data), before);
  assert.equal(option.fingerprint, 'legacy-title-dependent-hash');
  assert.equal(cue.candidates.length, 1);
});

test('legacy music retention fails for real music edits, replaced audio, missing evidence or withdrawn approval', () => {
  const changes = [
    (f) => {
      f.cue.prompt = 'Changed music';
    },
    (f) => {
      f.scene.clips[0].duration = 38;
    },
    (f) => {
      f.cue.bufferSeconds = 4;
    },
    (f) => {
      f.data.media[0].sha256 = 'replaced-audio';
    },
    (f) => {
      f.data.media = [];
    },
    (f) => {
      f.data.musicJobs = [];
    },
    (f) => {
      f.plan.state = 'changes-requested';
    },
    (f) => {
      f.take.state = 'unapproved';
    }
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    assert.notEqual(evaluateWorkflow(f.data).evaluate(f.target, 'music').status, 'approved');
  }
});

test('new music approvals stay approved through video edits and reopen for music prompt edits', () => {
  const f = fixture();
  f.option.fingerprint = musicState(f.episode, f.scene, f.cue).fingerprint;
  f.data.reviews = [];
  for (const stage of ['music-plan', 'music']) {
    const row = evaluateWorkflow(f.data).evaluate(f.target, stage);
    assert.equal(row.canApprove, true);
    f.data.reviews.push({
      targetKey: row.key,
      state: 'approved',
      fingerprint: row.fingerprint,
      approvalFingerprint: row.approvalFingerprint
    });
  }
  f.scene.clips[0].title = 'Changed title';
  f.scene.clips[0].production = { videoPrompt: 'Changed video' };
  for (const stage of ['music-plan', 'music'])
    assert.equal(evaluateWorkflow(f.data).evaluate(f.target, stage).status, 'approved');
  f.cue.prompt = 'New music';
  for (const stage of ['music-plan', 'music'])
    assert.notEqual(evaluateWorkflow(f.data).evaluate(f.target, stage).status, 'approved');
});

test('withdrawing a legacy take approval keeps its unchanged music brief approved', () => {
  const f = fixture();
  f.take.state = 'changes-requested';
  const ctx = evaluateWorkflow(f.data);
  assert.equal(ctx.evaluate(f.target, 'music-plan').status, 'approved');
  assert.notEqual(ctx.evaluate(f.target, 'music').status, 'approved');
});

test('a missing music candidate is never current', () => {
  const f = fixture();
  assert.equal(musicCandidateCurrent(f.episode, f.scene, f.cue, null), false);
});
