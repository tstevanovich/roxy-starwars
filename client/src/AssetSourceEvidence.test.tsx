import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import AssetSourceEvidence from './AssetSourceEvidence.tsx';
import { assetFixture, mediaFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';

test('saved source evidence shows three timestamped captures and the supplementary link from the brief', () => {
  const source = 'https://www.youtube.com/watch?v=example';
  const media = [986, 1697, 1702].map((seconds, index) => ({
    _id: 'frame-' + index,
    kind: 'image' as const,
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
      <AssetSourceEvidence
        asset={assetFixture(asset)}
        media={media.map((value) => mediaFixture(value))}
      />
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

test('source evidence tolerates missing captures and labels untimed sources by their original name', () => {
  const view = render(
    <AssetSourceEvidence
      asset={assetFixture({
        production: { sourceMediaIds: ['missing', 'untimed', 'timed', 'named'] }
      })}
      media={[
        mediaFixture({
          _id: 'untimed',
          originalName: '',
          sourceFrame: { sourceUrl: 'https://example.test/source' }
        }),
        mediaFixture({
          _id: 'timed',
          sourceFrame: { sourceUrl: 'https://youtu.be/abcdefghijk', sourceSeconds: 65 }
        }),
        mediaFixture({ _id: 'named', originalName: 'Evidence.png' })
      ]}
    />
  );
  expect(screen.getAllByText('Saved source image')).toHaveLength(2);
  expect(screen.getByText('Evidence.png')).toBeVisible();
  expect(screen.getByText('Saved gameplay capture - 1:05')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open capture source' })).toHaveAttribute(
    'href',
    'https://example.test/source'
  );
  view.unmount();
  render(<AssetSourceEvidence asset={{}} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
