import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { json, Router } from 'express';
import mongoose from 'mongoose';

import { toError } from '../../shared/errors.ts';
import {
  defaultOwnerPath,
  equalSecret,
  hashPassword,
  hashToken,
  readOwner,
  verifyPassword,
  writeOwner
} from './owner.ts';

const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, unique: true, required: true },
  csrf: String,
  ownerVersion: String,
  secure: Boolean,
  expiresAt: { type: Date, expires: 0 },
  createdAt: Date
});
const limitSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  count: Number,
  expiresAt: { type: Date, expires: 0 }
});
export const AuthSession: mongoose.Model<mongoose.InferSchemaType<typeof sessionSchema>> =
  (mongoose.models.AuthSession as mongoose.Model<mongoose.InferSchemaType<typeof sessionSchema>>) ||
  mongoose.model('AuthSession', sessionSchema);
export const AuthLimit: mongoose.Model<mongoose.InferSchemaType<typeof limitSchema>> =
  (mongoose.models.AuthLimit as mongoose.Model<mongoose.InferSchemaType<typeof limitSchema>>) ||
  mongoose.model('AuthLimit', limitSchema);
const defaultRemotePath = fileURLToPath(
  new URL('../../.data/private/remote.json', import.meta.url)
);
const localOrigins = [
  'http://127.0.0.1:5000',
  'http://localhost:5000',
  'http://127.0.0.1:5173',
  'http://localhost:5173'
];
const mutations = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:5173 ws://localhost:5173; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  if (req.path.startsWith('/api')) res.set('Cache-Control', 'private, no-store');
  next();
}

