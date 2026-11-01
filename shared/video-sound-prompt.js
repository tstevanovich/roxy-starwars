import { cleanRenderPrompt } from './render-prompt.js';

const text = (value = '') =>
  cleanRenderPrompt(value)
    .replace(/(?:later |separate )?sound pass\s*:/gi, '')
    .replace(/^proposed\s+/i, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
const seconds = (value) => Number(value.toFixed(2));

export function videoSoundCues(scene, clip) {
  const index = scene.clips?.findIndex((item) => item.id === clip.id) ?? -1;
  const offset =
    index > 0
      ? scene.clips.slice(0, index).reduce((sum, item) => sum + Number(item.duration || 0), 0)
      : 0;
  const duration = Number(clip.duration || 0);
  return (scene.soundPlan?.layers ?? []).flatMap((layer) => {
    if (layer.clipId && layer.clipId !== clip.id) return [];
    const description = text(layer.description);
    if (!description) return [];
    const localStart = Number(layer.start || 0) - (layer.clipId ? 0 : offset);
    const start = Math.max(0, localStart);
    const end = Math.min(duration, localStart + Number(layer.duration ?? duration + offset));
    if (end <= start) return [];
    return [
      { id: layer.id, type: layer.type, start: seconds(start), end: seconds(end), description }
    ];
  });
}

export function withVideoSoundPrompt(prompt, scene, clip) {
  // Our generated section uses single-line bullets; replace it without touching
  // custom AUDIO, camera, dialogue or transition instructions around it.
  const base = prompt.replace(/^SOUND CUES:\r?\n(?:-[^\n]*(?:\n|$))*/gm, '').trimEnd();
  const cues = videoSoundCues(scene, clip);
  const brief = text(clip.soundEffects);
  if (!brief && !cues.length) return base;
  const lines = [
    'SOUND CUES:',
    ...(brief && !base.includes(brief) ? [`- Shot sounds: ${brief}`] : []),
    ...cues.map(
      (cue) =>
        `- ${cue.type === 'ambience' ? 'Ambience' : 'Effect'} ${cue.start}–${cue.end}s: ${cue.description}`
    ),
    `- Mix: Sync effects to their cues; add no unplanned sounds. ${clip.dialogue?.trim() ? 'Dialogue stays clear above ambience/effects. ' : ''}No music.`
  ];
  return `${base}\n${lines.join('\n')}`;
}
