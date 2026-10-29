import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.js';
import AssetLibrary, { AssetEditor } from './AssetLibrary.jsx';
import { assetStatus } from './studio-utils.js';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));
const base = {
  _id: 'voice',
  name: 'Roxy voice',
  kind: 'voice',
  aliases: [],
  brief: 'Confident and teasing.',
  notes: '',
  revision: 4,
  history: [],
  scope: 'reusable',
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

test.each(['character', 'droid', 'prop', 'environment'])(
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
            type: 'image',
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
      target: { scope: 'asset', recordId: asset._id },
      stage: 'reference-plan:master-portrait',
      title: 'Master portrait revision directions',
      status: 'pending-review',
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
        asset={asset}
        assets={[asset]}
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
        within(board).getByRole('button', { name: 'Master portrait revision directions Approved' })
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
      asset={{ ...base, finalChoice: base.candidates[0] }}
      media={[{ _id: 'audio', kind: 'audio', originalName: 'Roxy-eleven-v3.mp3' }]}
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
    kind: 'droid',
    finalChoice: { id: 'navigator', finalizedAt: '2026-10-17T20:00:00Z' },
    characterSheets: []
  };
  const props = {
    media: [{ _id: 'sheet', kind: 'image', originalName: 'AL-GPT-sheet.png' }],
    onSaved: vi.fn(),
    onMedia: vi.fn(),
    onBack: vi.fn()
  };
  const view = mount(<AssetEditor asset={al} {...props} />);
  expect(screen.queryByRole('button', { name: 'Approve character sheet' })).not.toBeInTheDocument();
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
      <AssetEditor asset={latest} {...props} />
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
    kind: 'droid',
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
      asset={current}
      media={[{ _id: 'new-image', kind: 'image', originalName: 'AL-pending.png' }]}
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
  expect(JSON.parse(localStorage.getItem('roxy-studio-asset-al')).notes).toBe('My unsaved notes.');
  expect(JSON.parse(localStorage.getItem('roxy-studio-asset-al')).revision).toBe(old.revision);
});

test('new saved options do not overwrite a local draft and offer recovery', () => {
  localStorage.setItem(
    'roxy-studio-asset-voice',
    JSON.stringify({ ...base, notes: 'Keep my draft notes.' })
  );
  mount(
    <AssetEditor
      asset={{ ...base, revision: 5 }}
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
    kind: 'droid',
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
      asset={al}
      media={[{ _id: 'image', kind: 'image', originalName: 'AL.png' }]}
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
          kind: 'wardrobe',
          scope: 'episode',
          episodeId: 'episode-1',
          candidates: []
        },
        { ...base, _id: 'comparison', name: 'Old comparison', archived: true }
      ]}
      episodes={episodes}
      media={[]}
      onSaved={vi.fn()}
      onMedia={vi.fn()}
    />
  );
  expect(screen.getByRole('button', { name: 'Review Roxy voice' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Review Old comparison' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Reusable', exact: true }));
  expect(screen.queryByRole('button', { name: 'Review Episode outfit' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Episode only', exact: true }));
  expect(screen.getByRole('button', { name: 'Review Episode outfit' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Review Roxy voice' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Archive', exact: true }));
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
      asset={{ ...base, finalChoice: base.candidates[0] }}
      media={[{ _id: 'audio', kind: 'audio', originalName: 'Roxy-eleven-v3.mp3' }]}
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
    kind: 'character',
    scope: 'episode',
    episodeId: 'episode-1'
  };
  vi.mocked(request).mockResolvedValue({ asset: next });
  mount(
    <AssetLibrary assets={[]} episodes={episodes} media={[]} onSaved={onSaved} onMedia={vi.fn()} />
  );
  await user.click(screen.getByRole('button', { name: 'Episode only', exact: true }));
  await user.click(screen.getByRole('button', { name: 'New asset', exact: true }));
  await user.type(screen.getByRole('textbox', { name: 'Asset name' }), 'Custom outfit');
  expect(screen.getByRole('button', { name: 'Create asset' })).toBeDisabled();
  await user.click(screen.getByRole('combobox', { name: 'Episode' }));
  await user.click(screen.getByRole('option', { name: 'Episode 01' }));
  await user.click(screen.getByRole('button', { name: 'Create asset' }));
  expect(request).toHaveBeenCalledWith('/studio/assets', {
    method: 'POST',
    body: { name: 'Custom outfit', kind: 'character', scope: 'episode', episodeId: 'episode-1' }
  });
  expect(onSaved).toHaveBeenCalledWith(next);
});

test('pending replacement preserves the approved voice and exposes comparison history', () => {
  mount(
    <AssetEditor
      asset={{ ...base, finalChoice: base.candidates[0], reviewStatus: 'pending-choice' }}
      assets={[
        {
          ...base,
          _id: 'old',
          name: 'Production comparison',
          archived: true,
          relatedAssetId: base._id
        }
      ]}
      media={[{ _id: 'audio', kind: 'audio', originalName: 'Roxy-eleven-v3.mp3' }]}
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
      asset={source}
      assets={[base, source]}
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