export function createAuth({
  ownerPath = defaultOwnerPath,
  remotePath = defaultRemotePath,
  origins = localOrigins,
  sessionHours = 168
} = {}) {
  async function allowedOrigin(req) {
    const origin = req.get('origin');
    if (!origin || origin === 'null' || req.get('sec-fetch-site') === 'cross-site') return false;
    let publicOrigin = process.env.STUDIO_PUBLIC_ORIGIN || '';
    if (!publicOrigin) {
      try {
        publicOrigin = JSON.parse(await readFile(remotePath, 'utf8')).origin ?? '';
      } catch (caughtError) {
        const error = toError(caughtError);
        if (error.code !== 'ENOENT') return false;
      }
    }
    return (
      origins.includes(origin) ||
      (origin === publicOrigin && origin.startsWith('https://') && req.secure)
    );
  }
  async function limit(req, res, next) {
    const now = Date.now(),
      window = Math.floor(now / 900000);
    for (const [key, max] of [
      ['ip:' + hashToken(req.ip), 12],
      ['global', 60]
    ] as const) {
      const row = await AuthLimit.findOneAndUpdate(
        { key: window + ':' + key },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * 900000) } },
        { upsert: true, returnDocument: 'after' }
      ).lean();
      if (row.count > max) {
        res.set('Retry-After', String(Math.ceil(((window + 1) * 900000 - now) / 1000)));
        return res
          .status(429)
          .json({ message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
      }
    }
    next();
  }
  async function browserWrite(req, res, next) {
    if (!(await allowedOrigin(req)))
      return res.status(403).json({
        message: 'Open the studio at its configured address before signing in or making changes.'
      });
    next();
  }
  async function session(req) {
    const cookies = (req.get('cookie') ?? '').split(';').map((x) => x.trim().split('='));
    const name = req.secure ? '__Host-roxy_session' : 'roxy_session';
    const tokens = cookies.filter(([key]) => key === name).map(([, value]) => value);
    if (tokens.length !== 1 || !tokenPattern.test(tokens[0] ?? '')) return null;
    const row = await AuthSession.findOne({
      tokenHash: hashToken(tokens[0]),
      expiresAt: { $gt: new Date() }
    }).lean();
    if (!row || (row.secure && !req.secure)) return null;
    const owner = await readOwner(ownerPath);
    return owner && row.ownerVersion === owner.version ? { row, owner } : null;
  }
  async function issue(req, res, owner) {
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url'),
      now = Date.now();
    await AuthSession.create({
      tokenHash: hashToken(token),
      csrf,
      ownerVersion: owner.version,
      secure: req.secure,
      createdAt: new Date(now),
      expiresAt: new Date(now + sessionHours * 3600000)
    });
    res.cookie(req.secure ? '__Host-roxy_session' : 'roxy_session', token, {
      httpOnly: true,
      secure: req.secure,
      sameSite: 'strict',
      path: '/',
      maxAge: sessionHours * 3600000
    });
    res.json({ authenticated: true, username: owner.username, csrfToken: csrf });
  }
  const router = Router();
  router.use(json({ limit: '4kb' }));
  router.get('/session', async (req, res) => {
    const current = await session(req);
    const owner = current?.owner ?? (await readOwner(ownerPath));
    res.json(
      current
        ? { authenticated: true, username: owner.username, csrfToken: current.row.csrf }
        : { authenticated: false, configured: Boolean(owner) }
    );
  });
  router.post('/login', browserWrite, limit, async (req, res) => {
    const { username, password } = req.body ?? {},
      owner = await readOwner(ownerPath);
    if (!owner)
      return res
        .status(503)
        .json({ message: 'The owner account has not been set up on the studio computer.' });
    if (
      typeof password !== 'string' ||
      password.length > 256 ||
      typeof username !== 'string' ||
      username.length > 100
    )
      return res.status(401).json({ message: 'The username or password is incorrect.' });
    const valid = await verifyPassword(password, owner);
    if (!valid || username !== owner.username)
      return res.status(401).json({ message: 'The username or password is incorrect.' });
    const prior = await session(req);
    if (prior) await AuthSession.deleteOne({ _id: prior.row._id });
    await issue(req, res, owner);
  });
  router.post('/activate', browserWrite, limit, async (req, res) => {
    const { token, password } = req.body ?? {},
      owner = await readOwner(ownerPath);
    if (
      !owner ||
      typeof token !== 'string' ||
      !tokenPattern.test(token) ||
      !owner.inviteHash ||
      !equalSecret(hashToken(token), owner.inviteHash) ||
      Date.parse(owner.inviteExpiresAt) <= Date.now()
    )
      return res.status(403).json({
        message:
          'This setup link is invalid, expired or already used. Sign in or create a new link on the studio computer.'
      });
    if (typeof password !== 'string' || password.length < 15 || password.length > 256)
      return res
        .status(400)
        .json({ message: 'Use a password or passphrase between 15 and 256 characters.' });
    const nextOwner = {
      username: owner.username,
      ...(await hashPassword(password)),
      version: randomUUID(),
      createdAt: owner.createdAt,
      updatedAt: new Date().toISOString()
    };
    await writeOwner(ownerPath, nextOwner, owner.version);
    await AuthSession.deleteMany({});
    await issue(req, res, nextOwner);
  });
  async function protect(req, res, next) {
    const current = await session(req);
    if (!current) return res.status(401).json({ message: 'Sign in to access your studio.' });
    if (
      mutations.has(req.method) &&
      (!(await allowedOrigin(req)) || !equalSecret(req.get('x-csrf-token'), current.row.csrf))
    )
      return res.status(403).json({
        message: 'Your security token is missing or expired. Refresh the page before trying again.'
      });
    req.studioSession = current;
    next();
  }
  router.post('/logout', protect, async (req, res) => {
    await AuthSession.deleteOne({ _id: req.studioSession.row._id });
    res.clearCookie(req.secure ? '__Host-roxy_session' : 'roxy_session', {
      httpOnly: true,
      secure: req.secure,
      sameSite: 'strict',
      path: '/'
    });
    res.status(204).end();
  });
  router.post('/password', protect, limit, async (req, res) => {
    const { currentPassword, password } = req.body ?? {},
      owner = req.studioSession.owner;
    if (
      typeof currentPassword !== 'string' ||
      currentPassword.length > 256 ||
      typeof password !== 'string' ||
      password.length < 15 ||
      password.length > 256
    )
      return res.status(400).json({
        message: 'Enter your current password and a new passphrase of at least 15 characters.'
      });
    if (!(await verifyPassword(currentPassword, owner)))
      return res.status(401).json({ message: 'The current password is incorrect.' });
    const nextOwner = {
      username: owner.username,
      ...(await hashPassword(password)),
      version: randomUUID(),
      createdAt: owner.createdAt,
      updatedAt: new Date().toISOString()
    };
    await writeOwner(ownerPath, nextOwner, owner.version);
    await AuthSession.deleteMany({});
    await issue(req, res, nextOwner);
  });
  return { router, protect };
}

declare module 'express-serve-static-core' {
  interface Request {
    studioSession?: {
      row: mongoose.InferSchemaType<typeof sessionSchema> & { _id: mongoose.Types.ObjectId };
      owner: Awaited<ReturnType<typeof readOwner>>;
    };
  }
}
