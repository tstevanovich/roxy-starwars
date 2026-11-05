import { expect, test } from 'vitest';

import { runProjectContext } from './project-context.ts';
import {
  assetInput,
  assetOrganization,
  assetProductionInput,
  episodeInput,
  episodeView,
  fail,
  id,
  list,
  number,
  object,
  revision,
  sceneFingerprint,
  soundPlanFingerprint,
  soundPlanInput,
  text
} from './studio-validation.ts';

const mid = '111111111111111111111111',
  other = '222222222222222222222222';
const source = {
  id: 'source',
  title: 'Gameplay',
  url: 'https://example.com/watch',
  startSeconds: 1,
  endSeconds: 10,
  status: 'verified'
};
const shot = (production = {}) => ({ id: 'shot', title: 'Shot', duration: 5, production });
const scene = (production = {}) => ({
  id: 'scene',
  title: 'Scene',
  style: 'cinematic',
  clips: [shot(production)]
});
const episode = (production = {}) => ({ title: 'Episode', scenes: [scene(production)] });
const item = (extra = {}) => ({
  id: 'portrait',
  title: 'Portrait',
  type: 'image',
  required: true,
  ...extra
});
test('primitive validators bound payloads and reject malformed values with actionable errors', () => {
  for (const value of [null, [], 'text']) expect(() => object(value)).toThrow('JSON object');
  expect(object({})).toEqual({});
  expect(text(' trim ', 'Text')).toBe('trim');
  for (const value of [null, 1, 'xxxx']) expect(() => text(value, 'Text', 3)).toThrow('at most 3');
  expect(() => text(' ', 'Name', 3, true)).toThrow('nonempty');
  expect(list([], 'Entries')).toEqual([]);
  for (const value of [{}, Array(101)]) expect(() => list(value, 'Entries')).toThrow('list');
  for (const value of ['1', 0.1, -1, 11])
    expect(() => number(value, 'Number', 0, 10)).toThrow('integer');
  expect(revision(0)).toBe(0);
  expect(() => revision(null)).toThrow('Revision');
  expect(id(mid)).toBe(mid);
  for (const value of [1, 'invalid']) expect(() => id(value)).toThrow('record ID');
  expect(() => fail('Conflict', 409)).toThrow('Conflict');
});
test('asset organization links shot images to episodes and validates optional fields', () => {
  for (const value of [
    { scope: 'wrong' },
    { scope: 'episode' },
    { reviewStatus: 'approved' },
    { archived: 'true' },
    { sceneId: 'scene' },
    { sceneId: 'scene', clipId: 'shot' }
  ])
    expect(() => assetOrganization(value)).toThrow();
  expect(
    assetOrganization({
      scope: 'episode',
      episodeId: mid,
      sceneId: 'scene',
      clipId: 'shot',
      archived: true,
      reviewStatus: 'pending-choice',
      relatedAssetId: other
    })
  ).toMatchObject({ episodeId: mid, sceneId: 'scene', relatedAssetId: other });
  expect(() => assetInput({ kind: 'wrong' })).toThrow('category');
  expect(() =>
    assetInput({
      kind: 'character',
      name: 'Name',
      candidates: [{ id: 'a', title: 'A', archived: 1 }]
    })
  ).toThrow('Archived');
  expect(
    assetInput({ kind: 'character', name: 'Name', candidates: [{ id: 'a', title: 'A' }] })
      .candidates[0].mediaIds
  ).toEqual([]);
});
test('reference packages preserve deliberate reference selections, source provenance and revision requirements', () => {
  expect(() => assetProductionInput({ sourceMode: 'wrong' })).toThrow('footage');
  for (const url of ['not-url', 'http://example.com', 'https://name:password@example.com'])
    expect(() => assetProductionInput({ sourceUrl: url })).toThrow('HTTPS');
  for (const entry of [item({ type: 'wrong' }), item({ required: null })])
    expect(() => assetProductionInput({ items: [entry] })).toThrow();
  const parsed = assetProductionInput({
    sourceUrl: 'https://example.com',
    sourceMediaIds: [mid],
    items: [
      item({
        requiresPlanApproval: true,
        revisionSourceMediaId: mid,
        imageReferenceMediaIds: [mid, mid],
        referenceMediaIds: [],
        sourceMediaIds: [mid, mid],
        imagePrompt: 'Prompt'
      })
    ]
  });
  expect(parsed.sourceUrl).toBe('https://example.com/');
  expect(parsed.items[0]).toMatchObject({
    requiresPlanApproval: true,
    revisionSourceMediaId: mid,
    sourceMediaIds: [mid],
    referenceMediaIds: [],
    imageReferenceMediaIds: [mid]
  });
  expect(
    assetProductionInput({ items: [item({ revisionSourceMediaId: null })] }).items[0]
      .revisionSourceMediaId
  ).toBeNull();
  expect(() =>
    assetProductionInput({ sourceMediaIds: [mid], items: [item({ sourceMediaIds: [other] })] })
  ).toThrow('source evidence');
});
test('source evidence validates URLs, timing, review states and the decisions linked to each scene', () => {
  for (const url of ['bad', 'http://example.com', 'https://name:pass@example.com'])
    expect(() =>
      episodeInput({ title: 'Episode', sourceReferences: [{ ...source, url }] })
    ).toThrow('HTTPS');
  for (const startSeconds of ['1', Infinity, -1, 86401])
    expect(() =>
      episodeInput({ title: 'Episode', sourceReferences: [{ ...source, startSeconds }] })
    ).toThrow('start time');
  for (const endSeconds of ['1', Infinity, 1, 86401])
    expect(() =>
      episodeInput({ title: 'Episode', sourceReferences: [{ ...source, endSeconds }] })
    ).toThrow('end must');
  expect(() =>
    episodeInput({ title: 'Episode', sourceReferences: [{ ...source, status: 'wrong' }] })
  ).toThrow('review state');
  expect(() =>
    episodeInput({ title: 'Episode', decisions: [{ id: 'decision', sourceId: 'missing' }] })
  ).toThrow('source reference');
  const sources = [
    { id: 'source', url: source.url, title: 'Source' },
    { ...source, id: 'other' }
  ];
  const decisions = [
    { id: 'd1', sourceId: 'source', choice: 'Choice' },
    { id: 'd2', sourceId: 'other', choice: 'Other', timestampSeconds: 5, outcome: 'Result' }
  ];
  const parsed = episodeInput({
    ...episode(),
    sourceReferences: sources,
    decisions,
    scenes: [{ ...scene(), sourceReferenceIds: ['source'] }]
  });
  expect(parsed.decisions[0]).toMatchObject({ timestampSeconds: 0, outcome: '' });
  expect(parsed.sourceReferences[0]).toMatchObject({
    startSeconds: 0,
    endSeconds: null,
    status: 'unreviewed',
    chapter: '',
    notes: ''
  });
  expect(parsed.scenes[0].sourceEvidenceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(() =>
    episodeInput({ ...episode(), scenes: [{ ...scene(), sourceReferenceIds: ['missing'] }] })
  ).toThrow('episode source');
  expect(() => episodeInput({ ...episode(), scenes: [{ ...scene(), style: 'wrong' }] })).toThrow(
    'presentation'
  );
});
test('shot directions validate continuity and reference scope and retain explicit empty selections', () => {
  for (const production of [
    { continuityMode: 'wrong' },
    { mode: 'old-model' },
    { environment: 'wrong' },
    { videoEndFrame: { mode: 'wrong' } },
    { referenceAssetIds: [mid] }
  ])
    expect(() => episodeInput(episode(production))).toThrow();
  const parsed = episodeInput({
    ...episode(),
    scenes: [
      {
        ...scene({
          continuityMode: 'explicit',
          continuitySources: [{ sceneId: 'previous', clipId: 'previous' }],
          continuityNotes: 'Keep room',
          referenceAssetIds: [mid],
          imageReferenceMediaIds: [],
          videoReferenceMediaIds: [],
          videoTransitionPrompt: 'Legacy transition',
          videoEndFrame: { mode: 'none' },
          startState: 'Standing'
        }),
        assetIds: [mid]
      }
    ]
  });
  expect(parsed.scenes[0].clips[0].production).toMatchObject({
    continuityMode: 'explicit',
    continuitySources: [{ sceneId: 'previous', clipId: 'previous' }],
    videoEndFrame: { mode: 'none' },
    endState: '',
    allowedMotion: ''
  });
  expect(
    episodeInput(episode({ continuityNotes: 'Keep room' })).scenes[0].clips[0].production
      .continuityMode
  ).toBe('auto');
  expect(
    episodeInput(
      episode({
        continuitySources: [{ sceneId: 's', clipId: 'c' }],
        endState: 'Stay',
        allowedMotion: 'Breathe',
        videoEndFrame: { mode: 'image', assetId: mid, mediaId: other }
      })
    ).scenes[0].clips[0].production.videoEndFrame
  ).toEqual({ mode: 'image', assetId: mid, mediaId: other });
  for (const duration of [NaN, '5', 1, 31])
    expect(() =>
      episodeInput({ title: 'Episode', scenes: [{ ...scene(), clips: [{ ...shot(), duration }] }] })
    ).toThrow('duration');
  expect(episodeInput({ title: 'Empty' }).scenes).toEqual([]);
  expect(
    episodeInput({ title: 'Empty', scenes: [{ id: 's', title: 'S', style: 'vlog' }] }).scenes[0]
      .clips
  ).toEqual([]);
});
test('sound plans reject unsafe levels and fingerprint only production inputs', () => {
  expect(soundPlanInput({})).toEqual({ notes: '', dialogueGainDb: 0, layers: [] });
  for (const dialogueGainDb of ['0', Infinity, -31, 7])
    expect(() => soundPlanInput({ dialogueGainDb })).toThrow('between');
  const layer = {
    id: 'layer',
    title: 'Air',
    type: 'ambience',
    description: 'Ventilation',
    loop: true
  };
  for (const patch of [{ type: 'wrong' }, { loop: null }])
    expect(() => soundPlanInput({ layers: [{ ...layer, ...patch }] })).toThrow();
  expect(
    soundPlanInput({ layers: [{ ...layer, assetId: mid, clipId: 'shot' }] }).layers[0].assetId
  ).toBe(mid);
  const base = episodeInput(episode()).scenes[0];
  expect(
    sceneFingerprint({ ...base, sourceNotes: 'Evidence', sourceReferenceIds: undefined }, [])
  ).not.toBe(sceneFingerprint(base, []));
  expect(
    sceneFingerprint({ ...base, sourceReferenceIds: ['source'], sourceNotes: undefined }, [])
  ).not.toBe(sceneFingerprint(base, []));
  expect(soundPlanFingerprint(base, [])).toBe(
    soundPlanFingerprint({ ...base, soundPlan: {} } as typeof base, [])
  );
  expect(episodeView({ scenes: [base] }, []).scenes[0].soundApprovalStatus).toBe('draft');
  runProjectContext({ key: 'fixture', workflowVersion: 1 }, () =>
    expect(episodeView({ scenes: [base] }, []).workflowVersion).toBe(1)
  );
});
