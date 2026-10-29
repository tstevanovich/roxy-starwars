import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import mongoose from 'mongoose';

import { createAssistant } from './assistant/index.js';
import { createAuth, securityHeaders } from './auth.js';
import { projectMiddleware } from './projects.js';
import { createStudioRouter } from './routes/studio.js';
import { tasksRouter } from './routes/tasks.js';

const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));

export function createApp({ serveClient = false, mediaDirectory, auth = {}, assistant = {} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Only our loopback tunnel/Vite proxy may supply forwarding headers.
  app.set('trust proxy', 'loopback');
  app.use(securityHeaders);
  const studioAssistant = createAssistant({
    mediaDirectory,
    ownerPath: auth?.ownerPath,
    ...assistant
  });
  app.locals.assistant = studioAssistant;
  app.use('/api/assistant', studioAssistant.publicRouter);
  if (auth !== false) {
    const authentication = createAuth(auth);
    app.use('/api/auth', authentication.router);
    app.use('/api', authentication.protect);
  }
  app.use('/api/studio', projectMiddleware);
  app.use('/api/studio/assistant', studioAssistant.router);
  app.use('/api/studio', createStudioRouter({ mediaDirectory }));
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => {
    const connected = mongoose.connection.readyState === 1;
    res.status(connected ? 200 : 503).json({
      status: connected ? 'ok' : 'unavailable',
      database: connected ? 'connected' : 'disconnected'
    });
  });
  app.use('/api/tasks', tasksRouter);
  app.use('/api', (_req, res) => res.status(404).json({ message: 'API route not found.' }));

  if (serveClient) {
    app.use((req, res, next) => {
      let pathname;
      try {
        pathname = decodeURIComponent(req.path);
      } catch {
        return res.status(400).json({ message: 'Invalid URL.' });
      }
      if (pathname.split('/').some((segment) => segment.startsWith('.')))
        return res.status(404).json({ message: 'Route not found.' });
      next();
    });
    app.use(express.static(clientDist));
    app.get('/{*path}', (req, res, next) => {
      if (!req.accepts('html') || path.extname(req.path)) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
  app.use((_req, res) => res.status(404).json({ message: 'Route not found.' }));
  // Express requires all four parameters to recognize an error handler.
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ message: 'Invalid JSON body.' });
    if (error.type === 'entity.too.large')
      return res.status(413).json({ message: 'Request body is too large.' });
    if (error.name === 'ValidationError')
      return res.status(400).json({ message: 'Invalid task data.' });
    if (error.status === 409) return res.status(409).json({ message: error.message });
    console.error(error);
    res.status(500).json({ message: 'An unexpected server error occurred.' });
  });
  return app;
}
