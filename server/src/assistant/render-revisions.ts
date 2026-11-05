import { videoGenerationDefaults } from '../../../shared/production-defaults.ts';
import { proposalApplication, videoRevisionInputs } from '../../../shared/production-proposals.ts';
import { StudioEpisode } from '../models/Studio.ts';
import { assertMediaAccess } from '../projects.ts';
import { fail, id, text } from '../studio-validation.ts';
import { Proposal } from './models.ts';
import { saveWorkingDraft } from './working-drafts.ts';

export async function proposeVideoRevision({
  chatId = undefined,
  requestId,
  target,
  instructions = '',
  referenceIds = []
}) {
  const previous = await Proposal.findOne({ requestId }).lean();
  if (previous) return previous;
  const episode = await StudioEpisode.findById(id(target.episodeId)).lean();
  const scene = episode?.scenes.find((s) => s.id === target.sceneId);
  const clip = scene?.clips.find((c) => c.id === target.clipId);
  if (!clip) fail('Choose an existing episode, scene and clip for this video revision.');
  const directions = text(instructions, 'Video revision directions', 3000);
  if (!Array.isArray(referenceIds) || referenceIds.length > 12)
    fail('Choose at most 12 saved references.');
  referenceIds.forEach(id);
  await assertMediaAccess(referenceIds);
  const proposal = await saveWorkingDraft({
    requestId,
    chatId,
    scope: 'video-revision' as const,
    episodeId: String(episode._id),
    baseRevision: episode.revision,
    title: `Video revision · ${clip.title}`,
    text: 'Review and approve these video directions to save them for this shot. Approval does not generate a video or change its image. When ready, use Generate video in the shot card.',
    reviewStages: ['video-revision'],
    render: {
      target: { episodeId: String(episode._id), sceneId: scene.id, clipId: clip.id },
      instructions: directions,
      baseVideoInputs: videoRevisionInputs(clip),
      referenceIds,
      duration: clip.duration,
      model: videoGenerationDefaults.displayName,
      resolution: videoGenerationDefaults.resolution,
      aspectRatio: '16:9',
      audio: true
    }
  });
  return proposal;
}

export async function applyVideoRevision(proposalId) {
  const proposal = await Proposal.findById(id(proposalId)).lean();
  if (!proposal?.render) fail('Video revision not found.', 404);
  const result = {
    approved: true,
    applied: true,
    episodeId: proposal.episodeId,
    sceneId: proposal.render.target.sceneId,
    clipId: proposal.render.target.clipId,
    message:
      'Video directions saved. No video generated. Use Generate video in the shot card when ready.'
  };
  if (proposal.status === 'applied') return { ...result, alreadyApplied: true };
  if (proposal.status !== 'pending') fail('This video revision is no longer pending.', 409);
  const episode = await StudioEpisode.findById(proposal.episodeId).lean();
  const application = proposalApplication(proposal, episode);
  if (!application.canApply) fail(application.reason, 409);
  const directions = text(proposal.render.instructions ?? '', 'Video revision directions', 4500);
  const si = episode.scenes.findIndex((scene) => scene.id === proposal.render.target.sceneId);
  const ci = episode.scenes[si].clips.findIndex(
    (clip) => clip.id === proposal.render.target.clipId
  );
  const claim = await Proposal.updateOne(
    { _id: proposal._id, status: 'pending', updatedAt: proposal.updatedAt },
    { $set: { status: 'approving' } }
  );
  if (!claim.modifiedCount) fail('This revision changed or is already being approved.', 409);
  try {
    const snapshot = { ...episode };
    delete snapshot.history;
    const saved = await StudioEpisode.updateOne(
      { _id: episode._id, revision: episode.revision },
      {
        ...(directions
          ? { $set: { [`scenes.${si}.clips.${ci}.production.videoPrompt`]: directions } }
          : {}),
        $inc: { revision: 1 },
        $push: { history: { $each: [{ ...snapshot, savedAt: new Date() }], $slice: -30 } }
      }
    );
    if (!saved.modifiedCount)
      fail('The episode changed while saving these directions. Refresh and try again.', 409);
    await Proposal.updateOne(
      { _id: proposal._id, status: 'approving' },
      { $set: { status: 'applied', 'render.approvedAt': new Date() } }
    );
    return result;
  } catch (error) {
    await Proposal.updateOne(
      { _id: proposal._id, status: 'approving' },
      { $set: { status: 'pending' } }
    );
    throw error;
  }
}

export async function assertNoPendingRevision(target, excludedId?) {
  const proposals = await Proposal.find({
    episodeId: target.episodeId,
    status: 'pending',
    ...(excludedId ? { _id: { $ne: excludedId } } : {})
  }).lean();
  const blocking = proposals.find(
    (p) =>
      (p.render &&
        p.render.target.sceneId === target.sceneId &&
        p.render.target.clipId === target.clipId) ||
      (p.scene &&
        p.scene.id === target.sceneId &&
        (!p.targetClipId || p.targetClipId === target.clipId)) ||
      p.production ||
      (!p.scene && !p.render)
  );
  if (blocking)
    fail(`Review the pending revision “${blocking.title}” before generating video.`, 409);
}
