import assert from 'node:assert/strict';

import { test } from 'vitest';

import { toError } from './errors.ts';

test('nonstandard error objects receive a useful fallback message', () => {
  const failure = toError({ code: 'failure' });
  assert.equal(failure.message, '[object Object]');
  assert.equal(failure.code, 'failure');
});

test('error normalization retains a native error and provider metadata', () => {
  const failure = Object.assign(new Error('Connection interrupted'), {
    status: 502,
    providerCode: 'interrupted_response'
  });
  assert.equal(toError(failure), failure);
  assert.equal(toError(failure).providerCode, 'interrupted_response');
});

test('plain error records retain the fields used by workflow recovery', () => {
  const failure = toError({ message: 'File missing', code: 'ENOENT', status: 404 });
  assert.ok(failure instanceof Error);
  assert.equal(failure.message, 'File missing');
  assert.equal(failure.code, 'ENOENT');
  assert.equal(failure.status, 404);
});

test('non-object rejections have a usable message', () => {
  assert.equal(toError('Disconnected').message, 'Disconnected');
  assert.equal(toError(null).message, 'null');
});
