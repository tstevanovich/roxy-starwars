import { expect, test } from 'vitest';

import {
  imageGenerationDefaults,
  noVideoUpscale,
  videoGenerationDefaults
} from './production-defaults.ts';

test('generation defaults keep reviewed image prompts and native Standard 1080p video', () => {
  expect(imageGenerationDefaults).toMatchObject({
    provider: 'OpenArt',
    model: 'gpt-image-2-5-sunburst',
    resolution: '2K',
    params: {
      autoEnhancePrompt: false,
      lockAspectRatio: true,
      quality: 'high',
      aspectRatio: '16:9'
    }
  });
  expect(videoGenerationDefaults).toMatchObject({
    model: 'wan3-0',
    quality: 'standard',
    width: 1920,
    height: 1080,
    resolution: '1080p',
    automaticUpscale: false
  });
  expect(noVideoUpscale).toMatchObject({
    automaticOnApproval: false,
    required: false,
    preserveOriginal: true
  });
  for (const defaults of [imageGenerationDefaults, videoGenerationDefaults, noVideoUpscale])
    expect(Object.isFrozen(defaults)).toBe(true);
});
