import { expect, test } from 'vitest';

import {
  compactShotImageReferences,
  imageReferenceItems,
  imageReferenceSelection,
  selectedImageReferences
} from './image-references.ts';

test('exact selections override defaults, deduplicate IDs and expose overflow', () => {
  expect(imageReferenceSelection({})).toEqual({ selected: [], omitted: [] });
  const ids = Array.from({ length: 18 }, (_, i) => String(i));
  expect(imageReferenceSelection({ prompts: { imageReferenceMediaIds: [...ids, '0'] } })).toEqual({
    selected: ids.slice(0, 16),
    omitted: ids.slice(16)
  });
  expect(
    imageReferenceSelection({
      asset: { production: { items: [{ id: 'portrait', imageReferenceMediaIds: ['exact'] }] } },
      packageItemId: 'portrait'
    }).selected
  ).toEqual(['exact']);
  expect(
    imageReferenceSelection({ prompts: { imageReferenceMediaIds: [] }, referenceIds: ['ignored'] })
      .selected
  ).toEqual([]);
});

test('package defaults favor the master portrait and explicit item references over workflow sources', () => {
  const asset = {
    kind: 'character',
    identitySourceMediaIds: ['identity'],
    finalChoice: { mediaIds: ['final'] },
    production: {
      sourceMediaIds: ['source'],
      items: [
        { id: 'master-portrait', mediaId: 'master' },
        { id: 'body', referenceMediaIds: ['reference'] }
      ]
    }
  };
  expect(
    imageReferenceSelection({
      asset,
      packageItemId: 'body',
      prompts: { continuity: { mediaIds: ['earlier'] } },
      referenceIds: ['design', null],
      workflow: true
    }).selected
  ).toEqual(['master', 'earlier', 'design', 'reference', 'final']);
  expect(imageReferenceSelection({ asset, packageItemId: 'master-portrait' }).selected).toEqual([
    'identity',
    'final'
  ]);
  const noMaster = {
    ...asset,
    kind: 'droid',
    production: {
      sourceMediaIds: ['source'],
      items: [{ id: 'body', sourceMediaIds: ['item-source'] }]
    }
  };
  expect(
    imageReferenceSelection({ asset: noMaster, packageItemId: 'body', workflow: true }).selected
  ).toEqual(['identity', 'item-source', 'final']);
  expect(
    imageReferenceSelection({
      asset: { ...noMaster, production: { sourceMediaIds: ['source'] } },
      packageItemId: 'body',
      workflow: true
    }).selected
  ).toEqual(['identity', 'source', 'final']);
  expect(imageReferenceSelection({ asset: { kind: 'prop' }, workflow: true }).selected).toEqual([]);
  expect(imageReferenceSelection({ prompts: { referenceMediaIds: ['prompt'] } }).selected).toEqual([
    'prompt'
  ]);
});

test('reselection uses available metadata and stable placeholder labels for saved IDs', () => {
  expect(selectedImageReferences(undefined, [])).toBeUndefined();
  const result = selectedImageReferences(
    {
      items: [{ mediaId: 'a', title: 'A' }],
      omittedItems: [{ mediaId: 'b', title: 'B' }],
      choices: [{ mediaId: 'c', title: 'C' }]
    },
    ['c', 'b', 'a', 'unknown']
  );
  expect(result.items.map((i) => i.title)).toEqual(['C', 'B', 'A', 'Saved image']);
  expect(result.items.map((i) => i.imageNumber)).toEqual([1, 2, 3, 4]);
  expect(result.omitted).toEqual([]);
  expect(selectedImageReferences({}, ['unknown']).items[0].role).toBe('Image reference');
});

