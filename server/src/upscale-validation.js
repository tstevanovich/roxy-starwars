// Upscaling a rounded 854x480 source by 3 produces 2562x1440. Preserve that
// original provider output rather than re-encoding it to remove two columns.
export function inspectUpscale(probe, expectedDuration) {
  const video = probe.streams?.find((s) => s.codec_type === 'video');
  const width = Number(video?.width),
    height = Number(video?.height);
  const duration = Number(probe.format?.duration);
  const audio = Boolean(probe.streams?.some((s) => s.codec_type === 'audio'));
  const reasons = [];
  if (height !== 1440 || !Number.isInteger(width) || Math.abs(width - 2560) > 2)
    reasons.push(
      `Resolution is ${video ? `${width} × ${height}` : 'unavailable'}; expected 1440p at approximately 16:9 (2560 pixels wide, allowing 2 pixels of rounding).`
    );
  if (!audio) reasons.push('The video has no audio track; include the approved soundtrack.');
  if (!Number.isFinite(duration) || Math.abs(duration - expectedDuration) > 1)
    reasons.push(
      `Duration is ${Number.isFinite(duration) ? duration.toFixed(3) + ' seconds' : 'unavailable'}; this clip requires ${expectedDuration} seconds (within 1 second).`
    );
  return { verified: { width, height, duration, audio }, reasons };
}
