import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clipPrompts, productionVideoPrompt } from '../src/studio-prompts.js';

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
  assert.ok(result.video.includes(clip.dialogue));
  assert.ok(result.video.includes(clip.camera));
  assert.ok(result.video.includes(clip.soundEffects));
  assert.ok(!result.video.includes('another clip’s dialogue'));
  for (const prompt of [result.image, result.video]) {
    assert.ok(!prompt.includes('PENDING YOUR REVIEW'));
    assert.ok(!prompt.includes('Old model comparison'));
    for (const asset of assets) assert.ok(prompt.includes(asset.name));
  }
  assert.deepEqual(
    result.referenceMediaIds,
    assets.map((a) => a.finalChoice.mediaIds[0])
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
    clip.dialogue,
    clip.camera,
    clip.soundEffects,
    instructions,
    scene.location
  ])
    assert.ok(prompt.includes(direction));
  assert.match(prompt, /Star Wars universe, Imperial era/);
  assert.match(prompt, /No conventional cars or wheeled vehicles/);
  assert.match(prompt, /No music, score/);
  assert.ok(prompt.length < 4500);
});
