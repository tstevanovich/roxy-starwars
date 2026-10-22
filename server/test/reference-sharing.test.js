import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { referenceSharing } from '../src/assistant/reference-sharing.js';

test('public tunnel sharing is independent of a localhost OAuth callback and follows tunnel changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'roxy-sharing-'));
  const remotePath = join(directory, 'remote.json');
  const options = {
    publicOrigin: '',
    remotePath,
    redirectUrl: 'http://127.0.0.1:5000/api/assistant/oauth/openart/callback'
  };
  try {
    assert.equal((await referenceSharing(options)).ready, false);
    await writeFile(remotePath, JSON.stringify({ origin: 'https://first.trycloudflare.com' }));
    assert.equal((await referenceSharing(options)).origin, 'https://first.trycloudflare.com');
    await writeFile(remotePath, JSON.stringify({ origin: 'https://next.trycloudflare.com' }));
    assert.equal(
      (await referenceSharing({ ...options, redirectUrl: 'https://old.example.com/callback' }))
        .origin,
      'https://next.trycloudflare.com'
    );
    assert.equal(
      (await referenceSharing({ ...options, publicOrigin: 'https://studio.example.com' })).origin,
      'https://studio.example.com'
    );
    await writeFile(remotePath, '{broken');
    assert.equal((await referenceSharing(options)).ready, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reference sharing rejects local, insecure or credential-bearing public origins', async () => {
  for (const publicOrigin of [
    'http://studio.example.com',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://host.local',
    'https://host.localhost',
    'https://user:password@studio.example.com',
    'https://studio.example.com/path',
    'https://studio.example.com?query=1',
    'https://studio.example.com#fragment'
  ]) {
    assert.equal((await referenceSharing({ publicOrigin })).ready, false, publicOrigin);
  }
});
