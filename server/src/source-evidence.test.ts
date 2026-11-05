import { expect, test, vi } from 'vitest';

import { StudioSourceEvidence } from './models/Studio.ts';
import { sourceEvidence } from './source-evidence.ts';

vi.mock('./models/Studio.ts', () => ({ StudioSourceEvidence: { find: vi.fn() } }));
test('a packet cannot survive a change to its source URL or original time range', async () => {
  const reference = {
    id: 'source',
    url: 'https://example.org/source',
    startSeconds: 1,
    endSeconds: 3
  };
  const packet = { sourceId: 'source', sourceUrl: reference.url, startSeconds: 1, endSeconds: 3 };
  vi.mocked(StudioSourceEvidence.find).mockReturnValue({
    lean: async () => [
      packet,
      { ...packet, sourceUrl: 'https://example.org/other' },
      { ...packet, endSeconds: 4 }
    ]
  } as never);
  expect(await sourceEvidence({ _id: 'episode', sourceReferences: [reference] })).toEqual([packet]);
});
