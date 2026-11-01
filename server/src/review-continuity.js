import { createHash } from 'node:crypto';

import { shotContinuity } from '../../shared/shot-continuity.js';
import { shotAssetIds } from '../../shared/shot-references.js';
import { shotImageInputs } from '../../shared/shot-revisions.js';
import { motionInput } from '../../shared/video-readiness.js';

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])])
        )
      : value;
export const approvalHash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

export function clipApprovalInputs({ episode, scene, clip, assets, media }, stage) {
  const file = (mid) => {
    const m = media.find((m) => String(m._id) === String(mid));
    return mid ? { id: String(mid), sha: m?.sha256, kind: m?.kind } : null;
  };
  const explicit = (clip.production?.referenceMediaIds ?? []).map(String);
  const linked = assets.filter((a) =>
    shotAssetIds(scene, clip, assets).map(String).includes(String(a._id))
  );
  let references = linked.filter(
    (a) =>
      !explicit.length ||
      (a.kind === 'voice' && clip.dialogue?.trim()) ||
      [
        ...(a.finalChoice?.mediaIds ?? []),
        ...(a.production?.items ?? []).filter((i) => i.required).map((i) => i.mediaId)
      ].some((mid) => explicit.includes(String(mid)))
  );
  const image = assets.find(
    (a) =>
      !a.archived &&
      a.sceneId === scene.id &&
      a.clipId === clip.id &&
      String(a.episodeId) === String(episode._id)
  );
  const continuity =
    clip.production?.continuityMode === 'explicit' || image?.finalChoice?.continuitySources?.length
      ? shotContinuity(episode, scene, clip, assets, media)
      : null;
  if (continuity)
    references = [
      ...new Map(
        [
          ...references,
          ...assets.filter((a) => continuity.sources.some((s) => s.assetId === String(a._id)))
        ].map((a) => [String(a._id), a])
      ).values()
    ];
  const composition = {
    ...(continuity
      ? { continuity: { sources: continuity.sources, errors: continuity.errors } }
      : {}),
    shot: shotImageInputs(scene, clip),
    image: (image?.finalChoice?.mediaIds ?? []).map(file),
    references: references
      .map((a) => ({
        id: String(a._id),
        brief: a.brief ?? '',
        files: (a.finalChoice?.mediaIds ?? []).map(file),
        voiceId: a.finalChoice?.voiceId ?? null,
        voiceModel: a.finalChoice?.voiceModel ?? null,
        items: (a.production?.items ?? [])
          .filter((i) => i.required)
          .map((i) => ({ id: i.id, file: file(i.mediaId), notes: i.notes ?? '' }))
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  };
  const timing = {
    ...(clip.production?.videoPrompt ? { videoPrompt: clip.production.videoPrompt } : {}),
    ...(clip.production?.videoEndFrame ? { videoEndFrame: clip.production.videoEndFrame } : {}),
    ...(clip.production?.videoTransitionPrompt
      ? { videoTransitionPrompt: clip.production.videoTransitionPrompt }
      : {}),
    ...motionInput(clip.production),
    composition,
    duration: clip.duration,
    dialogue: clip.dialogue ?? '',
    dialogueFile: file(clip.selectedDialogueId),
    mode: clip.production?.mode ?? '',
    beats: clip.production?.beats ?? '',
    passCondition: clip.production?.passCondition ?? ''
  };
  const sound = {
    effects: clip.soundEffects ?? '',
    layers: (scene.soundPlan?.layers ?? [])
      .filter((l) => !l.clipId || l.clipId === clip.id)
      .map((layer) => ({
        type: layer.type,
        description: layer.description ?? '',
        clipId: layer.clipId ?? null,
        start: layer.start ?? 0,
        duration: layer.duration ?? 10
      }))
  };
  const take = media.find((m) => String(m._id) === String(clip.production?.visualTakeId));
  const picture = {
    timing,
    sound,
    take: file(clip.production?.visualTakeId),
    nativeAudio: take?.nativeAudio ?? null,
    repair: clip.production?.audioRepairTakeId === String(take?._id)
  };
  return {
    input:
      stage === 'storyboard'
        ? composition
        : stage === 'animatic'
          ? timing
          : stage === 'visual'
            ? picture
            : {
                picture,
                selected: file(clip.selectedTakeId),
                upscale: file(clip.production?.upscaleMediaId),
                upscaleSource: clip.production?.upscaleSourceTakeId ?? null
              },
    references,
    image
  };
}
