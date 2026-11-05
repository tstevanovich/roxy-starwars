import mongoose from 'mongoose';
import { afterEach, expect, test, vi } from 'vitest';

import { connectDatabase } from './db.ts';

afterEach(() => vi.restoreAllMocks());
test('database startup requires an explicit URI and bounds connection selection time', async () => {
  const connect = vi.spyOn(mongoose, 'connect').mockResolvedValue(mongoose);
  await expect(connectDatabase('')).rejects.toThrow('MONGODB_URI is required');
  expect(connect).not.toHaveBeenCalled();
  await connectDatabase('mongodb://fixture/studio');
  expect(connect).toHaveBeenCalledWith('mongodb://fixture/studio', {
    serverSelectionTimeoutMS: 5000
  });
  connect.mockRejectedValueOnce(new Error('Database unavailable'));
  await expect(connectDatabase('mongodb://fixture/studio')).rejects.toThrow('Database unavailable');
});
