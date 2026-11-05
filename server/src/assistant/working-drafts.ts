import { fail, id } from '../studio-validation.ts';
import { Proposal } from './models.ts';

export function workingDraftKey(proposal) {
  if (proposal.render)
    return `video:${proposal.episodeId}:${proposal.render.target.sceneId}:${proposal.render.target.clipId}`;
  if (proposal.scene && proposal.draftStage === 'shot-image' && proposal.targetClipId)
    return `image:${proposal.episodeId}:${proposal.scene.id}:${proposal.targetClipId}`;
  if (proposal.scene) return `scene:${proposal.episodeId}:${proposal.scene.id}`;
  if (proposal.production)
    return proposal.assetId
      ? `asset:${proposal.assetId}`
      : `episode:${proposal.episodeId}:${proposal.draftStage ?? (proposal.reviewStages?.includes('source') || proposal.production.outlineNeedsRevision || (!Object.hasOwn(proposal.production, 'outline') && Object.hasOwn(proposal.production, 'sourceNotes')) ? 'source' : 'outline')}`;
  return `notes:${proposal.episodeId}`;
}
export async function pendingWorkingDraft(fields) {
  const key = workingDraftKey(fields);
  const query = fields.assetId ? { assetId: fields.assetId } : { episodeId: fields.episodeId };
  return (
    await Proposal.find({ ...query, status: 'pending' })
      .sort({ createdAt: -1, _id: -1 })
      .lean()
  ).find((p) => workingDraftKey(p) === key);
}
// New revisions keep their own ID so an obsolete approval button cannot apply
// content the owner has not reviewed. Only one version remains pending.
export async function saveWorkingDraft(fields) {
  const previous = await pendingWorkingDraft(fields);
  const removedSupportingNoteIds = [
    ...new Set([
      ...(previous?.removedSupportingNoteIds ?? []),
      ...(fields.removedSupportingNoteIds ?? [])
    ])
  ];
  const proposal = (
    await Proposal.create({
      ...fields,
      removedSupportingNoteIds,
      supportingNotes: mergeSupportingNotes(fields.supportingNotes ?? []).filter(
        (note) => !removedSupportingNoteIds.includes(note.id)
      ),
      workingKey: workingDraftKey(fields),
      draftVersion: (previous?.draftVersion ?? 0) + 1,
      previousDraftId: previous ? String(previous._id) : undefined
    })
  ).toObject();
  const query = proposal.assetId
    ? { assetId: proposal.assetId }
    : { episodeId: proposal.episodeId };
  const pending = (
    await Proposal.find({ ...query, status: 'pending' })
      .sort({ createdAt: -1, _id: -1 })
      .lean()
  ).filter((p) => workingDraftKey(p) === proposal.workingKey);
  let current = pending[0];
  const removed = [...new Set(pending.flatMap((p) => p.removedSupportingNoteIds ?? []))];
  const notes = mergeSupportingNotes(
    ...pending.toReversed().map((p) => p.supportingNotes ?? [])
  ).filter((note) => !removed.includes(note.id));
  current =
    (await Proposal.findOneAndUpdate(
      { _id: current._id, status: 'pending' },
      { $set: { supportingNotes: notes, removedSupportingNoteIds: removed } },
      { returnDocument: 'after' }
    ).lean()) ?? current;
  await Proposal.updateMany(
    { _id: { $in: pending.slice(1).map((p) => p._id) }, status: 'pending' },
    { $set: { status: 'superseded', supersededBy: String(current._id), supersededAt: new Date() } }
  );
  if (proposal.absorbedDraftIds?.length)
    await Proposal.updateMany(
      { _id: { $in: proposal.absorbedDraftIds }, episodeId: proposal.episodeId, status: 'pending' },
      {
        $set: { status: 'superseded', supersededBy: String(current._id), supersededAt: new Date() }
      }
    );
  return current;
}

// A removal creates a replacement draft, never changes saved episode content or
// grants an approval. Persistent note IDs prevent later merges restoring it.
export async function removeDraftNotes(chatId, { draftId, noteIds }) {
  if (
    !Array.isArray(noteIds) ||
    noteIds.length === 0 ||
    noteIds.length > 50 ||
    noteIds.some((noteId) => typeof noteId !== 'string' || !noteId || noteId.length > 200)
  )
    fail('Choose between one and fifty supporting note IDs from the current working draft.');
  const draft = await Proposal.findById(id(draftId)).lean();
  if (!draft || draft.status !== 'pending')
    fail(
      'That draft is no longer pending. Read workingDrafts and use its current replacement.',
      409
    );
  if (draft.render) fail('Video revision instructions must be changed with request_render.');
  const notes = draft.supportingNotes ?? [];
  const missing = noteIds.filter((noteId) => !notes.some((n) => n.id === noteId));
  if (missing.length)
    fail(
      'A requested note does not belong to this draft. Read its supportingNotes IDs first.',
      409
    );
  const fields = { ...draft };
  for (const key of [
    '_id',
    'createdAt',
    'updatedAt',
    'status',
    'supersededBy',
    'supersededAt',
    'requestId'
  ])
    delete fields[key];
  return saveWorkingDraft({
    ...fields,
    chatId,
    supportingNotes: notes.filter((note) => !noteIds.includes(note.id)),
    removedSupportingNoteIds: [...new Set([...(draft.removedSupportingNoteIds ?? []), ...noteIds])]
  });
}
export function mergeSupportingNotes(...groups) {
  return [
    ...new Map(
      groups.flat().map((note) => [note.id ?? JSON.stringify([note.title, note.text]), note])
    ).values()
  ];
}