test('compact references choose approved matching sheets or appropriate package fallbacks', () => {
  const finalizedAt = '2026-01-01';
  const sheet = (mediaId, views?) => ({
    mediaId,
    approvedAt: '2026-01-02',
    sourceCandidateId: 'choice',
    sourceFinalizedAt: finalizedAt,
    views
  });
  const assets = [
    {
      kind: 'character',
      finalChoice: { id: 'choice', finalizedAt },
      characterSheets: [
        { ...sheet('unapproved'), approvedAt: null },
        { ...sheet('old'), sourceCandidateId: 'old' },
        { ...sheet('outdated'), sourceFinalizedAt: '2025-01-01' },
        sheet('small'),
        sheet('sheet', ['front', 'back'])
      ]
    },
    { kind: 'droid', finalChoice: { mediaIds: ['final'] } },
    {
      kind: 'wardrobe',
      production: { items: [{ id: 'body-turnaround', type: 'image', mediaId: 'body' }] }
    },
    {
      kind: 'character',
      production: { items: [{ id: 'master-portrait', type: 'image', mediaId: 'portrait' }] }
    },
    { kind: 'character' },
    {
      kind: 'environment',
      production: {
        items: [
          { type: 'image', mediaId: 'wrong', title: 'Forest' },
          { type: 'image', mediaId: 'room', title: 'Academy room' },
          { type: 'text' }
        ]
      }
    },
    {
      kind: 'environment',
      finalChoice: { mediaIds: ['set-final'] },
      production: { items: [{ type: 'image', mediaId: 'fallback' }] }
    },
    { kind: 'environment', production: { items: [{ type: 'image', mediaId: 'fallback' }] } },
    { kind: 'environment' },
    { kind: 'prop', finalChoice: { mediaIds: ['prop'] } },
    { kind: 'ship', production: { items: [{ type: 'image', mediaId: 'ship' }] } },
    {
      kind: 'prop',
      finalChoice: { id: 'choice', finalizedAt },
      characterSheets: [sheet('prop-sheet')]
    },
    { kind: 'prop' },
    { kind: 'voice' },
    { kind: 'sound' },
    { archived: true, kind: 'character' }
  ];
  expect(
    compactShotImageReferences({ location: 'Academy room' }, {}, assets, ['continuity', 'sheet'])
  ).toEqual([
    'continuity',
    'sheet',
    'final',
    'body',
    'portrait',
    'room',
    'set-final',
    'fallback',
    'prop',
    'ship',
    'prop-sheet'
  ]);
  expect(compactShotImageReferences({}, { production: { location: '!!!' } }, [])).toEqual([]);
  expect(compactShotImageReferences({}, {}, assets)).toContain('wrong');
  expect(
    compactShotImageReferences(
      {},
      {},
      [],
      Array.from({ length: 20 }, (_, i) => String(i))
    )
  ).toHaveLength(16);
  expect(
    compactShotImageReferences({}, {}, [
      {
        kind: 'character',
        finalChoice: { id: 'choice', finalizedAt },
        characterSheets: [sheet('first'), sheet('second')]
      },
      {
        kind: 'environment',
        production: {
          items: [
            { type: 'image', mediaId: 'one' },
            { type: 'image', mediaId: 'two' }
          ]
        }
      }
    ])
  ).toEqual(['first', 'one']);
});

test('reference labels identify continuity, package views, source appearances and missing files', () => {
  const assets = [
    { _id: 'archived', archived: true, finalChoice: { mediaIds: ['final'] } },
    {
      _id: 'character',
      kind: 'character',
      name: 'Roxy',
      finalChoice: { mediaIds: ['final'] },
      production: { items: [{ mediaId: 'item', title: 'Portrait' }] },
      characterSheets: [{ mediaId: 'sheet', title: 'Turnaround' }],
      identitySourceMediaIds: ['source']
    },
    {
      _id: 'source-owner',
      kind: 'unknown',
      name: 'Source',
      production: {
        sourceMediaIds: ['production-source'],
        items: [{ sourceMediaIds: ['item-source'] }, {}]
      }
    },
    { _id: 'empty' }
  ];
  const ids = [
    'continuity',
    'final',
    'item',
    'sheet',
    'source',
    'production-source',
    'item-source',
    'file',
    'missing'
  ];
  const result = imageReferenceItems(ids, {
    assets,
    media: [{ _id: 'file', originalName: 'file.png' }],
    continuity: {
      sources: [
        {
          mediaId: 'continuity',
          title: 'Previous shot',
          assetId: 'shot',
          clipId: 'before',
          sceneId: 'scene'
        }
      ]
    }
  });
  expect(result[0]).toMatchObject({
    title: 'Previous shot',
    role: 'Continuity - earlier shot image',
    sourceType: 'approved-shot-image',
    assetId: 'shot',
    sourceClipId: 'before'
  });
  expect(result[1]).toMatchObject({
    title: 'Roxy',
    role: 'Character identity',
    view: undefined,
    assetId: 'character'
  });
  expect(result[2].view).toBe('Portrait');
  expect(result[3].view).toBe('Turnaround');
  expect(result[4].view).toBe('Source appearance reference');
  expect(result[5].role).toBe('Image reference');
  expect(result[6].assetId).toBe('source-owner');
  expect(result[7]).toMatchObject({ title: 'file.png', available: true, filename: 'file.png' });
  expect(result[8]).toMatchObject({ title: 'Saved image', available: false });
  expect(imageReferenceItems(['missing'])[0].title).toBe('Saved image');
});
