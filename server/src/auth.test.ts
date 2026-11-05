import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';

import { createApp } from './app.ts';
import { AuthLimit, AuthSession } from './auth.ts';
import { connectDatabase } from './db.ts';
import { hashPassword, hashToken, readOwner, writeOwner } from './owner.ts';

let directory: string,
  mongo: MongoMemoryServer,
  ownerPath,
  remotePath,
  app: ReturnType<typeof createApp>,
  owner;
const origin = 'http://127.0.0.1:5173',
  password = 'A test passphrase with 30 characters';
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'roxy-auth-test-'));
  ownerPath = join(directory, 'owner.json');
  remotePath = join(directory, 'remote.json');
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri('auth_test'));
  owner = {
    username: 'tony',
    ...(await hashPassword(password)),
    version: randomUUID(),
    createdAt: new Date().toISOString()
  };
  app = createApp({ auth: { ownerPath, remotePath } });
}, 180000);
beforeEach(async () => {
  await Promise.all([AuthSession.deleteMany({}), AuthLimit.deleteMany({})]);
  await writeFile(ownerPath, JSON.stringify(owner));
  await rm(remotePath, { force: true });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
  assert.ok(
    resolve(directory).startsWith(resolve(tmpdir()) + '\\') ||
      resolve(directory).startsWith(resolve(tmpdir()) + '/')
  );
  await rm(directory, { recursive: true, force: true });
});
async function signIn(agent = request.agent(app)) {
  const login = await agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ username: 'tony', password })
    .expect(200);
  return {
    agent,
    csrf: login.body.csrfToken,
    cookie: login.headers['set-cookie'][0].split(';')[0]
  };
}
test('records, media GET/HEAD/ranges, imports and exports require authentication before any route runs', async () => {
  const session = await request(app).get('/api/auth/session').expect(200);
  assert.deepEqual(session.body, { authenticated: false, configured: true });
  for (const path of [
    '/api/studio',
    '/api/studio/assets',
    '/api/health',
    '/api/studio/media/6ad567d9974aa9ed7dfec641',
    '/api/studio/episodes/6ad42f7f1f1c334a521803f5/export'
  ])
    await request(app).get(path).expect(401);
  await request(app)
    .head('/api/studio/media/6ad567d9974aa9ed7dfec641')
    .set('Range', 'bytes=0-4')
    .expect(401);
  await request(app)
    .post('/api/studio/media')
    .set('Content-Type', 'application/octet-stream')
    .send(Buffer.alloc(10))
    .expect(401);
});

