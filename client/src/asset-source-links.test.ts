import { expect, test } from 'vitest';

import { capturedSourceLink, savedAssetSourceLinks } from './asset-source-links.ts';

test('saved source links are deduplicated in source priority order and reject private or malformed URLs', () => {
  expect(savedAssetSourceLinks({})).toEqual([]);
  expect(
    savedAssetSourceLinks({
      production: {
        sourceUrl: 'https://example.org/source',
        sourceNotes: 'See https://example.org/source. and https://notes.example.org/path).'
      },
      brief:
        'More https://brief.example.org/path! https://user:secret@example.org/ https://[invalid https://'
    })
  ).toEqual([
    { url: 'https://example.org/source', host: 'example.org', origin: 'primary' },
    { url: 'https://notes.example.org/path', host: 'notes.example.org', origin: 'notes' },
    { url: 'https://brief.example.org/path', host: 'brief.example.org', origin: 'brief' }
  ]);
});

test('captured evidence links use original video time and never expose unsafe source URLs', () => {
  expect(capturedSourceLink(undefined)).toBeNull();
  for (const sourceUrl of ['invalid', 'file:///private', 'https://user:secret@example.org'])
    expect(capturedSourceLink({ sourceFrame: { sourceUrl } })).toBeNull();
  expect(
    capturedSourceLink({
      sourceFrame: {
        sourceUrl: 'https://www.youtube.com/watch?v=source',
        requestedSeconds: 16.9,
        sourceSeconds: 2
      }
    })
  ).toBe('https://www.youtube.com/watch?v=source&t=16s');
  expect(
    capturedSourceLink({ sourceFrame: { sourceUrl: 'https://youtu.be/source', sourceSeconds: 8 } })
  ).toBe('https://youtu.be/source?t=8s');
  expect(
    capturedSourceLink({
      sourceFrame: { sourceUrl: 'https://example.org/source', sourceSeconds: 8 }
    })
  ).toBe('https://example.org/source');
  expect(capturedSourceLink({ sourceFrame: { sourceUrl: 'https://youtu.be/source' } })).toBe(
    'https://youtu.be/source'
  );
});
