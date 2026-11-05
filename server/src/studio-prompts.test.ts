import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  imageRevisionReview,
  packageImagePrompt,
  visualImageDirections
} from './asset-image-prompts.ts';
import { runProjectContext } from './project-context.ts';
import { clipPrompts, productionVideoPrompt } from './studio-prompts.ts';

test('generated video directions honor the saved starting state, permitted motion and state at the cut', () => {
  const clip = {
    id: 'shot',
    duration: 6,
    action: 'Old staging: walk away',
    dialogue: 'ROXY: I am staying here.',
    production: {
      startState: 'Roxy faces Harkun with both feet planted.',
      allowedMotion: 'A small nod while speaking; remain in place.',
      endState: 'Roxy and Harkun remain facing each other.'
    }
  };
  const prompt = productionVideoPrompt({ clips: [clip] }, clip);
  assert.match(prompt, /START STATE: Roxy faces Harkun with both feet planted\./);
  assert.match(prompt, /ACTION: A small nod while speaking; remain in place\./);
  assert.match(prompt, /ALLOWED MOTION: A small nod while speaking; remain in place\./);
  assert.match(prompt, /END STATE AT CUT: Roxy and Harkun remain facing each other\./);
  assert.doesNotMatch(prompt, /Old staging/);
});

test('prompt defaults handle silent vlogs, unnamed shots and explicitly numbered legacy references', () => {
  const scene = {
    id: 'scene',
    title: 'Fallback scene',
    style: 'vlog',
    assetIds: ['asset'],
    clips: []
  };
  const clip = { id: 'shot', duration: 5, production: {} };
  assert.match(productionVideoPrompt(scene, clip), /Natural audience-facing vlog/);
  assert.match(productionVideoPrompt(scene, clip), /Fallback scene/);
  assert.match(clipPrompts(scene, clip, []).video, /No spoken dialogue/);
  clip.production = { imagePrompt: 'Use @image1 for the scene' };
  assert.match(
    clipPrompts(scene, clip, [
      { _id: 'asset', name: 'Set', kind: 'environment', finalChoice: { mediaIds: ['image'] } }
    ]).image,
    /@image1/
  );
  runProjectContext({ key: 'fixture', workflowVersion: 1 }, () => {
    clip.production = { referenceMediaIds: ['image'] };
    assert.ok(
      clipPrompts(scene, clip, [
        {
          _id: 'asset',
          name: 'Set',
          kind: 'environment',
          production: { items: [{ mediaId: 'image', required: true, type: 'image' }] }
        }
      ]).referenceMediaIds.includes('image')
    );
  });
});

test('package image prompts exclude asset biographies, research and other deliverables', () => {
  const asset = {
    kind: 'character',
    brief:
      'UNFINALIZED workflow. Four-panel turnaround, expression sheet. Voice audition uses Eleven v3. Credits 176.',
    notes: 'OWNER APPROVAL REQUIRED',
    production: {
      sourceNotes: 'SOURCE TRANSCRIPT 17:03. https://youtube.com/video',
      items: [{ id: 'master-portrait', mediaId: 'approved-master' }]
    }
  };
  const item = {
    id: 'view-front',
    title: 'Individual full-body front view',
    notes:
      'One full-body FRONT view including head and feet. Red tunic and black trousers. Plain gray background.'
  };
  const prompt = packageImagePrompt(asset, item, { era: 'Old Republic era' });
  assert.match(prompt, /Star Wars universe, Old Republic era/);
  assert.match(prompt, /full-body FRONT/);
  assert.match(prompt, /Red tunic and black trousers/);
  assert.match(prompt, /@image1 is the approved master portrait/);
  for (const phrase of [
    'UNFINALIZED',
    'Four-panel',
    'expression sheet',
    'Eleven',
    'Credits',
    'OWNER',
    'SOURCE TRANSCRIPT',
    'https://',
    '17:03'
  ])
    assert.ok(!prompt.includes(phrase), phrase);
});

