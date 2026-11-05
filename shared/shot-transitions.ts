import type * as Studio from './types.ts';
const numberedPart = (clip: Studio.ClipInput) => {
  const match = clip?.title?.match(/^(.*?)\bpart\s*(\d+)(?:\s*(?:of|\/)\s*(\d+))?\s*$/i);
  if (!match) return null;
  const name = match[1]
    .replace(/[\s\-–—:]+$/, '')
    .trim()
    .toLowerCase();
  const part = Number(match[2]),
    total = match[3] ? Number(match[3]) : null;
  return name && part > 0 && (!total || total >= part) ? { name, part, total } : null;
};

export function multipartShot(scene: Studio.SceneInput, clip: Studio.ClipInput) {
  const current = numberedPart(clip);
  if (!current) return null;
  const index = scene.clips.findIndex((item) => item.id === clip.id);
  if (index < 0) return null;
  const candidate = scene.clips[index + 1],
    next = numberedPart(candidate);
  const matches =
    next?.name === current.name &&
    next.part === current.part + 1 &&
    (!current.total || !next.total || current.total === next.total);
  const needsEnd = current.total ? current.part < current.total : matches;
  return {
    part: current.part,
    total: current.total,
    needsEnd,
    nextClipId: needsEnd && matches ? candidate.id : null,
    nextTitle: needsEnd && matches ? candidate.title : null
  };
}

// Saved complete prompts may contain an earlier automatic transition block.
// Remove only our recognized lines; keep custom directions and spoken text.
export function withoutManagedVideoTransition(prompt = '') {
  const quotes = [];
  const lines = prompt
    .replace(/"(?:\\.|[^"\\])*"|“[^”]*”/g, (quote) => {
      quotes.push(quote);
      return `__TRANSITION_QUOTE_${quotes.length - 1}__`;
    })
    .split(/\r?\n/);
  const result = [];
  for (let index = 0; index < lines.length; index++) {
    if (
      /^(?:NUMBERED SHOT CONTINUITY|SHOT CONTINUITY|SHOT REFERENCE CONTINUITY): (?:Generate one continuous shot\.|Follow the saved shot timing and camera directions\.)$/.test(
        lines[index]
      ) &&
      /^@?Image\s*1 is (?:the )?START/.test(lines[index + 1] ?? '')
    ) {
      while (
        index + 1 < lines.length &&
        /^(?:@?Image\s*[12] (?:is|supplies)|This is the final part\.|Keep identities, costumes, set geometry and lighting consistent\.|Preserve identities; change only|Follow only this shot|@?Audio\s*1 (?:is|supplies))/.test(
          lines[index + 1]
        )
      )
        index++;
    } else result.push(lines[index]);
  }
  return result
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
    .replace(/__TRANSITION_QUOTE_(\d+)__/g, (_match, index) => quotes[Number(index)]);
}

function hasExplicitVideoCut(directions) {
  const cameraDirections = withoutManagedVideoTransition(directions)
    .replace(/"(?:\\.|[^"\\])*"|“[^”]*”/g, '')
    .replace(/^DIALOGUE:[\s\S]*?(?=^[A-Z][A-Z /_-]+:|$(?![\s\S]))/gm, '')
    .replace(/\b(?:no|never|avoid|without|do not|don't)\s+(?:any\s+)?(?:hard[ -]+)?cuts?\b/gi, '');
  return /\b(?:hard[ -]+cut|cuts?\s+(?:to|at|between|from))\b/i.test(cameraDirections);
}

export function startOnlyVideoPrompt(
  scene: Studio.SceneInput,
  clip: Studio.ClipInput,
  prompt = ''
) {
  const firstIdentity = prompt.match(/^- [^\n]+ = @?Image\s*(\d+) identity/m);
  const oldEnd = clip.production?.videoEndFrame
    ? clip.production.videoEndFrame.mode === 'image'
    : Boolean(multipartShot(scene, clip)?.needsEnd);
  const oldLayout = firstIdentity ? Number(firstIdentity[1]) > 2 : oldEnd;
  let base = withoutManagedVideoTransition(prompt);
  const custom = withoutManagedVideoTransition(clip.production?.videoTransitionPrompt ?? '');
  if (custom.trim() && !base.includes(custom.trim())) base += '\n' + custom;
  const protectedText = [];
  const protect = (value) => {
    protectedText.push(value);
    return `__START_ONLY_TEXT_${protectedText.length - 1}__`;
  };
  base = base.replace(/"(?:\\.|[^"\\])*"|\u201c[^\u201d]*\u201d/g, protect);
  const speakers = new Set(
    (clip.dialogue ?? '').split(/\r?\n/).map((line) => line.split(':')[0].trim())
  );
  base = base
    .split('\n')
    .map((line) => {
      const label = line.match(/^\s*([^:]+):/);
      return label && (label[1] === 'DIALOGUE' || speakers.has(label[1])) ? protect(line) : line;
    })
    .join('\n');
  if (
    (oldLayout && /@?Image\s*[2-9]\d*\b/i.test(base)) ||
    /\b(?:end(?:ing)?[ -](?:frame|image|composition)|(?:next|following) (?:shot|part)(?:'s|\u2019s)? (?:image|composition))\b/i.test(
      base
    )
  )
    base = base
      .split(/\n|(?<=[.!?])\s+(?=[A-Z@])/)
      .filter((sentence) => {
        if (oldLayout && /@?Image\s*2\b/i.test(sentence)) return false;
        return !/\b(?:end(?:ing)?[ -](?:frame|image|composition)|(?:next|following) (?:shot|part)(?:'s|\u2019s)? (?:image|composition))\b/i.test(
          sentence
        );
      })
      .map((sentence) =>
        oldLayout
          ? sentence.replace(/@?Image\s*(\d+)\b/gi, (tag, number) =>
              Number(number) > 2 ? `Image ${Number(number) - 1}` : tag
            )
          : sentence
      )
      .join('\n');
  for (let index = protectedText.length - 1; index >= 0; index--)
    base = base.replaceAll(`__START_ONLY_TEXT_${index}__`, protectedText[index]);
  return base.trim();
}

export function videoTransitionPrompt(
  scene: Studio.SceneInput,
  clip: Studio.ClipInput,
  directions = clip.production?.videoPrompt ?? ''
) {
  if (
    !multipartShot(scene, clip) &&
    !clip.production?.videoEndFrame &&
    !clip.production?.videoTransitionPrompt
  )
    return '';
  return [
    hasExplicitVideoCut(directions)
      ? 'SHOT REFERENCE CONTINUITY: Follow the saved shot timing and camera directions.'
      : 'SHOT CONTINUITY: Generate one continuous shot.',
    "Image 1 is the START reference: use this shot's approved image for the composition, cast and background.",
    "Follow only this shot's specified camera movement, action and dialogue. Preserve identities, wardrobe, set geometry and lighting. Do not perform the following shot's action."
  ].join('\n');
}

export const joinVideoPrompt = (base, transition) =>
  [withoutManagedVideoTransition(base), transition].filter(Boolean).join('\n\n');
