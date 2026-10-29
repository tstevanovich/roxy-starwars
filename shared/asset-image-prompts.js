// Planning records remain in Studio. Only visual directions belong in a render.
export function imageRevisionReview(previous, item) {
  if (
    !previous ||
    item.type !== 'image' ||
    (item.notes === previous.notes &&
      (item.imagePrompt ?? '') === (previous.imagePrompt ?? '') &&
      JSON.stringify(item.referenceMediaIds ?? []) ===
        JSON.stringify(previous.referenceMediaIds ?? []))
  )
    return item;
  return { ...item, requiresPlanApproval: true, revisionSourceMediaId: item.mediaId ?? null };
}

export function visualImageDirections(value = '') {
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) =>
      sentence.trim().replace(/^For a future individually authorized replacement option,\s*/i, '')
    )
    .filter(
      (sentence) =>
        sentence &&
        !/\b(?:workflow|approval|authorization|authorized|audition|elevenlabs|eleven v3|credits?|capcut|timestamps?|youtube|owner feedback)\b|https?:\/\/|^REVISION DRAFT|no generation[, ]|before (?:paid )?(?:image )?generation/i.test(
          sentence
        )
    )
    .join(' ');
}

export function packageImagePrompt(asset, item, { era = 'Imperial era', instructions = '' } = {}) {
  // Exact complete prompt reviewed by the owner; do not append planning prose.
  if (item.imagePrompt?.trim()) return item.imagePrompt.trim();
  const hasMaster =
    ['character', 'droid'].includes(asset.kind) &&
    item.id !== 'master-portrait' &&
    asset.production?.items?.some((i) => i.id === 'master-portrait' && i.mediaId);
  return [
    `Star Wars universe, ${era}. Photorealistic live-action production reference.`,
    `Generate ONLY the requested package deliverable: ${item.title}.`,
    visualImageDirections(item.notes),
    visualImageDirections(instructions),
    hasMaster
      ? 'The first reference is the approved master portrait: preserve its identity, facial features, hairstyle, proportions and photographic appearance. Other references establish the exact costume and visible design details.'
      : 'Preserve the identity and design in the supplied references. When a separate original identity portrait is supplied, use it for the face; gameplay images establish costume and physical design.',
    'Render believable anatomy, natural skin or practical mechanical surfaces, real textiles and physical materials. Use a plain light-gray studio background and even photographic lighting. No readable text, labels, interface graphics or unrelated subjects.'
  ]
    .filter(Boolean)
    .join('\n');
}
