import { beforeEach, expect, test, vi } from 'vitest';

import { StudioEpisode } from '../models/Studio.ts';
import { Proposal } from './models.ts';
import {
  applyVideoRevision,
  assertNoPendingRevision,
  proposeVideoRevision
} from './render-revisions.ts';
import { saveWorkingDraft } from './working-drafts.ts';

vi.mock('../models/Studio.ts', () => ({
  StudioEpisode: { findById: vi.fn(), updateOne: vi.fn() }
}));
vi.mock('./models.ts', () => ({
  Proposal: { findOne: vi.fn(), findById: vi.fn(), updateOne: vi.fn(), find: vi.fn() }
}));
vi.mock('../projects.ts', () => ({ assertMediaAccess: vi.fn() }));
vi.mock('./working-drafts.ts', () => ({ saveWorkingDraft: vi.fn(async (fields) => fields) }));
const eid = '111111111111111111111111',
  pid = '222222222222222222222222';
let episode, proposal, pending;
const query = (value) => ({ lean: async () => value });
beforeEach(() => {
  vi.clearAllMocks();
  episode = {
    _id: eid,
    revision: 1,
    scenes: [{ id: 'scene', clips: [{ id: 'shot', title: 'Shot', duration: 5, production: {} }] }]
  };
  proposal = {
    _id: pid,
    status: 'pending',
    episodeId: eid,
    baseRevision: 1,
    render: { target: { sceneId: 'scene', clipId: 'shot' }, instructions: 'Keep camera static' }
  };
  pending = [];
  vi.mocked(StudioEpisode.findById).mockImplementation(() => query(episode) as never);
  vi.mocked(Proposal.findById).mockImplementation(() => query(proposal) as never);
  vi.mocked(Proposal.findOne).mockReturnValue(query(null) as never);
  vi.mocked(Proposal.find).mockImplementation(() => query(pending) as never);
  vi.mocked(Proposal.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);
  vi.mocked(StudioEpisode.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);
});
test('video drafts are idempotent and validate the target and references before saving', async () => {
  const fields = {
    requestId: 'request',
    target: { episodeId: eid, sceneId: 'scene', clipId: 'shot' }
  };
  vi.mocked(Proposal.findOne).mockReturnValueOnce(query(proposal) as never);
  expect(await proposeVideoRevision(fields)).toBe(proposal);
  expect(await proposeVideoRevision(fields)).toMatchObject({
    scope: 'video-revision',
    render: { instructions: '', duration: 5 }
  });
  for (const referenceIds of [null, Array(13).fill(eid)])
    await expect(proposeVideoRevision({ ...fields, referenceIds })).rejects.toThrow('at most 12');
  episode = null;
  await expect(proposeVideoRevision(fields)).rejects.toThrow('existing episode');
  expect(saveWorkingDraft).toHaveBeenCalledOnce();
});
test('applying directions saves without rendering and rolls its claim back when a scene write fails', async () => {
  proposal.render.instructions = undefined;
  expect(await applyVideoRevision(pid)).toMatchObject({ applied: true });
  expect(StudioEpisode.updateOne).toHaveBeenCalledWith(
    expect.anything(),
    expect.not.objectContaining({ $set: expect.anything() })
  );
  vi.mocked(Proposal.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  await expect(applyVideoRevision(pid)).rejects.toThrow('already being approved');
  vi.mocked(StudioEpisode.updateOne).mockResolvedValueOnce({ modifiedCount: 0 } as never);
  await expect(applyVideoRevision(pid)).rejects.toThrow('episode changed while saving');
  expect(Proposal.updateOne).toHaveBeenLastCalledWith(
    { _id: pid, status: 'approving' },
    { $set: { status: 'pending' } }
  );
  proposal.status = 'dismissed';
  await expect(applyVideoRevision(pid)).rejects.toThrow('no longer pending');
  proposal.status = 'applied';
  expect(await applyVideoRevision(pid)).toMatchObject({ alreadyApplied: true });
  proposal = null;
  await expect(applyVideoRevision(pid)).rejects.toMatchObject({ status: 404 });
});
test('pending revisions block only their intended shot or a genuinely scene-wide draft', async () => {
  const target = { episodeId: eid, sceneId: 'scene', clipId: 'shot' };
  pending = [
    { render: { target: { sceneId: 'different', clipId: 'shot' } } },
    { render: { target: { sceneId: 'scene', clipId: 'different' } } },
    { scene: { id: 'different' } },
    { scene: { id: 'scene' }, targetClipId: 'different' }
  ];
  await expect(assertNoPendingRevision(target, pid)).resolves.toBeUndefined();
  for (const blocker of [
    { render: { target } },
    { scene: { id: 'scene' } },
    { scene: { id: 'scene' }, targetClipId: 'shot' },
    { production: {} },
    {}
  ]) {
    pending = [{ ...blocker, title: 'Revision' }];
    await expect(assertNoPendingRevision(target)).rejects.toThrow('Review the pending revision');
  }
});
