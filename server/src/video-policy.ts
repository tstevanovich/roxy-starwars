import type * as Studio from '../../shared/types.ts';
export const videoReviewStages = () => ['storyboard', 'animatic', 'visual'];
export function deliveryMediaId(clip: Studio.ClipInput, media: Studio.MediaInput[]) {
  const selected = media.find((m) => String(m._id) === String(clip.selectedTakeId));
  if (selected?.videoVerification?.height >= 1080) return clip.selectedTakeId;
  // Read-only support for an already saved high-resolution delivery.
  if (
    clip.production?.upscaleSourceTakeId === String(clip.selectedTakeId) &&
    clip.production?.upscaleMediaId
  )
    return clip.production.upscaleMediaId;
  return clip.selectedTakeId;
}
export function inspectNativeVideo(probe, seconds: number, { requireAudio = true } = {}) {
  const v = probe.streams?.find((s) => s.codec_type === 'video'),
    duration = Number(probe.format?.duration),
    audio = Boolean(probe.streams?.some((s) => s.codec_type === 'audio'));
  const verified = { width: Number(v?.width), height: Number(v?.height), duration, audio };
  const reasons = [];
  if (verified.width !== 1920 || verified.height !== 1080)
    reasons.push(
      `Import the native 1920 × 1080 video; this file is ${verified.width} × ${verified.height}.`
    );
  if (requireAudio && !audio)
    reasons.push('Include the video soundtrack with its dialogue/effects.');
  if (!Number.isFinite(duration) || Math.abs(duration - seconds) > 1)
    reasons.push(`The video must match this ${seconds}-second clip.`);
  return { verified, reasons };
}
