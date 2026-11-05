import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

import { MongoClient, MongoNetworkError } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

const defaultDataPath = fileURLToPath(new URL('../.data/mongodb/', import.meta.url));

function isListening(port: number) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (connected) => {
      socket.destroy();
      resolve(connected);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

export async function prepareDevelopmentDatabase(
  uri: string,
  { dbPath = defaultDataPath, port = 27017, log = console.log } = {}
) {
  if (!uri) {
    throw new Error('MONGODB_URI is required. Copy server/.env.example to server/.env.');
  }

  const defaultUris = [
    `mongodb://127.0.0.1:${port}/roxy-starwars`,
    `mongodb://localhost:${port}/roxy-starwars`
  ];
  const unmanaged = { managed: false, stop: async () => {} };

  if (!defaultUris.includes(uri)) {
    log('[db] Using the configured MongoDB connection; no local database was started.');
    return unmanaged;
  }
  if (await isListening(port)) {
    log(`[db] Reusing the existing database on port ${port}.`);
    return unmanaged;
  }

  await mkdir(dbPath, { recursive: true });
  const database = new MongoMemoryServer({
    // Pin the binary so dependency updates cannot silently upgrade persisted data.
    binary: { version: '8.2.6' },
    instance: {
      ip: '127.0.0.1',
      port,
      portGeneration: false,
      dbPath,
      storageEngine: 'wiredTiger'
    }
  });
  await database.start(true);
  log(`[db] MongoDB ready on 127.0.0.1:${port}. Data: ${dbPath}`);

  let stopped = false;
  return {
    managed: true,
    async stop() {
      if (stopped) return;
      stopped = true;
      const child = database.instanceInfo?.instance.mongodProcess;
      const client = new MongoClient(database.getUri('admin'), {
        directConnection: true,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 10000
      });
      try {
        await client.connect();
        // On Windows, killing a process with SIGINT is an immediate termination.
        // Flush writes and ask MongoDB itself to shut down before stopping its wrapper.
        await client.db('admin').command({ fsync: 1 });
        try {
          await client.db('admin').command({ shutdown: 1, timeoutSecs: 1 });
        } catch (error) {
          // MongoDB closes the command's connection as part of a successful shutdown.
          if (!(error instanceof MongoNetworkError)) throw error;
        }
        if (child && child.exitCode === null && child.signalCode === null) {
          await once(child, 'exit', { signal: AbortSignal.timeout(10000) });
        }
      } finally {
        await client.close();
        // This directory contains application data. Never clean it up on shutdown.
        await database.stop({ doCleanup: false, force: false });
      }
    }
  };
}
