import { expect, test, vi } from 'vitest';

import { approvalHash, clipApprovalInputs } from './review-continuity.ts';

vi.mock('../../shared/shot-continuity.ts', async (original) => ({
  ...(await original<typeof import('../../shared/shot-continuity.ts')>()),
  shotContinuity: () => ({ sources: [{ assetId: 'continuity' }], errors: [] })
}));
vi.mock('../../shared/shot-references.ts', () => ({
  shotAssetIds: () => ['linked', 'voice', 'excluded']
}));
test('clip approval scope tracks explicit continuity files and only relevant sound layers', () => {
  const episode = { _id: 'episode' },
    scene = { id: 'scene', soundPlan: { layers: [{ clipId: 'shot' }, { clipId: 'other' }] } };
  const clip = {
    id: 'shot',
    production: {
      continuityMode: 'explicit',
      referenceMediaIds: ['reference'],
      videoReferenceMediaIds: [],
      videoEndFrame: { mode: 'none' },
      videoTransitionPrompt: 'Legacy'
    }
  };
  const assets = [
    { _id: 'linked', production: { items: [{ required: true, mediaId: 'reference' }] } },
    { _id: 'excluded' },
    { _id: 'voice', kind: 'voice' },
    { _id: 'continuity', finalChoice: { mediaIds: ['reference'] } }
  ];
  const data = { episode, scene, clip, assets, media: [] };
  const result = clipApprovalInputs(data, 'visual');
  if (!('timing' in result.input) || !('sound' in result.input))
    throw new Error('Expected picture approval inputs');
  expect(result.references.map((asset) => asset._id)).toEqual(['linked', 'continuity']);
  expect(result.input.timing.composition.continuity.sources).toEqual([{ assetId: 'continuity' }]);
  expect(result.input.sound.layers).toEqual([
    { type: undefined, description: '', clipId: 'shot', start: 0, duration: 10 }
  ]);
  expect(approvalHash({ b: 2, a: 1 })).toBe(approvalHash({ a: 1, b: 2 }));
});
