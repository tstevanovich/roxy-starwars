export const alPronunciation =
  'The droid’s nickname is "Al": one syllable, rhyming with "pal". Never spell the nickname as the letters A and L.';

export function spokenDialogue(dialogue) {
  // Keep the formal designation and speaker labels for reference binding.
  return dialogue.replace(/\bAL\b(?!-1B\b|[ \t]*:)/g, 'Al');
}
