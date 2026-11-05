import { expect, test } from 'vitest';

import { musicModel, musicPrompt, sceneSeconds } from './scene-music.ts';

test('music follows cumulative shot timing and an explicit bounded allowance', () => {
  const scene = {
    clips: [
      { title: 'Arrival', duration: 4 },
      { title: 'Approach', duration: 6 },
      { title: 'Landing', duration: 3 }
    ]
  };
  expect(musicModel).toBe('music_v2_5');
  expect(sceneSeconds(scene)).toBe(13);
  const prompt = musicPrompt(scene);
  expect(prompt).toContain('exactly 18 seconds');
  expect(prompt).toContain('0–4 seconds — Arrival: Begin immediately');
  expect(prompt).toContain('4–10 seconds — Approach: Develop');
  expect(prompt).toContain('10–13 seconds — Landing: Continue');
  expect(prompt).toContain('13–18 seconds: Continue seamlessly');
  expect(musicPrompt(scene, 0)).not.toContain('13–13 seconds:');
  expect(musicPrompt({ clips: [] }, 0)).toContain('exactly 0 seconds');
});

test('long scenes summarize timing to keep the provider prompt bounded', () => {
  const clips = Array.from({ length: 20 }, (_, i) => ({ title: `Shot ${i}`, duration: 2 }));
  expect(musicPrompt({ title: 'Arrival', clips })).toContain('0–40 seconds — Arrival:');
  expect(musicPrompt({ clips })).toContain('0–40 seconds — Scene:');
});
