import assert from 'node:assert/strict';

import { test } from 'vitest';

import { packageImagePrompt } from '../server/src/asset-image-prompts.ts';
import { clipPrompts, productionVideoPrompt } from '../server/src/studio-prompts.ts';
import { taggedVideoReferences } from './reference-prompt.ts';
import { cleanRenderPrompt } from './render-prompt.ts';

test('render cleanup removes editing and review boilerplate without losing sound or staging directions', () => {
  const prompt =
    'ACTION: Harkun stays at his mark.\nAUDIO: Quiet ventilation. No music. Music is added later in CapCut.\nPASS CONDITIONS: Same room. Dialogue unchanged; selected recording measured, at most 15 seconds and fitting shot.\nWORKFLOW: Approve this before generating.\nCREDITS: 200\nCAMERA: Fixed.';
  const clean = cleanRenderPrompt(prompt);
  assert.doesNotMatch(clean, /CapCut|recording measured|WORKFLOW|CREDITS/);
  for (const text of [
    'Harkun stays at his mark.',
    'Quiet ventilation.',
    'No music.',
    'Same room.',
    'Dialogue unchanged.',
    'CAMERA: Fixed.'
  ])
    assert.ok(clean.includes(text));
  assert.equal(cleanRenderPrompt(clean), clean);
});

test('spoken dialogue and visible quoted text retain literal words even when they name an editor', () => {
  const prompt =
    'DIALOGUE: ROXY: Music is added later in CapCut.\nHARKUN: Review this before generating.\nACTION: A sign reads "Music is added later in CapCut."\nAUDIO: No background music.';
  assert.equal(cleanRenderPrompt(prompt), prompt);
});

test('saved exact prompts and generation previews use the same cleanup without rewriting stored inputs', () => {
  const stored =
    'ACTION: Keep both actors planted.\nAUDIO: No music. Music is added later in CapCut.\nEXPORT: Download after review.';
  const clip = {
    id: 'clip',
    title: 'Shot',
    duration: 5,
    dialogue: '',
    production: { imagePrompt: stored, videoPrompt: stored }
  };
  const before = structuredClone(clip);
  const scene = { id: 'scene', title: 'Scene', clips: [clip], assetIds: [] };
  const image = clipPrompts(scene, clip, []).image;
  const video = productionVideoPrompt(scene, clip);
  assert.equal(image, cleanRenderPrompt(stored));
  assert.equal(video, taggedVideoReferences(cleanRenderPrompt(stored)));
  assert.equal(packageImagePrompt({}, { imagePrompt: stored }), image);
  assert.deepEqual(clip, before);
});
