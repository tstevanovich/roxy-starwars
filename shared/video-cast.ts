import { videoDialogueTurns } from './dialogue-video-prompt.ts';
import { shotAssetIds } from './shot-references.ts';
import type * as Studio from './types.ts';

const key = (value) => value.trim().toLowerCase();
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matches = (name: string, value) =>
  new RegExp(`(^|[^a-z0-9])${escape(name)}(?=$|[^a-z0-9])`, 'i').test(value);

const identityNames = (asset: Studio.AssetInput) =>
  [...(asset.aliases ?? []), ...asset.name.split(/\s[-\u2013\u2014]\s/)[0].split(/\s+/)].filter(
    (name: string) =>
      /^[a-z][a-z0-9'-]+$/i.test(name) &&
      !/^(overseer|lord|darth|captain|master|adult|sith|jedi|identity|character|production|package|episode)$/i.test(
        name
      )
  );

export function videoReferenceChoices(assets: Studio.AssetInput[], media: Studio.MediaInput[]) {
  return assets
    .filter(
      (asset) =>
        !asset.archived &&
        ['character', 'droid'].includes(asset.kind) &&
        asset.finalChoice?.mediaIds?.length &&
        asset.reviewStatus !== 'pending-choice'
    )
    .map((asset) => ({
      assetId: String(asset._id),
      title: asset.name,
      names: [(identityNames(asset)[0] ?? asset.name).toUpperCase()],
      mediaId: String(asset.finalChoice.mediaIds[0])
    }))
    .filter(
      (reference) =>
        !media ||
        media.some((file) => String(file._id) === reference.mediaId && file.kind === 'image')
    );
}

export function videoCharacterReferences(
  scene: Studio.SceneInput,
  clip: Studio.ClipInput,
  assets: Studio.AssetInput[],
  media?: Studio.MediaInput[]
) {
  if (!clip.dialogue?.trim()) return [];
  if (clip.production?.videoReferenceMediaIds !== undefined) {
    const choices = videoReferenceChoices(assets, media);
    return clip.production.videoReferenceMediaIds
      .map(String)
      .map((id) => choices.find((choice) => choice.mediaId === id))
      .filter(Boolean)
      .map((reference, index: number) => ({ ...reference, imageNumber: index + 2 }));
  }
  const characters = assets
    .filter(
      (asset) =>
        !asset.archived &&
        ['character', 'droid'].includes(asset.kind) &&
        asset.finalChoice?.mediaIds?.length &&
        asset.reviewStatus !== 'pending-choice'
    )
    .sort((a, b) => String(a._id).localeCompare(String(b._id)));
  const linked = shotAssetIds(scene, clip, assets).map(String);
  const names = [...new Set((videoDialogueTurns(clip.dialogue) ?? []).map((turn) => turn.speaker))];
  const directions =
    clip.production?.videoPrompt?.trim() ||
    [
      clip.action,
      clip.production?.allowedMotion,
      clip.production?.startState,
      clip.production?.endState
    ]
      .filter(Boolean)
      .join(' ');
  const action = directions
    .replace(/^CAST REFERENCES:\r?\n(?:-[^\n]*(?:\n|$))*/gm, '')
    .replace(/"(?:\\.|[^"\\])*"|\u201c[^\u201d]*\u201d/g, '')
    .split('\n')
    .filter((line) => !/^\s*DIALOGUE:/.test(line))
    .join(' ');
  const knownNames = characters.flatMap(identityNames).map(escape).join('|');
  const excluded = (name: string) =>
    new RegExp(
      `\\b(?:no|not|without|exclude|omit)\\s+(?:(?:the|adult|character|showing|including|extra|additional)\\s+)*(?:(?:${knownNames})\\s*(?:,|or|and)\\s*)*${escape(name)}\\b|\\b(?:do not|don't|never)\\s+(?:include|show|add|depict)\\s+(?:the\\s+)?(?:character\\s+)?${escape(name)}\\b|\\b${escape(name)}\\s*(?:is |remains |: )?(?:absent|offscreen|not (?:present|visible|shown|included))\\b`,
      'i'
    ).test(action);
  const imageIds = (clip.production?.imageReferenceMediaIds ?? []).map(String);
  for (const asset of characters) {
    const candidates = identityNames(asset);
    if (candidates.some(excluded)) continue;
    const selectedForImage = [
      ...asset.finalChoice.mediaIds,
      ...(asset.production?.items ?? []).map((item) => item.mediaId),
      ...(asset.characterSheets ?? []).map((sheet) => sheet.mediaId)
    ].some((id) => id && imageIds.includes(String(id)));
    const found =
      candidates.find(
        (name: string) =>
          matches(name, action) &&
          (clip.production?.videoPrompt?.trim() || linked.includes(String(asset._id)))
      ) || (selectedForImage ? candidates[0] : null);
    if (found && !names.some((name: string) => key(name) === key(found)))
      names.push(found.toUpperCase());
  }
  const assigned = new Map();
  for (const name of names) {
    const all = characters.filter((asset) =>
      [asset.name, ...(asset.aliases ?? [])].some((value) => matches(name, value))
    );
    const preferred = all.filter((asset) => linked.includes(String(asset._id)));
    const candidates = preferred.length ? preferred : all;
    if (candidates.length !== 1) continue;
    const asset = candidates[0],
      mediaId = String(asset.finalChoice.mediaIds[0]);
    if (media && !media.some((file) => String(file._id) === mediaId && file.kind === 'image'))
      continue;
    const existing = assigned.get(String(asset._id));
    if (existing) existing.names.push(name);
    else
      assigned.set(String(asset._id), {
        assetId: String(asset._id),
        title: asset.name,
        names: [name],
        mediaId
      });
  }
  return [...assigned.values()]
    .slice(0, 9)
    .map((reference, index: number) => ({ ...reference, imageNumber: index + 2 }));
}

