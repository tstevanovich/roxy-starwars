import { beforeEach, expect, test, vi } from 'vitest';

import { existingCharacterAsset } from './asset-identity.ts';
import { StudioAsset } from './models/Studio.ts';

vi.mock('./models/Studio.ts', () => ({ StudioAsset: { find: vi.fn() } }));
beforeEach(() => {
  vi.mocked(StudioAsset.find).mockReset();
});

test('shot assets and non-character designs never reuse a character identity', async () => {
  expect(await existingCharacterAsset({ kind: 'character', clipId: 'shot' })).toBeNull();
  expect(await existingCharacterAsset({ kind: 'prop' })).toBeNull();
  expect(StudioAsset.find).not.toHaveBeenCalled();
});

test('identity lookup normalizes labels and aliases while preferring approved identities and then the oldest match', async () => {
  const records = [
    { _id: 'new-draft', name: 'AL-1B - Production package', createdAt: '2026-01-03' },
    {
      _id: 'new-approved',
      name: 'Another name',
      aliases: ['AL-1B'],
      finalChoice: {},
      createdAt: '2026-01-02'
    },
    { _id: 'old-approved', name: 'AL-1B', finalChoice: {}, createdAt: '2026-01-01' },
    { _id: 'unrelated', name: null }
  ];
  vi.mocked(StudioAsset.find).mockReturnValue({
    lean: async () => records
  } as unknown as ReturnType<typeof StudioAsset.find>);
  expect(
    await existingCharacterAsset({
      kind: 'droid',
      name: '  AL-1B: reference package  ',
      aliases: [null]
    })
  ).toEqual(records[2]);
  expect(StudioAsset.find).toHaveBeenCalledWith({
    kind: 'droid',
    archived: { $ne: true },
    clipId: null
  });
  expect(await existingCharacterAsset({ kind: 'character', name: 'Missing' })).toBeNull();
});
