import { unchangedShotImage } from '../../shared/shot-revisions.js';
import { evaluateWorkflow } from './production-workflow.js';

const atTime = (record, time) =>
  [record, ...(record.history ?? [])]
    .filter((v) => new Date(v.updatedAt ?? v.createdAt).getTime() <= time)
    .sort(
      (a, b) => new Date(b.updatedAt ?? b.createdAt) - new Date(a.updatedAt ?? a.createdAt)
    )[0] ?? record;
function reviewAt(review, time) {
  const history = (review.history ?? []).map((v, index) => ({
    ...review,
    ...v,
    revision: review.revision - review.history.length + index,
    approvalFingerprint: v.approvalFingerprint,
    clipApprovalFingerprints: v.clipApprovalFingerprints
  }));
  return [review, ...history]
    .filter((v) => new Date(v.reviewedAt).getTime() <= time)
    .sort((a, b) => new Date(b.reviewedAt) - new Date(a.reviewedAt))[0];
}

// Read-only plan. Recover only an existing owner's approval, verified against
// its original fingerprint. Missing evidence leaves the record for review.
export function approvalRecoveryPlan(data, proposals) {
  const restorations = [];
  for (const asset of data.assets.filter(
    (a) => a.clipId && !a.finalChoice && a.reviewStatus === 'pending-choice' && !a.archived
  )) {
    const previous = asset.history?.at(-1);
    if (!previous?.finalChoice || asset.revision !== previous.revision + 1) continue;
    const episode = data.episodes.find((e) => String(e._id) === String(asset.episodeId));
    const applied = proposals.find(
      (p) =>
        p.status === 'applied' &&
        p.scene?.id === asset.sceneId &&
        p.episodeId === String(asset.episodeId) &&
        new Date(asset.updatedAt) <= new Date(p.updatedAt) &&
        new Date(p.updatedAt) - new Date(asset.updatedAt) < 1000
    );
    const before = episode?.history.find((v) => v.revision === applied?.baseRevision);
    const after =
      episode &&
      [...episode.history, episode].find((v) => v.revision === applied?.baseRevision + 1);
    if (
      !before ||
      !after ||
      new Date(asset.updatedAt) < new Date(after.updatedAt) ||
      !unchangedShotImage(
        before.scenes.find((s) => s.id === asset.sceneId),
        after.scenes.find((s) => s.id === asset.sceneId),
        asset.clipId
      )
    )
      continue;
    if (
      !asset.candidates.some(
        (c) =>
          c.id === previous.finalChoice.id &&
          !c.archived &&
          JSON.stringify(c.mediaIds.map(String)) ===
            JSON.stringify(previous.finalChoice.mediaIds.map(String))
      )
    )
      continue;
    if (
      !previous.finalChoice.mediaIds.every((mid) =>
        data.media.some((m) => String(m._id) === String(mid) && m.kind === 'image')
      )
    )
      continue;
    restorations.push({
      assetId: String(asset._id),
      revision: asset.revision,
      finalChoice: previous.finalChoice,
      referenceRevision: previous.referenceRevision,
      proposalId: String(applied._id)
    });
  }
  const bindings = [],
    skipped = [];
  for (const review of data.reviews.filter(
    (r) => r.target.scope === 'clip' && r.state === 'approved' && !r.approvalFingerprint
  )) {
    const time = new Date(review.reviewedAt).getTime();
    const history = {
      assets: data.assets.map((a) => atTime(a, time)),
      episodes: data.episodes.map((e) => atTime(e, time)),
      media: data.media,
      jobs: [],
      reviews: data.reviews.map((r) => reviewAt(r, time)).filter(Boolean)
    };
    try {
      const row = evaluateWorkflow(history, { retainApprovals: false }).evaluate(
        review.target,
        review.stage
      );
      if (row.fingerprint !== review.fingerprint || !row.approvalFingerprint) {
        skipped.push({ id: String(review._id), reason: 'Historical fingerprint did not match.' });
        continue;
      }
      bindings.push({
        id: String(review._id),
        revision: review.revision,
        fingerprint: review.fingerprint,
        approvalFingerprint: row.approvalFingerprint,
        target: review.target,
        stage: review.stage
      });
    } catch {
      skipped.push({ id: String(review._id), reason: 'Historical inputs are unavailable.' });
    }
  }
  return { restorations, bindings, skipped };
}
