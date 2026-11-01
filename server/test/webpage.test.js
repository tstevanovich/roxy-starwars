import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractWebpage, readWebpage } from '../src/assistant/webpage.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
test('webpage extraction decodes entities and keeps main text, source links and image references without scripts', () => {
  const page = extractWebpage(
    `<html><head><title>Ffon &amp; references</title><meta name="description" content="NPC details"></head><body><nav>Ignore menu</nav><main><h1>Ffon Althe</h1><p>Red &amp; black tunic.</p><script>secret-script()</script><table><tr><td>Gender</td><td>Male</td></tr></table><a href="/en/item/robe">Robe</a><img src="/images/ffon.png" alt="Appearance preview"><footer>Ignore footer</footer></main></body></html>`,
    'https://swtor.jedipedia.net/en/npc/ffon'
  );
  assert.equal(page.title, 'Ffon & references');
  assert.match(page.text, /Red & black tunic/);
  assert.match(page.text, /Gender \| Male/);
  assert.doesNotMatch(page.text, /Ignore|secret-script/);
  assert.equal(page.links[0].url, 'https://swtor.jedipedia.net/en/item/robe');
  assert.equal(page.images[0].alt, 'Appearance preview');
});
test('reader pins resolved public address and returns bounded text with continuation and source URL', async () => {
  const calls = [];
  const page = await readWebpage(
    { url: 'https://reference.example.org/entry', maxChars: 1000 },
    {
      lookup: publicLookup,
      load: async (target) => {
        calls.push(target);
        return {
          status: 200,
          type: 'text/html',
          html: '<main><h1>Details</h1><p>' + 'Facts '.repeat(500) + '</p></main>'
        };
      }
    }
  );
  assert.equal(calls[0].address, '93.184.216.34');
  assert.equal(page.text.length, 1000);
  assert.equal(page.nextStart, 1000);
  assert.equal(page.url, 'https://reference.example.org/entry');
  assert.match(page.notice, /not been visually inspected/);
});
test('reader rejects private addresses, non-web schemes and credential-bearing URLs before making requests', async () => {
  for (const url of [
    'http://127.0.0.1',
    'http://169.254.169.254/latest',
    'http://10.0.0.1',
    'http://100.64.0.1',
    'http://[::1]',
    'file:///etc/passwd',
    'https://user:password@example.org',
    'http://example.org:5000',
    'http://localhost',
    'http://example.org.local'
  ]) {
    await assert.rejects(
      readWebpage({ url }, { lookup: publicLookup, load: () => assert.fail('Must not connect') })
    );
  }
  await assert.rejects(
    readWebpage(
      { url: 'https://reference.example.org' },
      {
        lookup: async () => [{ address: '10.0.0.2', family: 4 }],
        load: () => assert.fail('Must not connect')
      }
    ),
    /public IPv4/
  );
});
test('every redirect is revalidated and redirects to private networks are not fetched', async () => {
  let requests = 0;
  await assert.rejects(
    readWebpage(
      { url: 'https://reference.example.org' },
      {
        lookup: publicLookup,
        load: async () => {
          requests++;
          return { status: 302, location: 'http://169.254.169.254/latest' };
        }
      }
    ),
    /public IPv4/
  );
  assert.equal(requests, 1);
  const page = await readWebpage(
    { url: 'https://reference.example.org/old' },
    {
      lookup: publicLookup,
      load: async ({ url }) =>
        url.pathname === '/old'
          ? { status: 301, location: '/new' }
          : { status: 200, type: 'text/plain', html: 'Verified text.' }
    }
  );
  assert.equal(page.url, 'https://reference.example.org/new');
  assert.equal(page.text, 'Verified text.');
});
test('reader honours cancellation and reports sparse script-only content without inventing facts', async () => {
  await assert.rejects(
    readWebpage(
      { url: 'https://reference.example.org' },
      {
        signal: AbortSignal.abort(),
        lookup: publicLookup,
        load: () => assert.fail('Must not connect')
      }
    ),
    /cancelled/
  );
  const page = await readWebpage(
    { url: 'https://reference.example.org' },
    {
      lookup: publicLookup,
      load: async () => ({
        status: 200,
        type: 'text/html',
        html: '<body><script>renderEverything()</script></body>'
      })
    }
  );
  assert.equal(page.text, '');
  assert.match(page.warning, /JavaScript/);
});
