// Reference numbers follow attachment order, independently for images and audio.
// Keep quoted speech and raw labelled dialogue intact when upgrading older tags.
export function taggedVideoReferences(prompt: string = '', { endImage = false } = {}) {
  const quotes = [];
  const protectedPrompt = prompt.replace(/"(?:\\.|[^"\\])*"|“[^”]*”/g, (quote) => {
    quotes.push(quote);
    return `__REFERENCE_QUOTE_${quotes.length - 1}__`;
  });
  const tagged = protectedPrompt
    .split('\n')
    .map((line) => {
      if (
        /^\s*(?:DIALOGUE:|[A-Za-z][A-Za-z0-9 '-]{0,79}\s+(?:says|replies|whispers|shouts):)/.test(
          line
        )
      )
        return line;
      if (
        /^\s*[A-Z][A-Z0-9 '-]{0,79}:/.test(line) &&
        !/^\s*(?:AUDIO|LIP SYNC|ACTION|FRAME|LOCATION|PHYSICAL CONTINUITY|CAMERA|CAMERA AND LIGHT|STAGING|START STATE|ALLOWED MOTION|TIMED ACTION|END STATE AT CUT|SHOT CONTINUITY|NUMBERED SHOT CONTINUITY|REFERENCES|CAST REFERENCES|REQUESTED CHANGES):/.test(
          line
        )
      )
        return line;
      return line.replace(
        /(?<![\w@])@?(image|audio|video)\s*(\d+)\b/gi,
        (_match, type, number) => `@${type[0].toUpperCase()}${type.slice(1).toLowerCase()}${number}`
      );
    })
    .join('\n');
  let bound = /@Image1\b/.test(tagged)
    ? tagged
    : tagged + '\n@Image1 defines the starting composition, cast and background.';
  if (endImage && !/@Image2\b/.test(bound))
    bound += '\n@Image2 defines the ending composition; finish matching its framing and staging.';
  return bound.replace(/__REFERENCE_QUOTE_(\d+)__/g, (_match, index) => quotes[Number(index)]);
}

export function imageReferencePromptBase(prompt: string = '') {
  return prompt.replace(/\n*ATTACHED IMAGE REFERENCES:\r?\n(?:-[^\n]*(?:\n|$))*/g, '').trimEnd();
}

export function remapImageReferencePrompt(prompt: string, previous, nextIds) {
  const base = imageReferencePromptBase(prompt);
  // Older generated shot prompts copied the whole design library into this
  // section. The attachment-role block below is now the authoritative mapping.
  const selectedBase =
    base.startsWith('UNIVERSE AND ERA:') &&
    base.includes('Create one photorealistic cinematic still.')
      ? base.replace(/\nREFERENCES:[\s\S]*?(?=\nFRAME:)/, '')
      : base;
  return selectedBase
    .replace(/^@image(\d+) is the approved master portrait:[^\n]*\n?/gm, (line, number) =>
      nextIds.includes(previous[Number(number) - 1]?.mediaId) ? line : ''
    )
    .replace(/^SHOT-TO-SHOT CONTINUITY: The FIRST supplied images[^\n]*\n?/gm, '')
    .replace(/^Continuity image \d+:[^\n]*\n?/gm, '')
    .replace(/@image(\d+)\b/gi, (tag, number) => {
      const reference = previous[Number(number) - 1];
      if (!reference) return tag;
      const index = nextIds.indexOf(reference.mediaId);
      return index < 0
        ? reference.subject || reference.title || 'the described subject'
        : `@image${index + 1}`;
    });
}

export function withImageReferencePrompt(prompt: string = '', references = []) {
  const base = imageReferencePromptBase(prompt);
  if (!references.length) return base;
  return [
    base,
    'ATTACHED IMAGE REFERENCES:',
    ...references.map((reference) => {
      const subject = reference.subject || reference.role || 'Visual reference';
      const detail = reference.view ? `; ${reference.view}` : '';
      const purpose =
        reference.sourceType === 'approved-shot-image'
          ? 'match its visible background, framing and spatial layout; apply the requested action and physical state'
          : reference.role === 'Character identity'
            ? 'preserve this character’s identity and the pictured design'
            : 'preserve the pictured design and materials';
      return `- @image${reference.imageNumber}: ${subject} (${reference.role || 'Image reference'}${detail}); ${purpose}.`;
    })
  ].join('\n');
}
