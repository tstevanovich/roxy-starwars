import { createHash } from 'node:crypto';

import { StudioAsset, StudioMedia } from './models/Studio.js';
import { fail, sceneFingerprint, soundPlanFingerprint } from './studio-validation.js';

export function approvedSoundPlan(scene, assets) {
  if (!scene.approval || scene.approval.fingerprint !== sceneFingerprint(scene, assets))
    fail('Approve the current scene script first.');
  if (
    !scene.soundPlan?.layers?.length ||
    scene.soundPlan.approval?.fingerprint !== soundPlanFingerprint(scene, assets)
  )
    fail('Approve the current sound plan before generating effects or mixing.');
}
export async function mixState(episode, scene, clip, sourceTakeId) {
  const assets = await StudioAsset.find().lean();
  approvedSoundPlan(scene, assets);
  if (
    !(clip.takeIds ?? []).map(String).includes(String(sourceTakeId)) &&
    String(clip.selectedTakeId) !== String(sourceTakeId)
  )
    fail('Choose a video take belonging to this clip.');
  const source = await StudioMedia.findById(sourceTakeId).lean();
  if (!source || source.kind !== 'video' || source.soundMix)
    fail('Choose an original video take; do not mix effects onto an already mixed video.');
  const layers = [];
  for (const layer of scene.soundPlan.layers.filter((l) => !l.clipId || l.clipId === clip.id)) {
    const asset = assets.find((a) => String(a._id) === String(layer.assetId));
    if (
      !asset ||
      asset.kind !== 'sound' ||
      !asset.finalChoice ||
      asset.reviewStatus === 'pending-choice' ||
      asset.archived ||
      asset.finalChoice.mediaIds?.length !== 1
    )
      fail(`Approve one sound for ${layer.title} before mixing.`);
    if (asset.scope === 'episode' && String(asset.episodeId) !== String(episode._id))
      fail('A sound belongs to another episode.');
    const media = await StudioMedia.findById(asset.finalChoice.mediaIds[0]).lean();
    if (!media || media.kind !== 'audio') fail('An approved sound file is missing.');
    if (
      layer.start >= clip.duration ||
      (layer.type === 'effect' && layer.start + layer.duration > clip.duration + 0.001)
    )
      fail(`Sound timing exceeds ${clip.title}.`);
    layers.push({ layer, media, asset });
  }
  if (!layers.length) fail('Plan at least one audible sound layer for this clip.');
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        plan: soundPlanFingerprint(scene, assets),
        source: String(source._id),
        sha: source.sha256,
        dialogue: String(clip.selectedDialogueId ?? ''),
        layers: layers.map(({ layer, media, asset }) => ({
          layer,
          choice: asset.finalChoice.id,
          media: String(media._id),
          sha: media.sha256
        }))
      })
    )
    .digest('hex');
  return { source, layers, fingerprint };
}
export async function validateMixedSelection(episode, scene, clip) {
  if (!clip.selectedTakeId) return;
  if (String(clip.selectedTakeId) === String(clip.soundLegacyTakeId)) return;
  const selected = await StudioMedia.findById(clip.selectedTakeId).lean();
  if (
    !selected?.soundMix ||
    selected.soundMix.episodeId !== String(episode._id) ||
    selected.soundMix.sceneId !== scene.id ||
    selected.soundMix.clipId !== clip.id
  )
    fail('Complete and review a sound mix for this clip before approving its video take.');
  const state = await mixState(episode, scene, clip, selected.soundMix.sourceTakeId);
  if (state.fingerprint !== selected.soundMix.fingerprint)
    fail(
      'The sound plan, approved audio or source changed. Create and review a fresh mix before video approval.'
    );
}
