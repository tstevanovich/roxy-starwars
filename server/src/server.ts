import mongoose from 'mongoose';

import { toError } from '../../shared/errors.ts';
import { createApp } from './app.ts';
import { connectDatabase } from './db.ts';

const port = Number(process.env.PORT || 5000);
const host = process.env.HOST || '127.0.0.1';
let server;
let assistant;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}. Closing the server.`);
  const timer = setTimeout(() => process.exit(1), 10000).unref();
  try {
    await assistant.stop();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await mongoose.disconnect();
    clearTimeout(timer);
  } catch (caughtError) {
    const error = toError(caughtError);
    console.error('Shutdown failed:', error.message);
    process.exitCode = 1;
  }
}

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be between 1 and 65535.');
  await connectDatabase(process.env.MONGODB_URI);
  const app = createApp({ serveClient: process.env.NODE_ENV === 'production' });
  assistant = app.locals.assistant;
  server = app.listen(port, host, () => {
    console.log(`API ready at http://${host}:${port}`);
    assistant.start().catch(() => console.error('Production chat worker could not start.'));
  });
  server.on('error', async (error) => {
    console.error('Server failed to start:', error.message);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
} catch (caughtError) {
  const error = toError(caughtError);
  console.error('Startup failed:', error.message);
  await mongoose.disconnect();
  process.exitCode = 1;
}
