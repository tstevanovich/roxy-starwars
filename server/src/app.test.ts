import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterEach, expect, test, vi } from 'vitest';

import { createApp } from './app.ts';

vi.mock('./assistant/index.ts', () => ({
  createAssistant: vi.fn(() => ({ publicRouter: express.Router(), router: express.Router() }))
}));
vi.mock('./auth.ts', () => ({
  securityHeaders: (_req, _res, next) => next(),
  createAuth: () => ({ router: express.Router(), protect: (_req, _res, next) => next() })
}));
vi.mock('./projects.ts', () => ({ projectMiddleware: (_req, _res, next) => next() }));
vi.mock('./routes/studio.ts', () => {
  const router = express.Router();
  router.get('/validation', () => {
    throw Object.assign(new Error('bad'), { name: 'ValidationError' });
  });
  router.get('/conflict', () => {
    throw Object.assign(new Error('Changed'), { status: 409 });
  });
  router.get('/unexpected', () => {
    throw new Error('private detail');
  });
  return { createStudioRouter: () => router };
});
afterEach(() => vi.restoreAllMocks());

test('health reports database availability, API errors stay JSON, and request parsing is bounded', async () => {
  const app = createApp();
  vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
  expect((await request(app).get('/api/health')).body).toEqual({
    status: 'ok',
    database: 'connected'
  });
  vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(0);
  expect((await request(app).get('/api/health')).status).toBe(503);
  expect((await request(app).get('/api/missing')).body.message).toBe('API route not found.');
  expect((await request(app).get('/missing')).status).toBe(404);
  expect(
    (await request(app).post('/api/missing').set('Content-Type', 'application/json').send('{')).body
      .message
  ).toBe('Invalid JSON body.');
  expect(
    (
      await request(app)
        .post('/api/missing')
        .send({ text: 'x'.repeat(17000) })
    ).status
  ).toBe(413);
  expect((await request(app).get('/api/studio/validation')).body.message).toBe('Invalid data.');
  expect((await request(app).get('/api/studio/conflict')).status).toBe(409);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await request(app).get('/api/studio/unexpected')).body.message).toBe(
    'An unexpected server error occurred.'
  );
  expect(log).toHaveBeenCalled();
});

test('production serves the application without caching HTML or exposing dotfiles', async () => {
  const html = '<html><script src="/app.js"></script></html>';
  vi.spyOn(express, 'static').mockImplementation((_root, options) => (_req, res, next) => {
    if (_req.url === '/') {
      options.setHeaders(res, 'index.html', undefined);
      res.send(html);
    } else if (_req.url === '/app.js') {
      options.setHeaders(res, 'app.js', undefined);
      res.send('fixture application');
    } else next();
  });
  vi.spyOn(express.response, 'sendFile').mockImplementation(function () {
    this.send(html);
    return this;
  });
  const app = createApp({ serveClient: true, auth: false });
  expect((await request(app).get('/%FF')).status).toBe(400);
  expect((await request(app).get('/.env')).status).toBe(404);
  expect((await request(app).get('/nested/%2Esecret')).status).toBe(404);
  expect((await request(app).get('/missing.js')).status).toBe(404);
  expect((await request(app).get('/episode').set('Accept', 'application/json')).status).toBe(404);
  const home = await request(app).get('/');
  expect(home.status).toBe(200);
  expect(home.headers['cache-control']).toBe('no-store');
  const route = await request(app).get('/episode').set('Accept', 'text/html');
  expect(route.status).toBe(200);
  expect(route.headers['cache-control']).toBe('no-store');
  const asset = /src="([^"]+\.js)"/.exec(home.text)?.[1];
  expect(asset).toBeTruthy();
  expect((await request(app).get(asset)).status).toBe(200);
});
