import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

import { connectDatabase } from '../server/src/db.js';
import { Task } from '../server/src/models/Task.js';
import { prepareDevelopmentDatabase } from './local-database.mjs';

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

test('local development records survive shutdown and restart', { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'roxy-starwars-db-test-'));
  const port = await availablePort();
  const uri = `mongodb://127.0.0.1:${port}/roxy-starwars`;
  const options = { dbPath: directory, port, log: () => {} };
  let database;
  t.after(async () => {
    await Task.db.close();
    await database?.stop();
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(target.includes('roxy-starwars-db-test-'));
    await rm(target, { recursive: true, force: true });
  });

  database = await prepareDevelopmentDatabase(uri, options);
  assert.equal(database.managed, true);
  await connectDatabase(uri);
  await Task.create({ title: 'Keep this task after restarting' });

  const reused = await prepareDevelopmentDatabase(uri, options);
  assert.equal(reused.managed, false);
  await reused.stop();
  assert.equal(await Task.countDocuments(), 1);

  await Task.db.close();
  await database.stop();
  assert.ok((await readdir(directory)).includes('WiredTiger'));

  database = await prepareDevelopmentDatabase(uri, options);
  await connectDatabase(uri);
  assert.equal((await Task.findOne()).title, 'Keep this task after restarting');
});

test('configured external databases are left to the application', async () => {
  const database = await prepareDevelopmentDatabase('mongodb+srv://example.invalid/roxy-starwars', {
    log: () => {}
  });
  assert.equal(database.managed, false);
  await database.stop();
});

test('missing configuration fails before launching a database', async () => {
  await assert.rejects(prepareDevelopmentDatabase(undefined), /MONGODB_URI is required/);
});
