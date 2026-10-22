import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

const defaultRemotePath = fileURLToPath(
  new URL('../../../.data/private/remote.json', import.meta.url)
);
const unavailable =
  'Secure reference sharing is unavailable. Start the studio remote tunnel or configure STUDIO_PUBLIC_ORIGIN with its HTTPS address.';

// OAuth may return to localhost. Provider fetches must use the independently configured public host.
export async function referenceSharing({
  redirectUrl,
  remotePath = defaultRemotePath,
  publicOrigin = process.env.STUDIO_PUBLIC_ORIGIN
} = {}) {
  let configured = publicOrigin;
  let source = 'configuration';
  if (!configured) {
    try {
      configured = JSON.parse(await readFile(remotePath, 'utf8')).origin;
      source = 'remote tunnel';
    } catch (error) {
      if (error.code !== 'ENOENT') return { ready: false, origin: null, message: unavailable };
    }
  }
  if (!configured && redirectUrl?.startsWith('https://')) {
    try {
      configured = new URL(redirectUrl).origin;
    } catch {
      return { ready: false, origin: null, message: unavailable };
    }
    source = 'OpenArt callback';
  }
  try {
    const url = new URL(configured);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      isIP(host) ||
      !host.includes('.') ||
      host.endsWith('.localhost') ||
      host.endsWith('.local')
    )
      throw new Error('Not a public HTTPS origin');
    return { ready: true, origin: url.origin, source };
  } catch {
    return { ready: false, origin: null, message: unavailable };
  }
}
