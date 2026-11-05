import { expect, test, vi } from 'vitest';

import { StudioAsset, StudioSettings } from './models/Studio.ts';
import { runProjectContext } from './project-context.ts';
import { seedStudio } from './studio-seed.ts';

vi.mock('./models/Studio.ts', () => ({
  StudioAsset: { bulkWrite: vi.fn() },
  StudioSettings: { updateOne: vi.fn() }
}));
test('starter seeding inserts missing legacy records without replacing saved creative edits', async () => {
  await runProjectContext({ key: 'imperial-smuggler' }, seedStudio);
  const writes = vi.mocked(StudioAsset.bulkWrite).mock.calls[0][0];
  expect(writes.length).toBeGreaterThan(0);
  for (const write of writes) {
    expect('updateOne' in write).toBe(true);
    if ('updateOne' in write) expect(Object.keys(write.updateOne.update)).toEqual(['$setOnInsert']);
  }
  expect(StudioSettings.updateOne).toHaveBeenCalledWith(
    { key: 'series' },
    expect.objectContaining({
      $setOnInsert: expect.objectContaining({
        videoGeneration: expect.objectContaining({ resolution: '1080p' })
      })
    }),
    expect.objectContaining({ upsert: true })
  );
});
