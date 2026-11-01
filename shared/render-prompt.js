// Remove application instructions, not creative constraints. Quoted text and
// dialogue lines are protected: a character or sign can legitimately name an app.
export function cleanRenderPrompt(value = '') {
  const quotes = [];
  const protectedValue = value.replace(/"(?:\\.|[^"\\])*"|“[^”]*”/g, (quote) => {
    quotes.push(quote);
    return `__RENDER_QUOTE_${quotes.length - 1}__`;
  });
  const result = protectedValue
    .split('\n')
    .map((line) => {
      if (
        /^\s*(?:DIALOGUE:|[A-Za-z][A-Za-z0-9 '-]{0,79}\s+(?:says|replies|whispers|shouts):)/.test(
          line
        )
      )
        return line;
      if (
        /^\s*(?:WORKFLOW|APPROVAL STATUS|REVIEW STATUS|RENDER AUTHORIZATION|BILLING|COST|EXPORT|DOWNLOAD|EDITING NOTES|POST[- ]PRODUCTION NOTES|MODEL SETTINGS|GENERATION SETTINGS):/i.test(
          line
        ) ||
        /^\s*CREDITS?:\s*\d/i.test(line)
      )
        return '';
      // Raw labelled dialogue in older custom prompts has no quotation marks.
      if (
        /^\s*[A-Z][A-Z0-9 '-]{0,79}:/.test(line) &&
        !/^\s*(?:SHOT|FRAME|LOCATION|PHYSICAL CONTINUITY|ACTION|PRONUNCIATION|CAMERA|CAMERA AND LIGHT|START STATE|ALLOWED MOTION|TIMED ACTION|END STATE AT CUT|STAGING|PASS CONDITIONS|AUDIO|FINAL AUDIO RULE|CONTINUITY|REFERENCES|VISUAL DETAILS|LIP SYNC|NUMBERED SHOT CONTINUITY|SHOT CONTINUITY|UNIVERSE AND ERA|REQUESTED CHANGES):/.test(
          line
        )
      )
        return line;
      const cleaned = line
        .replace(
          /\b(?:Music|The music|Background music|The score)\s+(?:is|will be)\s+(?:added|mixed|assembled|edited)\s+(?:later\s+)?(?:in|with|using)\s+(?:CapCut|Premiere(?: Pro)?|DaVinci Resolve|the editor)\b[^.!?\n]*[.!?]?/gi,
          ''
        )
        .replace(
          /\b(?:Selected|Saved|Approved)\s+(?:(?:dialogue|audio)\s+)?(?:recording|performance)\s+(?:was\s+|is\s+)?measured,?\s*(?:at most|under|within)\s+\d+(?:\.\d+)?\s*(?:seconds?|s)\b[^.;\n]*/gi,
          ''
        )
        .replace(
          /(?:^|(?<=[.!?;])\s+)(?:Review|Approve|Save|Apply|Finalize)\b[^.!?\n]*(?:before\s+(?:(?:image|video)\s+)?(?:generating|generation|rendering)|(?:Generate|Save|Apply)\s+(?:image|video|scene|draft)\s+button)[^.!?\n]*[.!?]?/gi,
          ''
        )
        .replace(
          /(?:^|(?<=[.!?;])\s+)(?:No\s+(?:paid\s+)?(?:render|generation)\s+(?:is\s+|was\s+)?requested|This\s+(?:draft|proposal)\s+(?:does not|has not))[^.!?\n]*[.!?]?/gi,
          ''
        )
        .replace(/\bowner-(?:approved|selected)\s+/gi, '');
      if (cleaned === line) return line;
      return cleaned
        .replace(/[ \t]*;[ \t]*(?=[.!?]|$)/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trimEnd();
    })
    .filter((line, index, lines) => line.trim() || (index > 0 && lines[index - 1].trim()))
    .join('\n')
    .trim();
  return result.replace(/__RENDER_QUOTE_(\d+)__/g, (_match, index) => quotes[Number(index)]);
}
