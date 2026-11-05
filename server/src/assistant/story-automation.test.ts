import { expect, test, vi } from 'vitest';

import { Chat, Run } from './models.ts';
import { createStoryQueue } from './story-automation.ts';

vi.mock('./models.ts', () => ({ Chat: { findOneAndUpdate: vi.fn() }, Run: { findOne: vi.fn() } }));
test('a durable story request reuses its existing run without reconnecting or creating a message', async () => {
  vi.mocked(Chat.findOneAndUpdate).mockReturnValue({
    lean: async () => ({ _id: 'chat' })
  } as never);
  vi.mocked(Run.findOne).mockReturnValue({
    lean: async () => ({ _id: 'run', status: 'queued' })
  } as never);
  const ready = vi.fn();
  expect(
    await createStoryQueue({ ready })({ requestId: 'request', kind: 'story-outline', target: {} })
  ).toEqual({ _id: 'run', status: 'queued' });
  expect(ready).not.toHaveBeenCalled();
});
