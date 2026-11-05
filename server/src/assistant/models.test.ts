import { expect, test } from 'vitest';

import { Job, Message, Run, SourceGrant } from './models.ts';

test('job and message identity indexes prevent duplicate submissions and source grants expire', () => {
  expect(Job.schema.indexes().some(([keys, options]) => keys.requestId && options.unique)).toBe(
    true
  );
  expect(Message.schema.indexes().some(([keys, options]) => keys.requestId && options.unique)).toBe(
    true
  );
  expect(SourceGrant.schema.indexes().some(([, options]) => options.expireAfterSeconds === 0)).toBe(
    true
  );
  expect(new Run({ chatId: '111111111111111111111111', status: 'preparing' }).status).toBe(
    'preparing'
  );
});
