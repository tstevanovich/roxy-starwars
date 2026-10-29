import { expect, test } from 'vitest';

import { reconcileEpisodeDraft } from './episode-draft.js';

const base = {
  _id: 'episode',
  revision: 24,
  title: 'Episode 01',
  notes: 'Production notes.',
  scenes: [
    {
      id: 'scene',
      title: 'Easy credits',
      script: 'Approved script.',
      clips: [
        {
          id: 'clip',
          title: 'Roxy opening',
          duration: 24,
          action: 'She speaks.',
          takeIds: [],
          selectedTakeId: null
        }
      ]
    }
  ]
};
const latest = {
  ...base,
  revision: 26,
  history: [base],
  scenes: [
    {
      ...base.scenes[0],
      approval: { fingerprint: 'saved-approval' },
      clips: [{ ...base.scenes[0].clips[0], takeIds: ['generated'], upscale: null }]
    }
  ]
};

test('merges imported takes and unrelated saved edits while retaining local text and current server metadata', () => {
  const local = structuredClone(base);
  local.scenes[0].clips[0].action = 'Keep this local direction.';
  local.scenes[0].clips[0].takeIds = ['local-import'];
  const remote = { ...latest, notes: 'New production notes.' };
  const result = reconcileEpisodeDraft(local, remote);
  expect(result.conflicts).toEqual([]);
  expect(result.episode).toMatchObject({
    revision: 26,
    notes: 'New production notes.',
    scenes: [
      {
        approval: latest.scenes[0].approval,
        clips: [{ action: 'Keep this local direction.', takeIds: ['generated', 'local-import'] }]
      }
    ]
  });
  expect(local.scenes[0].clips[0].takeIds).toEqual(['local-import']);
  expect(remote.scenes[0].clips[0].action).toBe('She speaks.');
});

test('a restarted video pass does not resurrect old takes or selections from a cached draft', () => {
  const local = structuredClone(base);
  local.notes = 'Keep my unsaved notes.';
  local.scenes[0].clips[0].takeIds = ['old-video'];
  local.scenes[0].clips[0].selectedTakeId = 'old-video';
  local.scenes[0].clips[0].production = { visualTakeId: 'old-video' };
  const remote = {
    ...latest,
    videoPass: { id: 'new-pass' },
    scenes: [
      {
        ...latest.scenes[0],
        clips: [
          {
            ...latest.scenes[0].clips[0],
            takeIds: [],
            selectedTakeId: null,
            production: { visualTakeId: null }
          }
        ]
      }
    ]
  };
  const result = reconcileEpisodeDraft(local, remote);
  expect(result.conflicts).toEqual([]);
  expect(result.episode.notes).toBe(local.notes);
  expect(result.episode.scenes[0].clips[0].takeIds).toEqual([]);
  expect(result.episode.scenes[0].clips[0].selectedTakeId).toBeNull();
  expect(result.episode.scenes[0].clips[0].production.visualTakeId).toBeNull();
  expect(result.episode.videoPass.id).toBe('new-pass');
});

test('overlapping edits block revision advancement until the user chooses while new media remains merged', () => {
  const local = { ...base, notes: 'My notes.' };
  const remote = { ...latest, notes: 'Saved notes.' };
  const conflict = reconcileEpisodeDraft(local, remote);
  expect(conflict.conflicts).toEqual(['notes']);
  expect(conflict.episode.revision).toBe(24);
  expect(conflict.episode.scenes[0].clips[0].takeIds).toEqual(['generated']);
  expect(reconcileEpisodeDraft(local, remote, 'local').episode).toMatchObject({
    revision: 26,
    notes: 'My notes.'
  });
  expect(reconcileEpisodeDraft(local, remote, 'saved').episode).toMatchObject({
    revision: 26,
    notes: 'Saved notes.'
  });
});

test('preserves concurrent additions and detects deletion of a clip edited in the saved episode', () => {
  const local = structuredClone(base);
  local.scenes[0].clips.push({ id: 'local', title: 'Local addition' });
  const remote = structuredClone(latest);
  remote.scenes[0].clips.push({ id: 'remote', title: 'Saved addition' });
  expect(
    reconcileEpisodeDraft(local, remote).episode.scenes[0].clips.map((clip) => clip.id)
  ).toEqual(['clip', 'remote', 'local']);
  local.scenes[0].clips = [];
  expect(reconcileEpisodeDraft(local, remote).conflicts).toContain('scenes / scene / clips / clip');
});

test('does not guess at user edits when the original revision is unavailable', () => {
  expect(reconcileEpisodeDraft(base, { ...latest, history: [] })).toMatchObject({
    episode: base,
    unavailable: true
  });
});

test('sound-plan edits merge with background-linked sounds and retain saved sound approval metadata', () => {
  const soundPlan = {
    notes: 'Continuous port ambience.',
    dialogueGainDb: 0,
    layers: [{ id: 'bed', assetId: null, gainDb: -22 }],
    approval: { fingerprint: 'before' }
  };
  const before = { ...base, scenes: [{ ...base.scenes[0], soundPlan }] };
  const mine = {
    ...before,
    scenes: [
      { ...before.scenes[0], soundPlan: { ...soundPlan, notes: 'Muffle port behind dialogue.' } }
    ]
  };
  const saved = {
    ...before,
    revision: 25,
    history: [before],
    scenes: [
      {
        ...before.scenes[0],
        soundPlan: {
          ...soundPlan,
          approval: { fingerprint: 'saved' },
          layers: [{ ...soundPlan.layers[0], assetId: 'new-sound' }]
        }
      }
    ]
  };
  const result = reconcileEpisodeDraft(mine, saved);
  expect(result.conflicts).toEqual([]);
  expect(result.episode.scenes[0].soundPlan.notes).toBe('Muffle port behind dialogue.');
  expect(result.episode.scenes[0].soundPlan.layers[0].assetId).toBe('new-sound');
  expect(result.episode.scenes[0].soundPlan.approval).toEqual({ fingerprint: 'saved' });
});
