import { expect, test } from 'vitest';

import { removeMediaReferences } from './media-rejection.ts';

test('rejection removes takes and pointers without mutating unrelated saved work', () => {
  const before = {
    takeIds: ['bad', 'keep'],
    dialogueTakeIds: ['bad'],
    sourceMediaIds: ['bad'],
    referenceMediaIds: ['bad', 'keep'],
    selectedTakeId: 'bad',
    selectedDialogueId: 'bad',
    selectedMediaId: 'keep',
    sourceMediaId: 'bad',
    visualTakeId: 'bad',
    soundLegacyTakeId: 'bad',
    cleanDialogueMediaId: 'bad',
    upscaleMediaId: 'bad',
    upscaleSourceTakeId: 'bad',
    finalChoice: { mediaIds: ['bad'] },
    upscale: { sourceTakeId: 'bad' },
    items: [
      { mediaId: 'bad', required: true },
      { mediaId: 'bad', required: false },
      { mediaId: 'bad' },
      { mediaId: 'keep' }
    ],
    candidates: [
      { id: 'empty', mediaIds: ['bad'] },
      { id: 'remaining', mediaIds: ['bad', 'keep'] }
    ],
    notes: 'bad',
    empty: null
  };
  const saved = structuredClone(before);
  const result = removeMediaReferences(before, 'bad');
  expect(result).toMatchObject({
    takeIds: ['keep'],
    dialogueTakeIds: [],
    sourceMediaIds: [],
    referenceMediaIds: ['keep'],
    selectedTakeId: null,
    selectedDialogueId: null,
    selectedMediaId: 'keep',
    sourceMediaId: null,
    visualTakeId: null,
    soundLegacyTakeId: null,
    cleanDialogueMediaId: null,
    upscaleMediaId: null,
    upscaleSourceTakeId: null,
    finalChoice: null,
    upscale: null,
    notes: 'bad',
    empty: null
  });
  expect(result.items).toEqual([
    { mediaId: null, required: true },
    { mediaId: null, required: false },
    { mediaId: 'keep' }
  ]);
  expect(result.candidates).toEqual([{ id: 'remaining', mediaIds: ['keep'] }]);
  expect(before).toEqual(saved);
});

test('unrelated choices, primitive arrays and incomplete legacy records survive cleanup', () => {
  const value = {
    finalChoice: {},
    upscale: { resultMediaId: 'keep' },
    nested: [{ id: 'no-media' }, { id: 'other', mediaIds: ['keep'] }, { mediaIds: ['bad'] }],
    values: [0, null, undefined, 'keep']
  };
  expect(removeMediaReferences(value, 'bad')).toEqual({
    ...value,
    nested: [{ id: 'no-media' }, { id: 'other', mediaIds: ['keep'] }, { mediaIds: [] }],
    values: [0, null, 'keep']
  });
  expect(removeMediaReferences({ upscale: { resultMediaId: 'bad' } }, 'bad')).toEqual({
    upscale: null
  });
  expect(removeMediaReferences({ finalChoice: { mediaIds: ['keep'] } }, 'bad')).toEqual({
    finalChoice: { mediaIds: ['keep'] }
  });
});
