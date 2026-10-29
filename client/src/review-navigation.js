import { studioUrl } from './project-url.js';

const part = (s) =>
  String(s ?? '').replace(/[^a-zA-Z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);
export const reviewAnchor = (target, stage) =>
  'review-' +
  [target.scope, target.recordId, target.sceneId, target.clipId, stage].map(part).join('--');
export function reviewHref(target, stage, currentId) {
  const hash = '#' + reviewAnchor(target, stage);
  return String(target.recordId) === String(currentId)
    ? hash
    : studioUrl(`/?${target.scope === 'asset' ? 'asset' : 'episode'}=${target.recordId}`) + hash;
}
export function focusSection(id) {
  const element = document.getElementById(id);
  element?.scrollIntoView?.({
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'instant'
      : 'smooth',
    block: 'start'
  });
  element?.focus({ preventScroll: true });
}
