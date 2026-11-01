import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import AssetSourceEvidence from './AssetSourceEvidence.jsx';
import { theme } from './theme.js';

test('saved source evidence shows three timestamped captures and the supplementary link from the brief', () => {
  const source = 'https://www.youtube.com/watch?v=example';
  const media = [986, 1697, 1702].map((seconds, index) => ({
    _id: 'frame-' + index,
    kind: 'image',
    originalName: 'Source ' + index + '.png',
    sourceFrame: { sourceUrl: source, requestedSeconds: seconds }
  }));
  const asset = {
    production: {
      sourceUrl: source,
      sourceNotes: 'Reviewed hood, face and costume.',
      sourceMediaIds: media.map((file) => file._id)
    },
    brief:
      'Supplementary database: https://swtor.jedipedia.net/en/npc/ffon-althe-2. Keep gameplay authoritative.'
  };
  render(
    <ThemeProvider theme={theme}>
      <AssetSourceEvidence asset={asset} media={media} />
    </ThemeProvider>
  );
  for (const [time, seconds] of [
    ['16:26', 986],
    ['28:17', 1697],
    ['28:22', 1702]
  ])
    expect(screen.getByRole('link', { name: 'Open footage at ' + time })).toHaveAttribute(
      'href',
      source + '&t=' + seconds + 's'
    );
  expect(screen.getAllByRole('img')).toHaveLength(3);
  expect(
    screen.getByRole('link', { name: 'Open supplementary reference - swtor.jedipedia.net' })
  ).toHaveAttribute('href', 'https://swtor.jedipedia.net/en/npc/ffon-althe-2');
});