test('exact approved image prompts are returned whole without planning additions', () => {
  const prompt =
    'Star Wars universe, Old Republic era. One realistic front view, exact approved costume. No labels.';
  const item = {
    id: 'view-front',
    title: 'Front',
    imagePrompt: prompt,
    notes: 'Owner approval, costs and unrelated voice work.'
  };
  assert.equal(
    packageImagePrompt({ kind: 'character', brief: 'Entire production package' }, item),
    prompt
  );
  assert.ok(
    visualImageDirections(
      'Write pronunciation notes for ElevenLabs. Red cloth with a silver buckle. Approval is pending. No readable text.'
    ).includes('Red cloth with a silver buckle.')
  );
  assert.ok(!visualImageDirections(item.notes).includes('approval'));
});

test('changing only an exact image prompt requires revision review without changing other item fields', () => {
  const before = {
    id: 'front',
    type: 'image',
    notes: 'Keep source design.',
    imagePrompt: 'Old visual prompt.',
    mediaId: 'image'
  };
  const next = { ...before, imagePrompt: 'New visual prompt.' };
  assert.deepEqual(imageRevisionReview(before, next), {
    ...next,
    requiresPlanApproval: true,
    revisionSourceMediaId: 'image'
  });
  assert.equal(imageRevisionReview(before, before), before);
});

test('every image and video prompt carries Star Wars era guidance even without asset references', () => {
  const scenes = [
    {
      assetIds: [],
      title: 'Pickup',
      location: 'Coronet Spaceport',
      script: 'A ship waits.',
      style: 'cinematic'
    },
    {
      assetIds: [],
      title: 'Captain log',
      location: 'Cockpit',
      script: 'Roxy records a log.',
      style: 'vlog'
    }
  ];
  for (const scene of scenes) {
    for (const duration of [6, 24]) {
      const clip = {
        duration,
        action: 'Hold on the subject.',
        dialogue: '',
        camera: '',
        soundEffects: ''
      };
      const before = structuredClone({ scene, clip });
      const prompts = clipPrompts(scene, clip, []);
      assert.equal(prompts.imageGeneration.model, 'gpt-image-2-5-sunburst');
      assert.equal(prompts.imageGeneration.params.resolutionTier, '2k');
      assert.equal(prompts.imageGeneration.params.quality, 'high');
      assert.equal(prompts.imageGeneration.params.autoEnhancePrompt, false);
      for (const prompt of [prompts.image, prompts.video]) {
        assert.match(prompt, /^UNIVERSE AND ERA: Star Wars universe, Imperial era\./);
        assert.ok(prompt.includes(`LOCATION: ${scene.location}`));
        assert.match(
          prompt,
          /Approved references define the characters, ship and sets; preserve their designs/
        );
        assert.match(prompt, /Include only the cast and vehicles specified for this shot/);
      }
      assert.match(prompts.video, /No music, score, soundtrack, or musical bed/);
      assert.deepEqual({ scene, clip }, before);
    }
  }
});

test('each clip keeps its own instructions without copying other dialogue or asset review history', () => {
  const assets = Array.from({ length: 14 }, (_, index) => ({
    _id: String(index),
    name: `Production reference ${index}`,
    kind: index === 0 ? 'voice' : 'environment',
    finalChoice: {
      title: 'Old model comparison',
      description: 'PENDING YOUR REVIEW. '.repeat(200),
      mediaIds: [`reference-${index}`]
    }
  }));
  const scene = {
    title: 'A very polished passenger',
    location: 'Coronet Spaceport, Corellia',
    style: 'cinematic',
    script: 'TAVIN: This is another clip’s dialogue.\n'.repeat(150),
    assetIds: assets.map((a) => a._id)
  };
  const clip = {
    duration: 8,
    action: 'Al faces Tavin in the parked ship. The window apron stays clear of vehicles. '.repeat(
      15
    ),
    dialogue: 'AL: He handles docking clearances.',
    camera: 'Fixed camera. Preserve the same original station and eyeline.',
    soundEffects: 'Original selected Al recording, low ventilation. No music.',
    selectedDialogueId: 'selected-al'
  };
  const before = structuredClone({ scene, clip, assets });
  const result = clipPrompts(scene, clip, assets);
  assert.equal(result.videoWithinLimit, true);
  assert.ok(result.video.length <= 4500);
  assert.ok(result.video.includes(clip.action));
  assert.match(result.video, /AL says: "He handles docking clearances\."/);
  assert.ok(result.video.includes(clip.camera));
  assert.ok(result.video.includes(clip.soundEffects));
  assert.ok(!result.video.includes('another clip’s dialogue'));
  for (const prompt of [result.image, result.video]) {
    assert.ok(!prompt.includes('PENDING YOUR REVIEW'));
    assert.ok(!prompt.includes('Old model comparison'));
    for (const asset of assets.filter((asset) => asset.kind !== 'voice'))
      assert.ok(prompt.includes(asset.name));
    assert.ok(!prompt.includes(assets[0].name));
  }
  assert.deepEqual(
    result.referenceMediaIds,
    assets.filter((a) => a.kind !== 'voice').map((a) => a.finalChoice.mediaIds[0])
  );
  assert.equal(result.dialogueMediaId, 'selected-al');
  assert.deepEqual({ scene, clip, assets }, before);
});

