import { imageReferenceItems, imageReferenceSelection } from './image-references.js';
import { withImageReferencePrompt } from './reference-prompt.js';
import { cleanRenderPrompt } from './render-prompt.js';

// Planning records remain in Studio. Only visual directions belong in a render.
export function imageRevisionReview(previous, item) {
  if (
    !previous ||
    item.type !== 'image' ||
    (item.notes === previous.notes &&
      (item.imagePrompt ?? '') === (previous.imagePrompt ?? '') &&
      JSON.stringify(item.referenceMediaIds ?? []) ===
        JSON.stringify(previous.referenceMediaIds ?? []) &&
      JSON.stringify(item.imageReferenceMediaIds) ===
        JSON.stringify(previous.imageReferenceMediaIds))
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

export function packageImagePrompt(asset, item, options = {}) {
  const selection = imageReferenceSelection({
    asset,
    packageItemId: item.id,
    workflow: options.workflow ?? true
  });
  return withImageReferencePrompt(
    packageImageBasePrompt(asset, item, options),
    imageReferenceItems(selection.selected, { assets: options.assets ?? [asset] })
  );
}

export function packageImageBasePrompt(
  asset,
  item,
  { era = 'Imperial era', instructions = '', workflow = true } = {}
) {
  // Exact complete prompt reviewed by the owner; do not append planning prose.
  if (item.imagePrompt?.trim()) return cleanRenderPrompt(item.imagePrompt);
  const ids = imageReferenceSelection({ asset, packageItemId: item.id, workflow }).selected;
  const master = asset.production?.items?.find((i) => i.id === 'master-portrait')?.mediaId;
  const masterIndex = ids.indexOf(String(master));
  const hasMaster =
    ['character', 'droid'].includes(asset.kind) &&
    item.id !== 'master-portrait' &&
    masterIndex >= 0;
  return cleanRenderPrompt(
    [
      `Star Wars universe, ${era}. Photorealistic live-action production reference.`,
      `Create ${item.title}.`,
      visualImageDirections(item.notes),
      visualImageDirections(instructions),
      hasMaster
        ? `@image${masterIndex + 1} is the approved master portrait: preserve its identity, facial features, hairstyle, proportions and photographic appearance. Other references establish the exact costume and visible design details.`
        : ids.length
          ? 'Preserve the identity and design in the supplied references. When a separate original identity portrait is supplied, use it for the face; gameplay images establish costume and physical design.'
          : 'Use the described identity, clothing and physical design.',
      'Render believable anatomy, natural skin or practical mechanical surfaces, real textiles and physical materials. Use a plain light-gray studio background and even photographic lighting. No readable text, labels, interface graphics or unrelated subjects.'
    ]
      .filter(Boolean)
      .join('\n')
  );
}
