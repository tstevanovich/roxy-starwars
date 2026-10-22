import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.js';
import CharacterSheets from './CharacterSheets.jsx';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));
const finalizedAt = '2026-10-17T20:00:00.000Z';
const asset = {
  _id: 'al',
  name: 'AL-1B',
  revision: 3,
  finalChoice: { id: 'navigator', finalizedAt },
  characterSheets: [
    {
      id: 'sheet',
      title: 'AL turnaround',
      mediaId: 'image',
      views: ['front', 'side', 'rear'],
      sourceCandidateId: 'navigator',
      sourceFinalizedAt: finalizedAt,
      approvedAt: null
    }
  ]
};
const media = [
  { _id: 'image', kind: 'image', originalName: 'AL-sheet.png', url: '/api/studio/media/image' }
];
beforeEach(() => vi.mocked(request).mockReset());
test('shows sheet views and sends explicit approval without editing the identity', async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  const next = { ...asset, revision: 4 };
  vi.mocked(request).mockResolvedValue({ asset: next });
  render(
    <ThemeProvider theme={theme}>
      <CharacterSheets asset={asset} media={media} onSaved={onSaved} onMedia={vi.fn()} />
    </ThemeProvider>
  );
  expect(screen.getByText('Awaiting review')).toBeInTheDocument();
  expect(
    screen.getByText(/Additional views to establish: Three-quarter, Face detail/)
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Approve character sheet' }));
  expect(request).toHaveBeenCalledWith('/studio/assets/al/character-sheets/sheet/approve', {
    method: 'POST',
    body: { revision: 3 }
  });
  expect(onSaved).toHaveBeenCalledWith(next);
});
test('prop sheet registration offers object views and submits their selected coverage', async () => {
  const user = userEvent.setup();
  const prop = { ...asset, kind: 'prop', name: 'Roxy’s pistol' };
  vi.mocked(request).mockResolvedValue({ asset: prop });
  render(
    <ThemeProvider theme={theme}>
      <CharacterSheets asset={prop} media={media} onSaved={vi.fn()} onMedia={vi.fn()} />
    </ThemeProvider>
  );
  expect(screen.getByRole('heading', { name: 'Prop sheets' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Face detail' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('combobox', { name: 'Saved sheet image' }));
  await user.click(screen.getByRole('option', { name: 'AL-sheet.png' }));
  for (const label of ['Opposite side', 'Top', 'Detail'])
    await user.click(screen.getByRole('checkbox', { name: label }));
  await user.click(screen.getByRole('button', { name: 'Save prop sheet' }));
  expect(request).toHaveBeenCalledWith('/studio/assets/al/character-sheets', {
    method: 'POST',
    body: {
      revision: 3,
      title: 'Roxy’s pistol prop sheet',
      mediaId: 'image',
      views: ['opposite-side', 'top', 'detail']
    }
  });
});

test('a save in progress disables sheet mutations with a visible explanation', () => {
  render(
    <ThemeProvider theme={theme}>
      <CharacterSheets asset={asset} media={media} disabled onSaved={vi.fn()} onMedia={vi.fn()} />
    </ThemeProvider>
  );
  expect(screen.getByRole('button', { name: 'Approve character sheet' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save character sheet' })).toBeDisabled();
  expect(
    screen.getByText('A save is in progress. Approval will be available when it finishes.')
  ).toBeInTheDocument();
});

test('unsaved asset changes do not block approving a saved sheet', async () => {
  const user = userEvent.setup();
  vi.mocked(request).mockResolvedValue({ asset: { ...asset, revision: 4 } });
  render(
    <ThemeProvider theme={theme}>
      <CharacterSheets
        asset={asset}
        media={media}
        draftPending
        onSaved={vi.fn()}
        onMedia={vi.fn()}
      />
    </ThemeProvider>
  );
  expect(screen.getByRole('button', { name: 'Approve character sheet' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save character sheet' })).toBeDisabled();
  expect(screen.getByText(/Your unsaved asset changes will be kept/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Approve character sheet' }));
  expect(request).toHaveBeenCalledWith('/studio/assets/al/character-sheets/sheet/approve', {
    method: 'POST',
    body: { revision: 3 }
  });
});
