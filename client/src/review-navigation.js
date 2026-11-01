import { studioUrl } from './project-url.js';

const part = (s) =>
  String(s ?? '').replace(/[^a-zA-Z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);
export const assetReferenceSetupAnchor = (assetId) => 'asset-reference-setup-' + part(assetId);
export const assetImageGenerationAnchor = (assetId, itemId) =>
  'asset-image-generation-' + part(assetId) + '--' + part(itemId);
export const assetFinalizationAnchor = (assetId) => 'asset-finalization-' + part(assetId);
export const reviewAnchor = (target, stage) =>
  'review-' +
  [target.scope, target.recordId, target.sceneId, target.clipId, stage].map(part).join('--');
export function reviewHref(target, stage, currentId) {
  const hash = '#' + reviewAnchor(target, stage);
  return String(target.recordId) === String(currentId)
    ? hash
    : studioUrl(`/?${target.scope === 'asset' ? 'asset' : 'episode'}=${target.recordId}`) + hash;
}
export function endImageHref(transition, currentEpisodeId) {
  const hash = `#picture-prerequisites-${transition.nextClipId}`;
  return transition.nextEpisodeId && String(transition.nextEpisodeId) !== String(currentEpisodeId)
    ? studioUrl(`/?episode=${encodeURIComponent(transition.nextEpisodeId)}`) + hash
    : hash;
}
export function focusSection(id) {
  const element = document.getElementById(id);
  if (element?.tagName === 'DETAILS') element.open = true;
  const shotPanel = element?.querySelector('details[data-shot-panel]');
  if (shotPanel) shotPanel.open = true;
  for (let parent = element?.parentElement; parent; parent = parent.parentElement)
    if (parent.tagName === 'DETAILS') parent.open = true;
  element?.scrollIntoView?.({
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'instant'
      : 'smooth',
    block: 'start'
  });
  element?.focus({ preventScroll: true });
}
