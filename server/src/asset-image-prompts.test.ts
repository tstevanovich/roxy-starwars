import { expect, test } from 'vitest';

import {
  imageRevisionReview,
  packageImageBasePrompt,
  packageImagePrompt,
  visualImageDirections
} from './asset-image-prompts.ts';

test('visual prompts retain picture directions and omit production workflow notes', () => {
  expect(visualImageDirections()).toBe('');
  expect(
    visualImageDirections(
      'For a future individually authorized replacement option, Face left.\nApprove before generation. Music in CapCut.\n'
    )
  ).toBe('Face left.');
  const item = { id: 'view', title: 'Front view', type: 'image', notes: 'Hands visible.' };
  const asset = { name: 'Prop', kind: 'prop', production: { items: [item] } };
  expect(packageImageBasePrompt(asset, item)).toContain('Use the described identity');
  expect(packageImagePrompt(asset, item)).toContain('Hands visible.');
  expect(packageImageBasePrompt(asset, { ...item, imagePrompt: 'Exact saved image prompt.' })).toBe(
    'Exact saved image prompt.'
  );
  const master = {
    id: 'master-portrait',
    title: 'Master portrait',
    type: 'image',
    mediaId: 'portrait'
  };
  const character = { ...asset, kind: 'character', production: { items: [master, item] } };
  expect(packageImagePrompt(character, item)).toContain('@image1 is the approved master portrait');
  expect(packageImageBasePrompt(character, master)).toContain('Create Master portrait.');
  expect(
    packageImageBasePrompt({ ...asset, identitySourceMediaIds: ['identity'] }, item, {
      workflow: false,
      era: 'Old Republic',
      instructions: 'Head upright.'
    })
  ).toContain('Preserve the identity and design in the supplied references');
});

test('only changed image directions require a replacement review', () => {
  const item = { id: 'view', type: 'image', notes: 'Old direction', mediaId: 'saved' };
  expect(imageRevisionReview(null, item)).toBe(item);
  expect(
    imageRevisionReview(item, { ...item, type: 'notes', notes: 'Changed' })
  ).not.toHaveProperty('requiresPlanApproval');
  expect(imageRevisionReview(item, { ...item })).not.toHaveProperty('requiresPlanApproval');
  for (const patch of [
    { notes: 'New direction' },
    { imagePrompt: 'New prompt' },
    { referenceMediaIds: ['reference'] },
    { imageReferenceMediaIds: [] }
  ])
    expect(imageRevisionReview(item, { ...item, ...patch })).toMatchObject({
      requiresPlanApproval: true,
      revisionSourceMediaId: 'saved'
    });
  expect(
    imageRevisionReview(item, { ...item, notes: 'New', mediaId: undefined }).revisionSourceMediaId
  ).toBeNull();
});
