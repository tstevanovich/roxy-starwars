import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import mongoose from 'mongoose';

import { tasksRouter } from './routes/tasks.js';

const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));

export function createApp({ serveClient = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
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
    console.error(error);
    res.status(500).json({ message: 'An unexpected server error occurred.' });
  });
  return app;
}
