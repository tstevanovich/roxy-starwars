import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { request, uploadMedia } from './api.ts';
import App from './App.tsx';
import { AssetEditor } from './AssetLibrary.tsx';
import { studioChangeEvent, studioChangeKey } from './studio-events.ts';
import {
  assetFixture,
  episodeFixture,
  mediaFixture,
  reviewFixture,
  studioFixture
} from './test/fixtures.ts';
import { theme } from './theme.ts';

vi.mock('./api.ts', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));

describe('component behavior', () => {
  const asset = {
    _id: 'asset-1',
    seedKey: 'fortune',
    name: 'False Fortune',
    kind: 'ship' as const,
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

  test('zero pending results links to automatic production status for an incomplete episode', async () => {
    vi.mocked(request).mockResolvedValue({
      ...data,
      assets: [],
      workflowReviews: [],
      episodes: [
        {
          _id: 'unfinished',
          title: 'Initial Sith Trials',
          scenes: [],
          workflowVersion: 1,
          workflowReady: false
        }
      ]
    });
    mount();
    expect(
      await screen.findByText(/No results are ready for approval. Production is still incomplete/)
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Open production status for Initial Sith Trials' })
    ).toHaveAttribute('href', '/?episode=unfinished#production-approval-board');
  });

  test('loads the studio and opens candidate review from the dashboard', async () => {
    const user = userEvent.setup();
    vi.mocked(request).mockResolvedValue(data);
    mount();
    expect(
      await screen.findByRole('heading', { name: /A galaxy of choices/i })
    ).toBeInTheDocument();
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
      style: 'vlog' as const,
      location: 'Cockpit',
      script: 'The charter.',
      assetIds: [],
      approvalStatus: 'approved' as const,
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
        kind: 'video' as const,
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
                status: 'waiting-provider' as const,
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
    await user.click(screen.getByRole('button', { name: 'Review video: Roxy opening' }));
    expect(
      await screen.findByRole('heading', { name: 'Pending video choices (1)' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('roxy-opening.mp4')).toHaveAttribute(
      'src',
      '/api/studio/media/video'
    );
    await user.click(screen.getByRole('button', { name: 'Approve video take' }));
    expect(await screen.findByText('1080p video take approved and saved.')).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Overview' }));
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
        { _id: 'video', kind: 'video' as const },
        { _id: 'alternate', kind: 'video' as const }
      ]
    });
    mount();
    expect(
      within(await screen.findByRole('region', { name: 'Pending choices' })).getByText('03')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Creative library' }));
    expect(await screen.findByRole('button', { name: 'Pending choice (3)' })).toBeInTheDocument();
  });

  test('overview counts a workflow asset once and excludes empty work still in development', async () => {
    vi.mocked(request).mockResolvedValue({
      ...data,
      assets: [
        { ...asset, workflowStatus: 'pending-choice' },
        {
          ...asset,
          _id: 'rendering',
          reviewStatus: 'pending-choice',
          workflowStatus: 'development'
        }
      ],
      workflowReviews: [
        {
          key: 'source',
          name: asset.name,
          title: 'Source evidence',
          status: 'pending-review' as const,
          target: { scope: 'asset' as const, recordId: asset._id }
        },
        {
          key: 'brief',
          name: asset.name,
          title: 'Creative brief',
          status: 'needs-review' as const,
          target: { scope: 'asset' as const, recordId: asset._id }
        }
      ]
    });
    mount();
    expect(
      within(await screen.findByRole('region', { name: 'Pending choices' })).getByText('01')
    ).toBeInTheDocument();
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
          kind: 'droid' as const,
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
      media: [{ _id: 'sheet-image', kind: 'image' as const, originalName: 'AL-sheet.png' }]
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
      media: [{ _id: 'new-image', kind: 'image' as const, originalName: 'new-GPT.png' }]
    };
    vi.mocked(request).mockResolvedValueOnce(data).mockResolvedValue(next);
    mount();
    await user.click(await screen.findByRole('button', { name: 'Review options' }));
    expect(screen.queryByRole('img', { name: 'new-GPT.png' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    expect(await screen.findByRole('img', { name: 'new-GPT.png' })).toBeInTheDocument();
  });

  test.each(['focus', studioChangeEvent, 'storage'])(
    '%s refreshes saved records while retaining unsaved edits',
    async (event) => {
      const user = userEvent.setup();
      vi.mocked(request).mockResolvedValue(data);
      mount();
      await user.click(await screen.findByRole('button', { name: 'Review options' }));
      await user.type(
        screen.getByRole('textbox', { name: 'Continuity notes' }),
        'Keep this local note.'
      );
      vi.mocked(request).mockResolvedValue({ ...data, assets: [{ ...asset, revision: 1 }] });
      fireEvent(
        window,
        event === 'storage'
          ? new StorageEvent('storage', { key: studioChangeKey })
          : new Event(event)
      );
      expect(await screen.findByText(/New choices or sheets have been saved/)).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Continuity notes' })).toHaveValue(
        'Keep this local note.'
      );
    }
  );

  test('prop records expose their reference sheet workflow', () => {
    mount(
      <AssetEditor
        asset={assetFixture({
          ...structuredClone(asset),
          kind: 'prop' as const,
          name: 'Roxy’s pistol'
        })}
        media={[]}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: 'Prop sheets' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Choose a prop reference in Compare your options and press Finalize this option before adding its prop sheet.'
      )
    ).toBeInTheDocument();
  });

  test('failed saves preserve the editor and the recoverable local draft', async () => {
    const user = userEvent.setup();
    vi.mocked(request).mockRejectedValue(new Error('This record changed in another tab.'));
    mount(
      <AssetEditor
        asset={assetFixture(structuredClone(asset))}
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
    const file = mediaFixture({
      _id: 'media-1',
      kind: 'image' as const,
      originalName: 'ship.png',
      bytes: 12
    });
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
        asset={assetFixture(structuredClone(asset))}
        media={[file].map((value) => mediaFixture(value))}
        onSaved={onSaved}
        onMedia={onMedia}
        onBack={vi.fn()}
      />
    );
    await user.upload(
      screen.getByLabelText(/Upload reference/),
      new File(['image'], 'ship.png', { type: 'image/png' as const })
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
    expect(
      await screen.findByRole('heading', { name: /A galaxy of choices/i })
    ).toBeInTheDocument();
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

  test('overview counts draft episode source research as a visible pending owner review', async () => {
    vi.mocked(request).mockResolvedValue({
      ...data,
      assets: [],
      workflowReviews: [
        {
          key: 'source',
          target: { scope: 'episode' as const, recordId: 'episode-one' },
          name: 'Initial Sith Trials',
          title: 'Source research',
          stage: 'source',
          status: 'draft' as const
        }
      ]
    });
    mount();
    const pending = await screen.findByRole('region', { name: 'Pending choices' });
    expect(within(pending).getByText('01')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Initial Sith Trials.*Source research.*Needs your review/ })
    ).toBeVisible();
  });
});

describe('navigation and callback wiring', () => {
  let App: (typeof import('./App.tsx'))['default'];
  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('./AssetLibrary.tsx', () => ({
      default: (props) => (
        <section aria-label="Library view">
          <output>{JSON.stringify({ assets: props.assets, media: props.media })}</output>
          <button
            onClick={() => props.onSaved(assetFixture({ _id: 'new', name: 'New character' }))}
          >
            Save new asset
          </button>
          <button
            onClick={() =>
              props.onSaved(assetFixture({ _id: 'existing', name: 'Revised character' }))
            }
          >
            Save existing asset
          </button>
          <button
            onClick={() =>
              props.onMedia(mediaFixture({ _id: 'new-image', originalName: 'New.png' }))
            }
          >
            Import image
          </button>
          <button onClick={() => props.onRejected({ deletedMediaId: 'image' })}>
            Delete image
          </button>
          <button onClick={props.onReload}>Reload library</button>
          <button onClick={() => props.onOpenEpisode('episode')}>Open linked episode</button>
          <button onClick={() => props.onChat({ assetId: 'existing' })}>Discuss asset</button>
        </section>
      )
    }));
    vi.doMock('./Episodes.tsx', () => ({
      default: (props) => (
        <section aria-label="Episodes view">
          <output>
            {JSON.stringify({
              episodes: props.episodes,
              initialId: props.initialId,
              create: props.initialCreate
            })}
          </output>
          <button onClick={props.onReload}>Reload episodes</button>
          <button
            onClick={() =>
              props.onSaved(episodeFixture({ _id: 'episode', title: 'Revised episode' }))
            }
          >
            Save existing episode
          </button>
          <button
            onClick={() =>
              props.onSaved(episodeFixture({ _id: 'new-episode', title: 'New episode' }))
            }
          >
            Save new episode
          </button>
          <button
            onClick={() =>
              props.onAssetSaved(assetFixture({ _id: 'existing', name: 'Updated from episode' }))
            }
          >
            Save linked asset
          </button>
          <button onClick={() => props.onChat({ episodeId: 'episode', sceneId: 'scene' })}>
            Discuss scene
          </button>
        </section>
      )
    }));
    vi.doMock('./ProductionChat.tsx', () => ({
      default: (props) => (
        <section aria-label="Chat view">
          <output>{JSON.stringify(props.initialContext)}</output>
          <button onClick={() => props.onReview('episodes', 'episode')}>Review draft</button>
          <button onClick={props.onChanged}>Refresh after chat</button>
        </section>
      )
    }));
    vi.doMock('./SeriesBible.tsx', () => ({
      default: (props) => (
        <section aria-label="Bible view">
          <output>{props.settings.era}</output>
          <button onClick={() => props.onSaved({ ...props.settings, era: 'Updated era' })}>
            Save bible
          </button>
        </section>
      )
    }));
    vi.doMock('./StudioMedia.tsx', () => ({
      ReferencePreview: ({ file }) => <span>{file?.originalName}</span>,
      default: (props) => (
        <section aria-label="Media view">
          <output>{JSON.stringify(props.media)}</output>
        </section>
      )
    }));
    ({ default: App } = await import('./App.tsx'));
  });
  afterAll(() => {
    vi.doUnmock('./AssetLibrary.tsx');
    vi.doUnmock('./Episodes.tsx');
    vi.doUnmock('./ProductionChat.tsx');
    vi.doUnmock('./SeriesBible.tsx');
    vi.doUnmock('./StudioMedia.tsx');
    vi.resetModules();
  });
  beforeEach(() => {
    vi.mocked(request).mockReset();
    localStorage.clear();
    history.replaceState(null, '', '/');
    vi.stubGlobal('scrollTo', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const data = () =>
    studioFixture({
      assets: [
        {
          _id: 'existing',
          name: 'Original',
          finalChoice: { title: 'Chosen', mediaIds: ['image'] }
        },
        { _id: 'other', name: 'Other' }
      ],
      episodes: [
        {
          _id: 'episode',
          title: 'Episode',
          scenes: [{ id: 'scene', clips: [{ id: 'shot', takeIds: ['video'] }] }]
        }
      ],
      media: [
        { _id: 'image', originalName: 'Image.png' },
        { _id: 'video', kind: 'video', originalName: 'Video.mp4' }
      ]
    });

  function nav(label: string) {
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Studio navigation' })).getByRole('button', {
        name: label
      })
    );
  }

  test('library callbacks update and deduplicate records and media while preserving unrelated records', async () => {
    vi.mocked(request).mockResolvedValue(data());
    render(<App />);
    await screen.findByText(/A galaxy of choices/);
    nav('Creative library');
    await screen.findByRole('region', { name: 'Library view' });
    fireEvent.click(screen.getByText('Save new asset'));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Library view' })).toHaveTextContent(
        'New character'
      )
    );
    fireEvent.click(screen.getByText('Save existing asset'));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Library view' })).toHaveTextContent(
        'Revised character'
      )
    );
    fireEvent.click(screen.getByText('Import image'));
    fireEvent.click(screen.getByText('Import image'));
    expect(
      screen.getByRole('region', { name: 'Library view' }).textContent.match(/New.png/g)
    ).toHaveLength(1);
    vi.mocked(request).mockRejectedValueOnce(new Error('Refresh offline'));
    fireEvent.click(screen.getByText('Save existing asset'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('region', { name: 'Library view' })).toHaveTextContent(
      'Revised character'
    );
    vi.mocked(request).mockRejectedValueOnce(new Error('Deleted; refresh offline'));
    fireEvent.click(screen.getByText('Delete image'));
    await screen.findByText(/Deleted; refresh offline/);
    expect(screen.getByRole('region', { name: 'Library view' })).not.toHaveTextContent('Image.png');
    expect(localStorage.getItem('roxy-studio-rejected-media')).toContain('image');
    vi.mocked(request).mockResolvedValue(data());
    fireEvent.click(screen.getByText('Delete image'));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByText('Reload library'));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByText('Open linked episode'));
    expect(await screen.findByRole('region', { name: 'Episodes view' })).toHaveTextContent(
      'episode'
    );
  });

  test('episode, scene-chat and bible callbacks retain the requested context and saved settings', async () => {
    vi.mocked(request).mockResolvedValue(data());
    history.replaceState(null, '', '/?episode=episode');
    render(<App />);
    await screen.findByRole('region', { name: 'Episodes view' });
    fireEvent.click(screen.getByText('Save existing episode'));
    expect(screen.getByRole('region', { name: 'Episodes view' })).toHaveTextContent(
      'Revised episode'
    );
    fireEvent.click(screen.getByText('Save new episode'));
    expect(screen.getByRole('region', { name: 'Episodes view' })).toHaveTextContent('New episode');
    fireEvent.click(screen.getByText('Save linked asset'));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByText('Reload episodes'));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByText('Discuss scene'));
    expect(await screen.findByRole('region', { name: 'Chat view' })).toHaveTextContent(
      '"sceneId":"scene"'
    );
    expect(location.search).toBe('?chat=1');
    fireEvent.click(screen.getByText('Refresh after chat'));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByText('Review draft'));
    await screen.findByRole('region', { name: 'Episodes view' });
    nav('Series bible');
    fireEvent.click(screen.getByText('Save bible'));
    expect(screen.getByRole('region', { name: 'Bible view' })).toHaveTextContent('Updated era');
    nav('Media library');
    expect(screen.getByRole('region', { name: 'Media view' })).toHaveTextContent('Video.mp4');
  });

  test('asset chat context and failed draft navigation remain on the correct conversation', async () => {
    const current = data();
    current.settings.workflowVersion = 1;
    vi.mocked(request).mockResolvedValue(current);
    history.replaceState(null, '', '/?asset=existing');
    render(<App />);
    await screen.findByRole('region', { name: 'Library view' });
    fireEvent.click(screen.getByText('Save existing asset'));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByText('Discuss asset'));
    expect(await screen.findByRole('region', { name: 'Chat view' })).toHaveTextContent(
      '"assetId":"existing"'
    );
    vi.mocked(request).mockRejectedValueOnce(new Error('Review unavailable'));
    fireEvent.click(screen.getByText('Review draft'));
    await screen.findByText(/Review unavailable/);
    expect(screen.getByRole('region', { name: 'Chat view' })).toBeVisible();
  });

  test('dashboard review links open the correct record and anchor, retaining modifier-click behavior', async () => {
    const current = data();
    current.workflowReviews = [
      reviewFixture({
        key: 'draft',
        name: 'Episode',
        title: 'Story draft',
        stage: 'story-draft',
        status: 'draft',
        target: { scope: 'episode', recordId: 'episode' }
      }),
      reviewFixture({
        key: 'brief',
        name: 'Character',
        title: 'Brief',
        stage: 'brief',
        target: { scope: 'asset', recordId: 'existing' }
      }),
      reviewFixture({
        key: 'visual',
        stage: 'visual',
        title: 'Picture',
        name: 'Shot',
        target: { scope: 'clip', recordId: 'episode', sceneId: 'scene', clipId: 'shot' }
      })
    ];
    vi.mocked(request).mockResolvedValue(current);
    render(<App />);
    const draft = await screen.findByRole('link', { name: /Episode · Story draft/ });
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'])
      fireEvent.click(draft, { [modifier]: true });
    expect(location.search).toBe('');
    fireEvent.click(draft);
    await screen.findByRole('region', { name: 'Episodes view' });
    expect(location.hash).toBe('#draft');
    nav('Overview');
    fireEvent.click(screen.getByRole('link', { name: /Character · Brief/ }));
    await screen.findByRole('region', { name: 'Library view' });
    expect(location.search).toBe('?asset=existing');
    expect(location.hash).toContain('review-asset--existing');
  });

  test('overview actions and mobile navigation open and close the same workspace screens', async () => {
    const current = data();
    current.project = { key: 'sith', name: 'Sith', cinematicOnly: true };
    current.assets[0].seedKey = 'fortune';
    vi.mocked(request).mockResolvedValue(current);
    render(
      <App
        account={{
          session: { authenticated: true, configured: true, username: 'owner' },
          onSession: vi.fn(),
          onSignedOut: vi.fn()
        }}
      />
    );
    await screen.findByText(/Develop Roxy as the Sith Inquisitor/);
    expect(screen.getByRole('button', { name: 'Account' })).toBeVisible();
    expect(screen.getByText(/Original · Chosen/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Explore the library' }));
    await screen.findByRole('region', { name: 'Library view' });
    nav('Overview');
    fireEvent.click(screen.getByRole('button', { name: 'All assets' }));
    await screen.findByRole('region', { name: 'Library view' });
    nav('Overview');
    fireEvent.click(screen.getByRole('button', { name: 'Start an episode' }));
    expect(await screen.findByRole('region', { name: 'Episodes view' })).toHaveTextContent(
      '"create":true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open studio menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('navigation', { name: 'Mobile studio navigation' })
      ).not.toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open studio menu' }));
    fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.queryByRole('navigation', { name: 'Mobile studio navigation' })
      ).not.toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open studio menu' }));
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Mobile studio navigation' })).getByRole(
        'button',
        { name: 'Production chat' }
      )
    );
    expect(await screen.findByRole('region', { name: 'Chat view' })).toBeVisible();
  });

  test('workspace refresh coalesces concurrent changes, ignores hidden tabs and stops after unmount', async () => {
    const pending: ((value: ReturnType<typeof data>) => void)[] = [];
    vi.mocked(request).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const listen = vi.spyOn(window, 'addEventListener');
    const view = render(<App />);
    fireEvent(window, new Event(studioChangeEvent));
    fireEvent(window, new Event(studioChangeEvent));
    expect(request).toHaveBeenCalledOnce();
    await act(async () => pending[0](data()));
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => pending[1](data()));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(window, new Event('focus'));
    fireEvent(window, new StorageEvent('storage', { key: 'unrelated' }));
    expect(request).toHaveBeenCalledTimes(2);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    fireEvent(window, new StorageEvent('storage', { key: studioChangeKey }));
    expect(request).toHaveBeenCalledTimes(3);
    const queuedFocus = listen.mock.calls.find(([event]) => event === 'focus')[1] as EventListener;
    view.unmount();
    await act(async () => pending[2](data()));
    act(() => queuedFocus(new Event('focus')));
    expect(request).toHaveBeenCalledTimes(3);
  });

  test('opening a chat link selects chat directly and a failed late refresh cannot update an unmounted app', async () => {
    history.replaceState(null, '', '/?chat=1');
    let reject: (error: Error) => void;
    vi.mocked(request).mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    const view = render(<App />);
    view.unmount();
    await act(async () => reject(new Error('Closed tab')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('project selection changes only the storyline and keeps the current anchor', async () => {
    const current = data();
    current.projects = [
      { key: 'imperial-smuggler', name: 'Smuggler' },
      { key: 'sith', name: 'Sith' }
    ];
    vi.mocked(request).mockResolvedValue(current);
    history.replaceState(null, '', '/?project=imperial-smuggler&old=remove#shot');
    render(<App />);
    const picker = await screen.findByRole('combobox', { name: 'Project / class storyline' });
    const realWindow = window,
      assign = vi.fn();
    const href = realWindow.location.href,
      origin = realWindow.location.origin;
    vi.stubGlobal(
      'window',
      new Proxy(realWindow, {
        get(target, key) {
          if (key === 'location') return { href, assign };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      })
    );
    fireEvent.mouseDown(picker);
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Sith'));
    expect(assign).toHaveBeenCalledWith(origin + '/?project=sith#shot');
  });
});