export function remapVideoReferencePrompt(prompt: string, previous, next) {
  const quotes = [];
  const base = prompt
    .replace(/^CAST REFERENCES:\r?\n(?:-[^\n]*(?:\n|$))*/gm, '')
    .replace(/"(?:\\.|[^"\\])*"|\u201c[^\u201d]*\u201d/g, (quote) => {
      quotes.push(quote);
      return `__VIDEO_REFERENCE_QUOTE_${quotes.length - 1}__`;
    });
  return base
    .split('\n')
    .map((line) =>
      /^DIALOGUE:|^[A-Z][A-Z '-]+ says:/.test(line)
        ? line
        : line.replace(/(?<![\w@])@?Image\s*(\d+)\b/gi, (tag, number) => {
            const old = previous.find((reference) => reference.imageNumber === Number(number));
            if (!old) return tag;
            const index = next.indexOf(old.mediaId);
            return index < 0 ? old.names.join(' / ') : `@Image${index + 2}`;
          })
    )
    .join('\n')
    .replace(/__VIDEO_REFERENCE_QUOTE_(\d+)__/g, (_match, index: number) => quotes[Number(index)])
    .trimEnd();
}

export function withVideoCastPrompt(prompt: string, references = []) {
  const quotes = [];
  let base = prompt
    .replace(/^CAST REFERENCES:\r?\n(?:-[^\n]*(?:\n|$))*/gm, '')
    .trimEnd()
    .replace(/"(?:\\.|[^"\\])*"|\u201c[^\u201d]*\u201d/g, (quote) => {
      quotes.push(quote);
      return `__CAST_QUOTE_${quotes.length - 1}__`;
    });
  for (const reference of references)
    if (/^[a-f\d]{24}$/i.test(reference.mediaId ?? ''))
      base = base.replace(
        new RegExp(`\\b${reference.mediaId}\\b`, 'g'),
        `Image ${reference.imageNumber}`
      );
  base = base.replace(/__CAST_QUOTE_(\d+)__/g, (_match, index: number) => quotes[Number(index)]);
  if (!references.length) return base;
  return [
    base,
    'CAST REFERENCES:',
    ...references.map(
      (reference) =>
        `- ${reference.names.join(' / ')} = Image ${reference.imageNumber} identity; match them in the compositions.`
    ),
    '- Identity images define faces only. Keep the composition’s cast, wardrobe and background.'
  ].join('\n');
}
