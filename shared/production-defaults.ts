export const imageGenerationDefaults = Object.freeze({
  provider: 'OpenArt',
  model: 'gpt-image-2-5-sunburst',
  displayName: 'GPT Image 2.5 Sunburst',
  resolution: '2K',
  params: {
    resolutionTier: '2k',
    quality: 'high',
    variant: 'sunburst',
    aspectRatio: '16:9',
    outputFormat: 'png',
    autoEnhancePrompt: false,
    lockAspectRatio: true
  }
});

export const videoGenerationDefaults = Object.freeze({
  provider: 'OpenArt',
  model: 'wan3-0',
  displayName: 'Wan 3.0 Standard',
  quality: 'standard',
  resolution: '1080p',
  width: 1920,
  height: 1080,
  aspectRatio: '16:9',
  automaticUpscale: false
});

export const noVideoUpscale = Object.freeze({
  automaticOnApproval: false,
  required: false,
  preserveOriginal: true,
  message: 'Native 1080p video is used directly; no upscale step.'
});
