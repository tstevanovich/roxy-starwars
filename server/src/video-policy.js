import { activeProject } from './project-context.js';
export const nativeVideoWorkflow = () => activeProject()?.videoWorkflow === 'native-1080p';
export const videoReviewStages = () =>
  nativeVideoWorkflow()
    ? ['storyboard', 'animatic', 'visual']
    : ['storyboard', 'animatic', 'visual', 'upscale'];
export function deliveryMediaId(clip, media) {
  const selected = media.find((m) => String(m._id) === String(clip.selectedTakeId));
  if (nativeVideoWorkflow() && selected?.videoVerification?.height >= 1080)
    return clip.selectedTakeId;
  if (
    clip.production?.upscaleSourceTakeId === String(clip.selectedTakeId) &&
    clip.production?.upscaleMediaId
  )
    return clip.production.upscaleMediaId;
  return clip.selectedTakeId;
}
export function inspectNativeVideo(probe, seconds) {
  const v = probe.streams?.find((s) => s.codec_type === 'video'),
    duration = Number(probe.format?.duration),
    audio = Boolean(probe.streams?.some((s) => s.codec_type === 'audio'));
  const verified = { width: Number(v?.width), height: Number(v?.height), duration, audio };
  const reasons = [];
  if (verified.width !== 1920 || verified.height !== 1080)
    reasons.push(
      `Import the native 1920 × 1080 video; this file is ${verified.width} × ${verified.height}.`
    );
  if (!audio) reasons.push('Include the video soundtrack with its dialogue/effects.');
  if (!Number.isFinite(duration) || Math.abs(duration - seconds) > 1)
    reasons.push(`The video must match this ${seconds}-second clip.`);
  return { verified, reasons };
}
