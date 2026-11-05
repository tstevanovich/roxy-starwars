import assert from 'node:assert/strict';

import { test } from 'vitest';

import { productionVideoPrompt } from '../server/src/studio-prompts.ts';
import type * as Studio from './types.ts';
import {
  remapVideoReferencePrompt,
  videoCharacterReferences,
  videoReferenceChoices,
  withVideoCastPrompt
} from './video-cast.ts';
import { videoSoundCues, withVideoSoundPrompt } from './video-sound-prompt.ts';

test('video identity choices require approved available images and tolerate unnamed legacy identities', () => {
  const assets = [
    { _id: 'a', name: 'Roxy', kind: 'character', finalChoice: { mediaIds: ['roxy'] } },
    { _id: 'b', name: '123', kind: 'droid', finalChoice: { mediaIds: ['droid'] } },
    {
      _id: 'c',
      name: 'Pending',
      kind: 'character',
      reviewStatus: 'pending-choice',
      finalChoice: { mediaIds: ['pending'] }
    },
    { _id: 'd', name: 'Missing', kind: 'character' },
    { _id: 'e', archived: true, kind: 'character' },
    { kind: 'prop' }
  ];
  assert.deepEqual(
    videoReferenceChoices(assets, [
      { _id: 'roxy', kind: 'image' },
      { _id: 'droid', kind: 'audio' }
    ]).map((r) => r.names),
    [['ROXY']]
  );
  assert.equal(videoReferenceChoices(assets, undefined)[1].names[0], '123');
  assert.deepEqual(
    videoCharacterReferences(
      {},
      { dialogue: 'ROXY: Hello', production: { videoReferenceMediaIds: ['roxy', 'missing'] } },
      assets,
      [{ _id: 'roxy', kind: 'image' }]
    ).map((r) => r.mediaId),
    ['roxy']
  );
});

test('automatic cast handles aliases, sheet-only selection, unlabelled speech and missing image files', () => {
  const assets = [
    {
      _id: 'a',
      name: 'Roxy Kane',
      aliases: ['Rox'],
      kind: 'character',
      finalChoice: { mediaIds: ['roxy'] },
      characterSheets: [{ mediaId: 'sheet' }]
    }
  ];
  const clip = {
    dialogue: 'ROXY: Hello\nRox: Goodbye',
    production: { imageReferenceMediaIds: ['sheet'] }
  };
  assert.deepEqual(videoCharacterReferences({}, clip, assets)[0].names, ['ROXY', 'Rox']);
  assert.deepEqual(
    videoCharacterReferences({}, clip, assets, [{ _id: 'roxy', kind: 'audio' }]),
    []
  );
  assert.equal(
    videoCharacterReferences({}, clip, assets, [{ _id: 'roxy', kind: 'image' }]).length,
    1
  );
  assert.deepEqual(
    videoCharacterReferences(
      {},
      { dialogue: 'Hello', production: { imageReferenceMediaIds: ['sheet'] } },
      assets
    )[0].names,
    ['ROX']
  );
  assert.equal(remapVideoReferencePrompt('Image 1 and Image 9', [], []), 'Image 1 and Image 9');
});

test('custom video prompts inherit only this shot sound cues with clear local start/end times', () => {
  const clip: Studio.ClipInput = {
    id: 'b',
    title: 'Second',
    duration: 5,
    dialogue: 'ROXY: Hello.',
    soundEffects: 'Soft robe movement.',
    production: {
      videoPrompt: 'ACTION: Roxy stays planted.\nAUDIO: Keep the existing quiet ventilation.'
    }
  };
  const scene = {
    id: 'scene',
    clips: [{ id: 'a', duration: 5 }, clip],
    soundPlan: {
      layers: [
        { id: 'bed', type: 'ambience', start: 0, duration: 10, description: 'Steady machinery.' },
        { id: 'global', type: 'effect', start: 6, duration: 2, description: 'Distant mechanism.' },
        {
          id: 'other',
          clipId: 'a',
          type: 'effect',
          start: 1,
          duration: 1,
          description: 'Other shot only.'
        },
        {
          id: 'local',
          clipId: 'b',
          type: 'effect',
          start: 4,
          duration: 3,
          description: 'Robe settles.'
        }
      ]
    }
  };
  const original = structuredClone(scene);
  const cues = videoSoundCues(scene, clip);
  assert.deepEqual(
    cues.map((cue) => [cue.start, cue.end]),
    [
      [0, 5],
      [1, 3],
      [4, 5]
    ]
  );
  const prompt = productionVideoPrompt(scene, clip);
  for (const text of [
    'Keep the existing quiet ventilation.',
    'Soft robe movement.',
    'Ambience 0–5s: Steady machinery.',
    'Effect 1–3s: Distant mechanism.',
    'Effect 4–5s: Robe settles.'
  ])
    assert.ok(prompt.includes(text));
  assert.doesNotMatch(prompt, /Other shot only/);
  const body = withVideoSoundPrompt(clip.production.videoPrompt, scene, clip);
  assert.equal(withVideoSoundPrompt(body, scene, clip), body);
  assert.deepEqual(scene, original);
});

