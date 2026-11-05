import type * as Studio from '../../shared/types.ts';
// Display links already saved in owner source notes/briefs. This does not fetch
// or verify a website and does not change an existing source approval.
export function savedAssetSourceLinks(asset: Studio.AssetInput) {
  const links = new Map();
  for (const [origin, text] of [
    ['primary', asset.production?.sourceUrl ?? ''],
    ['notes', asset.production?.sourceNotes ?? ''],
    ['brief', asset.brief ?? '']
  ]) {
    for (const match of text.match(/https?:\/\/[^\s<>"']+/g) ?? []) {
      try {
        const url = new URL(match.replace(/[.,;:!?)\]}]+$/g, ''));
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
        if (!links.has(url.href))
          links.set(url.href, { url: url.href, host: url.hostname, origin });
      } catch {
        /* Ignore incomplete prose URLs. */
      }
    }
  }
  return [...links.values()];
}
export function capturedSourceLink(file) {
  const frame = file?.sourceFrame;
  if (!frame?.sourceUrl) return null;
  try {
    const url = new URL(frame.sourceUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const seconds = frame.requestedSeconds ?? frame.sourceSeconds;
    if (Number.isFinite(seconds) && /^(www\.)?(youtube\.com|youtu\.be)$/.test(url.hostname))
      url.searchParams.set('t', String(Math.floor(seconds)) + 's');
    return url.href;
  } catch {
    return null;
  }
}
