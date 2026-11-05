import { expect, test } from 'vitest';

import { rebaseSceneEdit, sceneEditToken } from './scene-editor.ts';

const scene = () => ({
  title: 'Scene',
  location: 'Room',
  script: 'Words',
  clips: [
    {
      id: 'a',
      title: 'First',
      duration: 5,
      action: '',
      dialogue: '',
      camera: '',
      soundEffects: '',
      production: {}
    }
  ]
});
test('rebasing saves only changed fields and retains new shots, ordering and generated selections', () => {
  const base = scene();
  const draft = structuredClone(base);
  draft.title = 'Renamed';
  draft.clips[0].action = 'Turn';
  draft.clips[0].production = { imagePrompt: 'new prompt' };
  const current = structuredClone(base);
  current.location = 'Hall';
  current.clips.unshift({ ...current.clips[0], id: 'new' });
  Object.assign(current.clips[1], { selectedTakeId: 'approved' });
  const result = rebaseSceneEdit(base, draft, current);
  expect(result.conflicts).toEqual([]);
  expect(result.scene.title).toBe('Renamed');
  expect(result.scene.location).toBe('Hall');
  expect(result.scene.clips.map((clip) => clip.id)).toEqual(['new', 'a']);
  expect(result.scene.clips[1]).toMatchObject({
    action: 'Turn',
    selectedTakeId: 'approved',
    production: { imagePrompt: 'new prompt' }
  });
  expect(current.clips[1].action).toBe('');
});
test('conflicting fields and edits to deleted shots are named without overwriting saved changes', () => {
  const base = scene(),
    draft = structuredClone(base),
    current = structuredClone(base);
  draft.title = 'Local';
  current.title = 'Remote';
  draft.clips[0].camera = 'Push';
  current.clips[0].camera = 'Static';
  expect(rebaseSceneEdit(base, draft, current).conflicts).toEqual(['title', 'First: camera']);
  current.title = 'Local';
  expect(rebaseSceneEdit(base, draft, current).scene.title).toBe('Local');
  current.clips = [];
  expect(rebaseSceneEdit(base, draft, current).conflicts).toContain(
    'First: shot removed from saved scene'
  );
  draft.clips[0].camera = '';
  draft.clips[0].production = { videoPrompt: 'Changed' };
  expect(rebaseSceneEdit(base, draft, current).conflicts).toContain(
    'First: shot removed from saved scene'
  );
  draft.clips[0].production = {};
  expect(rebaseSceneEdit(base, draft, current).conflicts).toEqual([]);
});
test('local structural edits are rejected rather than silently losing sibling shots', () => {
  const base = scene();
  expect(rebaseSceneEdit(base, { ...base, clips: null }, base).conflicts).toEqual([
    'shot order or added/removed shots in the local draft'
  ]);
  expect(rebaseSceneEdit(base, { ...base, clips: [] }, base).conflicts).toHaveLength(1);
});
test('edit tokens distinguish all editable directions, including explicitly empty reference selections', () => {
  const base = scene();
  const original = sceneEditToken(base);
  for (const production of [
    { imagePrompt: 'image' },
    { videoPrompt: 'video' },
    { imageReferenceMediaIds: [] },
    { videoReferenceMediaIds: [] },
    { videoEndFrame: { mode: 'none' } },
    { videoTransitionPrompt: 'legacy saved direction' }
  ]) {
    expect(sceneEditToken({ ...base, clips: [{ ...base.clips[0], production }] })).not.toBe(
      original
    );
  }
  expect(sceneEditToken({ ...base, clips: [{ ...base.clips[0], production: undefined }] })).toBe(
    original
  );
});
