import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  defaultOwnerPath,
  hashPassword,
  hashToken,
  readOwner,
  writeOwner
} from '../server/src/owner.js';
import { securePrivateDirectory } from './private-files.mjs';

const ownerPath = defaultOwnerPath;
const existing = await readOwner(ownerPath);
const reset = process.argv.includes('--reset');
if (existing && !reset) {
  console.log(
    'The single owner account already exists. Use --reset locally to create a new one-time recovery link and revoke existing sessions.'
  );
} else {
  const password = randomBytes(32).toString('base64url');
  const invite = randomBytes(32).toString('base64url');
  const owner = {
    username: 'tony',
    ...(await hashPassword(password)),
    version: randomUUID(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    inviteHash: hashToken(invite),
    inviteExpiresAt: new Date(Date.now() + 24 * 3600000).toISOString()
  };
  await mkdir(dirname(ownerPath), { recursive: true, mode: 0o700 });
  await securePrivateDirectory(dirname(ownerPath));
  await writeOwner(ownerPath, owner, existing?.version ?? null);
  await writeFile(join(dirname(ownerPath), 'setup-token.txt'), invite, { mode: 0o600 });
  // This local recovery password is never printed, committed or included in web responses.
  await writeFile(
    join(dirname(ownerPath), 'owner-access.txt'),
    'Username: tony\nTemporary local recovery password: ' +
      password +
      '\n\nUse the one-time setup link to set your own password. The temporary password then stops working.\nLocal setup: http://127.0.0.1:5000/#setup=' +
      invite +
      '\nLocal development setup: http://127.0.0.1:5173/#setup=' +
      invite +
      '\nExpires: ' +
      owner.inviteExpiresAt +
      '\n',
    { mode: 0o600 }
  );
  console.log(
    'Owner account prepared. Local setup instructions: .data/private/owner-access.txt. Passwords and one-time tokens were not printed.'
  );
  // Ensure all files are readable before reporting a successful setup.
  await readFile(ownerPath);
}
