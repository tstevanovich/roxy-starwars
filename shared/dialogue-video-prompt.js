// Reference images are complete compositions, not one image per speaker.
// Image 2 may be the next part's end reference; never bind it to speaker two.
export function videoDialogueTurns(dialogue = '') {
  const turns = [];
  for (const line of dialogue.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^\s*([a-z][a-z0-9 '-]{0,79}):\s*(.*)$/i);
    if (match) turns.push({ speaker: match[1].trim(), text: match[2].trim() });
    else if (turns.length) turns.at(-1).text += '\n' + line.trim();
    else return null;
  }
  return turns.length && turns.every((turn) => turn.text) ? turns : null;
}

export function videoDialoguePrompt(dialogue = '') {
  const turns = videoDialogueTurns(dialogue);
  if (!turns) return dialogue.trim() ? JSON.stringify(dialogue.trim()) : 'No dialogue.';
  return turns.map(({ speaker, text }) => `${speaker} says: ${JSON.stringify(text)}`).join('\n');
}

export function lipSyncDirections(dialogue = '') {
  if (!dialogue.trim()) return '';
  const turns = videoDialogueTurns(dialogue);
  const speakers = [...new Set((turns ?? []).map((turn) => turn.speaker.toLowerCase()))];
  return [
    speakers.length > 1
      ? 'Audio 1 contains the exchange. Keep each voice with its named character and preserve turn order. Composition references do not represent different speakers.'
      : 'Voice timbre reference Audio 1.',
    "Lip sync. Match each visible speaker's mouth to their audible words and pauses in the generated soundtrack. Only the named speaker mouths each line; listeners' mouths rest. After speech, mouths rest; do not stretch dialogue to fill the shot. Preserve framing and blocking."
  ].join(' ');
}

const sectionPattern = (name, speakers) => {
  const names = speakers.map((speaker) => speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const boundary = `^${names ? `(?!(?:${names}):)` : ''}[A-Z][A-Z0-9 /_-]{1,60}(?:[ \\t]*\\([^\\n:]*\\))?:`;
  return new RegExp(`^${name}:[\\s\\S]*?(?=${boundary}|(?![\\s\\S]))`, 'gm');
};

// Every dialogue render and its preview use the same automatic guidance.
// Custom camera/action/sound/transition directions stay verbatim.
export function improveVideoLipSyncPrompt(prompt, dialogue = '') {
  if (!dialogue.trim()) return prompt;
  dialogue = dialogue.replace(/\bAL\b(?!-1B\b|[ \t]*:)/g, 'Al');
  const speakers = (videoDialogueTurns(dialogue) ?? []).map((turn) => turn.speaker.toUpperCase());
  const dialogueBlock = `DIALOGUE: ${videoDialoguePrompt(dialogue)}\n`;
  let result = prompt.replace(sectionPattern('LIP SYNC', speakers), '');
  if (/^DIALOGUE:/m.test(result))
    result = result.replace(sectionPattern('DIALOGUE', speakers), () => dialogueBlock);
  else result = `${result.trimEnd()}\n${dialogueBlock}`;
  return `${result.trimEnd()}\nLIP SYNC: ${lipSyncDirections(dialogue)}`;
}
