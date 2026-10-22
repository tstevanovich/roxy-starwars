import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { request, uploadMedia } from './api.js';
import App from './App.jsx';
import { AssetEditor } from './AssetLibrary.jsx';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));
const asset = {
  _id: 'asset-1',
  seedKey: 'fortune',
  name: 'False Fortune',
  kind: 'ship',
  aliases: ['the Fortune'],
  brief: 'A weathered freighter.',
  notes: '',
  revision: 0,
  history: [],
  finalChoice: null,
  candidates: [
    {
      id: 'option-1',
      title: 'The working freighter',
      description: 'A fast ship.',
      mediaIds: [],
      voiceId: '',
      voiceModel: '',
      archived: false
    }
  ]
};
const data = {
  assets: [asset],
  episodes: [],
  media: [],
  settings: {
    _id: 'settings-1',
    targetSeconds: 600,
    vlogPercent: 33,
    monthlyCredits: 106000,
    era: 'Imperial era',
    notes: 'Sound effects, no music.',
    revision: 0
  }
};
function mount(component = <App />) {
  return render(<ThemeProvider theme={theme}>{component}</ThemeProvider>);
}
beforeEach(() => {
  vi.mocked(request).mockReset();
  vi.mocked(uploadMedia).mockReset();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.stubGlobal('scrollTo', vi.fn());
});

