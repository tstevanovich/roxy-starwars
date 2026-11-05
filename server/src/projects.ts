import type { NextFunction, Request, Response } from 'express';

import { toError } from '../../shared/errors.ts';
import { StudioAsset, StudioMedia, StudioProject, StudioSettings } from './models/Studio.ts';
import {
  activeProject,
  belongsToProject,
  legacyProjectKey,
  projectKey,
  runProjectContext,
  settingsKey,
  withoutProject
} from './project-context.ts';
import { fail, id } from './studio-validation.ts';

export const legacyProfile = {
  key: legacyProjectKey,
  name: 'Roxy Kane - Imperial adventures',
  era: 'Imperial era',
  classStory: 'Original smuggler series',
  cinematicOnly: false,
  faithfulAdaptation: false,
  videoWorkflow: 'native-1080p'
};
export async function projectProfile(key = projectKey()) {
  const profile = await StudioProject.findOne({ key }).lean();
  if (profile) return profile;
  if (key === legacyProjectKey) return legacyProfile;
  fail('Workspace not found.', 404);
}
export async function withProject<T>(key: string, callback: () => T) {
  const profile = await withoutProject(() => projectProfile(key));
  const settings = await withoutProject(() =>
    StudioSettings.findOne({ key: settingsKey(key) }).lean()
  );
  return runProjectContext({ ...profile, era: settings?.era ?? profile.era }, callback);
}
export async function projectMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const key = req.get('X-Studio-Project') || req.query.project || legacyProjectKey;
    if (typeof key !== 'string' || !/^[-a-z0-9]{2,80}$/.test(key)) fail('Invalid workspace.');
    await withProject(key, () => next());
  } catch (caughtError) {
    const error = toError(caughtError);
    res
      .status(error.status ?? 500)
      .json({ message: error.status ? error.message : 'Workspace could not be loaded.' });
  }
}
export async function assertMediaAccess(ids: string[]) {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length || !activeProject()) return;
  const media = await StudioMedia.find({ _id: { $in: unique.map(id) } }).lean();
  const assets = await StudioAsset.find().lean();
  const shared = new Set(assets.flatMap((a) => a.identitySourceMediaIds ?? []).map(String));
  if (
    media.length !== unique.length ||
    media.some((m) => !belongsToProject(m) && !shared.has(String(m._id)))
  )
    fail('Choose media from this workspace or its explicitly shared identity references.');
}
