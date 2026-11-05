import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { expect, test, vi } from 'vitest';

import { extractWebpage, readWebpage } from './webpage.ts';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('node:http', async (original) => ({
  ...(await original<typeof import('node:http')>()),
  request: transport.request
}));
vi.mock('node:https', async (original) => ({
  ...(await original<typeof import('node:https')>()),
  request: transport.request
}));
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

test('extraction handles article fallbacks, hidden content and invalid or duplicated links', () => {
  const html =
    '<article><div hidden>Hidden</div><span aria-hidden="true">Hidden too</span><a href="http://[bad">Invalid</a><a href="javascript:x">Unsafe</a><a href="https://user:pass@example.com">Login</a><a href="/ok">Good</a><a href="/ok">Duplicate</a><img data-src="/picture.png"><img src="/picture.png"><img><a>No destination</a></article>';
  const page = extractWebpage(html, 'https://reference.example.org');
  expect(page.title).toBe('');
  expect(page.text).not.toContain('Hidden');
  expect(page.images).toEqual([{ url: 'https://reference.example.org/picture.png', alt: '' }]);
  expect(page.links.filter((link) => link.url.endsWith('/ok'))).toHaveLength(1);
  expect(
    extractWebpage('<div id="mw-content-text">Wiki</div>', 'https://reference.example.org').text
  ).toBe('Wiki');
  const many = extractWebpage(
    '<main>' +
      Array.from({ length: 65 }, (_, i) => `<a href="/${i}">Link</a><img src="/${i}.png">`).join(
        ''
      ) +
      '</main>',
    'https://reference.example.org'
  );
  expect(many.links).toHaveLength(60);
  expect(many.images).toHaveLength(20);
});
test('reader bounds pagination, rejects every reserved IPv4 range and validates all redirect destinations', async () => {
  for (const args of [
    { start: 0.5 },
    { start: -1 },
    { start: 2097153 },
    { maxChars: 1.5 },
    { maxChars: 999 },
    { maxChars: 20001 }
  ])
    await expect(readWebpage({ url: 'https://example.org', ...args })).rejects.toThrow('maxChars');
  for (const url of [
    'invalid',
    'http://x.localhost',
    'http://x.internal',
    'http://x.home',
    'http://x.lan',
    'http://x.test',
    'https://example.org/' + 'x'.repeat(4000)
  ])
    await expect(readWebpage({ url })).rejects.toThrow();
  for (const address of [
    '::1',
    '0.0.0.1',
    '224.0.0.1',
    '172.16.0.1',
    '192.168.0.1',
    '192.0.0.1',
    '192.88.99.1',
    '198.18.0.1',
    '198.19.0.1',
    '198.51.100.1',
    '203.0.113.1'
  ])
    await expect(
      readWebpage({ url: 'http://example.org' }, { lookup: async () => [{ address, family: 4 }] })
    ).rejects.toThrow('public IPv4');
  await expect(
    readWebpage({ url: 'http://example.org' }, { lookup: async () => [] })
  ).rejects.toThrow('public IPv4');
  for (const location of [undefined, '/forever'])
    await expect(
      readWebpage(
        { url: 'http://example.org' },
        { lookup: publicLookup, load: async () => ({ status: 302, location }) }
      )
    ).rejects.toThrow('redirect');
  await expect(
    readWebpage(
      { url: 'http://example.org' },
      {
        lookup: async () => {
          throw Object.assign(new Error('DNS unavailable'), { code: 'ENOTFOUND' });
        }
      }
    )
  ).rejects.toThrow('Could not connect');
});
test('cancelling a DNS lookup interrupts a pending or immediately cancelled lookup', async () => {
  for (const immediate of [false, true]) {
    const controller = new AbortController();
    const reading = readWebpage(
      { url: 'http://example.org' },
      {
        signal: controller.signal,
        lookup: () => {
          if (immediate) controller.abort();
          return new Promise(() => {});
        }
      }
    );
    controller.abort();
    await expect(reading).rejects.toThrow('cancelled');
  }
});
test('default transport pins DNS, validates status and media type, decodes charsets and bounds response bytes', async () => {
  const scenarios = [
    { status: 200, type: 'text/html; charset=unknown', body: '<main>Content</main>' },
    { status: 200, type: 'text/plain', body: 'Plain content', all: true, protocol: 'http' },
    { status: 403, error: /HTTP 403/ },
    { status: 200, type: 'application/json', error: /not an HTML/ },
    { status: 302, location: 'http://127.0.0.1', error: /public IPv4/ },
    { status: 200, type: 'text/plain', body: 'x'.repeat(2097153), error: /2 MB/ },
    {
      status: 200,
      type: 'text/plain',
      requestError: new Error('Socket failed'),
      error: /Socket failed/
    }
  ];
  for (const scenario of scenarios) {
    transport.request.mockImplementationOnce((_url, options, callback) => {
      options.lookup('example.org', { all: scenario.all }, (_error, address) =>
        expect(address).toEqual(
          scenario.all ? [{ address: '93.184.216.34', family: 4 }] : '93.184.216.34'
        )
      );
      const req = new EventEmitter();
      Object.assign(req, {
        end: () =>
          queueMicrotask(() => {
            if (scenario.requestError) {
              req.emit('error', scenario.requestError);
              return;
            }
            const response = Object.assign(new EventEmitter(), {
              statusCode: scenario.status,
              headers: { 'content-type': scenario.type, location: scenario.location },
              destroy: (error?) => {
                if (error) response.emit('error', error);
              }
            });
            callback(response);
            if (scenario.body) response.emit('data', Buffer.from(scenario.body));
            response.emit('end');
          })
      });
      return req;
    });
    const reading = readWebpage(
      { url: `${scenario.protocol ?? 'https'}://example.org` },
      { lookup: publicLookup }
    );
    if (scenario.error) await expect(reading).rejects.toThrow(scenario.error);
    else
      expect((await reading).text).toContain(
        scenario.body.includes('<') ? 'Content' : 'Plain content'
      );
  }
});
