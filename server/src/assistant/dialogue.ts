import type * as Studio from '../../../shared/types.ts';
import { fail } from '../studio-validation.ts';

export const speakerKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
export function dialogueTurns(dialogue = '') {
  const turns = [];
  for (const line of dialogue.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^\s*([a-z][a-z0-9 '-]{0,79}):\s*(.*)$/i);
    if (match) turns.push({ speaker: match[1].trim(), text: match[2] });
    else if (turns.length) turns.at(-1).text += '\n' + line;
    else fail('Label dialogue with its speaker, for example ROXY: Hello.');
  }
  if (!turns.length || turns.some((turn) => !turn.text.trim()))
    fail('Each dialogue speaker needs spoken text.');
  return turns.map((turn) => ({ ...turn, text: turn.text.replace(/\bAL\b/g, 'Al') }));
}
export function speakerAsset(speaker: string, assets: Studio.AssetInput[], kind = 'voice') {
  const key = speakerKey(speaker),
    first = /^(al|al-1b)$/.test(key) ? 'al' : key.split(' ')[0];
  const matches = assets.filter(
    (asset) =>
      !asset.archived &&
      asset.kind === kind &&
      [asset.name, ...(asset.aliases ?? [])].some((name: string) =>
        String(name)
          .toLowerCase()
          .split(/[^a-z0-9'-]+/)
          .includes(first)
      )
  );
  return (
    matches.find(
      (asset) => asset.finalChoice?.voiceId && asset.finalChoice.voiceModel === 'eleven_v3'
    ) ?? matches[0]
  );
}
export function dialogueCast(clip: Studio.ClipInput, assets: Studio.AssetInput[]) {
  const turns = dialogueTurns(clip.dialogue);
  const missing = [
    ...new Map(turns.map(({ speaker }) => [speakerKey(speaker), speaker])).values()
  ].filter((speaker: string) => {
    const voice = speakerAsset(speaker, assets);
    return !voice?.finalChoice?.voiceId || voice.finalChoice.voiceModel !== 'eleven_v3';
  });
  if (missing.length) fail(`Voice auditions need approval for: ${missing.join(', ')}.`);
  const inputs = turns.map(({ speaker, text }) => ({
    text,
    voice_id: speakerAsset(speaker, assets).finalChoice.voiceId
  }));
  if (
    new Set(inputs.map((input) => input.voice_id)).size > 10 ||
    inputs.reduce((sum, input) => sum + input.text.length, 0) > 2000
  )
    fail(
      'This dialogue exceeds the provider limit of 10 voices and 2,000 spoken characters per request.'
    );
  return {
    turns,
    inputs,
    voices: turns.map(({ speaker }) => speakerAsset(speaker, assets).finalChoice)
  };
}
