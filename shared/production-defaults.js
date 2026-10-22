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

export const videoUpscaleDefaults = Object.freeze({
  automaticOnApproval: true,
  provider: 'OpenArt',
  model: 'BytePlus vCube',
  resolution: '1440p',
  displayResolution: '1440p 2K',
  width: 2560,
  height: 1440,
  frameRate: 30,
  mode: 'Standard',
  preserveOriginal: true
});
