import { unchangedShotImage } from '../../shared/shot-revisions.js';
import { musicState } from './music-state.js';
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
    .sort((a, b) => new Date(b.reviewedAt) - new Date(a.reviewedAt) || b.revision - a.revision)[0];
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

// Bind existing scene approvals only when a saved snapshot reproduces the
// owner's original fingerprint. This records scope, never grants an approval.
export function sceneApprovalBindings(data) {
  const bindings = [],
    skipped = [],
    feedbackBindings = [];
  for (const review of data.reviews.filter(
    (r) =>
      (r.target.scope === 'scene' &&
        r.state === 'approved' &&
        (!r.approvalFingerprint || r.stage === 'sound-plan') &&
        [
          'script',
          'shot-plan',
          'sound-plan',
          'storyboard',
          'animatic',
          'music-plan',
          'music'
        ].includes(r.stage)) ||
      (['scene', 'clip'].includes(r.target.scope) &&
        r.state === 'changes-requested' &&
        !r.contentFingerprint)
  )) {
    const episode = data.episodes.find((e) => String(e._id) === review.target.recordId);
    let match;
    if (review.stage === 'sound-plan') {
      if (!episode?.scenes.some((scene) => scene.id === review.target.sceneId)) {
        skipped.push({
          id: String(review._id),
          stage: review.stage,
          reason: 'The reviewed scene is no longer available.'
        });
        continue;
      }
      const current = evaluateWorkflow(data, { retainApprovals: false }).evaluate(
        review.target,
        review.stage
      );
      if (current.approvalFingerprint === review.approvalFingerprint) continue;
      for (const snapshot of episode ? [episode, ...(episode.history ?? []).toReversed()] : []) {
        if (!snapshot.scenes?.some((scene) => scene.id === review.target.sceneId)) continue;
        const historical = {
          ...data,
          episodes: data.episodes.map((saved) =>
            String(saved._id) === String(episode._id) ? snapshot : saved
          )
        };
        try {
          const legacy = evaluateWorkflow(historical, {
            retainApprovals: false,
            legacySoundPlanDependencies: true
          }).evaluate(review.target, review.stage);
          if (
            (review.approvalFingerprint &&
              legacy.approvalFingerprint === review.approvalFingerprint) ||
            legacy.fingerprint === review.fingerprint
          ) {
            match = evaluateWorkflow(historical, { retainApprovals: false }).evaluate(
              review.target,
              review.stage
            );
            break;
          }
        } catch {
          /* An incomplete historical snapshot cannot authorize recovery. */
        }
      }
    }
    if (review.stage === 'music-plan' || review.stage === 'music') {
      const scene = episode?.scenes.find((scene) => scene.id === review.target.sceneId);
      const cue = (data.musicCues ?? []).find(
        (cue) =>
          String(cue.episodeId) === review.target.recordId && cue.sceneId === review.target.sceneId
      );
      const approvedAt = new Date(review.reviewedAt).getTime();
      const saved = cue && atTime(cue, approvedAt);
      const option = cue?.candidates.find((option) =>
        option.mediaIds?.map(String).includes(String(cue.selectedMediaId))
      );
      // The immutable generated cue fingerprint proves its exact prompt, model
      // and shot timing. The saved selection predates this owner's approval.
      if (
        scene &&
        saved &&
        new Date(saved.updatedAt ?? saved.createdAt).getTime() <= approvedAt &&
        option?.qc?.passed &&
        option.fingerprint === musicState(episode, scene, cue).fingerprint &&
        option.fingerprint === musicState(episode, scene, saved).fingerprint &&
        (review.stage === 'music-plan' ||
          String(saved.selectedMediaId) === String(cue.selectedMediaId)) &&
        data.media.some(
          (media) => String(media._id) === String(cue.selectedMediaId) && media.kind === 'audio'
        )
      )
        match = evaluateWorkflow(data, { retainApprovals: false }).evaluate(
          review.target,
          review.stage
        );
    }
    for (const snapshot of episode ? [episode, ...(episode.history ?? []).toReversed()] : []) {
      if (match) break;
      const time = new Date(snapshot.savedAt ?? snapshot.updatedAt ?? review.reviewedAt).getTime();
      const history = {
        assets: data.assets.map((asset) => atTime(asset, time)),
        episodes: data.episodes.map((e) =>
          String(e._id) === String(episode._id) ? snapshot : atTime(e, time)
        ),
        media: data.media,
        musicCues: (data.musicCues ?? []).map((cue) => atTime(cue, time)),
        jobs: [],
        reviews: data.reviews.map((r) => reviewAt(r, time)).filter(Boolean)
      };
      try {
        const row = evaluateWorkflow(history, { retainApprovals: false }).evaluate(
          review.target,
          review.stage
        );
        if (row.fingerprint === review.fingerprint && row.approvalFingerprint) {
          match = row;
          break;
        }
      } catch {
        /* Missing historical evidence cannot authorize a binding. */
      }
    }
    if (match)
      (review.state === 'approved' ? bindings : feedbackBindings).push({
        id: String(review._id),
        revision: review.revision,
        fingerprint: review.fingerprint,
        approvalFingerprint: match.approvalFingerprint,
        target: review.target,
        stage: review.stage
      });
    else
      skipped.push({
        id: String(review._id),
        stage: review.stage,
        target: review.target,
        reason: 'No saved snapshot reproduces the original approved fingerprint.'
      });
  }
  return { bindings, feedbackBindings, skipped };
}