test('long actual shot instructions are flagged instead of silently truncated', () => {
  const action = 'Preserve this important shot instruction. '.repeat(150);
  const result = clipPrompts(
    { title: 'Shot', location: 'Corellia', style: 'cinematic', assetIds: [], script: '' },
    { duration: 8, action, dialogue: '', camera: '', soundEffects: '' },
    []
  );
  assert.equal(result.videoWithinLimit, false);
  assert.ok(result.video.includes(action));
});

test('production video prompts preserve exact shot instructions without appending library descriptions', () => {
  const scene = { title: 'Boarding', location: 'Coronet Spaceport, Corellia', style: 'cinematic' };
  const clip = {
    title: 'Al checks the passenger',
    duration: 13,
    action: 'Keep the Fortune parked. Al faces Tavin; his head is separate from the wall.',
    dialogue: 'AL: The charter is for one passenger.',
    camera: 'Fixed over-Roxy shoulder.',
    soundEffects: 'Busy port ambience and clean selected dialogue. No music.'
  };
  const instructions = 'Keep the exact finalized image and selected voice.';
  const prompt = productionVideoPrompt(scene, clip, instructions);
  for (const direction of [
    clip.action,
    clip.camera,
    clip.soundEffects,
    instructions,
    scene.location
  ])
    assert.ok(prompt.includes(direction));
  assert.match(prompt, /Star Wars universe, Imperial era/);
  assert.match(prompt, /No conventional cars or wheeled vehicles/);
  assert.match(prompt, /No music, score/);
  assert.match(prompt, /AL says: "The charter is for one passenger\."/);
  assert.ok(!prompt.includes('CapCut'));
  assert.ok(prompt.length < 4500);
});

test('orbital shots use their own setting and exclude offscreen platform references', async () => {
  const { runProjectContext } = await import('./project-context.ts');
  runProjectContext({ key: 'test', era: 'Old Republic era', workflowVersion: 1 }, () => {
    const assets = [
      {
        _id: 'fleet',
        name: 'Sith orbital fleet',
        kind: 'ship',
        finalChoice: { mediaIds: ['fleet-image'] }
      },
      {
        _id: 'platform',
        name: 'Surface landing platform reference',
        kind: 'environment',
        finalChoice: { mediaIds: ['platform-image'] }
      }
    ];
    const scene = {
      title: 'Orbital approach and landing',
      style: 'cinematic',
      location: 'Korriban orbit and Academy landing platform',
      assetIds: ['fleet', 'platform']
    };
    const clip = {
      title: 'Orbital fleet',
      duration: 12,
      action: 'Fleet in orbit above Korriban.',
      dialogue: '',
      camera: 'Hold extreme wide.',
      production: {
        location: 'Korriban orbit, exterior vacuum',
        environment: 'space-exterior',
        physicalConstraints:
          'Hold this exact orbital vista for the entire clip; no foreground reveal.',
        referenceMediaIds: ['fleet-image']
      }
    };
    const prompts = clipPrompts(scene, clip, assets),
      video = productionVideoPrompt(scene, clip);
    assert.ok(!prompts.image.includes('Surface landing platform reference'));
    for (const prompt of [prompts.image, prompts.video, video]) {
      assert.ok(!prompt.includes('LOCATION: ' + scene.location));
      assert.ok(prompt.includes('LOCATION: Korriban orbit, exterior vacuum'));
      assert.match(prompt, /No landing platform, ground plane, road, cars/);
      assert.match(prompt, /coherent trajectories and scale/);
    }
  });
});
