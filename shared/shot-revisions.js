import { continuityInput } from './shot-continuity.js';

// Scene narration and playback length do not change an unchanged shot composition.
export function shotImageInputs(scene, clip) {
  if (!clip) return null;
  const p = clip.production ?? {};
  return {
    style: scene?.style ?? '',
    location: p.location || scene?.location || '',
    environment: p.environment ?? '',
    physicalConstraints: p.physicalConstraints ?? '',
    action: clip.action ?? '',
    camera: clip.camera ?? '',
    framing: p.framing ?? '',
    ...continuityInput(p),
    references: (p.referenceMediaIds?.length ? p.referenceMediaIds : (scene?.assetIds ?? []))
      .map(String)
      .sort()
  };
}
export const unchangedShotImage = (before, after, clipId) =>
  JSON.stringify(
    shotImageInputs(
      before,
      before?.clips?.find((c) => c.id === clipId)
    )
  ) ===
  JSON.stringify(
    shotImageInputs(
      after,
      after?.clips?.find((c) => c.id === clipId)
    )
  );

export function shotRevisionImpact(before, after) {
  const timing = (c) => [
    c?.duration,
    c?.dialogue ?? '',
    c?.production?.mode ?? '',
    c?.production?.beats ?? '',
    c?.production?.passCondition ?? ''
  ];
  const audio = (s, c) => [
    c?.soundEffects ?? '',
    (s?.soundPlan?.layers ?? [])
      .filter((l) => !l.clipId || l.clipId === c?.id)
      .map((l) => [
        l.type,
        l.description ?? '',
        l.clipId ?? null,
        l.start ?? 0,
        l.duration ?? 10,
        l.assetId ? String(l.assetId) : null,
        l.sourceStart ?? 0,
        l.gainDb ?? -20,
        l.lowpassHz ?? 0,
        l.loop
      ])
  ];
  return (after?.clips ?? []).map((clip) => {
    const old = before?.clips?.find((c) => c.id === clip.id);
    const image = !unchangedShotImage(before, after, clip.id);
    const timed = JSON.stringify(timing(old)) !== JSON.stringify(timing(clip));
    const sound = JSON.stringify(audio(before, old)) !== JSON.stringify(audio(after, clip));
    return {
      id: clip.id,
      title: clip.title,
      image,
      timing: timed,
      sound,
      changed: !old || image || timed || sound
    };
  });
}