test('saved close-shot video directions override stale wide-shot action and excluded names never add identities', () => {
  const assets = ['Harkun', 'Roxy', 'Kory'].map((name) => ({
    _id: name.toLowerCase(),
    name,
    kind: 'character',
    finalChoice: { mediaIds: [name + '-image'] }
  }));
  const clip: Studio.ClipInput = {
    id: 'shot',
    dialogue: 'HARKUN: Hello.',
    action: 'Roxy, Kory and Harkun stand in a wide group.',
    production: {
      videoPrompt:
        'Harkun faces Roxy. No Kory or acolyte ensemble.\nCAST REFERENCES:\n- KORY = Image 4 identity; old generated mapping.'
    }
  };
  const scene = { id: 'scene', assetIds: assets.map((a) => a._id), clips: [clip] };
  assert.deepEqual(
    videoCharacterReferences(scene, clip, assets).flatMap((r) => r.names),
    ['HARKUN', 'ROXY']
  );
  clip.production.videoReferenceMediaIds = ['Roxy-image'];
  assert.deepEqual(
    videoCharacterReferences(scene, clip, assets).map((r) => [r.mediaId, r.imageNumber]),
    [['Roxy-image', 2]]
  );
  clip.production.videoReferenceMediaIds = [];
  assert.deepEqual(videoCharacterReferences(scene, clip, assets), []);
});

test('removing and reordering video identities remaps inline tags without changing speech or assigning removed names to other images', () => {
  const previous = [
    { mediaId: 'h', imageNumber: 2, names: ['HARKUN'] },
    { mediaId: 'r', imageNumber: 3, names: ['ROXY'] },
    { mediaId: 'k', imageNumber: 4, names: ['KORY'] }
  ];
  const prompt =
    'Harkun from @Image2 faces Roxy from @Image3. Kory uses @Image4.\nDIALOGUE: HARKUN says: "Image 4 stays in this spoken sentence."\nCAST REFERENCES:\n- KORY = Image 4 identity; old mapping.';
  const changed = remapVideoReferencePrompt(prompt, previous, ['r', 'h']);
  assert.match(changed, /Harkun from @Image3 faces Roxy from @Image2/);
  assert.match(changed, /Kory uses KORY/);
  assert.match(changed, /"Image 4 stays in this spoken sentence\."/);
  assert.doesNotMatch(changed, /CAST REFERENCES|@Image4/);
});

