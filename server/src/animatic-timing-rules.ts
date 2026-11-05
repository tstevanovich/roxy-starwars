import type * as Studio from '../../shared/types.ts';
export const audioReferenceLimit = 15;
export function animaticTimingIssue(clip: Studio.ClipInput, audioSeconds) {
  if (!clip.dialogue?.trim() || !Number.isFinite(audioSeconds)) return null;
  if (audioSeconds <= audioReferenceLimit && audioSeconds <= clip.duration + 0.1) return null;
  return {
    clipId: clip.id,
    audioSeconds,
    shotSeconds: clip.duration,
    split: audioSeconds > audioReferenceLimit,
    message: `${clip.title}: selected dialogue is ${audioSeconds.toFixed(2)}s; shot is ${clip.duration}s. The audio asset must be at most 15 seconds and fit within the shot. The shot itself may be longer than 15 seconds.`
  };
}

// Keep every spoken word and speaker in order. These are planning estimates;
// each new performance is measured again before animatic approval.
export function splitDialogueForTiming(dialogue, audioSeconds, shotSeconds) {
  const turns = [];
  for (const line of dialogue.split(/\r?\n/).filter((line) => line.trim())) {
    const match = line.match(/^\s*([^:]+):\s*(.*)$/);
    if (match) turns.push({ speaker: match[1].trim(), text: match[2].trim() });
    else if (turns.length) turns.at(-1).text += ' ' + line.trim();
    else throw new Error('Label each dialogue turn with its speaker before splitting.');
  }
  const words = turns.reduce((sum, turn) => sum + turn.text.split(/\s+/).length, 0);
  const rate = words / Math.max(audioSeconds, shotSeconds);
  const budget = Math.max(1, Math.floor(Math.min(rate, 2.7) * 11));
  const groups = [];
  let current = [],
    count = 0;
  for (const turn of turns) {
    const sentences = turn.text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [turn.text];
    for (const sentence of sentences) {
      const tokens = sentence.trim().split(/\s+/);
      while (tokens.length) {
        if (count && count + tokens.length > budget) {
          groups.push(current);
          current = [];
          count = 0;
        }
        const chunk = tokens.splice(0, budget);
        if (current.at(-1)?.speaker === turn.speaker) current.at(-1).text += ' ' + chunk.join(' ');
        else current.push({ speaker: turn.speaker, text: chunk.join(' ') });
        count += chunk.length;
      }
    }
  }
  if (current.length) groups.push(current);
  return groups.map((group) => {
    const length = group.reduce((sum, turn) => sum + turn.text.split(/\s+/).length, 0);
    return {
      dialogue: group.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n'),
      duration: Math.max(2, Math.min(30, Math.ceil((length / rate) * 2) / 2))
    };
  });
}
