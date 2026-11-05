import { expect, test } from 'vitest';

import { continuityChoice, continuitySelection } from './continuity-selection.ts';

test('continuity selections round trip punctuation and Unicode through a multiple select', () => {
  const sources = [
    { sceneId: 'scene, one', clipId: 'shot:[one]' },
    { sceneId: 'Académie', clipId: 'part 2/3' }
  ];
  const values = sources.map(continuityChoice);
  expect(continuitySelection(values)).toEqual(sources);
  expect(continuitySelection(values.join(','))).toEqual(sources);
});

test('empty saved and autofilled selections remain empty', () => {
  expect(continuitySelection('')).toEqual([]);
  expect(continuitySelection([])).toEqual([]);
});
