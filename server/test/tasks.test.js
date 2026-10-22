import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { connectDatabase } from '../src/db.js';
import { Task } from '../src/models/Task.js';

let mongo;
const app = createApp({ auth: false });

before(
  async () => {
    mongo = await MongoMemoryServer.create();
    await connectDatabase(mongo.getUri('roxy_starwars_test'));
  },
  { timeout: 180000 }
);
beforeEach(async () => {
  await Task.deleteMany({});
});
after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test('health reports the database connection', async () => {
  const response = await request(app).get('/api/health').expect(200);
  assert.deepEqual(response.body, { status: 'ok', database: 'connected' });
});

test('tasks persist through create, list, update, and delete', async () => {
  const created = await request(app)
    .post('/api/tasks')
    .send({ title: '  Build my app  ' })
    .expect(201);
  const id = created.body.task._id;
  assert.equal(created.body.task.title, 'Build my app');
  assert.equal(created.body.task.completed, false);
  assert.equal(await Task.countDocuments(), 1);

  const listed = await request(app).get('/api/tasks').expect(200);
  assert.equal(listed.body.tasks[0]._id, id);
  const updated = await request(app)
    .patch(`/api/tasks/${id}`)
    .send({ completed: true, title: 'Shipped' })
    .expect(200);
  assert.equal(updated.body.task.completed, true);
  assert.equal((await Task.findById(id)).title, 'Shipped');

  await request(app).delete(`/api/tasks/${id}`).expect(204);
  assert.equal(await Task.countDocuments(), 0);
});

test('rejects invalid input and update operators without writing data', async () => {
  for (const body of [
    {},
    { title: '' },
    { title: 'a'.repeat(201) },
    { title: 5 },
    { title: 'Task', completed: 'true' },
    { title: 'Task', $set: { completed: true } }
  ]) {
    await request(app).post('/api/tasks').send(body).expect(400);
  }
  const task = await Task.create({ title: 'Keep me' });
  for (const body of [{}, { title: ' ' }, { completed: null }, { $unset: { title: '' } }]) {
    await request(app).patch(`/api/tasks/${task.id}`).send(body).expect(400);
  }
  assert.equal((await Task.findById(task.id)).title, 'Keep me');
  assert.equal(await Task.countDocuments(), 1);
});

test('distinguishes invalid IDs, missing tasks, and unknown routes', async () => {
  await request(app).delete('/api/tasks/not-an-id').expect(400);
  const missingId = new mongoose.Types.ObjectId().toString();
  await request(app).delete(`/api/tasks/${missingId}`).expect(404);
  await request(app).patch(`/api/tasks/${missingId}`).send({ completed: true }).expect(404);
  const response = await request(app).get('/api/missing').expect(404);
  assert.equal(response.body.message, 'API route not found.');
});

test('returns JSON errors for malformed and oversized requests', async () => {
  await request(app)
    .post('/api/tasks')
    .set('Content-Type', 'application/json')
    .send('{')
    .expect(400);
  await request(app)
    .post('/api/tasks')
    .send({ title: 'a'.repeat(20000) })
    .expect(413);
});
