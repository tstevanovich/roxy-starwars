import { expect, test } from 'vitest';

import { videoSoundCues, withVideoSoundPrompt } from './video-sound-prompt.ts';

test('sound cues clamp scene and shot layers to this shot, including partial legacy timings', () => {
  const clip = { id: 'current', duration: 5 };
  const scene = {
    clips: [{ duration: 2 }, { duration: 0 }, clip],
    soundPlan: {
      layers: [
        {
          id: 'room',
          type: 'ambience',
          description: 'Proposed quiet room',
          start: 0,
          duration: 10
        },
        {
          id: 'local',
          clipId: 'current',
          description: 'sound pass: footsteps',
          start: 1.234,
          duration: 2.345
        },
        { clipId: 'other', description: 'elsewhere' },
        { description: '' },
        {},
        { description: 'before', start: -10, duration: 1 },
        { description: 'after', start: 20 },
        { id: 'default', description: 'room' }
      ]
    }
  };
  expect(videoSoundCues(scene, clip)).toEqual([
    { id: 'room', type: 'ambience', start: 0, end: 5, description: 'quiet room' },
    { id: 'local', type: undefined, start: 1.23, end: 3.58, description: 'footsteps' },
    { id: 'default', type: undefined, start: 0, end: 5, description: 'room' }
  ]);
  expect(videoSoundCues({}, {})).toEqual([]);
  expect(
    videoSoundCues({ clips: [], soundPlan: { layers: [{ description: 'room' }] } }, {})
  ).toEqual([]);
});

test('sound prompt replacement preserves custom directions and avoids repeating the shot brief', () => {
  expect(withVideoSoundPrompt('CAMERA: hold  ', {}, {})).toBe('CAMERA: hold');
  const scene = {
    clips: [],
    soundPlan: {
      layers: [
        { type: 'ambience', description: 'wind' },
        { type: 'effect', description: 'step' }
      ]
    }
  };
  const prompt = withVideoSoundPrompt('CAMERA: hold\nSOUND CUES:\n- old\n', scene, {
    duration: 4,
    soundEffects: 'cloth',
    dialogue: 'A: Hello'
  });
  expect(prompt).toContain('Shot sounds: cloth');
  expect(prompt).toContain('Ambience 0–4s: wind');
  expect(prompt).toContain('Effect 0–4s: step');
  expect(prompt).toContain('Dialogue stays clear');
  expect(
    withVideoSoundPrompt(prompt, scene, {
      duration: 4,
      soundEffects: 'cloth',
      dialogue: 'A: Hello'
    })
  ).toBe(prompt);
  const silent = withVideoSoundPrompt('cloth', {}, { soundEffects: 'cloth' });
  expect(silent).not.toContain('Shot sounds:');
  expect(silent).not.toContain('Dialogue stays clear');
});
