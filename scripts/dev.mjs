import { fileURLToPath } from 'node:url';

import { concurrently } from 'concurrently';

import { prepareDevelopmentDatabase } from './local-database.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function run() {
  let database;
  let apps;
  let stopping = false;

  const stop = () => {
    if (stopping) return;
    stopping = true;
    apps?.commands.forEach((command) => command.kill('SIGTERM'));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    database = await prepareDevelopmentDatabase(process.env.MONGODB_URI);
    if (stopping) return;

    apps = concurrently(
      [
        { command: 'npm run dev --workspace server', name: 'api' },
        { command: 'npm run dev --workspace client', name: 'web' }
      ],
      { cwd: projectRoot, prefix: 'name', killOthersOn: ['failure', 'success'] }
    );
    try {
      await apps.result;
    } catch {
      if (!stopping)
        throw new Error('A development process stopped. Check the api/web output above.');
    }
  } finally {
    if (database?.managed) {
      await database.stop();
      console.log('[db] MongoDB stopped. Application data is preserved in .data/mongodb.');
    }
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

run().catch((error) => {
  console.error(`[dev] ${error.message}`);
  process.exitCode = 1;
});
