import { expect, test } from 'vitest';

import { animaticTimingIssue, splitDialogueForTiming } from './animatic-timing-rules.ts';

test('audio references have their own duration limit while shots may run longer', () => {
  const clip = { id: 'shot', title: 'Reply', duration: 20, dialogue: 'HARKUN: Hello.' };
  for (const seconds of [14.72, 15, NaN, Infinity])
    expect(animaticTimingIssue(clip, seconds)).toBeNull();
  expect(animaticTimingIssue({ ...clip, dialogue: '' }, 18)).toBeNull();
  expect(animaticTimingIssue(clip, 18)).toMatchObject({
    clipId: 'shot',
    split: true,
    audioSeconds: 18
  });
  expect(animaticTimingIssue({ ...clip, duration: 10 }, 12)).toMatchObject({
    split: false,
    shotSeconds: 10
  });
});

test('splitting retains every word and speaker and keeps estimates within shot duration limits', () => {
  const dialogue =
    'ROXY: One sentence. Another sentence!\nContinued words.\nHARKUN: ' + 'Leave now. '.repeat(20);
  const parts = splitDialogueForTiming(dialogue, 30, 30);
  expect(parts.length).toBeGreaterThan(1);
  expect(
    parts
      .flatMap((part) => part.dialogue.split('\n'))
      .map((line) => line.replace(/^[^:]+:\s*/, ''))
      .join(' ')
  ).toBe(
    dialogue
      .replace(/^[^\n:]+:\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
  expect(parts.every((part) => part.duration >= 2 && part.duration <= 30)).toBe(true);
  expect(splitDialogueForTiming('ROXY: Yes.\nROXY: Fine.', 2, 2)[0].dialogue).toBe(
    'ROXY: Yes. Fine.'
  );
  expect(
    splitDialogueForTiming('ROXY: Two words', 100, 100).every((part) => part.duration === 30)
  ).toBe(true);
  expect(splitDialogueForTiming('ROXY:', 2, 2)[0].dialogue).toBe('ROXY: ');
  expect(splitDialogueForTiming(' \n ', 2, 2)).toEqual([]);
  expect(() => splitDialogueForTiming('Unlabelled speech', 2, 2)).toThrow('Label each dialogue');
});
