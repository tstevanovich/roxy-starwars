import { expect, test } from 'vitest';

import { shotImageRevisionScene } from './shot-image-revision.ts';

test('image revisions change only the selected shot and distinguish unchanged attachments from an explicit clear', () => {
  const selected = {
    id: 'selected',
    production: { videoPrompt: 'Keep video', imageReferenceMediaIds: ['old'] }
  };
  const sibling = { id: 'sibling', production: { imagePrompt: 'Keep sibling' } };
  const scene = { id: 'scene', clips: [selected, sibling] };
  const result = shotImageRevisionScene(scene, 'selected', {
    imagePrompt: 'New image',
    sourceMediaIds: ['source', 'source']
  });
  expect(result.clips[0].production).toMatchObject({
    imagePrompt: 'New image',
    videoPrompt: 'Keep video',
    imageReferenceMediaIds: ['source']
  });
  expect(result.clips[1]).toBe(sibling);
  expect(selected.production.imageReferenceMediaIds).toEqual(['old']);
  expect(
    shotImageRevisionScene(scene, 'selected', { imagePrompt: 'New image' }).clips[0].production
      .imageReferenceMediaIds
  ).toEqual(['old']);
  expect(
    shotImageRevisionScene(scene, 'selected', {
      imagePrompt: 'New image',
      imageReferenceMediaIds: [],
      referenceMediaIds: ['ignored']
    }).clips[0].production.imageReferenceMediaIds
  ).toEqual([]);
  expect(
    shotImageRevisionScene(scene, 'selected', {
      imagePrompt: 'New image',
      referenceMediaIds: ['reference']
    }).clips[0].production.imageReferenceMediaIds
  ).toEqual(['reference']);
  expect(() => shotImageRevisionScene(scene, 'missing', { imagePrompt: 'New' })).toThrow(
    'existing shot'
  );
  expect(() => shotImageRevisionScene(scene, 'selected', {})).toThrow('complete image prompt');
});