test('non-speaking cast comes from this shot image selection even when older scene links omit them', () => {
  const kory = {
    _id: 'kory',
    name: 'Kory',
    kind: 'character',
    finalChoice: { mediaIds: ['kory-body'] },
    production: { items: [{ id: 'costume', mediaId: 'kory-costume' }] }
  };
  const roxy = {
    _id: 'roxy',
    name: 'Roxy Kane',
    kind: 'character',
    finalChoice: { mediaIds: ['roxy-body'] },
    production: { items: [{ id: 'costume', mediaId: 'roxy-costume' }] }
  };
  const harkun = {
    _id: 'harkun',
    name: 'Harkun',
    kind: 'character',
    finalChoice: { mediaIds: ['harkun-body'] }
  };
  const assets = [harkun, roxy, kory];
  const clip: Studio.ClipInput = {
    id: 'shot',
    dialogue: 'HARKUN: Listen.',
    production: {
      referenceAssetIds: ['harkun', 'roxy'],
      imageReferenceMediaIds: ['roxy-body', 'roxy-costume', 'kory-costume'],
      videoPrompt:
        'Harkun addresses Roxy and the acolytes. Only Harkun speaks; listeners remain silent.'
    }
  };
  const scene = { id: 'scene', assetIds: ['harkun', 'roxy'], clips: [clip] };
  assert.deepEqual(
    videoCharacterReferences(scene, clip, assets)
      .flatMap((r) => r.names)
      .sort(),
    ['HARKUN', 'KORY', 'ROXY']
  );
  clip.production.imageReferenceMediaIds = [];
  clip.production.videoPrompt =
    'Harkun addresses Roxy. Kory listens silently, no dialogue from her.';
  assert.ok(videoCharacterReferences(scene, clip, assets).some((r) => r.assetId === 'kory'));
  clip.production.imageReferenceMediaIds = ['kory-body'];
  clip.production.videoPrompt = 'Harkun addresses Roxy. No Kory or additional acolytes.';
  assert.ok(!videoCharacterReferences(scene, clip, assets).some((r) => r.assetId === 'kory'));
  clip.production.videoReferenceMediaIds = ['harkun-body', 'roxy-body'];
  clip.production.videoPrompt = 'Kory stands beside Roxy.';
  assert.deepEqual(
    videoCharacterReferences(scene, clip, assets).map((r) => r.mediaId),
    ['harkun-body', 'roxy-body']
  );
});

test('saved media identifiers become attached image tags while spoken text remains unchanged', () => {
  const id = '6ae3b5292402f86b31e7736a';
  const prompt = withVideoCastPrompt(
    `Kory identity reference: ${id}.\nDIALOGUE: HARKUN says: "${id}"`,
    [{ names: ['KORY'], mediaId: id, imageNumber: 4 }]
  );
  assert.match(prompt, /Kory identity reference: Image 4\./);
  assert.ok(prompt.includes(`"${id}"`));
});

test('named characters bind to approved identity images after composition images without casting names merely mentioned in speech', () => {
  const first = {
    id: 'first',
    title: 'Talk - part 1 of 2',
    duration: 5,
    dialogue: 'HARKUN: Lord Zash is waiting.\nROXY: Fine.',
    action: 'Harkun faces Roxy.'
  };
  const next = { id: 'next', title: 'Talk - part 2 of 2', duration: 5 };
  const scene = { id: 'scene', assetIds: ['harkun', 'roxy', 'zash'], clips: [first, next] };
  const assets = [
    {
      _id: 'harkun',
      kind: 'character',
      name: 'Overseer Harkun',
      finalChoice: { mediaIds: ['harkun-face'] }
    },
    { _id: 'roxy', kind: 'character', name: 'Roxy Kane', finalChoice: { mediaIds: ['roxy-face'] } },
    { _id: 'zash', kind: 'character', name: 'Lord Zash', finalChoice: { mediaIds: ['zash-face'] } }
  ];
  const refs = videoCharacterReferences(scene, first, assets);
  assert.deepEqual(
    refs.map((ref) => [ref.names, ref.imageNumber]),
    [
      [['HARKUN'], 2],
      [['ROXY'], 3]
    ]
  );
  const prompt = withVideoCastPrompt('Keep the room unchanged.', refs);
  assert.match(prompt, /HARKUN = Image 2 identity/);
  assert.match(prompt, /ROXY = Image 3 identity/);
  assert.doesNotMatch(prompt, /ZASH/);
  assert.equal(withVideoCastPrompt(prompt, refs), prompt);
  const noEnd = { ...first, production: { videoEndFrame: { mode: 'none' } } };
  assert.deepEqual(
    videoCharacterReferences(scene, noEnd, assets).map((ref) => ref.imageNumber),
    [2, 3]
  );
  assert.equal(
    videoCharacterReferences(scene, first, [{ ...assets[0], reviewStatus: 'pending-choice' }])
      .length,
    0
  );
});
