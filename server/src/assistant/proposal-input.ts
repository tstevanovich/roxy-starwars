import { proposalReviewStages } from '../../../shared/production-proposals.ts';
import { episodeInput } from '../studio-validation.ts';
import { Proposal } from './models.ts';

export async function supersedeEpisodeProposals(applied, record) {
  if (!applied.episodeId || !applied.production) return [];
  const stages = proposalReviewStages(applied, record);
  if (!stages.length) return [];
  const pending = await Proposal.find({
    episodeId: applied.episodeId,
    status: 'pending',
    _id: { $ne: applied._id },
    baseRevision: { $lte: applied.baseRevision }
  }).lean();
  const ids = pending
    .filter((proposal) => {
      const affected = proposalReviewStages(proposal, record);
      return affected.length && affected.every((stage: string) => stages.includes(stage));
    })
    .map((proposal) => proposal._id);
  if (ids.length)
    await Proposal.updateMany(
      { _id: { $in: ids }, status: 'pending' },
      {
        $set: { status: 'superseded', supersededBy: String(applied._id), supersededAt: new Date() }
      }
    );
  return ids;
}

const referenceContent = (ref) =>
  JSON.stringify([
    ref.id,
    ref.title,
    ref.url,
    ref.chapter,
    ref.startSeconds,
    ref.endSeconds,
    ref.notes
  ]);

// A source correction can change ranges, never grant source verification.
// A changed source requires a revised outline, unless one is supplied together.
export function episodePlan(record, args) {
  const previous = episodeInput(JSON.parse(JSON.stringify(record)));
  const next = episodeInput({
    ...JSON.parse(JSON.stringify(record)),
    production: { ...record.production, ...args.production },
    ...(args.sourceReferences !== undefined ? { sourceReferences: args.sourceReferences } : {})
  });
  const sourceReferences = next.sourceReferences.map((ref) => {
    const old = previous.sourceReferences.find((item) => item.id === ref.id);
    return {
      ...ref,
      status: old && referenceContent(old) === referenceContent(ref) ? old.status : 'unreviewed'
    };
  });
  const sourceChanged =
    previous.production.sourceNotes !== next.production.sourceNotes ||
    JSON.stringify(previous.sourceReferences) !== JSON.stringify(sourceReferences);
  const outlineChanged = previous.production.outline !== next.production.outline;
  if (outlineChanged) delete next.production.outlineNeedsRevision;
  else if (sourceChanged) next.production.outlineNeedsRevision = true;
  return {
    production: next.production,
    ...(args.sourceReferences !== undefined ? { sourceReferences } : {})
  };
}
