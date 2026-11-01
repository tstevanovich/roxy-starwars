import { videoDialogueTurns } from './dialogue-video-prompt.js';
import { shotAssetIds } from './shot-references.js';
import { shotTransition } from './shot-transitions.js';

const key = (value) => value.trim().toLowerCase();
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matches = (name, value) =>
  new RegExp(`(^|[^a-z0-9])${escape(name)}(?=$|[^a-z0-9])`, 'i').test(value);

export function videoCharacterReferences(episodeId, scene, clip, assets, media, scenes = [scene]) {
  if (!clip.dialogue?.trim()) return [];
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
  const action = [
    clip.action,
    clip.production?.allowedMotion,
    clip.production?.startState,
    clip.production?.endState
  ]
    .filter(Boolean)
    .join(' ');
  for (const asset of characters.filter((item) => linked.includes(String(item._id)))) {
    const root = asset.name.split(/\s[-–—]\s/)[0];
    const candidates = [...(asset.aliases ?? []), ...root.split(/\s+/)].filter(
      (name) =>
        /^[a-z][a-z0-9'-]+$/i.test(name) &&
        !/^(overseer|lord|darth|captain|master|adult|sith|jedi|identity|character|production|package|episode)$/i.test(
          name
        )
    );
    const found = candidates.find((name) => matches(name, action));
    if (found && !names.some((name) => key(name) === key(found))) names.push(found.toUpperCase());
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
    if (existing) {
      if (!existing.names.includes(name)) existing.names.push(name);
    } else
      assigned.set(String(asset._id), {
        assetId: String(asset._id),
        title: asset.name,
        names: [name],
        mediaId
      });
  }
  const transition = shotTransition(episodeId, scene, clip, assets, media, scenes);
  const offset = transition?.needsEnd ? 2 : 1;
  return [...assigned.values()]
    .slice(0, 20 - offset - 1)
    .map((reference, index) => ({ ...reference, imageNumber: offset + index + 1 }));
}

export function withVideoCastPrompt(prompt, references = []) {
  const base = prompt.replace(/^CAST REFERENCES:\r?\n(?:-[^\n]*(?:\n|$))*/gm, '').trimEnd();
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
