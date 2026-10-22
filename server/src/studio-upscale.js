import { videoUpscaleDefaults } from '../../shared/production-defaults.js';

// A server-owned request is stored atomically with the take selection.
// The current OpenArt connection has no video-upscale submission capability.
// Do not mark these requests queued/running or emulate AI upscaling with resizing.
export function upscaleForSelection(clip, previous) {
  if (!clip.selectedTakeId) return null;
  if (previous?.upscale?.sourceTakeId === String(clip.selectedTakeId)) return previous.upscale;
  return {
    sourceTakeId: String(clip.selectedTakeId),
    status: 'waiting-provider',
    requestedAt: new Date().toISOString(),
    settings: structuredClone(videoUpscaleDefaults),
    resultMediaId: null,
    message:
      'Automatic 2K upscale requested. Waiting for an OpenArt connection that supports video upscaling; no upscale job has been submitted or charged.'
  };
}
