import { videoGenerationDefaults } from '../../../shared/production-defaults.js';
import { StudioEpisode } from '../models/Studio.js';
import { assertMediaAccess } from '../projects.js';
import { fail, id, text } from '../studio-validation.js';
import { Proposal } from './models.js';
import { saveWorkingDraft } from './working-drafts.js';

export async function proposeVideoRevision({
  chatId,
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
    scope: 'video-revision',
    episodeId: String(episode._id),
    baseRevision: episode.revision,
    title: `Video revision · ${clip.title}`,
    text: 'Review these exact video directions and the current approved shot image before generating. This request has not queued a render. If the image or shot plan is wrong, revise and approve those first.',
    reviewStages: ['video-revision'],
    render: {
      target: { episodeId: String(episode._id), sceneId: scene.id, clipId: clip.id },
      instructions: directions,
      referenceIds,
      duration: clip.duration,
      model: 'Wan 3.0 Standard',
      resolution: videoGenerationDefaults.resolution,
      aspectRatio: '16:9',
      audio: true
    }
  });
  return proposal;
}

export async function assertNoPendingRevision(target, excludedId) {
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
