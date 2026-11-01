const numberedPart = (clip) => {
  const match = clip?.title?.match(/^(.*?)\bpart\s*(\d+)(?:\s*(?:of|\/)\s*(\d+))?\s*$/i);
  if (!match) return null;
  const name = match[1]
    .replace(/[\s\-–—:]+$/, '')
    .trim()
    .toLowerCase();
  const part = Number(match[2]),
    total = match[3] ? Number(match[3]) : null;
  return name && part > 0 && (!total || total >= part) ? { name, part, total } : null;
};

export function multipartShot(scene, clip) {
  const current = numberedPart(clip);
  if (!current) return null;
  const index = scene.clips.findIndex((item) => item.id === clip.id);
  if (index < 0) return null;
  const candidate = scene.clips[index + 1],
    next = numberedPart(candidate);
  const matches =
    next?.name === current.name &&
    next.part === current.part + 1 &&
    (!current.total || !next.total || current.total === next.total);
  const needsEnd = current.total ? current.part < current.total : matches;
  return {
    part: current.part,
    total: current.total,
    needsEnd,
    nextClipId: needsEnd && matches ? candidate.id : null,
    nextTitle: needsEnd && matches ? candidate.title : null
  };
}

export function nextEpisodeShot(scenes, sceneId, clipId) {
  const shots = scenes.flatMap((item) =>
    item.clips.map((shot) => ({ sceneId: item.id, clipId: shot.id, title: shot.title }))
  );
  const index = shots.findIndex((shot) => shot.sceneId === sceneId && shot.clipId === clipId);
  return index < 0 ? null : (shots[index + 1] ?? null);
}

export function shotTransition(episodeId, scene, clip, assets, media, scenes = [scene]) {
  const group = multipartShot(scene, clip);
  const choice = clip.production?.videoEndFrame;
  if (!group && !choice) return null;
  const approvedId = (asset) => {
    if (asset?.archived) return null;
    const ids = asset?.finalChoice?.mediaIds;
    if (asset?.reviewStatus === 'pending-choice' || ids?.length !== 1) return null;
    const mid = String(ids[0]);
    return !media || media.some((file) => String(file._id) === mid && file.kind === 'image')
      ? mid
      : null;
  };
  const shotAsset = (clipId) =>
    assets.find(
      (item) =>
        !item.archived &&
        String(item.episodeId) === String(episodeId) &&
        item.sceneId === scene.id &&
        item.clipId === clipId
    );
  const custom = choice?.mode === 'image';
  const nextShot = custom ? nextEpisodeShot(scenes, scene.id, clip.id) : null;
  const needsEnd = choice?.mode === 'none' ? false : custom || Boolean(group?.needsEnd);
  const endAsset = custom
    ? assets.find(
        (asset) =>
          String(asset._id) === String(choice.assetId) &&
          String(asset.episodeId) === String(episodeId) &&
          asset.sceneId === nextShot?.sceneId &&
          asset.clipId === nextShot?.clipId
      )
    : needsEnd && group?.nextClipId
      ? shotAsset(group.nextClipId)
      : null;
  const startImageId = approvedId(shotAsset(clip.id));
  const candidateId = needsEnd ? approvedId(endAsset) : null;
  const endImageId = custom && candidateId !== String(choice.mediaId) ? null : candidateId;
  return {
    ...group,
    needsEnd,
    ...(choice ? { endMode: choice.mode, finalPart: Boolean(group && !group.needsEnd) } : {}),
    ...(choice?.mode === 'none' ? { nextClipId: null, nextTitle: null } : {}),
    ...(custom
      ? {
          endAssetId: choice.assetId,
          nextEpisodeId: String(endAsset?.episodeId ?? ''),
          nextSceneId: endAsset?.sceneId ?? null,
          nextClipId: endAsset?.clipId ?? null,
          nextTitle: endAsset?.name ?? 'Selected end image'
        }
      : {}),
    startImageId,
    endImageId,
    imageIds: [startImageId, endImageId].filter(Boolean),
    errors: [
      ...(!startImageId ? [`Approve this shot's starting image.`] : []),
      ...(custom
        ? !endImageId
          ? [
              'Choose the approved image of the immediately following shot in this episode, or choose No end image.'
            ]
          : []
        : needsEnd && !group?.nextClipId
          ? [
              `Place part ${group.part + 1} of this shot next to this part before generating its transition.`
            ]
          : needsEnd && !endImageId
            ? [`Approve the image for “${group.nextTitle}” to use as this shot's end reference.`]
            : [])
    ]
  };
}

export function videoTransitionPrompt(scene, clip) {
  const group = multipartShot(scene, clip);
  const choice = clip.production?.videoEndFrame;
  if (!group && !choice) return '';
  if (clip.production?.videoTransitionPrompt?.trim()) return clip.production.videoTransitionPrompt;
  if (choice)
    return [
      'SHOT CONTINUITY: Generate one continuous shot.',
      'Image 1 is START: begin with its cast, framing and background.',
      choice.mode === 'image'
        ? `Image 2 is the owner-selected END reference: match its composition and staging at ${clip.duration} seconds. Move naturally between them; no cuts, dissolves, face morphs, or the following shot's dialogue/action.`
        : 'Image 1 supplies the start composition; there is no end-image reference. Perform this shot only.',
      'Preserve identities; change only what the saved directions and end composition require.',
      clip.dialogue?.trim()
        ? 'Audio 1 supplies the approved voices; preserve dialogue and speaker order.'
        : ''
    ]
      .filter(Boolean)
      .join('\n');
  return [
    'NUMBERED SHOT CONTINUITY: Generate one continuous shot.',
    'Image 1 is the START reference: begin with its composition, cast positions, framing and background.',
    group.needsEnd
      ? `Image 2 is the END reference, the approved image for the next part. At ${clip.duration} seconds, finish matching its composition and staging so the next video starts from that same image. Move naturally from Image 1 to Image 2 over this shot; do not cut, dissolve, morph faces, or perform the next part's dialogue or action.`
      : 'This is the final part. Image 1 supplies the start composition; there is no end-image reference. Perform this part only.',
    'Keep identities, costumes, set geometry and lighting consistent. Do not invent departures, background changes or a scene reset.',
    clip.dialogue?.trim()
      ? 'Audio 1 is the approved voice reference for the specified dialogue. Preserve speaker order and voice identity.'
      : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export const joinVideoPrompt = (base, transition) =>
  [base, transition].filter(Boolean).join('\n\n');
