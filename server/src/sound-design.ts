import { createHash } from 'node:crypto';

import { hasNativeAudio } from '../../shared/audio-policy.ts';
import type * as Studio from '../../shared/types.ts';
import { StudioAsset, StudioMedia } from './models/Studio.ts';
import { requireWorkflow, workflowEnabled } from './production-workflow.ts';
import { assertMediaAccess } from './projects.ts';
import { fail, sceneFingerprint, soundPlanFingerprint } from './studio-validation.ts';

export function approvedSoundPlan(scene: Studio.SceneInput, assets: Studio.AssetInput[]) {
  if (workflowEnabled()) return;
  if (!scene.approval || scene.approval.fingerprint !== sceneFingerprint(scene, assets))
    fail('Approve the current scene script first.');
  if (
    !scene.soundPlan?.layers?.length ||
    scene.soundPlan.approval?.fingerprint !== soundPlanFingerprint(scene, assets)
  )
    fail('Approve the current sound plan before generating effects or mixing.');
}
export async function mixState(
  episode,
  scene: Studio.SceneInput,
  clip: Studio.ClipInput,
  sourceTakeId
) {
  if (workflowEnabled()) {
    await requireWorkflow(
      { scope: 'clip' as const, recordId: String(episode._id), sceneId: scene.id, clipId: clip.id },
      'visual'
    );
    if (String(clip.production?.visualTakeId) !== String(sourceTakeId))
      fail('Mix only the accepted visual take.');
  }
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
  let cleanDialogue = null;
  if (clip.dialogue?.trim()) {
    const dialogueId = clip.production?.cleanDialogueMediaId;
    if (!dialogueId)
      fail(
        'Import a synchronized dialogue-only audio stem before mixing this speaking clip. Generated video audio may contain music and is never mixed automatically.'
      );
    await assertMediaAccess([dialogueId]);
    cleanDialogue = await StudioMedia.findById(dialogueId).lean();
    if (!cleanDialogue || cleanDialogue.kind !== 'audio')
      fail('Choose a dialogue-only audio file.');
  }
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
        audioPolicy: 'isolated-dialogue-and-approved-effects-v1',
        cleanDialogue: cleanDialogue
          ? { id: String(cleanDialogue._id), sha: cleanDialogue.sha256 }
          : null,
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
  const inputFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        source: String(source._id),
        sha: source.sha256,
        cleanDialogue: cleanDialogue
          ? { id: String(cleanDialogue._id), sha: cleanDialogue.sha256 }
          : null,
        dialogue: String(clip.selectedDialogueId ?? ''),
        dialogueGainDb: scene.soundPlan.dialogueGainDb ?? 0,
        layers: layers.map(({ layer, media, asset }) => ({
          layer: {
            type: layer.type,
            clipId: layer.clipId ?? null,
            start: layer.start ?? 0,
            sourceStart: layer.sourceStart ?? 0,
            duration: layer.duration ?? 10,
            gainDb: layer.gainDb ?? -20,
            lowpassHz: layer.lowpassHz ?? 0,
            loop: layer.loop
          },
          choice: asset.finalChoice.id,
          media: String(media._id),
          sha: media.sha256
        }))
      })
    )
    .digest('hex');
  return { source, cleanDialogue, layers, fingerprint, inputFingerprint };
}
export async function validateMixedSelection(
  episode,
  scene: Studio.SceneInput,
  clip: Studio.ClipInput
) {
  if (!clip.selectedTakeId) return;
  if (!workflowEnabled() && String(clip.selectedTakeId) === String(clip.soundLegacyTakeId)) return;
  const selected = await StudioMedia.findById(clip.selectedTakeId).lean();
  if (hasNativeAudio(selected)) {
    if (
      selected.nativeAudio.episodeId !== String(episode._id) ||
      selected.nativeAudio.sceneId !== scene.id ||
      selected.nativeAudio.clipId !== clip.id ||
      String(clip.production?.visualTakeId) !== String(selected._id) ||
      clip.production?.audioRepairTakeId === String(selected._id) ||
      !clip.takeIds.map(String).includes(String(selected._id))
    )
      fail("Approve this clip's native picture and sound together before selecting it.");
    if (!workflowEnabled()) fail('Enable the production workflow to review native audio.');
    await requireWorkflow(
      { scope: 'clip' as const, recordId: String(episode._id), sceneId: scene.id, clipId: clip.id },
      'visual'
    );
    return;
  }
  if (
    !selected?.soundMix ||
    selected.soundMix.episodeId !== String(episode._id) ||
    selected.soundMix.sceneId !== scene.id ||
    selected.soundMix.clipId !== clip.id
  )
    fail('Complete and review a sound mix for this clip before approving its video take.');
  const state = await mixState(episode, scene, clip, selected.soundMix.sourceTakeId);
  if (
    state.fingerprint !== selected.soundMix.fingerprint &&
    state.inputFingerprint !== selected.soundMix.inputFingerprint
  ) {
    // Older mixes have only a scene-wide fingerprint. Retain them only when a
    // saved, selected version proves the same source and exact local audio inputs.
    for (const snapshot of episode.history ?? []) {
      const previousScene = snapshot.scenes?.find((s) => s.id === scene.id);
      const previousClip = previousScene?.clips.find((c) => c.id === clip.id);
      if (String(previousClip?.selectedTakeId) !== String(selected._id)) continue;
      try {
        const previous = await mixState(
          snapshot,
          previousScene,
          previousClip,
          selected.soundMix.sourceTakeId
        );
        if (
          previous.fingerprint === selected.soundMix.fingerprint &&
          previous.inputFingerprint === state.inputFingerprint
        )
          return;
      } catch {
        /* Missing or changed evidence never grants approval. */
      }
    }
    fail(
      'The sound plan, approved audio or source changed. Create and review a fresh mix before video approval.'
    );
  }
}
