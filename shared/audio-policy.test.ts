import { expect, test } from 'vitest';

import { hasNativeAudio, nativeAudioPolicy } from './audio-policy.ts';

test('native video audio is usable only until a separate mix replaces it', () => {
  expect(nativeAudioPolicy).toBe('wan-native-effects-v1');
  expect(hasNativeAudio({ kind: 'video', nativeAudio: { policy: nativeAudioPolicy } })).toBe(true);
  for (const media of [
    undefined,
    {},
    { kind: 'audio' },
    { kind: 'video' },
    { kind: 'video', nativeAudio: { policy: 'legacy' } },
    { kind: 'video', nativeAudio: { policy: nativeAudioPolicy }, soundMix: {} }
  ])
    expect(hasNativeAudio(media)).toBeFalsy();
});
