export function shotAssetIds(scene, clip, assets) {
  const selected = clip?.production?.referenceAssetIds ?? scene?.assetIds ?? [];
  const mediaIds = clip?.production?.referenceMediaIds ?? [];
  if (!assets || !mediaIds.length) return selected;
  const owners = assets
    .filter((asset) =>
      [
        ...(asset.finalChoice?.mediaIds ?? []),
        ...(asset.production?.items ?? []).map((item) => item.mediaId),
        ...(asset.characterSheets ?? []).map((sheet) => sheet.mediaId)
      ].some((id) => mediaIds.map(String).includes(String(id)))
    )
    .map((asset) => String(asset._id));
  return (scene?.assetIds ?? []).filter(
    (id) => selected.map(String).includes(String(id)) || owners.includes(String(id))
  );
}

export function scopeClipScene(before, proposed, clipId, allowSoundChanges = false) {
  if (!before || !clipId) return proposed;
  const target = proposed.clips.find((clip) => clip.id === clipId);
  const previous = before.clips.find((clip) => clip.id === clipId);
  if (!target || !previous)
    throw new Error('Include the existing target shot in this clip revision.');
  return {
    ...before,
    assetIds: [
      ...new Set([...(before.assetIds ?? []).map(String), ...(proposed.assetIds ?? []).map(String)])
    ],
    script: (target.dialogue ?? '') !== (previous.dialogue ?? '') ? proposed.script : before.script,
    soundPlan: allowSoundChanges ? proposed.soundPlan : before.soundPlan,
    clips: before.clips.map((clip) =>
      clip.id === clipId
        ? { ...clip, ...target, production: { ...clip.production, ...target.production } }
        : clip
    )
  };
}

// Adding a character for one shot must not change the implicit references of
// every other shot in the scene. Preserve their previous effective inputs.
export function scopeAddedReferences(before, after, targetClipId) {
  if (
    !before ||
    !(after.assetIds ?? []).some((id) => !(before.assetIds ?? []).map(String).includes(String(id)))
  )
    return after;
  const local = (scene, clip) => {
    const p = clip.production ?? {};
    return JSON.stringify([
      scene.style,
      p.location || scene.location,
      p.environment ?? '',
      p.physicalConstraints ?? '',
      clip.action ?? '',
      clip.camera ?? '',
      p.framing ?? '',
      p.continuityMode ?? '',
      p.continuitySources ?? [],
      p.continuityNotes ?? '',
      p.referenceAssetIds ?? null,
      p.referenceMediaIds ?? []
    ]);
  };
  return {
    ...after,
    clips: after.clips.map((clip) => {
      const previous = before.clips.find((saved) => saved.id === clip.id);
      if (!previous || clip.id === targetClipId || local(before, previous) !== local(after, clip))
        return clip;
      return {
        ...clip,
        production: {
          ...clip.production,
          referenceAssetIds: shotAssetIds(before, previous).map(String)
        }
      };
    })
  };
}
