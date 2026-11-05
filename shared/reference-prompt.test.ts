import assert from 'node:assert/strict';

import { test } from 'vitest';

import { packageImagePrompt } from '../server/src/asset-image-prompts.ts';
import { clipPrompts, productionVideoPrompt } from '../server/src/studio-prompts.ts';
import {
  compactShotImageReferences,
  imageReferenceItems,
  imageReferenceSelection
} from './image-references.ts';
import {
  remapImageReferencePrompt,
  taggedVideoReferences,
  withImageReferencePrompt
} from './reference-prompt.ts';

test('legacy reference remapping strips generated libraries and handles removed or unknown tags', () => {
  const prompt =
    'UNIVERSE AND ERA:\nCreate one photorealistic cinematic still.\nREFERENCES: obsolete library\nFRAME: Hold @image1 @image9';
  assert.equal(
    remapImageReferencePrompt(prompt, [{ mediaId: 'old', title: 'Roxy' }], []),
    'UNIVERSE AND ERA:\nCreate one photorealistic cinematic still.\nFRAME: Hold Roxy @image9'
  );
  assert.equal(
    remapImageReferencePrompt('UNIVERSE AND ERA: custom @image1', [{ mediaId: 'old' }], []),
    'UNIVERSE AND ERA: custom the described subject'
  );
  const master = '@image1 is the approved master portrait: match the face\nFRAME: @image1';
  assert.match(
    remapImageReferencePrompt(master, [{ mediaId: 'one' }], ['one']),
    /approved master portrait/
  );
  assert.equal(
    remapImageReferencePrompt(master, [{ mediaId: 'one' }], []),
    'FRAME: the described subject'
  );
  assert.equal(remapImageReferencePrompt(master, [], []), 'FRAME: @image1');
  assert.equal(withImageReferencePrompt(), '');
  assert.match(
    withImageReferencePrompt('', [{ imageNumber: 1, role: 'Prop design' }, { imageNumber: 2 }]),
    /Visual reference \(Image reference\)/
  );
  assert.match(taggedVideoReferences(), /@Image1/);
});

test('an exact image selection replaces automatic continuity and design references, including empty selections', () => {
  const prompts = {
    continuity: { mediaIds: ['earlier'] },
    referenceMediaIds: ['environment', 'costume'],
    imageReferenceMediaIds: []
  };
  assert.deepEqual(imageReferenceSelection({ prompts, referenceIds: ['legacy'] }).selected, []);
  const sixteen = Array.from({ length: 16 }, (_, i) => `image-${i}`);
  prompts.imageReferenceMediaIds = sixteen;
  assert.deepEqual(
    imageReferenceSelection({ prompts, referenceIds: ['legacy'] }).selected,
    sixteen
  );
  assert.deepEqual(
    imageReferenceSelection({
      asset: {
        kind: 'character',
        production: {
          items: [
            { id: 'master-portrait', mediaId: 'master' },
            { id: 'front', imageReferenceMediaIds: [] }
          ],
          sourceMediaIds: ['source']
        }
      },
      packageItemId: 'front',
      workflow: true
    }).selected,
    []
  );
});

test('removing and reordering images remaps inline tags without assigning a removed image to a different attachment', () => {
  const refs = [
    { mediaId: 'roxy', subject: 'Roxy' },
    { mediaId: 'room', subject: 'Academy trial room' },
    { mediaId: 'harkun', subject: 'Harkun' }
  ];
  const prompt = 'Roxy @image1 faces Harkun @image3 in @image2.';
  assert.equal(
    remapImageReferencePrompt(prompt, refs, ['harkun', 'roxy']),
    'Roxy @image2 faces Harkun @image1 in Academy trial room.'
  );
  assert.doesNotMatch(
    withImageReferencePrompt(remapImageReferencePrompt(prompt, refs, []), []),
    /@image\d/
  );
});

