import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error(
    'This installer targets Windows x64. Install cloudflared from its official distribution on other systems.'
  );
const directory = fileURLToPath(new URL('../.data/tools/', import.meta.url));
const release = await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', {
  headers: { 'User-Agent': 'roxy-studio-setup' },
  signal: AbortSignal.timeout(30000)
});
if (!release.ok) throw new Error('Could not read the official Cloudflare release.');
const data = await release.json(),
  asset = data.assets.find((a) => a.name === 'cloudflared-windows-amd64.exe');
if (
  !asset?.digest?.startsWith('sha256:') ||
  !asset.browser_download_url.startsWith(
    'https://github.com/cloudflare/cloudflared/releases/download/'
  )
)
  throw new Error('Official release checksum unavailable. No binary was installed.');
const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error('Download failed.');
const bytes = Buffer.from(await response.arrayBuffer());
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== asset.digest.slice(7) || bytes.length !== asset.size)
  throw new Error('Cloudflared checksum verification failed.');
await mkdir(directory, { recursive: true });
await writeFile(new URL('../.data/tools/cloudflared.exe', import.meta.url), bytes, { flag: 'wx' });
await writeFile(
  new URL('../.data/tools/cloudflared-release.json', import.meta.url),
  JSON.stringify(
    { version: data.tag_name, sha256, url: asset.browser_download_url, bytes: bytes.length },
    null,
    2
  )
);
console.log('Verified cloudflared ' + data.tag_name + ' installed in .data/tools.');
