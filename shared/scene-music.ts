import type * as Studio from './types.ts';
export const musicModel = 'music_v2_5';
export const sceneSeconds = (scene: Studio.SceneInput) =>
  scene.clips.reduce((sum, c) => sum + Number(c.duration), 0);
export function musicPrompt(scene: Studio.SceneInput, bufferSeconds = 5) {
  const seconds = sceneSeconds(scene),
    generated = seconds + bufferSeconds;
  let cursor = 0;
  const beats = scene.clips.map((clip, index: number) => {
    const start = cursor;
    cursor += Number(clip.duration);
    const direction =
      index === 0
        ? 'Begin immediately with an audible French-horn melody over moving cellos and supporting violins. Establish scale and restrained anticipation.'
        : index === scene.clips.length - 1
          ? 'Continue the musical phrase at the established audible volume. Keep melody and accompaniment actively playing through and beyond this shot. Do not compose an ending.'
          : 'Develop the same minor-key theme with flowing strings, restrained low brass and occasional woodwind phrases. Maintain continuous musical movement, leaving space for scene sounds.';
    return `${start}–${cursor} seconds — ${clip.title}: ${direction}`;
  });
  const detailed = beats.join('\n');
  const timing =
    detailed.length <= 1800
      ? detailed
      : `0–${seconds} seconds — ${String(scene.title ?? 'Scene').slice(0, 160)}: Begin with a clear horn melody over moving strings. Develop it continuously across all ${scene.clips.length} shot changes with restrained brass and woodwind variations. Sustain an active phrase through the last shot; do not compose an ending.`;
  return `Create exactly ${generated} seconds of continuous instrumental orchestral underscore for a cinematic space-fantasy scene. The edited scene is ${seconds} seconds; ${bufferSeconds} extra seconds provide a bounded allowance for provider silence. This is one ongoing musical performance, not a complete song with an intro and outro.

IMMEDIATE START: At 0.0 seconds, the orchestra is already playing clearly audible cellos, basses, supporting violins and an expressive French-horn melody. Maintain a usable background-score volume from the first moment. No leading silence, fade-in, delayed entrance or empty introductory bars.

SOUND: Original traditional symphonic space-opera underscore. Majestic, mysterious and ominous; immense scale, ancient power and restrained menace. Approximately 72 BPM in 4/4 with an original minor-key theme. Acoustic orchestra, expressive horns, flowing strings, restrained low brass, occasional woodwinds and sparse timpani. Clear recording with restrained room ambience. Leave sonic space for separately recorded engines, wind, landing sounds, footsteps and dialogue.

SCENE TIMING:
${timing}
${bufferSeconds ? `${seconds}–${generated} seconds: Continue seamlessly with the same theme, accompaniment and audible volume. This is continuation material, not an outro.` : ''}

CONTINUOUS END: Keep audible melody and moving accompaniment present right through ${generated} seconds. End the file while the orchestra is still actively performing. The editor will trim and fade the finished cue locally. No early stop, concluding chord, final cadence, long reverberation tail, fade-out or trailing silence.

Instrumental music only. No voices, choir, narration, synthesizers, electronic beats, sound effects, opening fanfare or sudden trailer impacts. Compose an original melody; do not reproduce an existing recording.`;
}
