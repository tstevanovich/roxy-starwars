import { StudioAsset } from './models/Studio.js';

// Package descriptions are labels, not new character identities. Preserve
// hyphenated names such as AL-1B while ignoring an appended package subtitle.
const identityName = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .split(/\s*[—–:]\s*|\s+-\s+/)[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export async function existingCharacterAsset(fields) {
  if (fields.clipId || !['character', 'droid'].includes(fields.kind)) return null;
  const names = [fields.name, ...(fields.aliases ?? [])].map(identityName).filter(Boolean);
  const assets = await StudioAsset.find({
    kind: fields.kind,
    archived: { $ne: true },
    clipId: null
  }).lean();
  const matches = assets.filter((asset) =>
    [asset.name, ...(asset.aliases ?? [])].map(identityName).some((name) => names.includes(name))
  );
  return (
    matches.sort(
      (a, b) =>
        Number(Boolean(b.finalChoice)) - Number(Boolean(a.finalChoice)) ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )[0] ?? null
  );
}
