import { expect, test } from 'vitest';

import { scopeAddedReferences, scopeClipScene, shotAssetIds } from './shot-references.ts';

test('shot links respect explicit selections and include owners of saved media', () => {
  expect(shotAssetIds(undefined, undefined)).toEqual([]);
  expect(shotAssetIds({ assetIds: ['a'] }, {})).toEqual(['a']);
  expect(shotAssetIds({}, { production: { referenceAssetIds: [] } }, [])).toEqual([]);
  const clip = {
    production: { referenceAssetIds: ['chosen'], referenceMediaIds: ['final', 'item', 'sheet'] }
  };
  const assets = [
    { _id: 'a', finalChoice: { mediaIds: ['final'] } },
    { _id: 'b', production: { items: [{ mediaId: 'item' }] } },
    { _id: 'c', characterSheets: [{ mediaId: 'sheet' }] },
    { _id: 'unrelated' }
  ];
  expect(shotAssetIds({ assetIds: ['chosen', 'a', 'b', 'c', 'unrelated'] }, clip, assets)).toEqual([
    'chosen',
    'a',
    'b',
    'c'
  ]);
  expect(shotAssetIds({}, clip, assets)).toEqual([]);
});

test('a shot-scoped revision preserves siblings and scene preparation', () => {
  const before = {
    script: 'old',
    assetIds: ['a'],
    soundPlan: { notes: 'room' },
    clips: [{ id: 'one', dialogue: 'old', production: { framing: 'wide' } }, { id: 'two' }]
  };
  const proposed = {
    script: 'new',
    assetIds: ['b'],
    soundPlan: { notes: 'wind' },
    clips: [{ id: 'one', dialogue: 'new', production: { beats: 'pause' } }]
  };
  expect(scopeClipScene(before, proposed, 'one')).toEqual({
    ...before,
    script: 'new',
    assetIds: ['a', 'b'],
    clips: [
      { ...proposed.clips[0], production: { framing: 'wide', beats: 'pause' } },
      before.clips[1]
    ]
  });
  expect(scopeClipScene(before, proposed, 'one', true).soundPlan).toEqual(proposed.soundPlan);
  expect(scopeClipScene(undefined, proposed, 'one')).toBe(proposed);
  expect(scopeClipScene(before, proposed, '')).toBe(proposed);
  expect(
    scopeClipScene({ clips: [{ id: 'one' }] }, { clips: [{ id: 'one' }] }, 'one').assetIds
  ).toEqual([]);
  expect(scopeClipScene(before, { clips: [{ id: 'one', dialogue: 'old' }] }, 'one').script).toBe(
    'old'
  );
  expect(() => scopeClipScene(before, { clips: [{ id: 'new' }] }, 'one')).toThrow(
    'scene conversation'
  );
  expect(() => scopeClipScene(before, { clips: [] }, 'one')).toThrow('existing target');
  expect(() => scopeClipScene(before, { clips: [] }, 'missing')).toThrow('existing target');
});

test('new asset links are confined to the edited shot while existing siblings retain their references', () => {
  const before = {
    assetIds: ['old'],
    clips: [{ id: 'target' }, { id: 'unchanged' }, { id: 'edited' }]
  };
  const after = {
    ...before,
    assetIds: ['old', 'new'],
    clips: [...before.clips.slice(0, 2), { id: 'edited', action: 'move' }, { id: 'added' }]
  };
  const result = scopeAddedReferences(before, after, 'target');
  expect(result.clips[0]).toBe(after.clips[0]);
  expect(result.clips[1].production.referenceAssetIds).toEqual(['old']);
  expect(result.clips[2]).toBe(after.clips[2]);
  expect(result.clips[3]).toBe(after.clips[3]);
  expect(scopeAddedReferences(undefined, after, 'target')).toBe(after);
  expect(scopeAddedReferences(before, before, 'target')).toBe(before);
  expect(scopeAddedReferences({ clips: [] }, { clips: [] }, 'target')).toEqual({ clips: [] });
  const production = {
    location: 'room',
    environment: 'stone',
    physicalConstraints: 'fixed',
    framing: 'wide',
    continuityMode: 'auto',
    continuitySources: [],
    continuityNotes: 'same set',
    referenceAssetIds: ['a'],
    referenceMediaIds: ['m']
  };
  const scene = { clips: [{ id: 'one', action: 'stand', camera: 'locked', production }] };
  expect(
    scopeAddedReferences(scene, { ...scene, assetIds: ['new'] }, 'other').clips[0].production
      .referenceAssetIds
  ).toEqual(['a']);
});