test('loads the studio and opens candidate review from the dashboard', async () => {
  const user = userEvent.setup();
  vi.mocked(request).mockResolvedValue(data);
  mount();
  expect(await screen.findByRole('heading', { name: /A galaxy of choices/i })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Review options' }));
  expect(await screen.findByRole('heading', { name: 'False Fortune' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Creative brief' })).toHaveValue(asset.brief);
  expect(screen.getByRole('button', { name: 'Finalize this option' })).toBeDisabled();
});

test('library video choices open the episode and approval clears the shared pending count', async () => {
  const user = userEvent.setup();
  const clip = {
    id: 'clip',
    title: 'Roxy opening',
    duration: 24,
    action: 'Roxy speaks.',
    dialogue: 'Credits.',
    camera: 'Static.',
    soundEffects: 'Ventilation.',
    takeIds: ['video'],
    selectedTakeId: null
  };
  const scene = {
    id: 'scene',
    title: 'Easy credits',
    style: 'vlog',
    location: 'Cockpit',
    script: 'The charter.',
    assetIds: [],
    approvalStatus: 'approved',
    clips: [clip]
  };
  const episode = {
    _id: 'episode',
    title: 'Episode 01',
    synopsis: 'A passenger.',
    premise: '',
    notes: '',
    revision: 1,
    scenes: [scene]
  };
  const media = [
    {
      _id: 'video',
      kind: 'video',
      soundMix: { fingerprint: 'fixture-mix' },
      originalName: 'roxy-opening.mp4'
    }
  ];
  const next = {
    ...episode,
    revision: 2,
    scenes: [
      {
        ...scene,
        clips: [
          {
            ...clip,
            selectedTakeId: 'video',
            upscale: {
              sourceTakeId: 'video',
              status: 'waiting-provider',
              message: 'No job submitted.'
            }
          }
        ]
      }
    ]
  };
  vi.mocked(request)
    .mockResolvedValueOnce({ ...data, episodes: [episode], media })
    .mockResolvedValue({ episode: next });
  mount();
  expect(
    within(await screen.findByRole('region', { name: 'Pending choices' })).getByText('01')
  ).toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: 'Creative library' }));
  await user.click(await screen.findByRole('button', { name: 'Pending choice (1)' }));
  await user.click(screen.getByRole('button', { name: 'Review video: Roxy opening', exact: true }));
  expect(
    await screen.findByRole('heading', { name: 'Pending video choices (1)' })
  ).toBeInTheDocument();
  expect(screen.getByLabelText('roxy-opening.mp4')).toHaveAttribute(
    'src',
    '/api/studio/media/video'
  );
  await user.click(screen.getByRole('button', { name: 'Approve video take' }));
  expect(
    await screen.findByText(
      'Video take approved and saved. A 1440p (2K) upscale has been requested.'
    )
  ).toBeInTheDocument();
  expect(screen.getByText('Script approved')).toBeInTheDocument();
  expect(request).toHaveBeenLastCalledWith('/studio/episodes/episode', {
    method: 'PUT',
    body: expect.objectContaining({
      revision: 1,
      scenes: [
        expect.objectContaining({
          clips: [expect.objectContaining({ selectedTakeId: 'video', takeIds: ['video'] })]
        })
      ]
    })
  });
  await user.click(screen.getByRole('button', { name: 'Creative library' }));
  expect(await screen.findByRole('button', { name: 'Pending choice (0)' })).toBeInTheDocument();
  expect(
    screen.queryByRole('region', { name: 'Pending episode video choices' })
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Overview', exact: true }));
  expect(
    within(await screen.findByRole('region', { name: 'Pending choices' })).getByText('00')
  ).toBeInTheDocument();
});

test('overview and library agree on combined asset and video choices without counting approved alternates', async () => {
  const user = userEvent.setup();
  const pendingAsset = { ...asset, reviewStatus: 'pending-choice' };
  const episode = {
    _id: 'episode',
    title: 'Episode 01',
    scenes: [
      {
        id: 'scene',
        title: 'Easy credits',
        clips: [
          {
            id: 'first',
            title: 'Roxy opening',
            takeIds: ['video', 'alternate'],
            selectedTakeId: null
          },
          { id: 'second', title: 'Al cutaway', takeIds: ['video'], selectedTakeId: null },
          {
            id: 'approved',
            title: 'Closing',
            takeIds: ['video', 'alternate'],
            selectedTakeId: 'video'
          }
        ]
      }
    ]
  };
  vi.mocked(request).mockResolvedValue({
    ...data,
    assets: [pendingAsset, { ...pendingAsset, _id: 'archived', archived: true }],
    episodes: [episode],
    media: [
      { _id: 'video', kind: 'video' },
      { _id: 'alternate', kind: 'video' }
    ]
  });
  mount();
  expect(
    within(await screen.findByRole('region', { name: 'Pending choices' })).getByText('03')
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Creative library', exact: true }));
  expect(await screen.findByRole('button', { name: 'Pending choice (3)' })).toBeInTheDocument();
});

test('an asset link opens its pending character sheet directly', async () => {
  window.history.replaceState({}, '', '/?asset=al');
  const finalizedAt = '2026-10-17T20:00:00Z';
  vi.mocked(request).mockResolvedValue({
    ...data,
    assets: [
      {
        ...asset,
        _id: 'al',
        name: 'AL-1B',
        kind: 'droid',
        finalChoice: { id: 'navigator', finalizedAt },
        characterSheets: [
          {
            id: 'sheet',
            title: 'AL pending character sheet',
            mediaId: 'sheet-image',
            views: ['front', 'side', 'rear'],
            sourceCandidateId: 'navigator',
            sourceFinalizedAt: finalizedAt,
            approvedAt: null
          }
        ]
      }
    ],
    media: [{ _id: 'sheet-image', kind: 'image', originalName: 'AL-sheet.png' }]
  });
  mount();
  expect(await screen.findByRole('heading', { name: 'AL-1B' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Approve character sheet' })).toBeEnabled();
  expect(screen.getByRole('img', { name: 'AL-sheet.png' })).toBeInTheDocument();
});

test('refreshing the workspace updates an open asset with imported options and media', async () => {
  const user = userEvent.setup();
  const next = {
    ...data,
    assets: [
      {
        ...asset,
        revision: 1,
        candidates: [
          ...asset.candidates,
          {
            id: 'new',
            title: 'New GPT reference',
            description: '',
            mediaIds: ['new-image'],
            archived: false
          }
        ]
      }
    ],
    media: [{ _id: 'new-image', kind: 'image', originalName: 'new-GPT.png' }]
  };
  vi.mocked(request).mockResolvedValueOnce(data).mockResolvedValue(next);
  mount();
  await user.click(await screen.findByRole('button', { name: 'Review options' }));
  expect(screen.queryByRole('img', { name: 'new-GPT.png' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Refresh workspace' }));
  expect(await screen.findByRole('img', { name: 'new-GPT.png' })).toBeInTheDocument();
});

test('returning to the app refreshes saved records while retaining unsaved edits', async () => {
  const user = userEvent.setup();
  vi.mocked(request).mockResolvedValue(data);
  mount();
  await user.click(await screen.findByRole('button', { name: 'Review options' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Continuity notes' }),
    'Keep this local note.'
  );
  vi.mocked(request).mockResolvedValue({ ...data, assets: [{ ...asset, revision: 1 }] });
  fireEvent(window, new Event('focus'));
  expect(await screen.findByText(/New choices or sheets have been saved/)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Continuity notes' })).toHaveValue(
    'Keep this local note.'
  );
});

test('prop records expose their reference sheet workflow', () => {
  mount(
    <AssetEditor
      asset={{ ...structuredClone(asset), kind: 'prop', name: 'Roxy’s pistol' }}
      media={[]}
      onSaved={vi.fn()}
      onMedia={vi.fn()}
      onBack={vi.fn()}
    />
  );
  expect(screen.getByRole('heading', { name: 'Prop sheets' })).toBeInTheDocument();
  expect(
    screen.getByText('Finalize the prop’s design before adding its prop sheet.')
  ).toBeInTheDocument();
});

test('failed saves preserve the editor and the recoverable local draft', async () => {
  const user = userEvent.setup();
  vi.mocked(request).mockRejectedValue(new Error('This record changed in another tab.'));
  mount(
    <AssetEditor
      asset={structuredClone(asset)}
      media={[]}
      onSaved={vi.fn()}
      onMedia={vi.fn()}
      onBack={vi.fn()}
    />
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Continuity notes' }),
    'Keep my cockpit notes.'
  );
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('This record changed in another tab.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Continuity notes' })).toHaveValue(
    'Keep my cockpit notes.'
  );
  expect(JSON.parse(localStorage.getItem('roxy-studio-asset-asset-1')).notes).toBe(
    'Keep my cockpit notes.'
  );
});

test('uploads a reference before saving and finalizing its creative option', async () => {
  const user = userEvent.setup();
  const file = { _id: 'media-1', kind: 'image', originalName: 'ship.png', bytes: 12 };
  const saved = {
    ...structuredClone(asset),
    revision: 1,
    candidates: [{ ...asset.candidates[0], mediaIds: [file._id] }]
  };
  const final = {
    ...saved,
    revision: 2,
    finalChoice: { ...saved.candidates[0], finalizedAt: new Date().toISOString() }
  };
  vi.mocked(uploadMedia).mockResolvedValue(file);
  vi.mocked(request)
    .mockResolvedValueOnce({ asset: saved })
    .mockResolvedValueOnce({ asset: final });
  const onMedia = vi.fn();
  const onSaved = vi.fn();
  mount(
    <AssetEditor
      asset={structuredClone(asset)}
      media={[file]}
      onSaved={onSaved}
      onMedia={onMedia}
      onBack={vi.fn()}
    />
  );
  await user.upload(
    screen.getByLabelText(/Upload reference/),
    new File(['image'], 'ship.png', { type: 'image/png' })
  );
  expect(await screen.findByRole('img', { name: 'ship.png' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Finalize this option' })).toBeEnabled()
  );
  await user.click(screen.getByRole('button', { name: 'Finalize this option' }));
  expect(
    await screen.findByText('Final choice saved with its reference files.')
  ).toBeInTheDocument();
  expect(onSaved).toHaveBeenLastCalledWith(final);
  expect(request).toHaveBeenLastCalledWith('/studio/assets/asset-1/finalize', {
    method: 'POST',
    body: { revision: 1, candidateId: 'option-1' }
  });
});

test('lets the user retry a failed connection', async () => {
  const user = userEvent.setup();
  vi.mocked(request).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(data);
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  await user.click(screen.getByRole('button', { name: 'Retry connection' }));
  expect(await screen.findByRole('heading', { name: /A galaxy of choices/i })).toBeInTheDocument();
});

test('creates an episode and keeps scene approval disabled until its draft is saved', async () => {
  const user = userEvent.setup();
  vi.mocked(request)
    .mockResolvedValueOnce(data)
    .mockResolvedValueOnce({
      episode: {
        _id: 'episode-1',
        title: 'The next job',
        premise: '',
        notes: '',
        revision: 0,
        scenes: []
      }
    });
  mount();
  await screen.findByRole('heading', { name: /A galaxy of choices/i });
  await user.click(screen.getByRole('button', { name: 'Episodes' }));
  await user.click(await screen.findByRole('button', { name: 'New episode' }));
  await user.type(screen.getByRole('textbox', { name: 'Episode title' }), 'The next job');
  await user.click(screen.getByRole('button', { name: 'Create episode' }));
  await user.click(await screen.findByRole('button', { name: 'Add the first scene' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Scene script' }),
    'Roxy enters the cockpit.'
  );
  await user.click(screen.getByRole('button', { name: 'Plan another clip' }));
  const duration = screen.getByRole('spinbutton', { name: 'Duration in seconds' });
  await user.clear(duration);
  await user.type(duration, '30');
  expect(duration).toHaveValue(30);
  expect(screen.getByRole('button', { name: 'Approve script' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save episode' })).toBeEnabled();
});
