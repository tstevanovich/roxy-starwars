import { musicState } from './music-state.ts';
import { evaluateWorkflow } from './production-workflow.ts';

const atTime = (record, time) =>
  [record, ...(record.history ?? [])]
    .filter((v) => new Date(v.updatedAt ?? v.createdAt).getTime() <= time)
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.updatedAt ?? a.createdAt).getTime()
    )[0] ?? record;
function reviewAt(review, time) {
  const history = (review.history ?? []).map((v, index: number) => ({
    ...review,
    ...v,
    revision: review.revision - review.history.length + index,
    approvalFingerprint: v.approvalFingerprint,
    clipApprovalFingerprints: v.clipApprovalFingerprints
  }));
  return [review, ...history]
    .filter((v) => new Date(v.reviewedAt).getTime() <= time)
    .sort(
      (a, b) =>
        new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime() ||
        b.revision - a.revision
    )[0];
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
      for (const snapshot of [episode, ...(episode.history ?? []).toReversed()]) {
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
