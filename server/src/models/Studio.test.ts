import { expect, test } from 'vitest';

import { StudioAsset, StudioEpisode, StudioReview } from './Studio.ts';

test('new records start with independent revisioned choices and never inherit an approval', () => {
  const first = new StudioAsset({ name: 'First', kind: 'prop' });
  const second = new StudioAsset({ name: 'Second', kind: 'prop' });
  first.candidates.push({ id: 'choice', mediaIds: [], archived: false, continuitySources: [] });
  expect(second.candidates).toEqual([]);
  expect(first.revision).toBe(0);
  expect(first.finalChoice).toBeNull();
  expect(new StudioEpisode({ title: 'Episode' }).scenes).toEqual([]);
  expect(
    StudioReview.schema.indexes().some(([keys, options]) => keys.targetKey && options.unique)
  ).toBe(true);
});
