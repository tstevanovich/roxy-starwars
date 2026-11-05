import { expect, test } from 'vitest';

import {
  activeProject,
  belongsToProject,
  legacyProjectKey,
  projectEra,
  projectFilter,
  projectKey,
  runProjectContext,
  settingsKey,
  withoutProject
} from './project-context.ts';

test('project context isolates asynchronous storylines and treats historical missing keys as the original project', async () => {
  expect(belongsToProject({ projectKey: null })).toBe(true);
  expect(belongsToProject({})).toBe(true);
  expect(belongsToProject({ projectKey: 'other' })).toBe(false);
  expect(projectKey()).toBe(legacyProjectKey);
  expect(settingsKey()).toBe('series');
  expect(projectFilter('other')).toEqual({ projectKey: 'other' });
  await runProjectContext({ key: 'other', era: 'Old Republic' }, async () => {
    await Promise.resolve();
    expect(projectEra()).toBe('Old Republic');
    expect(settingsKey()).toBe('series:other');
    expect(activeProject().key).toBe('other');
    expect(withoutProject(projectKey)).toBe(legacyProjectKey);
    expect(projectKey()).toBe('other');
  });
  expect(projectEra()).toBe('Imperial era');
});
