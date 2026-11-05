import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { request, uploadMedia } from './api.ts';
import AssetLibrary, { AssetEditor } from './AssetLibrary.tsx';
import { assetStatus } from './studio-utils.ts';
import { assetFixture, episodeFixture, mediaFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';

vi.mock('./api.ts', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));

describe('component behavior', () => {
  const base = {
    _id: 'voice',
    name: 'Roxy voice',
    kind: 'voice' as const,
    aliases: [],
    brief: 'Confident and teasing.',
    notes: '',
    revision: 4,
    history: [],
    scope: 'reusable' as const,
    finalChoice: null,
    candidates: [
      { id: 'v3', title: 'Eleven v3', description: '', mediaIds: ['audio'], archived: false }
    ]
  };

  const episodes = [{ _id: 'episode-1', title: 'Episode 01' }];

  function mount(element) {
    return render(<ThemeProvider theme={theme}>{element}</ThemeProvider>);
  }

  beforeEach(() => {
    vi.mocked(request).mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function choose(label: string, option: string) {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText(option));
  }

  test('asset and voice option fields save their exact edits while keeping other options', async () => {
    vi.mocked(request).mockImplementation(async (_path, options) => ({ asset: options.body }));
    mount(
      <AssetEditor
        asset={assetFixture({
          ...base,
          candidates: [...base.candidates, { id: 'other', title: 'Other', mediaIds: [] }]
        })}
        episodes={episodes.map(episodeFixture)}
        media={[mediaFixture({ _id: 'audio', kind: 'audio' })]}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
      />
    );
    for (const [label, value] of [
      ['Asset name', 'Harkun voice'],
      ['Aliases, separated by commas', 'Harkun, Overseer'],
      ['Creative brief', 'Firm and restrained.'],
      ['Continuity notes', 'Preserve delivery.']
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    choose('Asset use', 'Episode only');
    choose('Episode', 'Episode 01');
    choose('Asset use', 'Reusable across episodes');
    choose('Asset use', 'Episode only');
    choose('Episode', 'Episode 01');
    choose('Review status', 'In development');
    for (const [label, value] of [
      ['Option title', 'Preferred voice'],
      ['Design and feedback', 'Natural diction.'],
      ['ElevenLabs voice ID', 'provider-id'],
      ['Voice model and delivery settings', 'Eleven v3']
    ])
      fireEvent.change(screen.getAllByLabelText(label)[0], { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive option' })[0]);
    expect(screen.getByRole('button', { name: 'Restore option' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Restore option' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/studio/assets/voice',
        expect.objectContaining({
          method: 'PUT',
          body: expect.objectContaining({
            name: 'Harkun voice',
            aliases: ['Harkun', 'Overseer'],
            scope: 'episode',
            episodeId: 'episode-1',
            reviewStatus: 'development',
            brief: 'Firm and restrained.',
            candidates: [
              expect.objectContaining({
                title: 'Preferred voice',
                voiceId: 'provider-id',
                voiceModel: 'Eleven v3',
                archived: false
              }),
              expect.objectContaining({ id: 'other' }),
              expect.objectContaining({ title: 'Option 3' })
            ]
          })
        })
      )
    );
  });

  test.each([false, true])(
    'asset organization preserves history when archived is %s and keeps API failures visible',
    async (archived) => {
      const current = assetFixture({
        ...base,
        archived,
        history: [
          { _id: 'version', savedAt: '2026-11-01', candidates: [] },
          { _id: 'final', savedAt: '2026-11-02', finalChoice: { title: 'Earlier voice' } }
        ]
      });
      vi.mocked(request).mockResolvedValue({
        asset: { ...current, archived: !archived, revision: current.revision + 1 }
      });
      const onSaved = vi.fn(),
        onChat = vi.fn(),
        onOpenAsset = vi.fn();
      vi.stubGlobal(
        'URL',
        Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:asset'), revokeObjectURL: vi.fn() })
      );
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      mount(
        <AssetEditor
          asset={current}
          assets={[
            assetFixture({
              _id: 'comparison',
              archived: true,
              relatedAssetId: 'voice',
              name: 'Earlier comparison'
            })
          ]}
          media={[]}
          onSaved={onSaved}
          onMedia={vi.fn()}
          onChat={onChat}
          onOpenAsset={onOpenAsset}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Discuss in chat' }));
      expect(onChat).toHaveBeenCalledWith({ assetId: 'voice' });
      fireEvent.click(screen.getByRole('button', { name: 'View Earlier comparison' }));
      expect(onOpenAsset).toHaveBeenCalledWith('comparison');
      fireEvent.click(screen.getByRole('button', { name: 'Decision history (2)' }));
      expect(screen.getByText('Final choice: Earlier voice')).toBeVisible();
      expect(screen.getByText('Working draft')).toBeVisible();
      fireEvent.click(screen.getAllByRole('button', { name: 'Download version' })[0]);
      fireEvent.click(screen.getByRole('button', { name: 'Export asset record' }));
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(2);
      fireEvent.click(
        screen.getByRole('button', { name: archived ? 'Restore asset' : 'Archive asset' })
      );
      await waitFor(() =>
        expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ archived: !archived }))
      );
      vi.mocked(request).mockRejectedValueOnce(new Error('Organization offline'));
      fireEvent.click(
        screen.getByRole('button', { name: archived ? 'Archive asset' : 'Restore asset' })
      );
      expect(await screen.findByText('Organization offline')).toBeVisible();
    }
  );

  test('empty history explains when versions will appear and an empty sound option cannot be approved', () => {
    mount(
      <AssetEditor
        asset={assetFixture({
          ...base,
          kind: 'sound',
          candidates: [{ id: 'empty', title: 'Empty', mediaIds: [] }]
        })}
        media={[]}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Approve this sound' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Decision history (0)' }));
    expect(screen.getByText('Your first saved change will appear here.')).toBeVisible();
  });

  test.each(['character', 'droid', 'prop', 'environment'] as const)(
    'saved %s revision approvals work with an older browser draft and retain all local edits',
    async (kind) => {
      const user = userEvent.setup();
      const asset = {
        ...base,
        _id: 'package-asset',
        kind,
        revision: 6,
        candidates: [],
        production: {
          managed: true,
          items: [
            {
              id: 'master-portrait',
              title: 'Master portrait',
              type: 'image' as const,
              required: true,
              notes: 'Saved revised photographic directions.',
              mediaId: null,
              requiresPlanApproval: true
            }
          ]
        }
      };
      const cached = {
        ...asset,
        revision: 4,
        notes: 'Keep these unsaved continuity edits.',
        production: {
          ...asset.production,
          items: asset.production.items.map((i) => ({ ...i, notes: 'Outdated draft directions.' }))
        }
      };
      const key = 'roxy-studio-asset-package-asset';
      localStorage.setItem(key, JSON.stringify(cached));
      const row = {
        key: 'reference-plan-key',
        target: { scope: 'asset' as const, recordId: asset._id },
        stage: 'reference-plan:master-portrait',
        title: 'Master portrait revision directions',
        status: 'pending-review' as const,
        canApprove: true,
        blockers: [],
        prerequisites: [],
        feedback: '',
        fingerprint: 'saved-directions-fingerprint',
        parentRevision: 6,
        reviewRevision: 0
      };
      let approved = false;
      vi.mocked(request).mockImplementation(async (path) => {
        if (path === '/studio/assistant/character-generation/' + asset._id)
          return {
            asset,
            voice: null,
            speaker: 'Character',
            voicePrompt: 'A separate voice prompt.',
            images: [],
            jobs: []
          };
        if (path === '/studio/workflow/review') {
          approved = true;
          return { review: { state: 'approved' } };
        }
        if (path === '/studio/workflow/board')
          return {
            enabled: true,
            record: asset,
            proposals: [],
            groups: [
              {
                title: 'Reference package',
                target: row.target,
                stages: [
                  {
                    ...row,
                    status: approved ? 'approved' : row.status,
                    reviewRevision: approved ? 1 : 0
                  }
                ]
              }
            ]
          };
        return {};
      });
      const onReload = vi.fn();
      mount(
        <AssetEditor
          asset={assetFixture(asset)}
          assets={[asset].map((value) => assetFixture(value))}
          media={[]}
          workflowVersion={1}
          onSaved={vi.fn()}
          onMedia={vi.fn()}
          onBack={vi.fn()}
          onReload={onReload}
        />
      );
      await user.click(
        await screen.findByRole('button', {
          name: 'Master portrait revision directions Pending review'
        })
      );
      const board = screen.getByRole('region', { name: 'Production approval board' });
      expect(within(board).getByText('Saved revised photographic directions.')).toBeVisible();
      expect(within(board).queryByText('Outdated draft directions.')).not.toBeInTheDocument();
      expect(within(board).getByText(/unsaved editor draft is preserved separately/)).toBeVisible();
      const approve = within(board).getByRole('button', {
        name: 'Approve Master portrait revision directions'
      });
      expect(approve).toBeEnabled();
      await user.click(approve);
      expect(request).toHaveBeenCalledWith('/studio/workflow/review', {
        method: 'POST',
        body: {
          target: row.target,
          stage: row.stage,
          action: 'approve',
          fingerprint: row.fingerprint,
          parentRevision: 6,
          reviewRevision: 0,
          feedback: ''
        }
      });
      await waitFor(() =>
        expect(
          within(board).getByRole('button', {
            name: 'Master portrait revision directions Approved'
          })
        ).toBeInTheDocument()
      );
      expect(screen.getByRole('textbox', { name: 'Continuity notes' })).toHaveValue(cached.notes);
      expect(JSON.parse(localStorage.getItem(key))).toMatchObject({
        revision: 4,
        notes: cached.notes,
        production: cached.production
      });
      expect(onReload).toHaveBeenCalled();
      expect(
        vi.mocked(request).mock.calls.every(([path]) => path !== '/studio/assets/package-asset')
      ).toBe(true);
    }
  );

  test('three review states distinguish unfinished work, decisions, and finalized choices', () => {
    expect(assetStatus({ candidates: [] })).toBe('development');
    expect(assetStatus(base)).toBe('pending-choice');
    expect(assetStatus({ ...base, finalChoice: base.candidates[0] })).toBe('finalized');
    expect(
      assetStatus({ ...base, finalChoice: base.candidates[0], reviewStatus: 'pending-choice' })
    ).toBe('pending-choice');
  });

  test('workflow review state overrides a stale stored pending label while rendering', () => {
    expect(
      assetStatus({ ...base, reviewStatus: 'pending-choice', workflowStatus: 'development' })
    ).toBe('development');
    expect(assetStatus({ ...base, workflowStatus: 'pending-choice' })).toBe('pending-choice');
    expect(assetStatus({ ...base, workflowStatus: 'finalized' })).toBe('finalized');
  });

  test('a finalized ElevenLabs audition can be rejected from its owning voice option', async () => {
    const user = userEvent.setup();
    const result = { deletedMediaId: 'audio' };
    vi.mocked(request).mockResolvedValue(result);
    const onRejected = vi.fn();
    mount(
      <AssetEditor
        asset={assetFixture({ ...base, finalChoice: base.candidates[0] })}
        media={[{ _id: 'audio', kind: 'audio' as const, originalName: 'Roxy-eleven-v3.mp3' }].map(
          (value) => mediaFixture(value)
        )}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
        onBack={vi.fn()}
        onRejected={onRejected}
      />
    );
    expect(screen.getByLabelText('Roxy-eleven-v3.mp3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reject & delete' }));
    expect(request).toHaveBeenCalledWith('/studio/media/audio', {
      method: 'DELETE',
      body: { assetId: 'voice', revision: 4, candidateId: 'v3' }
    });
    expect(onRejected).toHaveBeenCalledWith(result);
  });

  test('an open clean editor displays newly imported character sheets without remounting', () => {
    const al = {
      ...base,
      _id: 'al',
      name: 'AL-1B',
      kind: 'droid' as const,
      finalChoice: { id: 'navigator', finalizedAt: '2026-10-17T20:00:00Z' },
      characterSheets: []
    };
    const props = {
      media: [{ _id: 'sheet', kind: 'image' as const, originalName: 'AL-GPT-sheet.png' }].map(
        mediaFixture
      ),
      onSaved: vi.fn(),
      onMedia: vi.fn(),
      onBack: vi.fn()
    };
    const view = mount(<AssetEditor asset={assetFixture(al)} {...props} />);
    expect(
      screen.queryByRole('button', { name: 'Approve character sheet' })
    ).not.toBeInTheDocument();
    const latest = {
      ...al,
      revision: 5,
      characterSheets: [
        {
          id: 'new-sheet',
          title: 'AL GPT sheet',
          mediaId: 'sheet',
          views: ['front', 'side', 'rear'],
          sourceCandidateId: 'navigator',
          sourceFinalizedAt: al.finalChoice.finalizedAt,
          approvedAt: null
        }
      ]
    };
    view.rerender(
      <ThemeProvider theme={theme}>
        <AssetEditor asset={assetFixture(latest)} {...props} />
      </ThemeProvider>
    );
    expect(screen.getByRole('img', { name: 'AL-GPT-sheet.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve character sheet' })).toBeEnabled();
  });

  test('an older local draft does not block saved sheet approval or lose unsaved changes', async () => {
    const user = userEvent.setup();
    const old = {
      ...base,
      _id: 'al',
      name: 'AL-1B',
      kind: 'droid' as const,
      characterSheets: [],
      finalChoice: { id: 'navigator', finalizedAt: '2026-10-17T20:00:00Z' }
    };
    localStorage.setItem(
      'roxy-studio-asset-al',
      JSON.stringify({ ...old, notes: 'My unsaved notes.' })
    );
    const current = {
      ...old,
      revision: 5,
      characterSheets: [
        {
          id: 'new-sheet',
          title: 'AL pending sheet',
          mediaId: 'new-image',
          views: ['front', 'side', 'rear'],
          sourceCandidateId: 'navigator',
          sourceFinalizedAt: old.finalChoice.finalizedAt,
          approvedAt: null
        }
      ]
    };
    const updated = {
      ...current,
      revision: 6,
      characterSheets: current.characterSheets.map((s) => ({
        ...s,
        approvedAt: '2026-10-18T20:00:00Z'
      }))
    };
    vi.mocked(request).mockResolvedValue({ asset: updated });
    mount(
      <AssetEditor
        asset={assetFixture(current)}
        media={[{ _id: 'new-image', kind: 'image' as const, originalName: 'AL-pending.png' }].map(
          (value) => mediaFixture(value)
        )}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(screen.getByRole('img', { name: 'AL-pending.png' })).toBeInTheDocument();
    expect(screen.getByText('Awaiting review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve character sheet' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Approve character sheet' }));
    expect(request).toHaveBeenCalledWith('/studio/assets/al/character-sheets/new-sheet/approve', {
      method: 'POST',
      body: { revision: 5 }
    });
    expect(screen.getByRole('textbox', { name: 'Continuity notes' })).toHaveValue(
      'My unsaved notes.'
    );
    expect(JSON.parse(localStorage.getItem('roxy-studio-asset-al')).notes).toBe(
      'My unsaved notes.'
    );
    expect(JSON.parse(localStorage.getItem('roxy-studio-asset-al')).revision).toBe(old.revision);
  });

  test('new saved options do not overwrite a local draft and offer recovery', () => {
    localStorage.setItem(
      'roxy-studio-asset-voice',
      JSON.stringify({ ...base, notes: 'Keep my draft notes.' })
    );
    mount(
      <AssetEditor
        asset={assetFixture({ ...base, revision: 5 })}
        media={[]}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(screen.getByRole('textbox', { name: 'Continuity notes' })).toHaveValue(
      'Keep my draft notes.'
    );
    expect(screen.getByText(/New choices or sheets have been saved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export draft and load latest' })).toBeEnabled();
  });

  test('sheet approval advances a current draft revision while preserving its edits', async () => {
    const user = userEvent.setup();
    const finalizedAt = '2026-10-17T20:00:00Z';
    const al = {
      ...base,
      _id: 'al',
      name: 'AL-1B',
      kind: 'droid' as const,
      finalChoice: { id: 'navigator', finalizedAt },
      characterSheets: [
        {
          id: 'sheet',
          title: 'AL sheet',
          mediaId: 'image',
          views: ['front'],
          sourceCandidateId: 'navigator',
          sourceFinalizedAt: finalizedAt,
          approvedAt: null
        }
      ]
    };
    const approved = {
      ...al,
      revision: 5,
      characterSheets: al.characterSheets.map((s) => ({ ...s, approvedAt: '2026-10-18T20:00:00Z' }))
    };
    vi.mocked(request)
      .mockResolvedValueOnce({ asset: approved })
      .mockResolvedValueOnce({ asset: { ...approved, revision: 6, notes: 'Keep my edit.' } });
    mount(
      <AssetEditor
        asset={assetFixture(al)}
        media={[{ _id: 'image', kind: 'image' as const, originalName: 'AL.png' }].map((value) =>
          mediaFixture(value)
        )}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
        onBack={vi.fn()}
      />
    );
    await user.type(screen.getByRole('textbox', { name: 'Continuity notes' }), 'Keep my edit.');
    expect(screen.getByRole('button', { name: 'Approve character sheet' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Approve character sheet' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(request).toHaveBeenLastCalledWith('/studio/assets/al', {
      method: 'PUT',
      body: expect.objectContaining({
        revision: 5,
        notes: 'Keep my edit.',
        characterSheets: approved.characterSheets
      })
    });
  });

  test('library separates reusable, episode-only, pending, and archived records', async () => {
    const user = userEvent.setup();
    mount(
      <AssetLibrary
        assets={[
          base,
          {
            ...base,
            _id: 'outfit',
            name: 'Episode outfit',
            kind: 'wardrobe' as const,
            scope: 'episode' as const,
            episodeId: 'episode-1',
            candidates: []
          },
          { ...base, _id: 'comparison', name: 'Old comparison', archived: true }
        ].map((value) => assetFixture(value))}
        episodes={episodes.map((value) => episodeFixture(value))}
        media={[]}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Review Roxy voice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review Old comparison' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reusable' }));
    expect(screen.queryByRole('button', { name: 'Review Episode outfit' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Episode only' }));
    expect(screen.getByRole('button', { name: 'Review Episode outfit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review Roxy voice' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('button', { name: 'Review Old comparison' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pending choice (1)' }));
    expect(screen.getByRole('button', { name: 'Review Roxy voice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review Episode outfit' })).not.toBeInTheDocument();
  });

  test('un-finalize is accessible beside the status and reopens the saved choice', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const next = { ...base, revision: 5, reviewStatus: 'pending-choice' };
    vi.mocked(request).mockResolvedValue({ asset: next });
    mount(
      <AssetEditor
        asset={assetFixture({ ...base, finalChoice: base.candidates[0] })}
        media={[{ _id: 'audio', kind: 'audio' as const, originalName: 'Roxy-eleven-v3.mp3' }].map(
          (value) => mediaFixture(value)
        )}
        onSaved={onSaved}
        onMedia={vi.fn()}
        onBack={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Un-finalize' }));
    expect(request).toHaveBeenCalledWith('/studio/assets/voice/reopen', {
      method: 'POST',
      body: { revision: 4, candidateId: undefined }
    });
    expect(onSaved).toHaveBeenCalledWith(next);
    expect(screen.getByRole('combobox', { name: 'Review status' })).toHaveTextContent(
      'Pending choice'
    );
    expect(screen.queryByRole('button', { name: 'Un-finalize' })).not.toBeInTheDocument();
  });

  test('new episode-only assets require an episode selection and save the assignment', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const next = {
      ...base,
      _id: 'new',
      name: 'Custom outfit',
      kind: 'character' as const,
      scope: 'episode' as const,
      episodeId: 'episode-1'
    };
    vi.mocked(request).mockResolvedValue({ asset: next });
    mount(
      <AssetLibrary
        assets={[]}
        episodes={episodes.map((value) => episodeFixture(value))}
        media={[]}
        onSaved={onSaved}
        onMedia={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Episode only' }));
    await user.click(screen.getByRole('button', { name: 'New asset' }));
    await user.type(screen.getByRole('textbox', { name: 'Asset name' }), 'Custom outfit');
    expect(screen.getByRole('button', { name: 'Create asset' })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Episode' }));
    await user.click(screen.getByRole('option', { name: 'Episode 01' }));
    await user.click(screen.getByRole('button', { name: 'Create asset' }));
    expect(request).toHaveBeenCalledWith('/studio/assets', {
      method: 'POST',
      body: {
        name: 'Custom outfit',
        kind: 'character' as const,
        scope: 'episode' as const,
        episodeId: 'episode-1'
      }
    });
    expect(onSaved).toHaveBeenCalledWith(next);
  });

  test('pending replacement preserves the approved voice and exposes comparison history', () => {
    mount(
      <AssetEditor
        asset={assetFixture({
          ...base,
          finalChoice: base.candidates[0],
          reviewStatus: 'pending-choice'
        })}
        assets={[
          {
            ...base,
            _id: 'old',
            name: 'Production comparison',
            archived: true,
            relatedAssetId: base._id
          }
        ].map((value) => assetFixture(value))}
        media={[{ _id: 'audio', kind: 'audio' as const, originalName: 'Roxy-eleven-v3.mp3' }].map(
          (value) => mediaFixture(value)
        )}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
        onBack={vi.fn()}
        onOpenAsset={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Keep current choice' })).toBeEnabled();
    expect(screen.getByText(/current approved reference stays in place/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Comparison history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Production comparison/ })).toBeInTheDocument();
  });

  test('consolidation submits both revisions and returns both preserved records', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onOpenAsset = vi.fn();
    const source = { ...base, _id: 'comparison', name: 'Production comparison' };
    const result = {
      asset: base,
      archivedAsset: { ...source, archived: true, relatedAssetId: base._id }
    };
    vi.mocked(request).mockResolvedValue(result);
    mount(
      <AssetEditor
        asset={assetFixture(source)}
        assets={[base, source].map((value) => assetFixture(value))}
        media={[]}
        onSaved={onSaved}
        onMedia={vi.fn()}
        onBack={vi.fn()}
        onOpenAsset={onOpenAsset}
      />
    );
    await user.click(screen.getByRole('combobox', { name: 'Main asset' }));
    await user.click(screen.getByRole('option', { name: 'Roxy voice' }));
    await user.click(screen.getByRole('button', { name: 'Consolidate comparison' }));
    expect(request).toHaveBeenCalledWith('/studio/assets/comparison/consolidate', {
      method: 'POST',
      body: { revision: 4, targetId: 'voice', targetRevision: 4 }
    });
    expect(onSaved).toHaveBeenCalledWith(result.asset);
    expect(onSaved).toHaveBeenCalledWith(result.archivedAsset);
    expect(onOpenAsset).toHaveBeenCalledWith('voice');
  });

  test('generated voice options preserve identity references, attach chosen media and export a failed save', async () => {
    const files = [
      mediaFixture({ _id: 'audio', kind: 'audio', originalName: 'first.wav' }),
      mediaFixture({ _id: 'new', kind: 'audio', originalName: 'new.wav' }),
      mediaFixture({ _id: 'identity', kind: 'image' }),
      mediaFixture({ _id: 'uploaded', kind: 'audio' })
    ];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:draft'), revokeObjectURL: vi.fn() })
    );
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.mocked(request).mockRejectedValue(new Error('Save failed'));
    mount(
      <AssetEditor
        asset={assetFixture({
          ...base,
          aliases: undefined,
          history: undefined,
          identitySourceMediaIds: ['identity'],
          candidates: [
            { ...base.candidates[0], generatedVoiceId: 'generated' },
            { id: 'other', title: 'Other', mediaIds: [] }
          ]
        })}
        media={files}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
      />
    );
    expect(screen.getByText(/Listen to this generated audition/)).toBeVisible();
    fireEvent.mouseDown(screen.getAllByRole('combobox', { name: 'Attach saved media' })[0]);
    fireEvent.click(within(screen.getByRole('listbox')).getByText('new.wav'));
    expect(
      JSON.parse(localStorage.getItem('roxy-studio-asset-voice')).candidates[0].mediaIds
    ).toEqual(['audio', 'new']);
    vi.mocked(uploadMedia).mockResolvedValue(mediaFixture({ _id: 'uploaded', kind: 'audio' }));
    fireEvent.change(screen.getAllByLabelText('Upload reference')[0], {
      target: { files: [new File(['voice'], 'upload.wav')] }
    });
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem('roxy-studio-asset-voice')).candidates[0].mediaIds
      ).toContain('uploaded')
    );
    expect(
      JSON.parse(localStorage.getItem('roxy-studio-asset-voice')).candidates[1].mediaIds
    ).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Decision history/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Save failed');
    fireEvent.click(screen.getByRole('button', { name: 'Export draft' }));
    expect(download).toHaveBeenCalledOnce();
  });

  test('comparison consolidation can fail safely or return to the library without an asset-opening callback', async () => {
    const target = assetFixture({ _id: 'main', name: 'Main', revision: 5, kind: 'voice' }),
      onBack = vi.fn(),
      onSaved = vi.fn();
    mount(
      <AssetEditor
        asset={assetFixture(base)}
        assets={[target]}
        media={[mediaFixture({ _id: 'audio', kind: 'audio' })]}
        onSaved={onSaved}
        onBack={onBack}
        onMedia={vi.fn()}
      />
    );
    choose('Main asset', 'Main');
    vi.mocked(request).mockRejectedValueOnce(new Error('Consolidation unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Consolidate comparison' }));
    expect(await screen.findByText('Consolidation unavailable')).toBeVisible();
    vi.mocked(request).mockResolvedValueOnce({
      asset: target,
      archivedAsset: { ...base, archived: true }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Consolidate comparison' }));
    await waitFor(() => expect(onBack).toHaveBeenCalledOnce());
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  test('a comparison target removed during editing cannot submit a stale consolidation', () => {
    const target = assetFixture({ _id: 'main', name: 'Main', kind: 'voice' });
    const props = {
      asset: assetFixture(base),
      assets: [target],
      media: [mediaFixture({ _id: 'audio', kind: 'audio' })],
      onSaved: vi.fn(),
      onMedia: vi.fn()
    };
    const view = render(<AssetEditor {...props} />);
    choose('Main asset', 'Main');
    view.rerender(
      <AssetEditor {...props} assets={[{ ...target, _id: 'replacement', name: 'Replacement' }]} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Consolidate comparison' }));
    expect(request).not.toHaveBeenCalled();
  });
});

describe('library callbacks and filters', () => {
  let AssetLibrary: (typeof import('./AssetLibrary.tsx'))['default'];
  let AssetEditor: (typeof import('./AssetLibrary.tsx'))['AssetEditor'];
  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('./ProductionBoard.tsx', () => ({ default: () => null, EnableWorkflow: () => null }));
    vi.doMock('./CharacterGeneration.tsx', () => ({
      default: ({ asset, onSaved }) => (
        <button
          onClick={() =>
            onSaved({ ...asset, revision: asset.revision + 1, name: 'Refreshed character' })
          }
        >
          Refresh character prompts
        </button>
      )
    }));
    vi.doMock('./CharacterSheets.tsx', () => ({
      default: ({ asset, onSaved }) => (
        <button
          onClick={() =>
            onSaved({ ...asset, revision: asset.revision + 1, name: 'Refreshed sheet' })
          }
        >
          Refresh sheet
        </button>
      )
    }));
    ({ default: AssetLibrary, AssetEditor } = await import('./AssetLibrary.tsx'));
  });
  afterAll(() => {
    vi.doUnmock('./ProductionBoard.tsx');
    vi.doUnmock('./CharacterGeneration.tsx');
    vi.doUnmock('./CharacterSheets.tsx');
    vi.resetModules();
  });
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(request).mockReset();
  });

  function choose(label: string, option: string) {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText(option));
  }

  test('clean character and sheet refreshes update the editor while dirty prompts retain local asset edits', () => {
    const asset = assetFixture({ _id: 'character', revision: 2, name: 'Original' }),
      onSaved = vi.fn();
    render(
      <AssetEditor
        asset={asset}
        media={[]}
        onSaved={onSaved}
        onMedia={vi.fn()}
        workflowVersion={1}
      />
    );
    fireEvent.click(screen.getByText('Refresh character prompts'));
    expect(screen.getByLabelText('Asset name')).toHaveValue('Refreshed character');
    fireEvent.click(screen.getByText('Refresh sheet'));
    expect(screen.getByLabelText('Asset name')).toHaveValue('Refreshed sheet');
    fireEvent.change(screen.getByLabelText('Continuity notes'), {
      target: { value: 'My local notes' }
    });
    fireEvent.click(screen.getByText('Refresh character prompts'));
    expect(screen.getByLabelText('Continuity notes')).toHaveValue('My local notes');
    expect(onSaved).toHaveBeenCalledTimes(3);
    fireEvent.change(screen.getByLabelText('Source URL'), {
      target: { value: 'https://example.test/source' }
    });
    expect(
      JSON.parse(localStorage.getItem('roxy-studio-asset-character')).production.sourceUrl
    ).toBe('https://example.test/source');
  });

  test('library category, alias, status and episode filters show only the chosen assets', () => {
    const assets = [
      assetFixture({ _id: 'character', name: 'Harkun', aliases: ['Overseer'] }),
      assetFixture({
        _id: 'episode-character',
        name: 'Episode actor',
        scope: 'episode',
        episodeId: 'episode',
        reviewStatus: 'pending-choice'
      }),
      assetFixture({
        _id: 'other-episode',
        name: 'Other actor',
        scope: 'episode',
        episodeId: 'other'
      }),
      assetFixture({ _id: 'sound', name: 'Room tone', kind: 'sound' })
    ];
    render(
      <AssetLibrary
        assets={assets}
        episodes={[
          episodeFixture({ _id: 'episode', title: 'Episode One' }),
          episodeFixture({ _id: 'other', title: 'Other Episode' })
        ]}
        media={[]}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Characters' }));
    expect(screen.queryByRole('button', { name: 'Review Room tone' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search assets and aliases'), {
      target: { value: 'overseer' }
    });
    expect(screen.getByRole('button', { name: 'Review Harkun' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Review Episode actor' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search assets and aliases'), { target: { value: '' } });
    choose('Filter by status', 'Pending choice');
    expect(screen.getByRole('button', { name: 'Review Episode actor' })).toBeVisible();
    choose('Filter by status', 'All statuses');
    fireEvent.click(screen.getByRole('button', { name: 'Episode only' }));
    choose('Filter by episode', 'Episode One');
    expect(screen.queryByRole('button', { name: 'Review Other actor' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pending choice (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pending choice (1)' }));
    expect(screen.getByRole('button', { name: 'Review Room tone' })).toBeVisible();
  });

  test('asset creation supports explicit category and scope, shows failures and can close either way', async () => {
    render(
      <AssetLibrary
        assets={[]}
        episodes={[episodeFixture({ _id: 'episode', title: 'Episode One' })]}
        media={[]}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'New asset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'New asset' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'New asset' }));
    fireEvent.change(screen.getByLabelText('Asset name'), { target: { value: 'Training blade' } });
    choose('Category', 'Props');
    choose('Asset use', 'Episode only');
    choose('Episode', 'Episode One');
    vi.mocked(request).mockRejectedValueOnce(new Error('Create unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Create asset' }));
    expect(await screen.findByText('Create unavailable')).toBeVisible();
    expect(request).toHaveBeenCalledWith('/studio/assets', {
      method: 'POST',
      body: { name: 'Training blade', kind: 'prop', scope: 'episode', episodeId: 'episode' }
    });
  });

  test('a shot-image library entry has a direct back route and ordinary assets return from their editor', () => {
    const assets = [
      assetFixture({ _id: 'shot', name: 'Shot composition', clipId: 'shot' }),
      assetFixture({ _id: 'character', name: 'Character' })
    ];
    render(
      <AssetLibrary
        assets={assets}
        episodes={[]}
        media={[]}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
        initialId="shot"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Creative library' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review Character' }));
    expect(screen.getByLabelText('Asset name')).toHaveValue('Character');
    fireEvent.click(screen.getByRole('button', { name: 'Creative library' }));
    expect(screen.getByRole('heading', { name: 'Creative library' })).toBeVisible();
  });

  test('new reusable assets have no episode association and unknown episode cards keep a readable scope', async () => {
    const onSaved = vi.fn();
    vi.mocked(request).mockResolvedValue({
      asset: assetFixture({ _id: 'new', name: 'New actor' })
    });
    render(
      <AssetLibrary
        assets={[
          assetFixture({
            _id: 'orphan',
            name: 'Orphan',
            scope: 'episode',
            episodeId: 'unknown',
            aliases: undefined
          })
        ]}
        episodes={[]}
        media={[]}
        onSaved={onSaved}
        onMedia={vi.fn()}
      />
    );
    expect(screen.getByText(/Episode only.*Episode/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'New asset' }));
    fireEvent.change(screen.getByLabelText('Asset name'), { target: { value: 'New actor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create asset' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(request).toHaveBeenCalledWith(
      '/studio/assets',
      expect.objectContaining({
        body: expect.objectContaining({ scope: 'reusable', episodeId: null })
      })
    );
  });

  test('pending video cards respect a specific episode filter for matching and unrelated episodes', () => {
    const episodes = ['one', 'two'].map((_id) =>
      episodeFixture({
        _id,
        title: 'Episode ' + _id,
        scenes: [
          {
            id: 'scene',
            title: 'Scene',
            clips: [{ id: 'shot', title: 'Shot', takeIds: ['video'] }]
          }
        ]
      })
    );
    render(
      <AssetLibrary
        assets={[]}
        episodes={episodes}
        media={[mediaFixture({ _id: 'video', kind: 'video' })]}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Episode only' }));
    choose('Filter by episode', 'Episode one');
    expect(screen.getByText(/Episode one.*Scene/)).toBeVisible();
    expect(screen.queryByText(/Episode two.*Scene/)).not.toBeInTheDocument();
  });
});
