export function removeMediaReferences(value, mediaId, key = '') {
  if (Array.isArray(value)) {
    if (['mediaIds', 'takeIds', 'dialogueTakeIds'].includes(key))
      return value.filter((item) => String(item) !== mediaId);
    return value
      .map((item) => removeMediaReferences(item, mediaId))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  if (value.mediaId === mediaId) return undefined;
  if (key === 'upscale' && [value.sourceTakeId, value.resultMediaId].includes(mediaId)) return null;
  if (key === 'finalChoice' && value.mediaIds?.includes(mediaId)) return null;
  const next = Object.fromEntries(
    Object.entries(value).map(([name, item]) => [
      name,
      ['selectedTakeId', 'selectedDialogueId', 'soundLegacyTakeId'].includes(name) &&
      item === mediaId
        ? null
        : removeMediaReferences(item, mediaId, name)
    ])
  );
  if (key === '' && value.id && value.mediaIds?.includes(mediaId) && !next.mediaIds.length)
    return undefined;
  return next;
}
