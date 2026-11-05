import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { request, uploadMedia } from './api.ts';
import CharacterSheets from './CharacterSheets.tsx';
import { assetFixture, mediaFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';

vi.mock('./api.ts', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));
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
  {
    _id: 'image',
    kind: 'image' as const,
    originalName: 'AL-sheet.png',
    url: '/api/studio/media/image'
  }
];
beforeEach(() => {
  vi.mocked(request).mockReset();
  vi.mocked(uploadMedia).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

test('sheet registration edits title and saved image, removes unchecked views and reports a failed save', async () => {
  const onBusy = vi.fn();
  vi.mocked(request).mockRejectedValueOnce(new Error('Sheet save unavailable'));
  render(
    <CharacterSheets
      asset={assetFixture(asset)}
      media={media.map(mediaFixture)}
      onSaved={vi.fn()}
      onBusy={onBusy}
    />
  );
  fireEvent.change(screen.getByLabelText('Sheet title'), {
    target: { value: 'Complete body turnaround' }
  });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Saved sheet image' }));
  fireEvent.click(within(screen.getByRole('listbox')).getByText('AL-sheet.png'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Front' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Rear' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Front' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save character sheet' }));
  expect(await screen.findByText('Sheet save unavailable')).toBeVisible();
  expect(request).toHaveBeenCalledWith('/studio/assets/al/character-sheets', {
    method: 'POST',
    body: { revision: 3, title: 'Complete body turnaround', mediaId: 'image', views: ['rear'] }
  });
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
  expect(screen.getByLabelText('Sheet title')).toHaveValue('Complete body turnaround');
});

test('sheet uploads accept only an image and retain the original media callback for other file kinds', async () => {
  const onMedia = vi.fn();
  render(
    <CharacterSheets
      asset={assetFixture(asset)}
      media={media.map(mediaFixture)}
      onSaved={vi.fn()}
      onMedia={onMedia}
    />
  );
  const input = screen.getByLabelText('Upload character sheet');
  vi.mocked(uploadMedia).mockResolvedValueOnce(mediaFixture({ _id: 'audio', kind: 'audio' }));
  fireEvent.change(input, { target: { files: [new File(['audio'], 'voice.wav')] } });
  expect(await screen.findByText('Choose an image for the character sheet.')).toBeVisible();
  vi.mocked(uploadMedia).mockResolvedValueOnce(mediaFixture({ _id: 'image', kind: 'image' }));
  fireEvent.change(input, { target: { files: [new File(['image'], 'body.png')] } });
  await waitFor(() => expect(onMedia).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Choose an image for the character sheet.')).not.toBeInTheDocument();
});

test('previous prop designs and a fully approved sheet retain honest status and project-aware downloads', () => {
  history.replaceState(null, '', '/?project=sith');
  render(
    <CharacterSheets
      asset={assetFixture({
        ...asset,
        kind: 'prop',
        characterSheets: [
          {
            ...asset.characterSheets[0],
            id: 'old',
            sourceCandidateId: 'older',
            views: ['unknown-view']
          },
          {
            ...asset.characterSheets[0],
            id: 'current',
            views: ['side', 'opposite-side', 'top', 'rear', 'detail'],
            approvedAt: finalizedAt
          }
        ]
      })}
      media={media.map(mediaFixture)}
      onSaved={vi.fn()}
    />
  );
  expect(screen.getByText('Previous design')).toBeVisible();
  expect(screen.getByText('Approved sheet')).toBeVisible();
  expect(screen.getByText('Review the covered views before approving this sheet.')).toBeVisible();
  expect(screen.getAllByRole('link', { name: 'Download sheet' })[0]).toHaveAttribute(
    'href',
    '/api/studio/media/image?project=sith&download=1'
  );
});

test.each(['character', 'prop'] as const)(
  'the %s finalization link focuses the actual next step before registration',
  (kind) => {
    render(
      <>
        <section id="asset-finalization-al" aria-label="Finalization" tabIndex={-1} />
        <CharacterSheets
          asset={assetFixture({ ...asset, kind, finalChoice: null, characterSheets: undefined })}
          media={[]}
          onSaved={vi.fn()}
        />
      </>
    );
    fireEvent.click(screen.getByRole('link', { name: 'Go to finalization' }));
    expect(screen.getByRole('region', { name: 'Finalization' })).toHaveFocus();
  }
);

test('a current prop sheet can be approved and a character sheet can be saved for review', async () => {
  vi.mocked(request).mockResolvedValue({ asset: assetFixture(asset) });
  const view = render(
    <CharacterSheets
      asset={assetFixture({ ...asset, kind: 'prop' })}
      media={media.map(mediaFixture)}
      onSaved={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve prop sheet' }));
  await screen.findByText('Prop sheet approved for reuse.');
  view.unmount();
  render(
    <CharacterSheets
      asset={assetFixture(asset)}
      media={media.map(mediaFixture)}
      onSaved={vi.fn()}
    />
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Saved sheet image' }));
  fireEvent.click(screen.getByRole('option', { name: 'AL-sheet.png' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Front' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save character sheet' }));
  await screen.findByText('Character sheet saved for review.');
});
test('shows sheet views and sends explicit approval without editing the identity', async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  const next = { ...asset, revision: 4 };
  vi.mocked(request).mockResolvedValue({ asset: next });
  render(
    <ThemeProvider theme={theme}>
      <CharacterSheets
        asset={assetFixture(asset)}
        media={media.map((value) => mediaFixture(value))}
        onSaved={onSaved}
        onMedia={vi.fn()}
      />
    </ThemeProvider>
  );
  expect(screen.getByText('Awaiting review')).toBeInTheDocument();
  expect(screen.getByText(/Additional views to establish: Three-quarter/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Approve character sheet' }));
  expect(request).toHaveBeenCalledWith('/studio/assets/al/character-sheets/sheet/approve', {
    method: 'POST',
    body: { revision: 3 }
  });
  expect(onSaved).toHaveBeenCalledWith(next);
});
test('prop sheet registration offers object views and submits their selected coverage', async () => {
  const user = userEvent.setup();
  const prop = { ...asset, kind: 'prop' as const, name: 'Roxy’s pistol' };
  vi.mocked(request).mockResolvedValue({ asset: prop });
  render(
    <ThemeProvider theme={theme}>
      <CharacterSheets
        asset={assetFixture(prop)}
        media={media.map((value) => mediaFixture(value))}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
      />
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
      <CharacterSheets
        asset={assetFixture(asset)}
        media={media.map((value) => mediaFixture(value))}
        disabled
        onSaved={vi.fn()}
        onMedia={vi.fn()}
      />
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
        asset={assetFixture(asset)}
        media={media.map((value) => mediaFixture(value))}
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

test.each([
  [[], 'Go to reference setup', '#asset-reference-setup-al'],
  [
    [{ id: 'body-turnaround', type: 'image' as const, mediaId: null }],
    'Go to body turnaround',
    '#asset-image-generation-al--body-turnaround'
  ],
  [
    [{ id: 'body-turnaround', type: 'image' as const, mediaId: 'turnaround' }],
    'Review body turnaround',
    '#review-asset--al------reference_3a_body-turnaround'
  ]
])('package sheet navigation follows the actual next step', (items, label, href) => {
  const pending = {
    ...asset,
    kind: 'character' as const,
    sheetLayout: 'production-package',
    finalChoice: null,
    characterSheets: [],
    production: { items }
  };
  render(
    <ThemeProvider theme={theme}>
      <CharacterSheets
        asset={assetFixture(pending)}
        media={media.map((value) => mediaFixture(value))}
        onSaved={vi.fn()}
      />
    </ThemeProvider>
  );
  expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
  expect(screen.queryByRole('link', { name: 'Go to finalization' })).not.toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
});

test('a character sheet from an older identity is labeled as a previous identity', () => {
  render(
    <CharacterSheets
      asset={assetFixture({
        ...asset,
        kind: 'character',
        characterSheets: [{ ...asset.characterSheets[0], sourceCandidateId: 'older' }]
      })}
      media={media.map(mediaFixture)}
      onSaved={vi.fn()}
    />
  );
  expect(screen.getByText(/Previous identity/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Approve character sheet' })).toBeDisabled();
});
