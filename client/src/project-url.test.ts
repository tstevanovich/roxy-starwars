import { afterEach, expect, test } from 'vitest';

import { currentProjectKey, projectHeaders, studioUrl } from './project-url.ts';
afterEach(() => window.history.replaceState({}, '', '/'));
test('legacy URLs remain compatible and new workspace requests and downloads carry the correct project', () => {
  expect(currentProjectKey()).toBe('imperial-smuggler');
  expect(projectHeaders()).toEqual({});
  expect(studioUrl('/api/studio/media/file')).toBe('/api/studio/media/file');
  window.history.replaceState({}, '', '/?project=old-republic-sith-inquisitor');
  expect(projectHeaders()).toEqual({ 'X-Studio-Project': 'old-republic-sith-inquisitor' });
  expect(studioUrl('/api/studio/media/file?download=1')).toBe(
    '/api/studio/media/file?download=1&project=old-republic-sith-inquisitor'
  );
});
