import { expect, test } from 'vitest';

import { approvedCharacterSheets, characterSheetInput } from './character-sheets.ts';

test('only approved sheets bound to the current finalized identity can be reused', () => {
  const finalizedAt = '2026-01-01T00:00:00Z';
  const current = {
    id: 'sheet',
    sourceCandidateId: 'choice',
    sourceFinalizedAt: finalizedAt,
    approvedAt: finalizedAt
  };
  const asset = {
    finalChoice: { id: 'choice', finalizedAt },
    characterSheets: [
      current,
      { ...current, id: 'old', sourceCandidateId: 'previous' },
      { ...current, id: 'pending', approvedAt: null }
    ]
  };
  expect(approvedCharacterSheets(asset)).toEqual([current]);
  expect(
    characterSheetInput(
      { title: 'Prop', mediaId: '111111111111111111111111', views: ['top', 'top', 'detail'] },
      'prop'
    ).views
  ).toEqual(['top', 'detail']);
});
