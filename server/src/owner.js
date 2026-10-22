import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual
} from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const defaultOwnerPath = fileURLToPath(
  new URL('../../.data/private/owner.json', import.meta.url)
);
export const hashToken = (value) => createHash('sha256').update(value).digest('hex');
export function equalSecret(a, b) {
  const left = Buffer.from(a ?? ''),
    right = Buffer.from(b ?? '');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
export async function hashPassword(password) {
  const salt = randomBytes(24).toString('hex');
  const key = await scrypt(password, salt, 64, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024
  });
  return { salt, hash: key.toString('hex') };
}
export async function verifyPassword(password, owner) {
  const key = await scrypt(password, owner.salt, 64, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024
  });
  return equalSecret(key.toString('hex'), owner.hash);
}
export async function readOwner(ownerPath = defaultOwnerPath) {
  try {
    const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
    if (
      !owner.username ||
      !/^[a-f0-9]{128}$/.test(owner.hash) ||
      !/^[a-f0-9]{48}$/.test(owner.salt) ||
      !owner.version
    )
      throw new Error('Invalid owner record.');
    return owner;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Owner configuration could not be read. Access remains locked.', {
      cause: error
    });
  }
}
export async function writeOwner(ownerPath, owner, expectedVersion) {
  await mkdir(dirname(ownerPath), { recursive: true, mode: 0o700 });
  const lock = await open(ownerPath + '.lock', 'wx', 0o600);
  const temp = ownerPath + '.' + randomUUID() + '.tmp';
  try {
    const current = await readOwner(ownerPath);
    if ((current?.version ?? null) !== expectedVersion)
      throw Object.assign(new Error('Owner credentials changed. Try again.'), { status: 409 });
    await writeFile(temp, JSON.stringify(owner, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(temp, ownerPath);
  } finally {
    await lock.close();
    await rm(ownerPath + '.lock', { force: true });
    await rm(temp, { force: true });
  }
}
