import { beforeEach, expect, test, vi } from 'vitest';

import { Proposal } from './models.ts';
import {
  mergeSupportingNotes,
  removeDraftNotes,
  saveWorkingDraft,
  workingDraftKey
} from './working-drafts.ts';

vi.mock('./models.ts', () => ({
  Proposal: {
    find: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateMany: vi.fn()
  }
}));
let proposals, draft;
const pid = '111111111111111111111111';
beforeEach(() => {
  vi.clearAllMocks();
  proposals = [];
  draft = {
    _id: pid,
    episodeId: pid,
    status: 'pending',
    production: { outline: 'Outline' },
    supportingNotes: [
      { id: 'keep', text: 'Keep' },
      { id: 'remove', text: 'Remove' }
    ]
  };
  vi.mocked(Proposal.find).mockImplementation(
    () => ({ sort: () => ({ lean: async () => proposals }) }) as never
  );
  vi.mocked(Proposal.findById).mockImplementation(() => ({ lean: async () => draft }) as never);
  vi.mocked(Proposal.create).mockImplementation(async (fields) => {
    const next = { ...fields, _id: 'new' };
    proposals = [next, ...proposals];
    return { toObject: () => next } as never;
  });
  vi.mocked(Proposal.findOneAndUpdate).mockReturnValue({ lean: async () => null } as never);
  vi.mocked(Proposal.updateMany).mockResolvedValue({ modifiedCount: 1 } as never);
});
test('draft keys keep source and outline edits separate, including explicitly declared stages', () => {
  expect(workingDraftKey({ episodeId: pid, production: { sourceNotes: '' } })).toBe(
    `episode:${pid}:source`
  );
  expect(workingDraftKey({ episodeId: pid, production: { outline: '', sourceNotes: '' } })).toBe(
    `episode:${pid}:outline`
  );
  expect(workingDraftKey({ episodeId: pid, production: {}, draftStage: 'source' })).toBe(
    `episode:${pid}:source`
  );
  expect(
    mergeSupportingNotes([{ title: 'A', text: 'Same' }], [{ title: 'A', text: 'Same' }])
  ).toHaveLength(1);
});
test('new draft revisions preserve removals even for historical notes without explicit IDs', async () => {
  proposals = [{ ...draft, supportingNotes: undefined, removedSupportingNoteIds: undefined }];
  expect(await saveWorkingDraft({ ...draft, supportingNotes: undefined })).toMatchObject({
    draftVersion: 1,
    supportingNotes: []
  });
  expect(Proposal.updateMany).toHaveBeenCalled();
});
test('note removal rejects render revisions and unknown notes and creates a replacement for a valid removal', async () => {
  draft.render = {};
  await expect(removeDraftNotes('chat', { draftId: pid, noteIds: ['remove'] })).rejects.toThrow(
    'request_render'
  );
  delete draft.render;
  expect(await removeDraftNotes('chat', { draftId: pid, noteIds: ['remove'] })).toMatchObject({
    removedSupportingNoteIds: ['remove'],
    supportingNotes: [{ id: 'keep', text: 'Keep' }]
  });
  draft.supportingNotes = undefined;
  await expect(removeDraftNotes('chat', { draftId: pid, noteIds: ['unknown'] })).rejects.toThrow(
    'does not belong'
  );
});