test('authentication rejects malformed bodies and rotates an existing local login session', async () => {
  for (const body of [
    undefined,
    { username: 1, password },
    { username: 'tony', password: 1 },
    { username: 'tony', password: 'x'.repeat(1025) }
  ])
    await request(app).post('/api/auth/login').set('Origin', origin).send(body).expect(401);
  await request(app).post('/api/auth/activate').set('Origin', origin).expect(403);
  const session = await signIn();
  await session.agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ username: 'tony', password })
    .expect(200);
  assert.equal(await AuthSession.countDocuments(), 1);
  const current = await signIn();
  for (const body of [
    undefined,
    { currentPassword: 'wrong', password },
    { currentPassword: password, password: 'short' }
  ]) {
    const result = await current.agent
      .post('/api/auth/password')
      .set('Origin', origin)
      .set('X-CSRF-Token', current.csrf)
      .send(body);
    assert.equal(result.status, body?.currentPassword === 'wrong' ? 401 : 400);
  }
});
test('malformed remote configuration fails closed and empty configuration preserves local-origin access', async () => {
  await writeFile(remotePath, '{');
  await request(app)
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ username: 'tony', password })
    .expect(403);
  await writeFile(remotePath, '{}');
  await request(app)
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ username: 'tony', password })
    .expect(200);
  await request(app).get('/api/auth/session').set('Cookie', 'roxy_session').expect(200);
});
test('secure logout clears the secure host cookie after validating its CSRF token', async () => {
  const login = await request(app)
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('X-Forwarded-Proto', 'https')
    .send({ username: 'tony', password })
    .expect(200);
  const logout = await request(app)
    .post('/api/auth/logout')
    .set('Origin', origin)
    .set('X-Forwarded-Proto', 'https')
    .set('Cookie', login.headers['set-cookie'][0].split(';')[0])
    .set('X-CSRF-Token', login.body.csrfToken)
    .expect(204);
  assert.match(logout.headers['set-cookie'][0], /__Host-roxy_session=/);
});
test('successful login stores only a token hash and cookie cannot be read by browser JavaScript', async () => {
  const agent = request.agent(app),
    login = await agent
      .post('/api/auth/login')
      .set('Origin', origin)
      .send({ username: 'tony', password })
      .expect(200);
  const cookie = login.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.ok(!cookie.includes('Domain='));
  const token = cookie.split(';')[0].split('=')[1],
    stored = await AuthSession.findOne().lean();
  assert.equal(stored.tokenHash, hashToken(token));
  assert.ok(!JSON.stringify(stored).includes(token));
  const current = await agent.get('/api/auth/session').expect(200);
  assert.equal(current.body.authenticated, true);
  assert.equal(current.body.csrfToken, login.body.csrfToken);
  await agent.get('/api/health').expect(200);
  assert.equal(login.headers['cache-control'], 'private, no-store');
  assert.equal(login.headers['x-frame-options'], 'DENY');
});
test('writes need both the session CSRF token and a configured browser origin', async () => {
  const { agent, csrf } = await signIn();
  await agent.post('/api/studio/assets').send({ title: 'blocked' }).expect(403);
  await agent
    .post('/api/studio/assets')
    .set('Origin', origin)
    .set('X-CSRF-Token', 'wrong')
    .send({ title: 'blocked' })
    .expect(403);
  await agent
    .post('/api/studio/assets')
    .set('Origin', 'https://evil.example')
    .set('X-CSRF-Token', csrf)
    .send({ title: 'blocked' })
    .expect(403);
  await agent
    .post('/api/studio/assets')
    .set('Origin', origin)
    .set('Sec-Fetch-Site', 'cross-site')
    .set('X-CSRF-Token', csrf)
    .send({ title: 'blocked' })
    .expect(403);
  await agent
    .post('/api/studio/assets')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrf)
    .send({ name: 'Owner prop', kind: 'prop' })
    .expect(201);
  await request(app)
    .post('/api/auth/login')
    .set('Origin', 'https://evil.example')
    .send({ username: 'tony', password })
    .expect(403);
});
test('logout revokes the original token; expired sessions and malformed cookies fail closed', async () => {
  const { agent, csrf, cookie } = await signIn();
  await agent.post('/api/auth/logout').set('Origin', origin).set('X-CSRF-Token', csrf).expect(204);
  await request(app).get('/api/health').set('Cookie', cookie).expect(401);
  const next = await signIn();
  await AuthSession.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await next.agent.get('/api/health').expect(401);
  await request(app).get('/api/health').set('Cookie', 'roxy_session=garbage').expect(401);
});
test('one-time owner activation consumes its secret and invalidates every previous session', async () => {
  const { agent } = await signIn(),
    token = randomBytes(32).toString('base64url');
  await writeFile(
    ownerPath,
    JSON.stringify({
      ...owner,
      inviteHash: hashToken(token),
      inviteExpiresAt: new Date(Date.now() + 60000).toISOString()
    })
  );
  await request(app)
    .post('/api/auth/activate')
    .set('Origin', origin)
    .send({ token: 'bad', password })
    .expect(403);
  await request(app)
    .post('/api/auth/activate')
    .set('Origin', origin)
    .send({ token, password: 'short' })
    .expect(400);
  const activated = await request(app)
    .post('/api/auth/activate')
    .set('Origin', origin)
    .send({ token, password: 'My new owner passphrase for testing' })
    .expect(200);
  assert.equal(activated.body.username, 'tony');
  assert.ok(!(await readOwner(ownerPath)).inviteHash);
  await agent.get('/api/health').expect(401);
  await request(app)
    .post('/api/auth/activate')
    .set('Origin', origin)
    .send({ token, password })
    .expect(403);
  await request(app)
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ username: 'tony', password })
    .expect(401);
});
test('expired invitation cannot activate and no public owner registration exists', async () => {
  const token = randomBytes(32).toString('base64url');
  await writeFile(
    ownerPath,
    JSON.stringify({
      ...owner,
      inviteHash: hashToken(token),
      inviteExpiresAt: new Date(Date.now() - 1).toISOString()
    })
  );
  await request(app)
    .post('/api/auth/activate')
    .set('Origin', origin)
    .send({ token, password })
    .expect(403);
  await request(app).post('/api/auth/register').send({ username: 'another', password }).expect(401);
});
test('HTTPS tunnel uses a secure Host cookie and accepts only the registered public origin', async () => {
  const remoteOrigin = 'https://test-studio.trycloudflare.com';
  await writeFile(remotePath, JSON.stringify({ origin: remoteOrigin }));
  const login = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-Proto', 'https')
    .set('Origin', remoteOrigin)
    .send({ username: 'tony', password })
    .expect(200);
  const cookie = login.headers['set-cookie'][0];
  assert.ok(cookie.startsWith('__Host-roxy_session='));
  assert.match(cookie, /; Secure/);
  assert.equal(login.headers['strict-transport-security'], 'max-age=31536000');
  await request(app)
    .get('/api/health')
    .set('X-Forwarded-Proto', 'https')
    .set('Cookie', cookie.split(';')[0])
    .expect(200);
  await request(app).get('/api/health').set('Cookie', cookie.split(';')[0]).expect(401);
  await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-Proto', 'https')
    .set('Origin', 'https://other.trycloudflare.com')
    .send({ username: 'tony', password })
    .expect(403);
});
test('password change and local owner recovery invalidate all older sessions', async () => {
  const first = await signIn(),
    second = await signIn();
  await first.agent
    .post('/api/auth/password')
    .set('Origin', origin)
    .set('X-CSRF-Token', first.csrf)
    .send({ currentPassword: password, password: 'Changed owner password for testing' })
    .expect(200);
  await second.agent.get('/api/health').expect(401);
  await first.agent.get('/api/health').expect(200);
  const current = await readOwner(ownerPath);
  await writeOwner(ownerPath, { ...current, version: randomUUID() }, current.version);
  await first.agent.get('/api/health').expect(401);
});
test('login throttles repeated attempts without allowing spoofed client values to bypass global limits', async () => {
  const window = Math.floor(Date.now() / 900000);
  await AuthLimit.create({
    key: window + ':global',
    count: 60,
    expiresAt: new Date(Date.now() + 100000)
  });
  const denied = await request(app)
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('X-Forwarded-For', '192.0.2.55')
    .send({ username: 'tony', password })
    .expect(429);
  assert.ok(denied.headers['retry-after']);
});
test('missing owner keeps the API locked and bad credentials never expose configuration', async () => {
  await rm(ownerPath);
  await request(app).get('/api/health').expect(401);
  const missing = await request(app)
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ username: 'tony', password })
    .expect(503);
  assert.ok(!JSON.stringify(missing.body).includes(directory));
  const current = await request(app).get('/api/auth/session').expect(200);
  assert.equal(current.body.configured, false);
  await writeFile(ownerPath, JSON.stringify(owner));
  const bad = await request(app)
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ username: 'tony', password: 'incorrect' })
    .expect(401);
  assert.deepEqual(bad.body, { message: 'The username or password is incorrect.' });
  assert.ok(!(await readFile(ownerPath, 'utf8')).includes(password));
});

test('the production web server never serves hidden configuration paths as app pages', async () => {
  const production = createApp({ serveClient: true, auth: { ownerPath, remotePath } });
  for (const path of ['/server/.env', '/server/%2eenv', '/.data/private/owner.json'])
    await request(production).get(path).expect(404);
});
