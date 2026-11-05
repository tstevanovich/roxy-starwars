import { expect, test } from 'vitest';

import { inquisitorBrief, inquisitorKey } from './old-republic.ts';

test('the separate Inquisitor continuity retains its source and native video policy', () => {
  expect(inquisitorKey).toBe('old-republic-sith-inquisitor');
  expect(inquisitorBrief).toContain('ojIORTFv7WU');
  expect(inquisitorBrief).toContain('Wan 3.0 Standard 1080p');
  expect(inquisitorBrief).toContain('Entirely cinematic');
});
