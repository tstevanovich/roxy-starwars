import { expect, test } from 'vitest';

import { sceneDraftMatches } from './scene-board-draft.ts';
import { sceneFixture } from './test/fixtures.ts';

test('missing scenes cannot be saved as a match; omitted clips and empty production prompts normalize', () => {
  expect(sceneDraftMatches(undefined, {})).toBe(false);
  expect(sceneDraftMatches({}, undefined)).toBe(false);
  expect(sceneDraftMatches({}, { clips: [] })).toBe(true);
  const scene = sceneFixture({ clips: [{ id: 'one' }] });
  const explicit = structuredClone(scene);
  explicit.clips[0].production = { imagePrompt: '', videoPrompt: '', videoTransitionPrompt: '' };
  expect(sceneDraftMatches(scene, explicit)).toBe(true);
  delete scene.clips[0].production;
  expect(sceneDraftMatches(scene, explicit)).toBe(true);
});

test('only editable scene inputs make a local draft dirty', () => {
  const scene = sceneFixture({
    clips: [
      {
        id: 'one',
        production: {
          imagePrompt: 'image',
          videoPrompt: 'motion',
          videoTransitionPrompt: 'continuity',
          imageReferenceMediaIds: ['face'],
          videoReferenceMediaIds: ['face']
        }
      }
    ]
  });
  const reviewed = {
    ...scene,
    editToken: 'new',
    approval: { status: 'approved' },
    clips: [{ ...scene.clips[0], takeIds: ['video'], selectedTakeId: 'video' }]
  };
  expect(sceneDraftMatches(reviewed, scene)).toBe(true);
  expect(sceneDraftMatches(scene, { ...scene, script: 'New line' })).toBe(false);
  expect(
    sceneDraftMatches(scene, {
      ...scene,
      clips: [{ ...scene.clips[0], production: { videoPrompt: 'New motion' } }]
    })
  ).toBe(false);
});
