import { beforeEach, expect, test, vi } from 'vitest';

import { Proposal } from './models.ts';
import { episodePlan, supersedeEpisodeProposals } from './proposal-input.ts';

vi.mock('./models.ts', () => ({ Proposal: { find: vi.fn(), updateMany: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
});
test('superseding an outline draft preserves unrelated source and scene drafts', async () => {
  const record = {
    title: 'Episode',
    revision: 0,
    production: { sourceNotes: 'Sources', outline: '' },
    sourceReferences: []
  };
  const applied = {
    _id: 'applied',
    episodeId: 'episode',
    production: { outline: 'Outline' },
    baseRevision: 0
  };
  vi.mocked(Proposal.find).mockReturnValue({
    lean: async () => [
      { ...applied, _id: 'replace' },
      { _id: 'notes', title: 'Notes' },
      { _id: 'source', production: { sourceNotes: 'Changed' } }
    ]
  } as never);
  expect(await supersedeEpisodeProposals(applied, record)).toEqual(['replace']);
  expect(Proposal.updateMany).toHaveBeenCalledOnce();
  expect(
    episodePlan(record, {
      sourceReferences: [{ id: 'new', title: 'New', url: 'https://example.com' }]
    }).sourceReferences[0].status
  ).toBe('unreviewed');
  expect(await supersedeEpisodeProposals({ ...applied, production: {} }, record)).toEqual([]);
  expect(episodePlan(record, {}).production.outlineNeedsRevision).toBeUndefined();
  const old = {
    ...record,
    sourceReferences: [{ id: 'source', title: 'Source', url: 'https://example.com', notes: null }]
  };
  expect(
    episodePlan(old, { production: { sourceNotes: 'Changed' } }).production.outlineNeedsRevision
  ).toBe(true);
});
