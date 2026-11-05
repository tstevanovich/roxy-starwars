import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import type * as Studio from '../../shared/types.ts';
import { request, uploadMedia } from './api.ts';
import Episodes from './Episodes.tsx';
import { assetFixture, episodeFixture, mediaFixture, settingsFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';

vi.mock('./api.ts', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));

describe('component behavior', () => {
  const episode = episodeFixture({
    _id: 'episode-1',
    title: 'Episode 01 · The Passenger Pays Double',
    synopsis: 'Roxy takes Tavin from Corellia to Ord Mantell. His con puts the Fortune at risk.',
    premise: `DRAFT OUTLINE ROUND 02\n\n${'Detailed shot and story directions. '.repeat(120)}`,
    notes: 'Preserve the cockpit and weapon continuity.',
    scenes: [],
    revision: 7
  });

  const settings = { targetSeconds: 600, vlogPercent: 33 };

  function mount(
    record: Parameters<typeof episodeFixture>[0] = episode,
    onSaved = vi.fn(),
    media = [],
    onRejected = vi.fn(),
    configuration: Parameters<typeof settingsFixture>[0] = settings
  ) {
    return render(
      <ThemeProvider theme={theme}>
        <Episodes
          episodes={[record].map((value) => episodeFixture(value))}
          assets={[]}
          media={media}
          settings={settingsFixture(configuration)}
          onSaved={onSaved}
          onMedia={vi.fn()}
          onRejected={onRejected}
        />
      </ThemeProvider>
    );
  }

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(request).mockReset();
    vi.stubGlobal('scrollTo', vi.fn());
  });

  test.each(['cached', 'new'])(
    'saved episode reviews work with %s unsaved edits without overwriting the editor',
    async (mode) => {
      const user = userEvent.setup();
      const record = {
        ...episode,
        production: { sourceNotes: 'Saved verified source research.' },
        sourceReferences: [],
        decisions: []
      };
      const key = 'roxy-studio-episode-' + record._id;
      if (mode === 'cached')
        localStorage.setItem(
          key,
          JSON.stringify({ ...record, notes: 'Retain local episode changes.' })
        );
      const row = {
        key: 'source-row',
        target: { scope: 'episode' as const, recordId: record._id },
        stage: 'source',
        title: 'Source research',
        status: 'pending-review' as const,
        canApprove: true,
        blockers: [],
        prerequisites: [],
        feedback: '',
        fingerprint: 'saved-source',
        parentRevision: 7,
        reviewRevision: 0
      };
      let approved = false;
      vi.mocked(request).mockImplementation(async (path) => {
        if (path === '/studio/workflow/review') {
          approved = true;
          return { review: { state: 'approved' } };
        }
        return {
          enabled: true,
          record,
          proposals: [],
          groups: [
            {
              title: 'Episode preparation',
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
      });
      mount(record, vi.fn(), [], vi.fn(), { ...settings, workflowVersion: 1 });
      await user.click(screen.getByRole('button', { name: 'Open episode' }));
      if (mode === 'new') {
        const notes = screen.getByRole('textbox', { name: 'Episode continuity notes' });
        await user.clear(notes);
        await user.click(notes);
        await user.paste('Retain local episode changes.');
      }
      const board = screen.getByRole('region', { name: 'Production approval board' });
      const approve = await within(board).findByRole('button', { name: 'Approve Source research' });
      expect(approve).toBeEnabled();
      expect(within(board).getByText('Saved verified source research.')).toBeVisible();
      await user.click(approve);
      expect(request).toHaveBeenCalledWith('/studio/workflow/review', {
        method: 'POST',
        body: {
          target: row.target,
          stage: 'source',
          action: 'approve',
          fingerprint: 'saved-source',
          parentRevision: 7,
          reviewRevision: 0,
          feedback: ''
        }
      });
      await waitFor(() =>
        expect(
          within(board).getByRole('button', { name: 'Source research Approved' })
        ).toBeInTheDocument()
      );
      expect(screen.getByRole('textbox', { name: 'Episode continuity notes' })).toHaveValue(
        'Retain local episode changes.'
      );
      expect(JSON.parse(localStorage.getItem(key)).notes).toBe('Retain local episode changes.');
    }
  );

  test('scene editor shots have independent collapse buttons that preserve unsaved edits', async () => {
    const user = userEvent.setup();
    const { base } = staleEpisodeCase(false);
    const first = base.scenes[0].clips[0];
    const second = { ...first, id: 'reply', title: 'Harkun replies' };
    mount({
      ...base,
      scenes: [{ ...base.scenes[0], title: "Harkun's Welcome", clips: [first, second] }]
    });
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    const title = screen.getAllByRole('textbox', { name: 'Clip title' })[0];
    fireEvent.change(title, { target: { value: 'My revised shot' } });
    const [collapseFirst, collapseSecond] = screen.getAllByRole('button', {
      name: 'Collapse shot'
    });
    await user.click(collapseFirst);
    expect(title).not.toBeVisible();
    expect(screen.getByRole('heading', { name: 'My revised shot' })).toBeVisible();
    expect(collapseSecond).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Expand shot' }));
    expect(title).toBeVisible();
    expect(title).toHaveValue('My revised shot');
    expect(request).not.toHaveBeenCalled();
  });

  test('unsaved episode edits block dialogue rejection', async () => {
    const user = userEvent.setup();
    const { base } = staleEpisodeCase(false);
    const clip = {
      ...base.scenes[0].clips[0],
      dialogueTakeIds: ['al-dialogue'],
      selectedDialogueId: 'al-dialogue'
    };
    const record = { ...base, scenes: [{ ...base.scenes[0], clips: [clip] }] };
    const onRejected = vi.fn();
    const result = { deletedMediaId: 'al-dialogue' };
    vi.mocked(request).mockResolvedValue(result);
    mount(
      record,
      vi.fn(),
      [{ _id: 'al-dialogue', kind: 'audio' as const, originalName: 'Al-eleven-v3-dialogue.mp3' }],
      onRejected
    );
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    const review = screen.getByRole('region', {
      name: 'Dialogue takes for Al questions the berth'
    });
    expect(within(review).getByLabelText('Al-eleven-v3-dialogue.mp3')).toBeInTheDocument();
    expect(within(review).getByRole('button', { name: 'Selected dialogue' })).toBeDisabled();
    await user.click(screen.getByRole('textbox', { name: 'Episode continuity notes' }));
    await user.paste(' Keep this edit.');
    expect(within(review).getByRole('button', { name: 'Reject & delete' })).toBeDisabled();
    expect(request).not.toHaveBeenCalled();
  });

  test('native 1080p episodes offer native import and omit the upscale controls', async () => {
    const { base } = staleEpisodeCase(false);
    vi.mocked(request).mockImplementation(async (path) =>
      path.includes('/assistant/music?')
        ? {
            defaults: { prompt: 'Original music', bufferSeconds: 5 },
            targetSeconds: 8,
            jobs: [],
            cue: null
          }
        : { enabled: true, record: base, groups: [] }
    );
    mount(base, vi.fn(), [], vi.fn(), {
      ...settings,
      workflowVersion: 1,
      videoWorkflow: 'native-1080p'
    });
    await userEvent.click(screen.getByRole('button', { name: 'Open episode' }));
    expect(await screen.findByLabelText('Import native 1080p video')).toBeInTheDocument();
    expect(screen.queryByLabelText('Import 1440p video file')).not.toBeInTheDocument();
    expect(screen.queryByText('No upscale imported for this clip')).not.toBeInTheDocument();
  });

  test('dialogue rejection submits the owning episode revision and clip, then refreshes media', async () => {
    const user = userEvent.setup();
    const { base } = staleEpisodeCase(false);
    const clip = {
      ...base.scenes[0].clips[0],
      dialogueTakeIds: ['al-dialogue'],
      selectedDialogueId: 'al-dialogue'
    };
    const record = { ...base, scenes: [{ ...base.scenes[0], clips: [clip] }] };
    const onRejected = vi.fn();
    const result = { deletedMediaId: 'al-dialogue' };
    vi.mocked(request).mockResolvedValue(result);
    mount(
      record,
      vi.fn(),
      [{ _id: 'al-dialogue', kind: 'audio' as const, originalName: 'Al-eleven-v3-dialogue.mp3' }],
      onRejected
    );
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    const review = screen.getByRole('region', {
      name: 'Dialogue takes for Al questions the berth'
    });
    await user.click(within(review).getByRole('button', { name: 'Reject & delete' }));
    expect(request).toHaveBeenCalledWith('/studio/media/al-dialogue', {
      method: 'DELETE',
      body: { episodeId: 'episode-1', revision: 7, sceneId: 'scene', clipId: 'clip' }
    });
    expect(onRejected).toHaveBeenCalledWith(result);
  });

  function staleEpisodeCase(cache = true) {
    const clip = {
      id: 'clip',
      title: 'Al questions the berth',
      duration: 8,
      action: 'Al speaks.',
      dialogue: 'AL: A private berth.',
      camera: 'Static.',
      soundEffects: 'Ventilation.',
      takeIds: [],
      selectedTakeId: null
    };
    const base = {
      ...episode,
      scenes: [
        {
          id: 'scene',
          title: 'Easy credits',
          script: 'Approved script.',
          style: 'cinematic' as const,
          location: 'Cockpit',
          assetIds: [],
          approvalStatus: 'approved' as const,
          clips: [clip]
        }
      ]
    };
    const local = { ...base, notes: 'Keep my unsaved notes.' };
    const latest = {
      ...base,
      revision: 8,
      history: [base],
      scenes: [{ ...base.scenes[0], clips: [{ ...clip, takeIds: ['new-video'] }] }]
    };
    const media = [
      {
        _id: 'new-video',
        kind: 'video' as const,
        soundMix: { fingerprint: 'fixture-mix' },
        originalName: 'al-new-take.mp4'
      }
    ];
    if (cache) localStorage.setItem('roxy-studio-episode-episode-1', JSON.stringify(local));
    return { base, local, latest, media };
  }

  test('opening a cached episode merges new video takes, preserves notes and saves with the current revision', async () => {
    const user = userEvent.setup();
    const { local, latest, media } = staleEpisodeCase();
    vi.mocked(request).mockImplementation(async (_path, { body }) => ({
      episode: { ...(body as Partial<Studio.Episode>), revision: 9 }
    }));
    mount(latest, vi.fn(), media);
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    expect(screen.getByLabelText('al-new-take.mp4')).toHaveAttribute(
      'src',
      '/api/studio/media/new-video'
    );
    expect(screen.getByRole('textbox', { name: 'Episode continuity notes' })).toHaveValue(
      local.notes
    );
    expect(screen.getByRole('button', { name: 'Save episode' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save episode' }));
    expect(request).toHaveBeenLastCalledWith('/studio/episodes/episode-1', {
      method: 'PUT',
      body: expect.objectContaining({
        revision: 8,
        notes: local.notes,
        scenes: [
          expect.objectContaining({
            clips: [expect.objectContaining({ takeIds: ['new-video'], selectedTakeId: null })]
          })
        ]
      })
    });
    expect(await screen.findByRole('button', { name: 'Approve video take' })).toBeEnabled();
    expect(JSON.parse(localStorage.getItem('roxy-studio-episode-episode-1-recovery-7'))).toEqual(
      local
    );
  });

  test('overlapping episode edits require a choice while the imported video remains visible', async () => {
    const user = userEvent.setup();
    const { local, latest, media } = staleEpisodeCase();
    mount({ ...latest, notes: 'Different saved notes.' }, vi.fn(), media);
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    expect(screen.getByLabelText('al-new-take.mp4')).toBeInTheDocument();
    expect(screen.getByText('Conflicting fields: notes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save episode' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Keep my edits in conflicting fields' }));
    expect(screen.getByRole('textbox', { name: 'Episode continuity notes' })).toHaveValue(
      local.notes
    );
    expect(screen.getByRole('button', { name: 'Save episode' })).toBeEnabled();
    expect(screen.queryByText('Conflicting fields: notes')).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  test('saved videos can still be watched when an old draft cannot be merged safely', async () => {
    const user = userEvent.setup();
    const { local, latest, media } = staleEpisodeCase();
    mount({ ...latest, history: [] }, vi.fn(), media);
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    expect(
      within(screen.getByRole('region', { name: 'Pending video choices' })).getByLabelText(
        'al-new-take.mp4'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save episode' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Episode continuity notes' })).toHaveValue(
      local.notes
    );
  });

  test('a save conflict refreshes the episode and exposes new takes without retrying the write or losing edits', async () => {
    const user = userEvent.setup();
    const { base, local, latest, media } = staleEpisodeCase();
    const onSaved = vi.fn((next) =>
      view.rerender(
        <ThemeProvider theme={theme}>
          <Episodes
            episodes={[next]}
            assets={[]}
            media={media.map((value) => mediaFixture(value))}
            settings={settingsFixture(settings)}
            onSaved={onSaved}
            onMedia={vi.fn()}
          />
        </ThemeProvider>
      )
    );
    vi.mocked(request)
      .mockRejectedValueOnce(
        Object.assign(new Error('This record changed in another tab.'), { status: 409 })
      )
      .mockResolvedValueOnce({ episodes: [latest] });
    const view = mount(base, onSaved, media);
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    expect(screen.queryByLabelText('al-new-take.mp4')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save episode' }));
    expect(await screen.findByLabelText('al-new-take.mp4')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Episode continuity notes' })).toHaveValue(
      local.notes
    );
    expect(screen.getByRole('button', { name: 'Save episode' })).toBeEnabled();
    expect(onSaved).toHaveBeenCalledWith(latest);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('/studio');
  });

  test('overview shows a concise summary and truthful progress, then opens the complete existing editor', async () => {
    const user = userEvent.setup();
    mount();
    const card = screen.getByRole('article', { name: episode.title });
    expect(within(card).getByText(episode.synopsis)).toBeInTheDocument();
    expect(within(card).getByText('Outline draft')).toBeInTheDocument();
    expect(within(card).getByText('10:00')).toBeInTheDocument();
    expect(within(card).getByText('Scene planning has not started yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Detailed shot and story directions/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Premise and story outline' })
    ).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Open episode' }));
    expect(screen.getByRole('textbox', { name: 'Premise and story outline' })).toHaveValue(
      episode.premise
    );
    expect(screen.getByRole('textbox', { name: 'Episode continuity notes' })).toHaveValue(
      episode.notes
    );
    expect(screen.getByRole('heading', { name: 'Scene board' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All episodes' }));
    expect(screen.getByRole('article', { name: episode.title })).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  test('summary edits save separately from the full production outline', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const synopsis = 'A costly charter from Corellia to Ord Mantell.';
    vi.mocked(request).mockResolvedValue({ episode: { ...episode, synopsis, revision: 8 } });
    mount(episode, onSaved);
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    await user.clear(screen.getByRole('textbox', { name: 'Episode summary' }));
    await user.type(screen.getByRole('textbox', { name: 'Episode summary' }), synopsis);
    await user.click(screen.getByRole('button', { name: 'Save episode' }));
    expect(request).toHaveBeenCalledWith('/studio/episodes/episode-1', {
      method: 'PUT',
      body: { ...episode, synopsis }
    });
    expect(
      await screen.findByText('Episode saved. Changed scenes need renewed approval.')
    ).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith({ ...episode, synopsis, revision: 8 });
  });

  test('legacy outlines are bounded and progress reflects approvals and selected takes', () => {
    const scenes = [
      {
        id: 'scene-one',
        title: 'Departure',
        script: 'Roxy lifts off.',
        style: 'cinematic' as const,
        location: 'Corellia',
        assetIds: [],
        approvalStatus: 'approved' as const,
        clips: [{ id: 'clip-one', duration: 25, selectedTakeId: 'take-one' }]
      }
    ];
    mount({ ...episode, synopsis: '', scenes });
    const card = screen.getByRole('article', { name: episode.title });
    expect(within(card).getByText(/DRAFT OUTLINE ROUND 02/).textContent.length).toBeLessThan(285);
    expect(within(card).getByText('Ready for editing')).toBeInTheDocument();
    expect(within(card).getByText('0:25 of clips planned')).toBeInTheDocument();
    expect(within(card).getAllByText('1 / 1')).toHaveLength(2);
  });

  test('unselected takes are playable beside their clip and require an explicit selection', async () => {
    const user = userEvent.setup();
    const clip = {
      id: 'opening-clip',
      title: 'Corellia wide',
      duration: 6,
      action: 'The ship waits.',
      dialogue: '',
      camera: 'Slow lateral move.',
      soundEffects: 'Wind.',
      dialogueTakeIds: ['dialogue-one'],
      selectedDialogueId: 'dialogue-one',
      takeIds: ['take-one'],
      selectedTakeId: null
    };
    const record = {
      ...episode,
      scenes: [
        {
          id: 'opening',
          title: 'Corellia pickup',
          style: 'cinematic' as const,
          location: 'Corellia',
          script: 'A parked ship.',
          assetIds: [],
          approvalStatus: 'approved' as const,
          clips: [clip]
        }
      ]
    };
    const next = {
      ...record,
      revision: 8,
      scenes: [
        {
          ...record.scenes[0],
          clips: [
            {
              ...clip,
              selectedTakeId: 'take-one',
              upscale: {
                sourceTakeId: 'take-one',
                status: 'waiting-provider' as const,
                message: 'No upscale job has been submitted or charged.'
              }
            }
          ]
        }
      ]
    };
    vi.mocked(request).mockResolvedValue({ episode: next });
    mount(record, vi.fn(), [
      {
        _id: 'take-one',
        kind: 'video' as const,
        soundMix: { fingerprint: 'fixture-mix' },
        originalName: 'Corellia-take01.mp4'
      },
      { _id: 'dialogue-one', kind: 'audio' as const, originalName: 'Corellia-dialogue.mp3' }
    ]);
    expect(screen.getByText('Pending choice (1 video clip)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    expect(screen.getByRole('region', { name: 'Pending video choices' })).toBeInTheDocument();
    const videoReview = screen.getByRole('region', { name: 'Video takes for Corellia wide' });
    expect(
      within(videoReview).getByRole('heading', { name: 'Video takes to review' })
    ).toBeInTheDocument();
    const pendingReview = screen.getByRole('region', { name: 'Pending video choices' });
    const video = within(pendingReview).getByLabelText('Corellia-take01.mp4');
    expect(video).toHaveAttribute('src', '/api/studio/media/take-one');
    expect(video).toHaveAttribute('controls');
    expect(video).toAppearBefore(screen.getByRole('textbox', { name: 'Action and performance' }));
    expect(video).toAppearBefore(screen.getByLabelText('Corellia-dialogue.mp3'));
    expect(within(pendingReview).getByRole('button', { name: 'Approve video take' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Selected video take' })).toHaveTextContent(
      'No take selected'
    );
    await user.click(screen.getByRole('button', { name: 'Approve video take' }));
    expect(request).toHaveBeenLastCalledWith('/studio/episodes/episode-1', {
      method: 'PUT',
      body: expect.objectContaining({
        scenes: [
          expect.objectContaining({
            clips: [expect.objectContaining({ takeIds: ['take-one'], selectedTakeId: 'take-one' })]
          })
        ]
      })
    });
    expect(
      screen.queryByText('2K upscale waiting for provider connection.')
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Pending video choices' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Selected for edit' })).toBeDisabled();
    expect(screen.getByText('Script approved')).toBeInTheDocument();
  });

  test('an approval failure keeps the video pending and unsaved drafts block immediate approval', async () => {
    const user = userEvent.setup();
    const clip = {
      id: 'clip',
      title: 'Opening',
      duration: 8,
      action: '',
      dialogue: '',
      camera: '',
      soundEffects: '',
      takeIds: ['video'],
      selectedTakeId: null
    };
    const record = {
      ...episode,
      scenes: [
        {
          id: 'scene',
          title: 'Opening scene',
          script: 'A ship.',
          style: 'cinematic' as const,
          location: 'Corellia',
          assetIds: [],
          approvalStatus: 'approved' as const,
          clips: [clip]
        }
      ]
    };
    const onSaved = vi.fn();
    vi.mocked(request).mockRejectedValue(new Error('This record changed in another tab.'));
    mount(record, onSaved, [
      {
        _id: 'video',
        kind: 'video' as const,
        soundMix: { fingerprint: 'fixture-mix' },
        originalName: 'opening.mp4'
      }
    ]);
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    await user.click(screen.getByRole('button', { name: 'Approve video take' }));
    expect(await screen.findByText('This record changed in another tab.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Pending video choices' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Selected video take' })).toHaveTextContent(
      'No take selected'
    );
    expect(onSaved).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole('textbox', { name: 'Episode continuity notes' }),
      ' Keep this draft.'
    );
    expect(screen.getByRole('button', { name: 'Approve video take' })).toBeDisabled();
    expect(JSON.parse(localStorage.getItem('roxy-studio-episode-episode-1')).notes).toContain(
      'Keep this draft.'
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('dialogue can be played, explicitly selected and reopened without changing the script', async () => {
    const user = userEvent.setup();
    const record = {
      ...episode,
      scenes: [
        {
          id: 'opening',
          title: 'Captain vlog',
          style: 'vlog' as const,
          location: 'Cockpit',
          script: 'Roxy introduces the charter.',
          assetIds: [],
          approvalStatus: 'approved' as const,
          clips: [
            {
              id: 'log',
              title: 'The charter',
              duration: 24,
              action: '',
              dialogue: 'ROXY: Easy credits.',
              camera: '',
              soundEffects: '',
              dialogueTakeIds: ['dialogue-one'],
              selectedDialogueId: null,
              takeIds: [],
              selectedTakeId: null
            }
          ]
        }
      ]
    };
    mount(record, vi.fn(), [
      { _id: 'dialogue-one', kind: 'audio' as const, originalName: 'roxy-dialogue.mp3' }
    ]);
    vi.mocked(request).mockImplementation(async (_path, { body }) => ({
      episode: { ...(body as Studio.Episode), revision: (body as Studio.Episode).revision + 1 }
    }));
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    expect(screen.getByLabelText('roxy-dialogue.mp3')).toHaveAttribute(
      'src',
      '/api/studio/media/dialogue-one'
    );
    expect(screen.getByRole('button', { name: 'Save episode' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Use this dialogue' }));
    await user.click(screen.getByRole('button', { name: 'Save episode' }));
    expect(request).toHaveBeenLastCalledWith('/studio/episodes/episode-1', {
      method: 'PUT',
      body: expect.objectContaining({
        scenes: [
          expect.objectContaining({
            script: record.scenes[0].script,
            clips: [
              expect.objectContaining({ selectedDialogueId: 'dialogue-one', selectedTakeId: null })
            ]
          })
        ]
      })
    });
    await user.click(screen.getByRole('button', { name: 'Clear dialogue selection' }));
    expect(screen.getByRole('button', { name: 'Use this dialogue' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save episode' }));
    expect(request).toHaveBeenLastCalledWith('/studio/episodes/episode-1', {
      method: 'PUT',
      body: expect.objectContaining({
        scenes: [
          expect.objectContaining({
            clips: [
              expect.objectContaining({
                dialogueTakeIds: ['dialogue-one'],
                selectedDialogueId: null
              })
            ]
          })
        ]
      })
    });
  });

  test('episode summary shows pending production reviews before any scenes exist', () => {
    mount({ ...episode, workflowReviewCount: 1 });
    expect(screen.getByText('Pending choice (1 production review)')).toBeVisible();
  });

  test('original video has picture approval and rejection together beside its top player', async () => {
    const user = userEvent.setup(),
      { base } = staleEpisodeCase(false),
      onSaved = vi.fn();
    const row = {
      target: { scope: 'clip' as const, recordId: base._id, sceneId: 'scene', clipId: 'clip' },
      stage: 'visual',
      fingerprint: 'picture-fingerprint',
      parentRevision: 7,
      reviewRevision: 0
    };
    const clip = {
      ...base.scenes[0].clips[0],
      takeIds: ['picture'],
      production: { visualTakeId: null },
      pictureApprovalStatus: 'draft' as const,
      pictureReview: row
    };
    const record = {
      ...base,
      workflowVersion: 1,
      scenes: [{ ...base.scenes[0], pictureReviewBlockers: [], clips: [clip] }]
    };
    const next = {
      ...record,
      revision: 8,
      scenes: [
        {
          ...record.scenes[0],
          clips: [
            {
              ...clip,
              production: { visualTakeId: 'picture' },
              pictureApprovalStatus: 'approved' as const
            }
          ]
        }
      ]
    };
    vi.mocked(request).mockImplementation(async (path) =>
      path === '/studio'
        ? { episodes: [next] }
        : path.endsWith('/board')
          ? { enabled: true, groups: [], nextSteps: [] }
          : { review: { state: 'approved' } }
    );
    mount(
      record,
      onSaved,
      [{ _id: 'picture', kind: 'video' as const, originalName: 'orbital-redo.mp4' }],
      vi.fn(),
      { ...settings, workflowVersion: 1 }
    );
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    const pending = screen.getByRole('region', { name: 'Pending video choices' });
    expect(within(pending).getByRole('button', { name: 'Reject & delete' })).toBeEnabled();
    await user.click(
      within(pending).getByRole('button', { name: 'Approve picture & performance' })
    );
    expect(request).toHaveBeenCalledWith('/studio/workflow/review', {
      method: 'POST',
      body: {
        target: row.target,
        stage: 'visual',
        action: 'approve',
        takeId: 'picture',
        fingerprint: 'picture-fingerprint',
        parentRevision: 7,
        reviewRevision: 0
      }
    });
    expect(onSaved).toHaveBeenCalledWith(next);
    expect(
      await screen.findByRole('button', { name: 'Picture & performance approved' })
    ).toBeDisabled();
    expect(next.scenes[0].clips[0].selectedTakeId).toBeNull();
  });

  test('clip readiness permits picture review even when sibling shots block whole-scene reviews', async () => {
    const user = userEvent.setup(),
      { base } = staleEpisodeCase(false);
    const record = {
      ...base,
      workflowVersion: 1,
      scenes: [
        {
          ...base.scenes[0],
          pictureReviewBlockers: ['Storyboard continuity', 'Timed animatic'],
          clips: [{ ...base.scenes[0].clips[0], takeIds: ['picture'], pictureReviewBlockers: [] }]
        }
      ]
    };
    vi.mocked(request).mockResolvedValue({ enabled: true, groups: [], nextSteps: [] });
    mount(
      record,
      vi.fn(),
      [{ _id: 'picture', kind: 'video' as const, originalName: 'review.mp4' }],
      vi.fn(),
      {
        ...settings,
        workflowVersion: 1
      }
    );
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    const pending = screen.getByRole('region', { name: 'Pending video choices' });
    expect(
      within(pending).getByRole('button', { name: 'Approve picture & performance' })
    ).toBeEnabled();
    expect(within(pending).queryByText(/Complete these reviews/)).not.toBeInTheDocument();
  });

  test('blocked picture approval remains visible and identifies the scene reviews needed', async () => {
    const user = userEvent.setup(),
      { base } = staleEpisodeCase(false),
      record = {
        ...base,
        workflowVersion: 1,
        scenes: [
          {
            ...base.scenes[0],
            pictureReviewBlockers: ['Shot plan', 'Timed animatic'],
            clips: [{ ...base.scenes[0].clips[0], takeIds: ['picture'] }]
          }
        ]
      };
    vi.mocked(request).mockResolvedValue({ enabled: true, groups: [], nextSteps: [] });
    mount(
      record,
      vi.fn(),
      [{ _id: 'picture', kind: 'video' as const, originalName: 'orbital-redo.mp4' }],
      vi.fn(),
      { ...settings, workflowVersion: 1 }
    );
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    const pending = screen.getByRole('region', { name: 'Pending video choices' });
    expect(
      within(pending).getByRole('button', { name: 'Approve picture & performance' })
    ).toBeDisabled();
    expect(
      within(pending).getByText(/Complete these reviews for this clip.*Shot plan, Timed animatic/)
    ).toBeVisible();
    expect(
      within(pending).getByRole('link', { name: "Review this clip's prerequisites" })
    ).toHaveAttribute('href', `#picture-prerequisites-${base.scenes[0].clips[0].id}`);
    expect(within(pending).getByRole('button', { name: 'Reject & delete' })).toBeEnabled();
  });

  test('native video approval clearly accepts picture and sound in one request', async () => {
    const user = userEvent.setup(),
      { base } = staleEpisodeCase(false),
      onSaved = vi.fn();
    const row = {
      target: { scope: 'clip' as const, recordId: base._id, sceneId: 'scene', clipId: 'clip' },
      stage: 'visual',
      fingerprint: 'picture-fingerprint',
      parentRevision: 7,
      reviewRevision: 0
    };
    const clip = {
      ...base.scenes[0].clips[0],
      takeIds: ['picture'],
      production: { visualTakeId: null },
      pictureApprovalStatus: 'draft' as const,
      pictureReview: row
    };
    const record = {
      ...base,
      workflowVersion: 1,
      scenes: [{ ...base.scenes[0], pictureReviewBlockers: [], clips: [clip] }]
    };
    const next = {
      ...record,
      revision: 8,
      scenes: [
        {
          ...record.scenes[0],
          clips: [
            {
              ...clip,
              selectedTakeId: 'picture',
              production: { visualTakeId: 'picture' },
              pictureApprovalStatus: 'approved' as const
            }
          ]
        }
      ]
    };
    vi.mocked(request).mockImplementation(async (path) =>
      path === '/studio'
        ? { episodes: [next] }
        : path.endsWith('/board')
          ? { enabled: true, groups: [], nextSteps: [] }
          : { review: { state: 'approved' } }
    );
    mount(
      record,
      onSaved,
      [
        {
          _id: 'picture',
          kind: 'video' as const,
          nativeAudio: { policy: 'wan-native-effects-v1' },
          originalName: 'native-sound.mp4'
        }
      ],
      vi.fn(),
      { ...settings, workflowVersion: 1 }
    );
    await user.click(screen.getByRole('button', { name: 'Open episode' }));
    const pending = screen.getByRole('region', { name: 'Pending video choices' });
    expect(within(pending).getByRole('button', { name: 'Reject & delete' })).toBeEnabled();
    await user.click(
      within(pending).getByRole('button', { name: 'Approve picture, performance & sound' })
    );
    expect(request).toHaveBeenCalledWith('/studio/workflow/review', {
      method: 'POST',
      body: {
        target: row.target,
        stage: 'visual',
        action: 'approve',
        takeId: 'picture',
        fingerprint: 'picture-fingerprint',
        parentRevision: 7,
        reviewRevision: 0
      }
    });
    expect(onSaved).toHaveBeenCalledWith(next);
    expect(await screen.findByRole('button', { name: 'Picture & sound approved' })).toBeDisabled();
    expect(next.scenes[0].clips[0].selectedTakeId).toBe('picture');
  });
});

describe('episode editing and recovery', () => {
  let Episodes: (typeof import('./Episodes.tsx'))['default'];
  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('./ProductionBoard.tsx', () => ({
      EnableWorkflow: () => null,
      default: () => <section id="board-scene-main" aria-label="Production board" />
    }));
    vi.doMock('./SoundDesign.tsx', () => ({
      default: (props) => (
        <>
          <button
            onClick={() =>
              props.onEdit({ notes: 'Revised sound plan.', dialogueGainDb: 0, layers: [] })
            }
          >
            Edit shared sound
          </button>
          <button onClick={() => props.onSaved(episodeFixture({ ...props.episode, revision: 9 }))}>
            Refresh saved sound
          </button>
        </>
      )
    }));
    ({ default: Episodes } = await import('./Episodes.tsx'));
  });
  afterAll(() => {
    vi.doUnmock('./ProductionBoard.tsx');
    vi.doUnmock('./SoundDesign.tsx');
    vi.resetModules();
  });
  function record() {
    return episodeFixture({
      _id: 'episode',
      revision: 2,
      title: 'Episode',
      synopsis: 'Summary',
      premise: 'Outline',
      notes: '',
      sourceReferences: [
        {
          id: 'source',
          title: 'Gameplay',
          chapter: '',
          url: 'https://example.test/source',
          startSeconds: 0,
          endSeconds: null,
          status: 'unreviewed'
        }
      ],
      scenes: [
        {
          id: 'main',
          title: 'Welcome',
          script: 'HARKUN: Begin.',
          style: 'cinematic',
          approvalStatus: 'draft',
          clips: [
            {
              id: 'one',
              title: 'Opening',
              duration: 6,
              takeIds: ['video'],
              selectedTakeId: 'video',
              soundLegacyTakeId: 'video'
            },
            { id: 'two', title: 'Reply', duration: 5 }
          ]
        },
        { id: 'other', title: 'Other scene', clips: [] }
      ]
    });
  }

  const media = [mediaFixture({ _id: 'video', kind: 'video', originalName: 'Video.mp4' })];

  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/');
    vi.stubGlobal('scrollTo', vi.fn());
    vi.mocked(request).mockReset();
    vi.mocked(uploadMedia).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function mount(initial = record(), props = {}) {
    return render(
      <Episodes
        initialId="episode"
        episodes={[initial]}
        assets={[assetFixture({ _id: 'character', name: 'Harkun' })]}
        media={media}
        settings={settingsFixture()}
        onSaved={vi.fn()}
        onMedia={vi.fn()}
        {...props}
      />
    );
  }

  function choose(label: string, option: string) {
    fireEvent.mouseDown(screen.getAllByRole('combobox', { name: label })[0]);
    fireEvent.click(within(screen.getByRole('listbox')).getByText(option));
  }

  test('scene and shot field edits save the exact edited scene without losing sibling shots', async () => {
    vi.mocked(request).mockImplementation(async (_path, options) => ({
      episode: { ...(options.body as object), revision: 3 }
    }));
    const onChat = vi.fn();
    mount(record(), { onChat });
    fireEvent.click(screen.getByRole('button', { name: 'Discuss in chat' }));
    expect(onChat).toHaveBeenCalledWith({ episodeId: 'episode' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Discuss this clip' })[0]);
    expect(onChat).toHaveBeenCalledWith({ episodeId: 'episode', sceneId: 'main', clipId: 'one' });
    for (const [label, value] of [
      ['Episode title', 'Revised episode'],
      ['Premise and story outline', 'New outline'],
      ['Scene title', 'Trial room'],
      ['Location', 'Academy'],
      ['Scene script', 'HARKUN: Begin.'],
      ['Scene source notes and adaptation choices', 'Preserve source order.'],
      ['Clip title', 'First line'],
      ['Duration in seconds', '7'],
      ['Action and performance', 'Arms crossed.'],
      ['Exact dialogue with speaker names', 'HARKUN: Begin.'],
      ['Camera and light', 'Locked camera.'],
      ['Sound effects and ambience', 'Quiet ventilation.']
    ])
      fireEvent.change(screen.getAllByLabelText(label)[0], { target: { value } });
    choose('Presentation', 'Vlog to audience');
    choose('Characters, sets, wardrobe, and props', 'Harkun · in development');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    choose('Source footage for this scene', 'Gameplay - unreviewed');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit shared sound' })[0]);
    choose('Selected video take', 'No take selected');
    fireEvent.click(screen.getByRole('button', { name: 'Save episode' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/studio/episodes/episode',
        expect.objectContaining({
          method: 'PUT',
          body: expect.objectContaining({
            title: 'Revised episode',
            premise: 'New outline',
            scenes: [
              expect.objectContaining({
                title: 'Trial room',
                location: 'Academy',
                style: 'vlog',
                assetIds: ['character'],
                sourceReferenceIds: ['source'],
                soundPlan: expect.objectContaining({ notes: 'Revised sound plan.' }),
                clips: [
                  expect.objectContaining({
                    title: 'First line',
                    duration: 7,
                    action: 'Arms crossed.',
                    dialogue: 'HARKUN: Begin.',
                    camera: 'Locked camera.',
                    soundEffects: 'Quiet ventilation.',
                    selectedTakeId: null
                  }),
                  expect.objectContaining({ id: 'two' })
                ]
              }),
              expect.objectContaining({ id: 'other' })
            ]
          })
        })
      )
    );
  }, 20000);

  test('clip and scene reorder controls retain stable IDs and explicit removals affect only their draft entries', () => {
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Move earlier' })[1]);
    let draft = JSON.parse(localStorage.getItem('roxy-studio-episode-episode'));
    expect(draft.scenes[0].clips.map((clip) => clip.id)).toEqual(['two', 'one']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove clip from draft' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Move scene earlier' })[1]);
    draft = JSON.parse(localStorage.getItem('roxy-studio-episode-episode'));
    expect(draft.scenes.map((scene) => scene.id)).toEqual(['other', 'main']);
    expect(draft.scenes[1].clips.map((clip) => clip.id)).toEqual(['one']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove scene from draft' })[0]);
    draft = JSON.parse(localStorage.getItem('roxy-studio-episode-episode'));
    expect(draft.scenes.map((scene) => scene.id)).toEqual(['main']);
  });

  test('generator preview loads saved prompts and script approval stays separate from video generation', async () => {
    const initial = record();
    vi.mocked(request).mockImplementation(async (path) =>
      path === '/studio/prompts'
        ? {
            prompts: [
              {
                sceneId: 'main',
                clipId: 'one',
                image: 'Image directions.',
                video: 'Motion directions.',
                videoWithinLimit: true
              }
            ]
          }
        : { episode: { ...initial, revision: 3 } }
    );
    mount(initial);
    fireEvent.click(screen.getByRole('button', { name: 'Preview generator prompts' }));
    expect(await screen.findByLabelText(/2K image prompt/)).toHaveValue('Image directions.');
    expect(screen.getByLabelText('Wan 3.0 · 16:9 video prompt')).toHaveValue('Motion directions.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve script' })[0]);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/studio/episodes/episode/scenes/main/approve',
        expect.objectContaining({ method: 'POST', body: { revision: 2 } })
      )
    );
  });

  test('scene jump waits for the menu to close and supports choosing the current scene and episode top again', async () => {
    vi.useFakeTimers();
    mount();
    for (const [label, hash] of [
      ['01 \u00b7 Welcome', '#scene-edit-main'],
      ['01 \u00b7 Welcome', '#scene-edit-main'],
      ['Top of episode', '#episode-top'],
      ['Top of episode', '#episode-top']
    ]) {
      choose('Jump to scene', label);
      // Complete menu exit and the subsequent animation frame before reopening it.
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(location.hash).toBe(hash);
    }
  });

  test('episode planning and source edits save their current values independently from prompt previews', async () => {
    vi.mocked(request).mockImplementation(async (_path, options) => ({
      episode: { ...(options.body as object), revision: 3 }
    }));
    mount(record(), { settings: settingsFixture({ workflowVersion: 1 }) });
    fireEvent.change(screen.getByLabelText('Source research / original story direction'), {
      target: { value: 'Verified source research.' }
    });
    fireEvent.change(screen.getByLabelText('Episode outline for approval'), {
      target: { value: 'Revised outline.' }
    });
    fireEvent.change(screen.getByLabelText('Source review notes'), {
      target: { value: 'Observed dialogue order.' }
    });
    fireEvent.change(screen.getAllByLabelText('Framing')[0], {
      target: { value: 'Locked medium shot.' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save episode' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/studio/episodes/episode',
        expect.objectContaining({
          body: expect.objectContaining({
            production: {
              sourceNotes: 'Verified source research.',
              outline: 'Revised outline.',
              outlineNeedsRevision: false
            },
            sourceReferences: [expect.objectContaining({ notes: 'Observed dialogue order.' })],
            scenes: [
              expect.objectContaining({
                clips: [
                  expect.objectContaining({
                    production: expect.objectContaining({ framing: 'Locked medium shot.' })
                  }),
                  expect.anything()
                ]
              }),
              expect.anything()
            ]
          })
        })
      )
    );
  });

  test('uploading dialogue validates its kind, saves the clean stem and preserves the selected video', async () => {
    const initial = record();
    initial.scenes[0].clips[0].dialogue = 'HARKUN: Begin.';
    const audio = mediaFixture({ _id: 'audio', kind: 'audio', originalName: 'Clean.wav' });
    mount(initial, { media: [...media, audio] });
    const input = screen.getByLabelText('Import synchronized dialogue-only stem');
    vi.mocked(uploadMedia).mockResolvedValueOnce(mediaFixture({ _id: 'image', kind: 'image' }));
    fireEvent.change(input, { target: { files: [new File(['image'], 'image.png')] } });
    await screen.findByText('Choose an audio file for the dialogue-only stem.');
    vi.mocked(uploadMedia).mockResolvedValueOnce(audio);
    fireEvent.change(input, { target: { files: [new File(['audio'], 'clean.wav')] } });
    await screen.findByLabelText('Clean.wav');
    const local = JSON.parse(localStorage.getItem('roxy-studio-episode-episode'));
    expect(local.scenes[0].clips[0]).toMatchObject({
      selectedTakeId: 'video',
      production: { cleanDialogueMediaId: 'audio' }
    });
  });

  test('native video imports refresh the saved episode and retain its parent callbacks', async () => {
    const second = mediaFixture({ _id: 'second', kind: 'video', originalName: 'Second.mp4' });
    const initial = record(),
      onSaved = vi.fn(),
      onReload = vi.fn();
    vi.mocked(request).mockResolvedValue({ episode: { ...initial, revision: 3 } });
    vi.mocked(uploadMedia).mockResolvedValueOnce(second);
    mount(initial, {
      settings: settingsFixture({ videoWorkflow: 'native-1080p' }),
      onSaved,
      onReload
    });
    fireEvent.change(screen.getAllByLabelText('Import native 1080p video')[0], {
      target: { files: [new File(['video'], 'second.mp4')] }
    });
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }))
    );
    expect(onReload).toHaveBeenCalledOnce();
  });

  test('a selected legacy video remains visible even when it is absent from the take list', () => {
    const initial = record();
    initial.scenes[0].clips[0].takeIds = undefined;
    mount(initial);
    expect(screen.getByLabelText('Video.mp4')).toBeVisible();
  });

  test.each([
    {
      workflow: false,
      native: false,
      message: '1080p video take approved and saved.'
    },
    {
      workflow: false,
      native: true,
      message: '1080p video take approved and saved.'
    },
    {
      workflow: true,
      native: false,
      message: 'Finished 1080p sound mix approved and saved.'
    },
    {
      workflow: true,
      native: true,
      message: 'Finished 1080p sound mix approved and saved.'
    }
  ])(
    'finished video selection preserves sibling scenes for workflow=$workflow native=$native',
    async ({ workflow, native, message }) => {
      const initial = record();
      initial.scenes[0].clips[0].selectedTakeId = null;
      vi.mocked(request).mockImplementation(async (_path, options) => ({
        episode: { ...(options.body as object), revision: 3 }
      }));
      mount(initial, {
        settings: settingsFixture({
          workflowVersion: workflow ? 1 : undefined,
          videoWorkflow: native ? 'native-1080p' : undefined
        }),
        media: [mediaFixture({ ...media[0], soundMix: { fingerprint: 'mixed' } })]
      });
      fireEvent.click(screen.getAllByRole('button', { name: 'Approve video take' })[0]);
      await screen.findByText(message);
      expect(vi.mocked(request).mock.calls[0][1].body).toMatchObject({
        scenes: [
          expect.objectContaining({
            clips: [
              expect.objectContaining({ selectedTakeId: 'video' }),
              expect.objectContaining({ id: 'two' })
            ]
          }),
          expect.objectContaining({ id: 'other' })
        ]
      });
    }
  );

  test.each([false, true])(
    'native picture review retrieves a missing row from the saved board; audio repair=%s',
    async (repair) => {
      const initial = record();
      initial.scenes[0].clips[0].selectedTakeId = null;
      const target = { scope: 'clip', recordId: 'episode', sceneId: 'main', clipId: 'one' };
      vi.mocked(request).mockImplementation(async (path) =>
        path.endsWith('/board')
          ? {
              groups: [
                { target: { scope: 'scene' }, stages: [] },
                { target: { ...target, sceneId: 'other' }, stages: [] },
                { target: { ...target, clipId: 'other' }, stages: [] },
                {
                  target,
                  stages: [{ stage: 'other' }, { stage: 'visual', target, fingerprint: 'picture' }]
                }
              ]
            }
          : path === '/studio'
            ? { episodes: [] }
            : {}
      );
      mount(initial, {
        settings: settingsFixture({ workflowVersion: 1, videoWorkflow: 'native-1080p' }),
        media: [mediaFixture({ ...media[0], nativeAudio: { policy: 'wan-native-effects-v1' } })]
      });
      fireEvent.click(
        screen.getAllByRole('button', {
          name: repair ? 'Accept picture; repair sound' : 'Approve picture, performance & sound'
        })[0]
      );
      await screen.findByText(
        repair
          ? 'Picture accepted for sound repair. No finished take has been approved.'
          : 'Native 1080p picture, performance and sound approved. Ready to download.'
      );
      expect(request).toHaveBeenCalledWith(
        '/studio/workflow/review',
        expect.objectContaining({
          body: expect.objectContaining({
            action: 'approve',
            stage: 'visual',
            takeId: 'video',
            ...(repair ? { audioRepair: true } : {})
          })
        })
      );
    }
  );

  test('missing picture reviews report a useful error without approving or submitting a render', async () => {
    const initial = record();
    initial.scenes[0].clips[0].selectedTakeId = null;
    vi.mocked(request).mockResolvedValue({ groups: [] });
    mount(initial, {
      settings: settingsFixture({ workflowVersion: 1 }),
      media: [mediaFixture({ ...media[0], nativeAudio: { policy: 'wan-native-effects-v1' } })]
    });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Approve picture, performance & sound' })[0]
    );
    await screen.findByText('Picture review is unavailable. Refresh the episode.');
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('new episode dialogs retain failed input and support cancel and escape', async () => {
    mount(record(), { episodes: [], initialId: '' });
    fireEvent.click(screen.getByRole('button', { name: 'Create the first episode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Create the first episode' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Create the first episode' }));
    fireEvent.change(screen.getByLabelText('Episode title'), { target: { value: 'New episode' } });
    vi.mocked(request).mockRejectedValueOnce(new Error('Creation unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Create episode' }));
    await screen.findByText('Creation unavailable');
    expect(screen.getByLabelText('Episode title')).toHaveValue('New episode');
  });

  test('saved sound receipts update the episode and image choices are shown only on their owning shot', async () => {
    const onSaved = vi.fn();
    const shotAsset = assetFixture({
      _id: 'image',
      name: 'Opening image',
      episodeId: 'episode',
      sceneId: 'main',
      clipId: 'one',
      candidates: [{ id: 'choice', title: 'Current composition', mediaIds: ['picture'] }],
      finalChoice: { id: 'choice', mediaIds: ['picture'] }
    });
    mount(record(), {
      onSaved,
      assets: [
        shotAsset,
        { ...shotAsset, _id: 'wrong-scene', sceneId: 'elsewhere' },
        { ...shotAsset, _id: 'wrong-shot', clipId: 'elsewhere' },
        { ...shotAsset, _id: 'other-episode', scope: 'episode', episodeId: 'elsewhere' }
      ],
      media: [...media, mediaFixture({ _id: 'picture' })]
    });
    expect(screen.getAllByText('Current composition')).toHaveLength(1);
    fireEvent.click(screen.getAllByText('Refresh saved sound')[0]);
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ revision: 9 }))
    );
  });

  test.each([false, true])(
    'pending video navigation focuses its shot and respects reduced motion=%s',
    (reduced) => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: reduced }))
      );
      HTMLElement.prototype.scrollIntoView = vi.fn();
      const initial = record();
      initial.scenes[0].clips[0].selectedTakeId = null;
      mount(initial);
      fireEvent.click(screen.getByRole('button', { name: /Review video: Opening/ }));
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
        behavior: reduced ? 'instant' : 'smooth',
        block: 'start'
      });
    }
  );

  test('conflicting cached edits can explicitly use the saved values without triggering a write', () => {
    const initial = record();
    localStorage.setItem(
      'roxy-studio-episode-episode',
      JSON.stringify({ ...initial, notes: 'Local notes' })
    );
    mount({ ...initial, revision: 3, notes: 'Saved notes', history: [initial] });
    fireEvent.click(screen.getByRole('button', { name: 'Use saved values in conflicting fields' }));
    expect(screen.getByLabelText('Episode continuity notes')).toHaveValue('Saved notes');
    expect(request).not.toHaveBeenCalled();
  });

  test('episode save failures allow exporting both the failed and the working draft', async () => {
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:draft'), revokeObjectURL: vi.fn() })
    );
    vi.mocked(request).mockRejectedValueOnce(new Error('Save offline'));
    mount();
    fireEvent.change(screen.getByLabelText('Episode title'), { target: { value: 'Revised' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save episode' }));
    await screen.findByText('Save offline');
    fireEvent.click(screen.getByRole('button', { name: 'Export draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export working draft' }));
    expect(download).toHaveBeenCalledTimes(2);
  });

  test('a stale episode response that omits the current episode keeps its draft and original error', async () => {
    vi.mocked(request).mockImplementation(async (path) => {
      if (path === '/studio') return { episodes: [] };
      throw Object.assign(new Error('Episode conflict'), { status: 409 });
    });
    mount();
    fireEvent.change(screen.getByLabelText('Episode title'), { target: { value: 'Local title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save episode' }));
    expect(await screen.findByText('Episode conflict')).toBeVisible();
    expect(screen.getByLabelText('Episode title')).toHaveValue('Local title');
  });

  test('workflow scene jumps use the board heading and closing the menu without choosing does not jump', async () => {
    const initial = record();
    initial.scenes[0].title = '';
    initial.workflowReviewCount = 2;
    initial.videoPass = { policy: 'wan-native-effects-v1' };
    mount(initial, { settings: settingsFixture({ workflowVersion: 1 }) });
    expect(
      screen.getByRole('link', { name: 'Production reviews waiting for you (2)' })
    ).toBeVisible();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Jump to scene' }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(scrollTo).not.toHaveBeenCalled();
  });

  test('workflow jumps align to the production-board scene heading', async () => {
    const initial = record();
    initial.scenes[0].title = '';
    mount(initial, { settings: settingsFixture({ workflowVersion: 1 }) });
    choose('Jump to scene', '01 \u00b7 Untitled scene');
    await waitFor(() => expect(location.hash).toBe('#board-scene-main'));
  });

  test('overview statuses distinguish multiple reviews, pending clips, review needs and a new empty story', () => {
    const review = record();
    review.scenes[0].approvalStatus = 'needs-review';
    review.scenes[0].clips[0].takeIds = [];
    review.scenes[0].clips[0].selectedTakeId = null;
    const pending = record();
    pending.scenes[0].clips = pending.scenes[0].clips.map((clip) => ({
      ...clip,
      takeIds: ['video'],
      selectedTakeId: null
    }));
    mount(record(), {
      initialId: '',
      episodes: [
        episodeFixture({ _id: 'reviews', workflowReviewCount: 2 }),
        { ...pending, _id: 'pending' },
        { ...review, _id: 'review' },
        episodeFixture({ _id: 'new', premise: '', synopsis: '', scenes: [] }),
        episodeFixture({ _id: 'outline', synopsis: '', premise: 'Short premise', scenes: [] })
      ]
    });
    expect(screen.getByText('Pending choice (2 production reviews)')).toBeVisible();
    expect(screen.getByText('Pending choice (2 video clips)')).toBeVisible();
    expect(screen.getByText('Needs review')).toBeVisible();
    expect(screen.getAllByText('New episode').length).toBeGreaterThan(0);
    expect(screen.getAllByText('The story is waiting for its first draft.').length).toBeGreaterThan(
      0
    );
    expect(screen.getByText('Short premise')).toBeVisible();
  });

  test('review-needed scripts and sound mixes keep fallback labels for unnamed takes', () => {
    const initial = record();
    initial.scenes[0].approvalStatus = 'needs-review';
    initial.scenes[0].clips[0] = {
      ...initial.scenes[0].clips[0],
      pictureApprovalStatus: 'approved',
      soundReviewStatus: 'needs-review',
      dialogueTakeIds: ['voice']
    };
    mount(initial, {
      media: [
        mediaFixture({ _id: 'video', kind: 'video', originalName: '' }),
        mediaFixture({ _id: 'voice', kind: 'audio', originalName: '' })
      ]
    });
    expect(screen.getByText('Needs review')).toBeVisible();
    expect(screen.getByText(/This selected mix needs review/)).toBeVisible();
    expect(screen.getByText('Missing video take')).toBeVisible();
    expect(screen.getByText('Missing dialogue take')).toBeVisible();
  });

  test('an already accepted picture cannot request the same sound repair twice', () => {
    const initial = record();
    initial.scenes[0].clips[0] = {
      ...initial.scenes[0].clips[0],
      selectedTakeId: null,
      pictureApprovalStatus: 'approved',
      production: { audioRepairTakeId: 'video', visualTakeId: 'video' }
    };
    mount(initial, {
      settings: settingsFixture({ workflowVersion: 1 }),
      media: [mediaFixture({ ...media[0], nativeAudio: { policy: 'wan-native-effects-v1' } })]
    });
    expect(screen.getByRole('button', { name: 'Accept picture; repair sound' })).toBeDisabled();
  });

  test('pending saved takes remain navigable after local clip removal and tolerate missing saved files', () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const initial = record();
    initial.scenes[0].clips[0].selectedTakeId = null;
    initial.scenes[0].clips[0].takeIds = ['video', 'missing'];
    mount(initial);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove clip from draft' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Review video: Opening/ }));
    expect(screen.getByRole('heading', { name: 'Welcome' })).toHaveFocus();
    expect(screen.getByLabelText('Video.mp4')).toBeVisible();
  });

  test.each(['scene', 'top'])(
    'a scene jump queued before local removal handles the missing %s destination safely',
    async (destination) => {
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      const initial = record();
      initial.scenes = [initial.scenes[0]];
      mount(initial);
      choose('Jump to scene', destination === 'scene' ? '01 \u00b7 Welcome' : 'Top of episode');
      await waitFor(() => expect(frames.length).toBeGreaterThan(0));
      fireEvent.click(screen.getByRole('button', { name: 'Remove scene from draft' }));
      act(() => {
        for (const frame of frames) frame(performance.now());
      });
      expect(
        screen.queryByRole('navigation', { name: 'Scene navigation' })
      ).not.toBeInTheDocument();
      if (destination === 'scene') expect(scrollTo).not.toHaveBeenCalled();
      else expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
    }
  );

  test('closing scene navigation without a selection completes its exit without scrolling', async () => {
    vi.useFakeTimers();
    mount();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Jump to scene' }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
