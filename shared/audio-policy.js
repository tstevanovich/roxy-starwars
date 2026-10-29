// Only new renders with this provenance can skip the replacement sound mix.
export const nativeAudioPolicy = 'wan-native-effects-v1';
export const hasNativeAudio = (media) =>
  media?.kind === 'video' && media?.nativeAudio?.policy === nativeAudioPolicy && !media.soundMix;
