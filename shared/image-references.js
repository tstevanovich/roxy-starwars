export function imageReferenceSelection({
  asset,
  prompts,
  packageItemId,
  referenceIds = [],
  workflow = false
}) {
  const item = asset?.production?.items?.find((item) => item.id === packageItemId);
  const exact = prompts?.imageReferenceMediaIds ?? item?.imageReferenceMediaIds;
  if (Array.isArray(exact)) {
    const ids = [...new Set(exact.map(String))];
    return { selected: ids.slice(0, 16), omitted: ids.slice(16) };
  }
  const characterPackage = Boolean(
    packageItemId &&
    packageItemId !== 'master-portrait' &&
    ['character', 'droid'].includes(asset?.kind)
  );
  const master = characterPackage
    ? asset.production?.items?.find((item) => item.id === 'master-portrait')?.mediaId
    : null;
  const ids = [
    ...new Set(
      [
        ...(master ? [master] : []),
        ...(prompts?.continuity?.mediaIds ?? []),
        ...referenceIds,
        ...(master ? [] : (asset?.identitySourceMediaIds ?? [])),
        ...(item?.referenceMediaIds?.length
          ? item.referenceMediaIds
          : workflow
            ? item?.sourceMediaIds?.length
              ? item.sourceMediaIds
              : (asset?.production?.sourceMediaIds ?? [])
            : []),
        ...(prompts?.referenceMediaIds ?? asset?.finalChoice?.mediaIds ?? [])
      ]
        .filter(Boolean)
        .map(String)
    )
  ];
  return { selected: ids.slice(0, 16), omitted: ids.slice(16) };
}

export function selectedImageReferences(references, ids) {
  if (!references) return references;
  const choices = [
    ...(references.items ?? []),
    ...(references.omittedItems ?? []),
    ...(references.choices ?? [])
  ];
  return {
    ...references,
    selected: ids,
    omitted: [],
    omittedItems: [],
    items: ids.map((mediaId, index) => ({
      ...(choices.find((item) => item.mediaId === mediaId) ?? {
        mediaId,
        title: 'Saved image',
        role: 'Image reference'
      }),
      imageNumber: index + 1
    }))
  };
}

// One representative image per linked design, rather than every package view.
export function compactShotImageReferences(scene, clip, assets, continuityIds = []) {
  const words = (value) =>
    new Set(
      (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        (word) =>
          word.length > 2 &&
          !['the', 'and', 'from', 'with', 'shot', 'reference', 'scene', 'opening'].includes(word)
      )
    );
  const location = words(clip.production?.location || scene.location || '');
  const score = (value) => [...words(value)].filter((word) => location.has(word)).length;
  const ids = [...continuityIds];
  for (const asset of assets.filter(
    (asset) => !asset.archived && !['voice', 'sound'].includes(asset.kind)
  )) {
    const items = (asset.production?.items ?? []).filter(
      (item) => item.type === 'image' && item.mediaId
    );
    const finalized = asset.finalChoice?.mediaIds ?? [];
    const sheet = (asset.characterSheets ?? [])
      .filter(
        (sheet) =>
          sheet.approvedAt &&
          sheet.sourceCandidateId === asset.finalChoice?.id &&
          new Date(sheet.sourceFinalizedAt).getTime() ===
            new Date(asset.finalChoice?.finalizedAt).getTime()
      )
      .sort((a, b) => (b.views?.length ?? 0) - (a.views?.length ?? 0))[0];
    let mediaId;
    if (['character', 'droid', 'wardrobe'].includes(asset.kind)) {
      mediaId =
        sheet?.mediaId ??
        finalized[0] ??
        items.find((item) => item.id === 'body-turnaround')?.mediaId ??
        items.find((item) => item.id === 'master-portrait')?.mediaId;
    } else if (asset.kind === 'environment') {
      const best = items.slice().sort((a, b) => score(b.title ?? '') - score(a.title ?? ''))[0];
      mediaId =
        best && score(best.title ?? '') > 0 ? best.mediaId : (finalized[0] ?? best?.mediaId);
    } else mediaId = sheet?.mediaId ?? finalized[0] ?? items[0]?.mediaId;
    if (mediaId) ids.push(String(mediaId));
  }
  return [...new Set(ids.map(String))].slice(0, 16);
}

export function imageReferenceItems(ids, { assets = [], media = [], continuity } = {}) {
  const roleNames = {
    character: 'Character identity',
    droid: 'Droid design',
    wardrobe: 'Costume',
    ship: 'Ship design',
    environment: 'Environment / set',
    prop: 'Prop design'
  };
  return ids.map((mediaId, index) => {
    const source = continuity?.sources?.find((source) => source.mediaId === mediaId);
    const owner =
      assets.find(
        (asset) =>
          !asset.archived &&
          [
            ...(asset.finalChoice?.mediaIds ?? []),
            ...(asset.production?.items ?? []).map((item) => item.mediaId),
            ...(asset.characterSheets ?? []).map((sheet) => sheet.mediaId)
          ].some((id) => String(id) === mediaId)
      ) ??
      assets.find(
        (asset) =>
          !asset.archived &&
          [
            ...(asset.identitySourceMediaIds ?? []),
            ...(asset.production?.sourceMediaIds ?? []),
            ...(asset.production?.items ?? []).flatMap((item) => item.sourceMediaIds ?? [])
          ].some((id) => String(id) === mediaId)
      );
    const file = media.find((file) => String(file._id) === mediaId);
    const item = owner?.production?.items?.find((item) => String(item.mediaId) === mediaId);
    const sheet = owner?.characterSheets?.find((sheet) => String(sheet.mediaId) === mediaId);
    return {
      mediaId,
      imageNumber: index + 1,
      title: source?.title ?? owner?.name ?? file?.originalName ?? 'Saved image',
      subject: source?.title ?? owner?.name,
      role: source
        ? 'Continuity - earlier shot image'
        : (roleNames[owner?.kind] ?? 'Image reference'),
      view:
        item?.title ??
        sheet?.title ??
        (owner && !owner.finalChoice?.mediaIds?.map(String).includes(mediaId)
          ? 'Source appearance reference'
          : undefined),
      filename: file?.originalName,
      available: Boolean(file),
      assetId: owner ? String(owner._id) : source?.assetId,
      sourceClipId: source?.clipId,
      sourceSceneId: source?.sceneId,
      sourceType: source ? 'approved-shot-image' : 'design-reference'
    };
  });
}
