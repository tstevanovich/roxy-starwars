import { afterEach, expect, test, vi } from 'vitest';

import {
  assetFinalizationAnchor,
  assetImageGenerationAnchor,
  assetReferenceSetupAnchor,
  focusSection,
  reviewAnchor,
  reviewHref
} from './review-navigation.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

test('review links encode anchor identifiers and keep the selected project across records', () => {
  const target = { scope: 'asset', recordId: 'a b', sceneId: null, clipId: undefined };
  expect(assetReferenceSetupAnchor('a b')).toBe('asset-reference-setup-a_20_b');
  expect(assetImageGenerationAnchor('a', 'face/front')).toBe(
    'asset-image-generation-a--face_2f_front'
  );
  expect(assetFinalizationAnchor('a')).toBe('asset-finalization-a');
  expect(reviewAnchor(target, 'creative-brief')).toBe('review-asset--a_20_b------creative-brief');
  expect(reviewHref(target, 'brief', 'a b')).toBe('#review-asset--a_20_b------brief');
  history.replaceState(null, '', '/?project=sith');
  expect(reviewHref(target, 'brief')).toBe(
    '/?asset=a b&project=sith#review-asset--a_20_b------brief'
  );
  expect(reviewHref({ scope: 'episode', recordId: 'e' }, 'sound')).toBe(
    '/?episode=e&project=sith#review-episode--e------sound'
  );
});

test.each([false, true])('reveals nested shot panels and respects reduced motion: %s', (reduce) => {
  document.body.innerHTML =
    '<details><summary>Scene</summary><section id="target" tabindex="-1"><details data-shot-panel><summary>Shot</summary></details></section></details>';
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reduce }))
  );
  const target = document.getElementById('target');
  const scroll = vi.fn();
  target.scrollIntoView = scroll;
  focusSection('target');
  expect([...document.querySelectorAll('details')].every((panel) => panel.open)).toBe(true);
  expect(scroll).toHaveBeenCalledWith({ behavior: reduce ? 'instant' : 'smooth', block: 'start' });
  expect(document.activeElement).toBe(target);
});

test('opens a details destination and tolerates absent browser scrolling APIs and missing targets', () => {
  document.body.innerHTML = '<details id="target"><summary>Scene</summary></details>';
  vi.stubGlobal('matchMedia', undefined);
  focusSection('target');
  expect(document.querySelector('details').open).toBe(true);
  expect(() => focusSection('missing')).not.toThrow();
});