test('compact shot defaults pick one character sheet and only the matching environment view', () => {
  const assets = [
    {
      kind: 'character',
      finalChoice: { mediaIds: ['roxy-sheet'] },
      production: {
        items: [
          { type: 'image', mediaId: 'portrait' },
          { type: 'image', mediaId: 'costume' }
        ]
      }
    },
    {
      kind: 'environment',
      production: {
        items: [
          { type: 'image', title: 'Academy jails', mediaId: 'jail' },
          { type: 'image', title: 'Academy trial room', mediaId: 'room' },
          { type: 'image', title: 'Sacrificial chamber', mediaId: 'tomb' }
        ]
      }
    }
  ];
  assert.deepEqual(compactShotImageReferences({ location: 'Academy trial room' }, {}, assets), [
    'roxy-sheet',
    'room'
  ]);
});

test('image prompt tags follow the exact selected order and preserve inline owner tags', () => {
  const assets = [
    {
      _id: 'blade',
      kind: 'prop',
      name: 'Training blade',
      finalChoice: { mediaIds: ['blade-image'] }
    },
    {
      _id: 'roxy',
      kind: 'character',
      name: 'Roxy',
      production: {
        items: [{ id: 'master-portrait', title: 'Master portrait', mediaId: 'roxy-image' }]
      }
    }
  ];
  const refs = imageReferenceItems(['previous-image', 'roxy-image', 'blade-image'], {
    assets,
    continuity: { sources: [{ mediaId: 'previous-image', title: 'Landing shot' }] }
  });
  const base = 'Match the background in @image1. Roxy carries the blade from @image3.';
  const prompt = withImageReferencePrompt(base, refs);
  assert.ok(prompt.startsWith(base));
  assert.match(prompt, /@image1: Landing shot.*match its visible background/);
  assert.match(prompt, /@image2: Roxy.*Master portrait/);
  assert.match(prompt, /@image3: Training blade.*Prop design/);
  assert.equal(withImageReferencePrompt(prompt, refs), prompt);
  const changed = withImageReferencePrompt(prompt, [refs[0]]);
  assert.doesNotMatch(changed, /@image3: Training blade/);
});

test('shot and character package image previews bind their actual reference order', () => {
  const character = {
    _id: 'roxy',
    kind: 'character',
    name: 'Roxy',
    finalChoice: { mediaIds: ['master'] },
    production: { items: [{ id: 'master-portrait', mediaId: 'master', title: 'Master portrait' }] }
  };
  const clip = {
    id: 'shot',
    title: 'Portrait',
    assetIds: ['roxy'],
    action: 'Roxy stands still.',
    dialogue: '',
    production: { imagePrompt: 'Show Roxy.', referenceMediaIds: ['master'] }
  };
  const scene = { id: 'scene', title: 'Scene', clips: [clip], assetIds: ['roxy'] };
  const prompts = clipPrompts(scene, clip, [character], { _id: 'episode', scenes: [scene] });
  assert.equal(prompts.imageBase, 'Show Roxy.');
  assert.match(prompts.image, /@image1: Roxy/);
  const item = { id: 'front', type: 'image', title: 'Front view', imagePrompt: 'A front view.' };
  assert.match(
    packageImagePrompt(character, item),
    /^A front view\.\nATTACHED IMAGE REFERENCES:\n- @image1: Roxy/
  );
});

test('video references use explicit tags without changing spoken words or duplicating bindings', () => {
  const clip = {
    id: 'shot',
    title: 'Dialogue',
    duration: 8,
    action: 'Roxy listens.',
    dialogue: 'ROXY: Image 1 and Audio 1 are the words I said.',
    production: {
      videoPrompt:
        'Use Image 1 for the starting composition. Match Roxy to Image 2. Use Audio 1 as her voice.'
    }
  };
  const prompt = productionVideoPrompt({ id: 'scene', clips: [clip] }, clip, '', {
    characterReferences: []
  });
  assert.match(prompt, /Use @Image1 for the starting composition/);
  assert.match(prompt, /Match Roxy to @Image2/);
  assert.match(prompt, /Use @Audio1 as her voice/);
  assert.ok(prompt.includes('"Image 1 and Audio 1 are the words I said."'));
  assert.equal(taggedVideoReferences(prompt), prompt);
  assert.match(
    taggedVideoReferences('Keep the camera steady.'),
    /@Image1 defines the starting composition/
  );
  assert.match(
    taggedVideoReferences('Keep the camera steady.', { endImage: true }),
    /@Image2 defines the ending composition/
  );
});
