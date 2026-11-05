import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { request } from './api.ts';
import ProductionBoard from './ProductionBoard.tsx';
import { reviewAnchor } from './review-navigation.ts';
import { studioChangeEvent, studioChangeKey } from './studio-events.ts';
import { assetFixture, episodeFixture, mediaFixture, reviewFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';

vi.mock('./api.ts', () => ({ request: vi.fn() }));

describe('component behavior', () => {
  const record = {
    _id: 'asset-one',
    name: 'Test character',
    revision: 2,
    brief: 'Keep the source outfit.',
    production: { sourceNotes: 'Red tunic and black trousers.' }
  };

  const row = {
    key: 'source-key',
    title: 'Source evidence',
    stage: 'source',
    target: { scope: 'asset' as const, recordId: 'asset-one' },
    status: 'pending-review' as const,
    canApprove: true,
    blockers: [],
    fingerprint: 'saved-hash',
    parentRevision: 2,
    reviewRevision: 0,
    feedback: ''
  };

  const board = {
    enabled: true,
    groups: [{ title: 'Source and creative brief', target: row.target, stages: [row] }]
  };

  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    vi.mocked(request).mockReset();
    vi.mocked(request).mockImplementation(async (url) => (url.endsWith('/board') ? board : {}));
  });

  test('shot plans show dialogue once when timed action repeats it and preserve distinct action notes', async () => {
    const target = { scope: 'scene' as const, recordId: 'episode', sceneId: 'academy' };
    const episode = {
      _id: 'episode',
      revision: 2,
      scenes: [
        {
          id: 'academy',
          title: 'Academy',
          clips: [
            {
              id: 'opening',
              title: 'Opening',
              duration: 7,
              dialogue: 'HARKUN: Begin.',
              production: { beats: 'HARKUN:  Begin.\n' }
            },
            {
              id: 'reply',
              title: 'Reply',
              duration: 5,
              dialogue: 'ROXY: Understood.',
              production: { beats: 'Roxy nods before answering.' }
            }
          ]
        }
      ]
    };
    vi.mocked(request).mockResolvedValue({
      enabled: true,
      record: episode,
      groups: [
        {
          title: 'Academy preparation',
          target,
          stages: [{ ...row, target, stage: 'shot-plan', title: 'Shot plan' }]
        }
      ]
    });
    render(
      <ThemeProvider theme={theme}>
        <ProductionBoard record={episodeFixture(episode)} scope="episode" onChanged={vi.fn()} />
      </ThemeProvider>
    );
    expect(await screen.findByText('Dialogue: HARKUN: Begin.')).toBeVisible();
    expect(screen.getAllByText(/HARKUN:\s+Begin\./)).toHaveLength(1);
    expect(screen.getByText('Timed action: Roxy nods before answering.')).toBeVisible();
    expect(screen.getByText('Dialogue: ROXY: Understood.')).toBeVisible();
  });

  test('the episode board groups each shot under its own scene and links directly to scenes', async () => {
    const episode = {
      _id: 'episode',
      revision: 2,
      scenes: [
        {
          id: 'arrival',
          title: 'Arrival',
          clips: [{ id: 'landing', title: 'Landing', duration: 5, dialogue: '', production: {} }]
        },
        {
          id: 'academy',
          title: 'Academy',
          clips: [{ id: 'opening', title: 'Opening', duration: 5, dialogue: '', production: {} }]
        }
      ]
    };
    vi.mocked(request).mockResolvedValue({
      enabled: true,
      layout: 'scenes',
      record: episode,
      groups: episode.scenes.flatMap((scene) => [
        {
          title: scene.title,
          target: { scope: 'scene' as const, recordId: 'episode', sceneId: scene.id },
          stages: []
        },
        ...scene.clips.map((clip) => ({
          title: clip.title,
          target: {
            scope: 'clip' as const,
            recordId: 'episode',
            sceneId: scene.id,
            clipId: clip.id
          },
          stages:
            scene.id === 'academy'
              ? [
                  {
                    ...row,
                    key: 'timed-opening',
                    title: 'Timed animatic',
                    stage: 'animatic',
                    status: 'needs-review' as const,
                    target: {
                      scope: 'clip' as const,
                      recordId: 'episode',
                      sceneId: scene.id,
                      clipId: clip.id
                    }
                  }
                ]
              : []
        }))
      ])
    });
    render(
      <ThemeProvider theme={theme}>
        <ProductionBoard record={episodeFixture(episode)} scope="episode" onChanged={vi.fn()} />
      </ThemeProvider>
    );
    const first = await screen.findByRole('region', { name: 'Scene 1: Arrival' });
    const second = screen.getByRole('region', { name: 'Scene 2: Academy' });
    expect(within(first).getByRole('region', { name: 'Shot 1: Landing' })).toBeVisible();
    expect(within(second).getByRole('region', { name: 'Shot 1: Opening' })).toBeVisible();
    expect(
      within(first).queryByRole('region', { name: 'Shot 1: Opening' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scene 2: Academy' })).toHaveAttribute(
      'href',
      '#board-scene-academy'
    );
    expect(within(second).getByRole('button', { name: 'Generate video' })).toBeDisabled();
    expect(within(second).getByRole('link', { name: 'Discuss this scene' })).toHaveAttribute(
      'href',
      '/?chat=1&episode=episode&scene=academy'
    );
    expect(within(second).getByRole('link', { name: 'Discuss this scene' })).toHaveAttribute(
      'target',
      '_blank'
    );
    const timingLink = screen.getByRole('link', { name: 'Review Opening / Timed animatic' });
    const timingAnchor = reviewAnchor(
      { scope: 'clip' as const, recordId: 'episode', sceneId: 'academy', clipId: 'opening' },
      'animatic'
    );
    expect(timingLink).toHaveAttribute('href', '#' + timingAnchor);
    expect(screen.getByRole('button', { name: 'Approve Timed animatic' })).not.toBeVisible();
    await userEvent.click(timingLink);
    window.history.replaceState({}, '', '#' + timingAnchor);
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(await screen.findByRole('button', { name: 'Approve Timed animatic' })).toBeVisible();
  });

  test('the shot sound-plan blocker links to its scene approval and opens collapsed preparation', async () => {
    const target = { scope: 'scene' as const, recordId: 'episode', sceneId: 'academy' };
    const episode = {
      _id: 'episode',
      revision: 2,
      scenes: [
        {
          id: 'academy',
          title: 'Academy',
          clips: [{ id: 'opening', title: 'Opening', duration: 5, dialogue: '', production: {} }]
        }
      ]
    };
    vi.mocked(request).mockResolvedValue({
      enabled: true,
      layout: 'scenes',
      record: episode,
      groups: [
        {
          title: 'Academy preparation',
          target,
          stages: [
            {
              ...row,
              key: 'script',
              target,
              stage: 'script',
              title: 'Scene script',
              status: 'approved' as const
            },
            { ...row, key: 'sound', target, stage: 'sound-plan', title: 'Sound plan' }
          ]
        }
      ]
    });
    const user = userEvent.setup();
    render(
      <ThemeProvider theme={theme}>
        <ProductionBoard record={episodeFixture(episode)} scope="episode" onChanged={vi.fn()} />
      </ThemeProvider>
    );
    const link = await screen.findByRole('link', { name: 'Go to Sound plan' });
    const anchor = reviewAnchor(target, 'sound-plan');
    expect(link).toHaveAttribute('href', '#' + anchor);
    await user.click(screen.getByRole('button', { name: /^Sound plan / }));
    await user.click(screen.getByText('Shared scene preparation'));
    expect(screen.queryByRole('button', { name: 'Approve Sound plan' })).not.toBeInTheDocument();
    const requestsBeforeLink = vi.mocked(request).mock.calls.length;
    await user.click(link);
    window.history.replaceState({}, '', '#' + anchor);
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(await screen.findByRole('button', { name: 'Approve Sound plan' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve Sound plan' })).toBeEnabled();
    expect(request).toHaveBeenCalledTimes(requestsBeforeLink);
  });

  test('an over-limit animatic shows measured timing and offers an actual split draft instead of approval', async () => {
    const target = {
      scope: 'clip' as const,
      recordId: 'episode',
      sceneId: 'scene',
      clipId: 'shot'
    };
    const timingRow = {
      ...row,
      key: 'timing',
      title: 'Timed animatic',
      stage: 'animatic',
      target,
      status: 'draft' as const,
      canApprove: false,
      timingIssues: [
        {
          clipId: 'shot',
          message: 'Selected dialogue is 18.88s; the audio-reference limit is 15 seconds.'
        }
      ]
    };
    const episode = {
      _id: 'episode',
      revision: 2,
      scenes: [
        {
          id: 'scene',
          clips: [{ id: 'shot', title: 'Mandate', duration: 24, dialogue: 'HARKUN: Begin.' }]
        }
      ]
    };
    vi.mocked(request).mockImplementation(async (url) =>
      url.endsWith('/animatic/prepare')
        ? { timingRepair: 'split', message: 'Timing revision draft ready above.' }
        : {
            enabled: true,
            record: episode,
            groups: [{ title: 'Mandate', target, stages: [timingRow] }]
          }
    );
    const user = userEvent.setup();
    render(
      <ThemeProvider theme={theme}>
        <ProductionBoard
          record={episodeFixture(episode)}
          scope="episode"
          media={[]}
          onChanged={vi.fn()}
        />
      </ThemeProvider>
    );
    expect(await screen.findByRole('button', { name: 'Approve Timed animatic' })).toBeDisabled();
    expect(screen.getByText(/Selected dialogue is 18.88s/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Prepare split or retimed shots' }));
    expect(request).toHaveBeenCalledWith('/studio/workflow/animatic/prepare', {
      method: 'POST',
      body: { target, parentRevision: 2 }
    });
    expect(await screen.findByText('Timing revision draft ready above.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to timing draft' })).toHaveAttribute(
      'href',
      '#production-revisions'
    );
  });

  test('a provider failure is shown at the missing reference instead of an unexplained Draft label', async () => {
    const failed = {
      ...row,
      key: 'front-key',
      stage: 'reference:view-front',
      title: 'Individual full-body front view',
      status: 'draft' as const,
      canApprove: false,
      blockers: ['Attach the reference image.']
    };
    vi.mocked(request).mockResolvedValue({
      ...board,
      record: {
        ...record,
        production: {
          items: [
            {
              id: 'view-front',
              type: 'image' as const,
              title: failed.title,
              notes: 'One front view.',
              mediaId: null
            }
          ]
        }
      },
      groups: [{ title: 'Reference package', target: row.target, stages: [failed] }],
      jobs: [
        {
          _id: 'failed-front',
          status: 'failed' as const,
          target: { assetId: record._id, packageItemId: 'view-front' },
          error: 'OpenArt render failed: request rejected by the safety system.'
        }
      ]
    });
    mount();
    expect(
      await screen.findByRole('button', {
        name: 'Individual full-body front view Generation failed'
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText('OpenArt render failed: request rejected by the safety system.')
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Approve Individual full-body front view' })
    ).toBeDisabled();
  });

  test('exact visual prompts are visible in the revision review', async () => {
    const imagePrompt =
      'Star Wars universe, Old Republic era. One full-body front view. No labels.';
    const plan = {
      ...row,
      key: 'plan-key',
      stage: 'reference-plan:view-front',
      title: 'Front revision directions'
    };
    vi.mocked(request).mockResolvedValue({
      ...board,
      record: {
        ...record,
        production: {
          items: [
            {
              id: 'view-front',
              title: 'Front',
              type: 'image' as const,
              notes: 'Preserve the selected design.',
              imagePrompt,
              requiresPlanApproval: true
            }
          ]
        }
      },
      groups: [{ title: 'Reference package', target: row.target, stages: [plan] }]
    });
    mount();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Front revision directions Pending review' })
    );
    expect(screen.getByText(imagePrompt)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve Front revision directions' })).toBeEnabled();
  });

  test('next-step and prerequisite links open the exact collapsed review', async () => {
    const user = userEvent.setup();
    const brief = {
      ...row,
      key: 'brief-key',
      stage: 'brief',
      title: 'Creative brief',
      status: 'blocked' as const,
      canApprove: false,
      blockers: ['Approve Source evidence.'],
      prerequisites: [{ key: row.key, target: row.target, stage: row.stage, title: row.title }]
    };
    vi.mocked(request).mockResolvedValue({
      ...board,
      progress: {
        state: 'review',
        message: 'Next step: Creative brief.',
        review: { target: brief.target, stage: brief.stage, title: brief.title }
      },
      groups: [{ ...board.groups[0], stages: [row, brief] }]
    });
    mount();
    const next = await screen.findByRole('link', { name: 'Go to Creative brief' });
    expect(next).toHaveAttribute('href', '#' + reviewAnchor(brief.target, brief.stage));
    const summary = screen.getByRole('button', { name: 'Creative brief Blocked' });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    await user.click(next);
    await waitFor(() => expect(summary).toHaveAttribute('aria-expanded', 'true'));
    await user.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    await user.click(next);
    await waitFor(() => expect(summary).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByRole('link', { name: 'Go to Source evidence' })).toHaveAttribute(
      'href',
      '#' + reviewAnchor(row.target, row.stage)
    );
  });

  function mount(props = {}) {
    return render(
      <ThemeProvider theme={theme}>
        <ProductionBoard record={episodeFixture(record)} scope="asset" {...props} />
      </ThemeProvider>
    );
  }

  test('missing asset source evidence is expanded and links directly to its input fields', async () => {
    vi.mocked(request).mockResolvedValue({
      ...board,
      groups: [
        {
          ...board.groups[0],
          stages: [
            {
              ...row,
              status: 'draft' as const,
              canApprove: false,
              blockers: ['Attach source frames or a source URL.']
            }
          ]
        }
      ]
    });
    mount();
    const summary = await screen.findByRole('button', { name: 'Source evidence Draft' });
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Approve Source evidence' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Go to source evidence fields' })).toHaveAttribute(
      'href',
      '#asset-production-inputs'
    );
  });

  test.each(['focus', studioChangeEvent, 'storage'])(
    'the production board refreshes saved approvals on %s',
    async (event) => {
      mount();
      await screen.findByRole('button', { name: /Source evidence Pending review/ });
      vi.mocked(request).mockResolvedValue({
        ...board,
        groups: [{ ...board.groups[0], stages: [{ ...row, title: 'Updated source evidence' }] }]
      });
      fireEvent(
        window,
        event === 'storage'
          ? new StorageEvent('storage', { key: studioChangeKey })
          : new Event(event)
      );
      expect(
        await screen.findByRole('button', { name: /Updated source evidence Pending review/ })
      ).toBeVisible();
    }
  );

  test('approval sends saved fingerprint and revisions and reopens from the refreshed board', async () => {
    const user = userEvent.setup(),
      onChanged = vi.fn();
    mount({ onChanged });
    await user.click(await screen.findByRole('button', { name: /Source evidence Pending review/ }));
    expect(screen.getByText('Red tunic and black trousers.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Approve Source evidence' }));
    expect(request).toHaveBeenCalledWith('/studio/workflow/review', {
      method: 'POST',
      body: {
        target: row.target,
        stage: 'source',
        action: 'approve',
        fingerprint: 'saved-hash',
        parentRevision: 2,
        reviewRevision: 0,
        feedback: ''
      }
    });
    expect(onChanged).toHaveBeenCalled();
  });

  test('board reviews use the saved server snapshot instead of an older editor copy', async () => {
    vi.mocked(request).mockResolvedValue({
      ...board,
      record: {
        ...record,
        revision: 3,
        production: { sourceNotes: 'Current saved source research.' }
      },
      proposals: [
        {
          _id: 'scene-draft',
          title: 'Correct arrival',
          baseRevision: 1,
          scene: {
            id: 'arrival',
            title: 'Beneath the carrier',
            script: 'One transport.',
            clips: []
          },
          application: { canApply: true, rebased: true, recordRevision: 3 }
        }
      ]
    });
    mount();
    expect(await screen.findByRole('button', { name: 'Apply revised draft' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /Source evidence Pending review/ }));
    expect(screen.getByText('Current saved source research.')).toBeVisible();
    expect(screen.queryByText('Red tunic and black trousers.')).not.toBeInTheDocument();
  });

  test('active editor saves disable reviews with an explanation; request changes requires feedback', async () => {
    const user = userEvent.setup();
    const view = mount({ saving: true });
    await user.click(await screen.findByRole('button', { name: /Source evidence Pending review/ }));
    expect(screen.getByRole('button', { name: 'Approve Source evidence' })).toBeDisabled();
    view.rerender(
      <ThemeProvider theme={theme}>
        <ProductionBoard record={episodeFixture(record)} scope="asset" />
      </ThemeProvider>
    );
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: 'Review feedback' }),
      'Check the belt against footage.'
    );
    await user.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(request).toHaveBeenCalledWith(
      '/studio/workflow/review',
      expect.objectContaining({
        body: expect.objectContaining({
          action: 'request-changes',
          feedback: 'Check the belt against footage.'
        })
      })
    );
  });

  test('a stale review retains feedback and shows the server conflict', async () => {
    const user = userEvent.setup();
    vi.mocked(request).mockImplementation(async (url) => {
      if (url.endsWith('/review'))
        throw Object.assign(
          new Error('This review changed. Refresh and review the saved version.'),
          {
            status: 409
          }
        );
      return board;
    });
    mount();
    await user.click(await screen.findByRole('button', { name: /Source evidence Pending review/ }));
    await user.type(
      screen.getByRole('textbox', { name: 'Review feedback' }),
      'My feedback is retained.'
    );
    await user.click(screen.getByRole('button', { name: 'Approve Source evidence' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('This review changed.')
    );
    expect(screen.getByRole('textbox', { name: 'Review feedback' })).toHaveValue(
      'My feedback is retained.'
    );
  });

  test('request changes shows saving, then a persistent timestamped receipt after a reload', async () => {
    const user = userEvent.setup();
    const feedback = 'We only need maybe 7 seconds of the canyon flight';
    const savedAt = '2026-10-24T14:28:16.593Z';
    const savedRow = {
      ...row,
      status: 'needs-changes' as const,
      feedback,
      savedAt,
      lastAction: 'request-changes',
      feedbackIsCurrent: true,
      reviewRevision: 1
    };
    let resolveSave;
    let saved = false;
    vi.mocked(request).mockImplementation(async (url) => {
      if (url.endsWith('/review'))
        return new Promise((resolve) => {
          resolveSave = () => {
            saved = true;
            resolve({ receipt: { action: 'request-changes', savedAt, feedback } });
          };
        });
      return saved ? { ...board, groups: [{ ...board.groups[0], stages: [savedRow] }] } : board;
    });
    const view = mount();
    await user.click(await screen.findByRole('button', { name: /Source evidence Pending review/ }));
    await user.type(screen.getByRole('textbox', { name: 'Review feedback' }), feedback);
    await user.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saving change request');
    expect(screen.getByRole('status')).toHaveTextContent('not confirmed saved yet');
    expect(screen.getByRole('textbox', { name: 'Review feedback' })).toBeDisabled();
    resolveSave();
    await waitFor(() => expect(screen.getByText('Change request saved')).toBeVisible());
    expect(screen.getByRole('status')).toHaveTextContent(feedback);
    expect(screen.getByRole('status')).toHaveTextContent(
      'does not automatically prepare a revision'
    );
    view.unmount();
    mount();
    expect(await screen.findByText('Change request saved')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(new Date(savedAt).toLocaleString());
    expect(screen.getByRole('status')).toHaveTextContent(feedback);
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discuss saved feedback' })).toBeEnabled();
  });

  test('failed change requests keep the comment and never show a saved receipt', async () => {
    vi.mocked(request).mockImplementation(async (url) => {
      if (url.endsWith('/review'))
        throw new Error('Connection lost. Your request was not confirmed.');
      return board;
    });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /Source evidence Pending review/ }));
    const input = screen.getByRole('textbox', { name: 'Review feedback' });
    await user.type(input, 'Shorten the shot.');
    await user.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not confirmed');
    expect(input).toHaveValue('Shorten the shot.');
    expect(screen.queryByText('Change request saved')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeEnabled();
  });

  test('feedback discussion carries the saved context and comment without sending a message, and storage failure preserves the receipt', async () => {
    const feedback = 'We only need maybe 7 seconds of the canyon flight';
    const requestedRow = {
      ...row,
      status: 'needs-changes' as const,
      feedback,
      lastAction: 'request-changes',
      savedAt: '2026-10-24T14:28:16.593Z',
      feedbackIsCurrent: true
    };
    vi.mocked(request).mockImplementation(async (url) =>
      url.endsWith('/chats')
        ? { chat: { _id: 'feedback-chat' } }
        : { ...board, groups: [{ ...board.groups[0], stages: [requestedRow] }] }
    );
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Browser storage is unavailable.');
    });
    try {
      const user = userEvent.setup();
      mount();
      await user.click(await screen.findByRole('button', { name: 'Discuss saved feedback' }));
      expect(request).toHaveBeenCalledWith('/studio/assistant/chats', {
        method: 'POST',
        body: {
          title: 'Requested changes: Test character',
          context: { assetId: 'asset-one' }
        }
      });
      expect(setItem).toHaveBeenCalledWith('roxy-chat-draft-feedback-chat', expect.any(String));
      const draft = JSON.parse(setItem.mock.calls[0][1]);
      expect(draft.text).toContain(feedback);
      expect(draft.text).toContain('do not approve anything or generate media');
      expect(await screen.findByRole('alert')).toHaveTextContent('Browser storage is unavailable.');
      expect(screen.getByText('Change request saved')).toBeVisible();
      expect(vi.mocked(request).mock.calls.some(([url]) => url.endsWith('/messages'))).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });

  test('body turnaround has its own approval action rather than approving other package items', async () => {
    const user = userEvent.setup();
    const targetRow = {
      ...row,
      stage: 'reference:body-turnaround',
      title: 'Body turnaround',
      automatic: true,
      status: 'blocked' as const,
      canApprove: false,
      blockers: ['Finalize this body turnaround in the asset image choices.']
    };
    vi.mocked(request).mockImplementation(async (url) =>
      url.endsWith('/board')
        ? {
            enabled: true,
            groups: [{ title: 'Reference package', target: row.target, stages: [targetRow] }]
          }
        : {}
    );
    const body = {
      ...record,
      production: {
        items: [
          {
            id: 'body-turnaround',
            type: 'image' as const,
            title: 'Body turnaround',
            mediaId: 'turnaround-file',
            notes: 'Full body and head.'
          }
        ]
      },
      candidates: [{ id: 'new-turnaround', mediaIds: ['turnaround-file'], archived: false }]
    };
    mount({
      record: body,
      media: [{ _id: 'turnaround-file', kind: 'image' as const, originalName: 'turnaround.png' }]
    });
    await user.click(await screen.findByRole('button', { name: /Body turnaround Blocked/ }));
    await user.click(screen.getByRole('button', { name: 'Approve body turnaround' }));
    expect(request).toHaveBeenCalledWith('/studio/assets/asset-one/finalize', {
      method: 'POST',
      body: { revision: 2, candidateId: 'new-turnaround' }
    });
    expect(vi.mocked(request).mock.calls.some(([url]) => url.endsWith('/review'))).toBe(false);
  });

  test('already-approved inputs can start the next step and queued work is visible', async () => {
    const user = userEvent.setup();
    vi.mocked(request).mockImplementation(async (url) =>
      url.endsWith('/board')
        ? {
            ...board,
            nextSteps: [{ kind: 'image' as const }],
            automation: []
          }
        : {}
    );
    mount();
    await user.click(
      await screen.findByRole('button', { name: 'Start next production step (1 request)' })
    );
    expect(request).toHaveBeenCalledWith('/studio/workflow/advance', {
      method: 'POST',
      body: { target: { scope: 'asset' as const, recordId: 'asset-one' }, parentRevision: 2 }
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Production step queued.');
    await user.click(screen.getByRole('link', { name: 'Go to production jobs' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Production jobs and retries' })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    );
  });

  test('queued automation disables duplicate starts and replaces the earlier failure notice', async () => {
    vi.mocked(request).mockResolvedValue({
      ...board,
      nextSteps: [{ kind: 'image' as const }],
      automation: [
        { _id: 'queued', status: 'queued' as const },
        { _id: 'failed', status: 'failed' as const, error: 'Connect OpenArt first.' }
      ]
    });
    mount();
    expect(
      await screen.findByRole('button', { name: 'Start next production step (1 request)' })
    ).toBeDisabled();
    expect(screen.queryByText(/Connect OpenArt first/)).not.toBeInTheDocument();
    expect(screen.getByText(/Jobs continue when you leave this page/)).toBeVisible();
  });

  test('dialogue blockers link to their exact fields and old repeated failures appear once', async () => {
    const target = { episodeId: 'episode-one', sceneId: 'scene', clipId: 'shot' };
    const episode = {
      _id: 'episode-one',
      revision: 1,
      scenes: [{ id: 'scene', title: 'Arrival', clips: [{ id: 'shot', title: 'Harkun opening' }] }]
    };
    const error = 'Dialogue generation requires one speaker per clip.';
    vi.mocked(request).mockResolvedValue({
      enabled: true,
      groups: [],
      blockedSteps: [{ kind: 'dialogue' as const, target, error }],
      automation: [
        { _id: 'new', status: 'failed' as const, error },
        { _id: 'old', status: 'failed' as const, error }
      ],
      nextSteps: [{ kind: 'image' as const, target }]
    });
    mount({ scope: 'episode' as const, record: episode });
    expect(
      await screen.findByRole('link', { name: 'Edit dialogue for Harkun opening' })
    ).toHaveAttribute('href', '#shot-dialogue-shot');
    expect(screen.getAllByText(/Dialogue generation requires one speaker per clip/)).toHaveLength(
      1
    );
    expect(
      screen.getByRole('button', { name: 'Start next production step (1 request)' })
    ).toBeEnabled();
    expect(screen.getByText('image · Harkun opening')).toBeVisible();
  });

  test('failed job shortcuts open and focus the exact job even after recollapsing it', async () => {
    const user = userEvent.setup();
    vi.mocked(request).mockResolvedValue({
      ...board,
      jobs: [
        {
          _id: 'failed-image',
          kind: 'image' as const,
          title: 'Image · Harkun opening',
          status: 'failed' as const,
          target: { episodeId: record._id, sceneId: 'scene', clipId: 'shot' },
          error: 'Too many image references.'
        }
      ]
    });
    mount();
    const link = await screen.findByRole('link', {
      name: 'Go to job details for Image · Harkun opening'
    });
    expect(link).toHaveAttribute('href', '#production-job-failed-image');
    const summary = screen.getByRole('button', { name: 'Production jobs and retries' });
    await user.click(link);
    await waitFor(() => expect(summary).toHaveAttribute('aria-expanded', 'true'));
    await waitFor(() =>
      expect(
        screen.getByRole('alert', { name: 'Production job: Image · Harkun opening' })
      ).toHaveFocus()
    );
    await user.click(summary);
    await user.click(link);
    await waitFor(() => expect(summary).toHaveAttribute('aria-expanded', 'true'));
  });

  test('starting production disables repeat clicks while the request is pending', async () => {
    const user = userEvent.setup();
    let resolveStart;
    vi.mocked(request).mockImplementation((url) =>
      url.endsWith('/board')
        ? Promise.resolve({ ...board, nextSteps: [{ kind: 'image' as const }] })
        : new Promise((resolve) => {
            resolveStart = resolve;
          })
    );
    mount();
    await user.click(
      await screen.findByRole('button', { name: 'Start next production step (1 request)' })
    );
    expect(screen.getByRole('button', { name: 'Starting production…' })).toBeDisabled();
    resolveStart({});
    expect(await screen.findByRole('status')).toHaveTextContent('Production step queued.');
  });

  test('failed prerequisites stay visible after approval and retry starts through the application', async () => {
    const user = userEvent.setup();
    vi.mocked(request).mockResolvedValue({
      ...board,
      progress: {
        state: 'blocked',
        message: '5 requests failed. Your approvals are saved.',
        retrySteps: Array.from({ length: 5 }, () => ({ kind: 'image' as const }))
      }
    });
    mount();
    expect(await screen.findByRole('status')).toHaveTextContent(
      '5 requests failed. Your approvals are saved.'
    );
    await user.click(screen.getByRole('button', { name: 'Retry failed requests (5)' }));
    expect(request).toHaveBeenCalledWith('/studio/workflow/retry', {
      method: 'POST',
      body: expect.objectContaining({
        target: { scope: 'asset' as const, recordId: 'asset-one' },
        parentRevision: 2,
        requestId: expect.any(String)
      })
    });
  });

  test('episode source review collects explicit range confirmation next to its research', async () => {
    const user = userEvent.setup();
    const episode = {
      _id: 'episode-one',
      revision: 4,
      scenes: [],
      production: { sourceNotes: 'Recorded events to review.' },
      sourceReferences: [
        {
          id: 'chapter',
          chapter: 'Initial Sith Trials',
          title: 'Chapter',
          startSeconds: 1007,
          endSeconds: 2043,
          status: 'unreviewed' as const,
          url: 'https://www.youtube.com/watch?v=ojIORTFv7WU'
        }
      ]
    };
    const source = {
      ...row,
      target: { scope: 'episode' as const, recordId: episode._id },
      title: 'Source research',
      status: 'draft' as const,
      canApprove: false,
      parentRevision: 4,
      blockers: ['Verify the source.']
    };
    vi.mocked(request).mockImplementation(async (url) =>
      url.endsWith('/board')
        ? { enabled: true, groups: [{ title: 'Episode preparation', stages: [source] }] }
        : {}
    );
    mount({ scope: 'episode' as const, record: episode });
    expect(await screen.findByText('Recorded events to review.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve Source research' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /I reviewed Initial Sith Trials/ }));
    await user.click(
      screen.getByRole('button', { name: 'Verify selected sources and approve research' })
    );
    expect(request).toHaveBeenCalledWith(
      '/studio/workflow/review',
      expect.objectContaining({
        body: expect.objectContaining({
          verifiedSourceIds: ['chapter'],
          parentRevision: 4,
          action: 'approve'
        })
      })
    );
  });

  test('approved source research stays explicit when the applied outline is ready for approval', async () => {
    const episode = {
      _id: 'episode-one',
      revision: 8,
      scenes: [],
      sourceReferences: [],
      production: { sourceNotes: 'Approved research.', outline: 'Applied outline.' }
    };
    const source = {
      ...row,
      target: { scope: 'episode' as const, recordId: episode._id },
      title: 'Source research',
      stage: 'source',
      status: 'approved' as const
    };
    const outline = {
      ...source,
      key: 'outline-key',
      title: 'Episode outline',
      stage: 'outline',
      status: 'pending-review' as const
    };
    vi.mocked(request).mockResolvedValue({
      enabled: true,
      proposals: [],
      groups: [{ title: 'Episode preparation', stages: [source, outline] }]
    });
    mount({ scope: 'episode' as const, record: episode });
    expect(await screen.findByRole('link', { name: 'Source research approved' })).toHaveAttribute(
      'href',
      '#' + reviewAnchor(source.target, 'source')
    );
    expect(screen.getByRole('button', { name: 'Approve Episode outline' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Apply revised draft' })).not.toBeInTheDocument();
  });

  test('clip prerequisite anchor exposes an approval and previews only the selected clip', async () => {
    const user = userEvent.setup();
    const target = {
      scope: 'clip' as const,
      recordId: 'episode-one',
      sceneId: 'arrival',
      clipId: 'giants'
    };
    const clip = {
      id: 'giants',
      title: 'Beneath the stone giants',
      duration: 6,
      camera: 'Wide approach.',
      dialogue: ''
    };
    const episode = {
      _id: 'episode-one',
      revision: 3,
      scenes: [
        {
          id: 'arrival',
          title: 'Arrival',
          clips: [clip, { ...clip, id: 'unfinished', title: 'Unfinished parked shot', duration: 4 }]
        }
      ]
    };
    vi.mocked(request).mockResolvedValue({
      enabled: true,
      record: episode,
      groups: [
        {
          title: 'Arrival / Beneath the stone giants',
          target,
          stages: [
            {
              ...row,
              key: 'clip-storyboard',
              target,
              stage: 'storyboard',
              title: 'Storyboard continuity'
            }
          ]
        }
      ]
    });
    mount({
      record: episode,
      scope: 'episode' as const,
      assets: [
        {
          _id: 'shot-image',
          episodeId: episode._id,
          sceneId: 'arrival',
          clipId: 'giants',
          finalChoice: { mediaIds: ['image'] }
        }
      ],
      media: [{ _id: 'image', kind: 'image' as const, originalName: 'giants.png' }]
    });
    const approve = await screen.findByRole('button', { name: 'Approve Storyboard continuity' });
    expect(approve).toBeEnabled();
    expect(
      screen.getByRole('region', { name: 'Prerequisites: Arrival / Beneath the stone giants' })
    ).toHaveAttribute('id', 'picture-prerequisites-giants');
    expect(screen.getByText(/Beneath the stone giants.*6s/)).toBeVisible();
    expect(screen.queryByText(/Unfinished parked shot.*4s/)).not.toBeInTheDocument();
    expect(screen.getByText(/Other shots can remain unfinished/)).toBeVisible();
    await user.click(approve);
    expect(request).toHaveBeenCalledWith(
      '/studio/workflow/review',
      expect.objectContaining({
        body: expect.objectContaining({ target, stage: 'storyboard', action: 'approve' })
      })
    );
  });

  test('saved gameplay evidence can be inspected on the episode without a new approval', async () => {
    const user = userEvent.setup();
    vi.mocked(request).mockResolvedValue({
      ...board,
      sourceEvidence: [
        {
          _id: 'packet',
          title: 'Arrival at Korriban source',
          observations: 'Actual footage shows the transport approaching the landing platform.',
          limitations: 'Caption markers do not establish dialogue.',
          frames: [
            {
              captured: true,
              captureKey: 'frame-key',
              mediaId: 'full-frame',
              subtitleCropMediaId: 'subtitle-crop',
              requestedSeconds: 1038,
              sourceSeconds: 1038,
              width: 1920,
              height: 1080
            }
          ]
        }
      ]
    });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Saved gameplay evidence' }));
    expect(screen.getByText('Arrival at Korriban source')).toBeVisible();
    expect(screen.getByText('Source 17:18 · 1920 × 1080')).toBeVisible();
    expect(screen.getByAltText('Source frame at 17:18')).toHaveAttribute(
      'src',
      '/api/studio/media/full-frame'
    );
    expect(screen.getByAltText('Subtitle crop at 17:18')).toHaveAttribute(
      'src',
      '/api/studio/media/subtitle-crop'
    );
    expect(
      screen.getByText('Actual footage shows the transport approaching the landing platform.')
    ).toBeVisible();
    expect(vi.mocked(request).mock.calls.every(([url]) => url.endsWith('/board'))).toBe(true);
  });

  test('music brief can be approved on the board without requesting music generation', async () => {
    const target = { scope: 'scene' as const, recordId: 'episode', sceneId: 'arrival' };
    const musicRow = {
      ...row,
      key: 'music-plan',
      target,
      stage: 'music-plan',
      title: 'Background music brief'
    };
    const episode = {
      _id: 'episode',
      revision: 2,
      scenes: [{ id: 'arrival', title: 'Arrival', clips: [] }]
    };
    vi.mocked(request).mockImplementation(async (url) =>
      url.endsWith('/board')
        ? {
            enabled: true,
            record: episode,
            groups: [{ title: 'Background music', target, stages: [musicRow] }]
          }
        : {}
    );
    const user = userEvent.setup();
    render(
      <ThemeProvider theme={theme}>
        <ProductionBoard record={episodeFixture(episode)} scope="episode" onChanged={vi.fn()} />
      </ThemeProvider>
    );
    await user.click(await screen.findByRole('button', { name: 'Approve Background music brief' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/studio/workflow/review',
        expect.objectContaining({
          body: expect.objectContaining({ stage: 'music-plan', action: 'approve' })
        })
      )
    );
    expect(vi.mocked(request).mock.calls.some(([url]) => url.endsWith('/music/generate'))).toBe(
      false
    );
  });
});

describe('production stages and recovery', () => {
  let ProductionBoard: (typeof import('./ProductionBoard.tsx'))['default'];
  let EnableWorkflow: (typeof import('./ProductionBoard.tsx'))['EnableWorkflow'];
  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('./SceneMusic.tsx', () => ({
      default: ({ scene }) => (
        <section id={'music-' + scene.id} tabIndex={-1}>
          Section music
        </section>
      )
    }));
    ({ default: ProductionBoard, EnableWorkflow } = await import('./ProductionBoard.tsx'));
  });
  afterAll(() => {
    vi.doUnmock('./SceneMusic.tsx');
    vi.resetModules();
  });
  const target = { scope: 'scene' as const, recordId: 'episode', sceneId: 'scene' };

  const episode = episodeFixture({
    _id: 'episode',
    revision: 2,
    production: { sourceNotes: 'Recorded source notes', outline: 'Saved outline' },
    scenes: [
      {
        id: 'scene',
        title: 'Welcome',
        location: 'Academy',
        assetIds: ['character'],
        soundPlan: {
          notes: 'Continuous sound',
          dialogueGainDb: 0,
          layers: [
            {
              id: 'bed',
              title: 'Ventilation',
              type: 'ambience',
              description: 'Low machinery',
              duration: 5,
              start: 0,
              sourceStart: 0,
              gainDb: -22,
              lowpassHz: 0,
              loop: true
            }
          ]
        },
        clips: [
          { id: 'prior', title: 'Prior', production: { location: 'Academy' } },
          {
            id: 'shot',
            title: 'Response',
            dialogue: 'HARKUN: Begin.',
            action: 'He stays still.',
            selectedDialogueId: 'voice',
            production: {
              visualTakeId: 'video',
              referenceMediaIds: ['portrait', 'missing'],
              location: 'Academy',
              beats: 'Nod before speaking.',
              startState: 'Arms crossed',
              allowedMotion: 'Face only',
              endState: 'Still facing Roxy',
              passCondition: 'Preserve identity',
              physicalConstraints: 'Fixed background',
              continuityNotes: 'Same room'
            }
          }
        ]
      }
    ]
  });

  const assets = [
    assetFixture({
      _id: 'character',
      name: 'Harkun',
      episodeId: 'episode',
      sceneId: 'scene',
      clipId: 'prior',
      finalChoice: { mediaIds: ['portrait'] }
    })
  ];

  const media = [
    mediaFixture({ _id: 'portrait', originalName: 'Portrait.png' }),
    mediaFixture({ _id: 'voice', kind: 'audio', originalName: 'Dialogue.wav' }),
    mediaFixture({ _id: 'video', kind: 'video', originalName: 'Video.mp4' })
  ];

  beforeEach(() => {
    vi.mocked(request).mockReset();
    history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function mount(
    rows,
    extra = {},
    record: Parameters<typeof ProductionBoard>[0]['record'] = episode,
    scope: 'asset' | 'episode' = 'episode'
  ) {
    const board = {
      enabled: true,
      groups: [{ title: 'Saved stage', target: rows[0]?.target || target, stages: rows }],
      ...extra
    };
    vi.mocked(request).mockImplementation(async (path) => (path.endsWith('/board') ? board : {}));
    return render(
      <ProductionBoard
        record={record}
        scope={scope}
        assets={assets}
        media={media}
        onChanged={vi.fn()}
      />
    );
  }

  test.each([
    ['references', 'Harkun', false],
    ['sound-plan', 'Ventilation: Low machinery', false],
    ['shot-plan', 'Reference views: Portrait.png, Missing file', false],
    ['storyboard', 'Current shot directions', true],
    ['animatic', 'Timed still-image preview', true],
    ['visual', 'Review the full take with sound', true],
    ['music-plan', 'Approval saves this music brief.', false],
    ['music', 'Listen and approve one individual music audition', false],
    ['export', 'Review shot order, approved final-resolution clips', false],
    ['other', 'Reference', true]
  ])(
    'renders the saved %s review content with its scene and media context',
    async (stage, expected, clip) => {
      const row = reviewFixture({
        key: stage,
        stage,
        title: stage === 'visual' ? 'Video picture, performance and sound' : stage,
        target: {
          ...target,
          ...(clip
            ? { scope: 'clip', clipId: 'shot' }
            : stage === 'export'
              ? { scope: 'episode', sceneId: undefined }
              : {})
        },
        canApprove: true,
        status: 'pending-review'
      });
      mount([row]);
      await screen.findByRole('heading', { name: 'Saved stage' });
      const summary = screen.getByRole('button', { name: new RegExp('^' + row.title) });
      if (summary.getAttribute('aria-expanded') === 'false') fireEvent.click(summary);
      if (stage === 'visual') expect(screen.getByLabelText('Video.mp4')).toBeVisible();
      else if (stage === 'other') expect(screen.getByLabelText('Video.mp4')).toBeVisible();
      else
        expect(
          screen.getByText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        ).toBeInTheDocument();
      if (stage.startsWith('music') || stage === 'music')
        fireEvent.click(screen.getByRole('link', { name: 'Go to background music' }));
    }
  );

  test('source reviews handle ordinary and malformed URLs and verify only explicitly selected ranges', async () => {
    const record = episodeFixture({
      ...episode,
      sourceReferences: [
        {
          id: 'one',
          title: 'Chapter one',
          url: 'https://youtube.com/watch?v=abcdefghijk',
          startSeconds: undefined,
          endSeconds: null,
          status: 'unreviewed'
        },
        {
          id: 'two',
          title: 'Database',
          url: 'https://example.test/source',
          startSeconds: 3,
          endSeconds: 8,
          status: 'unreviewed'
        },
        {
          id: 'invalid',
          title: 'Unfinished URL',
          url: 'incomplete',
          startSeconds: 0,
          endSeconds: 4,
          status: 'verified'
        }
      ]
    });
    mount(
      [
        reviewFixture({
          stage: 'source',
          title: 'Source research',
          target: { scope: 'episode', recordId: 'episode' },
          status: 'pending-review'
        })
      ],
      {},
      record
    );
    const check = await screen.findByRole('checkbox', {
      name: 'I reviewed Chapter one and confirm its recorded events and decisions'
    });
    fireEvent.click(check);
    fireEvent.click(check);
    fireEvent.click(check);
    fireEvent.click(
      screen.getByRole('button', { name: 'Verify selected sources and approve research' })
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/studio/workflow/review',
        expect.objectContaining({ body: expect.objectContaining({ verifiedSourceIds: ['one'] }) })
      )
    );
    expect(screen.getAllByText(/Database/).length).toBeGreaterThan(0);
  });

  test('an approved stage can be unapproved without changing other review rows', async () => {
    mount([
      reviewFixture({ stage: 'sound-plan', title: 'Sound plan', status: 'approved', target })
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Sound plan Approved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unapprove' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/studio/workflow/review',
        expect.objectContaining({
          body: expect.objectContaining({ action: 'unapprove', stage: 'sound-plan' })
        })
      )
    );
  });

  test('package references display their exact prompt and image generation remains an explicit request', async () => {
    const record = assetFixture({
      _id: 'character',
      revision: 3,
      kind: 'character',
      production: {
        items: [{ id: 'master-portrait', title: 'Master portrait', type: 'image', required: true }]
      }
    });
    mount(
      [
        reviewFixture({
          stage: 'reference:master-portrait',
          title: 'Portrait',
          status: 'pending-review',
          target: { scope: 'asset', recordId: 'character' }
        })
      ],
      { referencePrompts: [{ itemId: 'master-portrait', prompt: 'Neutral head and shoulders.' }] },
      record,
      'asset'
    );
    expect(await screen.findByLabelText('Saved image generation prompt')).toHaveValue(
      'Neutral head and shoulders.'
    );
    const summary = screen.getByRole('button', { name: /Portrait Pending review/ });
    if (summary.getAttribute('aria-expanded') === 'false') fireEvent.click(summary);
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/studio/assistant/image/generate',
        expect.objectContaining({
          body: expect.objectContaining({
            assetId: 'character',
            revision: 3,
            packageItemId: 'master-portrait',
            prompt: 'Neutral head and shoulders.'
          })
        })
      )
    );
    vi.mocked(request).mockRejectedValueOnce(new Error('Image service unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }));
    expect(await screen.findByText('Image service unavailable')).toBeVisible();
  });

  test('saved gameplay evidence shows original video, overview and ordered captured subtitle frames', async () => {
    mount([], {
      sourceEvidence: [
        {
          _id: 'packet',
          title: 'Gameplay packet',
          observations: 'Observed dialogue.',
          limitations: 'Limited viewpoint.',
          videoMediaId: 'video',
          frames: [
            { overview: true, mediaId: 'portrait' },
            {
              captured: true,
              requestedSeconds: 65,
              mediaId: 'not-in-list',
              subtitleCropMediaId: 'crop'
            },
            {
              captured: true,
              requestedSeconds: 60,
              mediaId: 'portrait',
              subtitleCropMediaId: 'portrait'
            }
          ]
        }
      ]
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Saved gameplay evidence' }));
    expect(screen.getByLabelText('Video.mp4')).toBeVisible();
    expect(screen.getByAltText('Source frame at 1:05')).toBeVisible();
    expect(screen.getByAltText('Subtitle crop at 1:05')).toBeVisible();
    expect(screen.getAllByAltText('Portrait.png')).toHaveLength(3);
  });

  test('failed retry and advance requests retain their explanation and let the user retry explicitly', async () => {
    const view = mount([], {
      progress: { retrySteps: ['retry'] },
      automation: [],
      nextSteps: [{ kind: 'image' }]
    });
    const retry = await screen.findByRole('button', { name: 'Retry failed requests (1)' });
    vi.mocked(request).mockRejectedValueOnce(new Error('Retry unavailable'));
    fireEvent.click(retry);
    expect(await screen.findByText('Retry unavailable')).toBeVisible();
    vi.mocked(request).mockRejectedValueOnce(new Error('Advance unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Start next production step (1 request)' }));
    expect(await screen.findByText('Advance unavailable')).toBeVisible();
    view.unmount();
  });

  test('board read errors do not erase a saved view and late results cannot replace newer board data', async () => {
    let requests: ((value: unknown) => void)[] = [];
    vi.mocked(request).mockImplementation(() => new Promise((resolve) => requests.push(resolve)));
    const view = render(<ProductionBoard record={episode} scope="episode" onChanged={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent(window, new Event(studioChangeEvent));
    await act(async () =>
      requests[1]({ enabled: true, groups: [], progress: { message: 'New saved board' } })
    );
    await act(async () =>
      requests[0]({ enabled: true, groups: [], progress: { message: 'Old board' } })
    );
    expect(screen.queryByText('Old board')).not.toBeInTheDocument();
    vi.mocked(request).mockRejectedValueOnce(new Error('Board offline'));
    fireEvent(window, new Event(studioChangeEvent));
    expect(await screen.findByText('Board offline')).toBeVisible();
    view.unmount();
    requests = [];
  });

  test('workflow setup failures remain visible and can be retried', async () => {
    vi.mocked(request)
      .mockRejectedValueOnce(new Error('Setup unavailable'))
      .mockResolvedValueOnce({});
    render(<EnableWorkflow />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Setup unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  test('scene layout keeps preparation, shot edits, prompt previews and exports in their scene', async () => {
    const clipTarget = {
      scope: 'clip' as const,
      recordId: 'episode',
      sceneId: 'scene',
      clipId: 'shot'
    };
    mount([], {
      layout: 'scenes',
      record: episode,
      groups: [
        {
          title: 'Episode planning',
          target: { scope: 'episode', recordId: 'episode' },
          stages: [
            reviewFixture({ stage: 'outline', target: { scope: 'episode', recordId: 'episode' } })
          ]
        },
        {
          title: 'Scene preparation',
          target,
          stages: [
            reviewFixture({ stage: 'script', status: 'approved', target }),
            reviewFixture({ stage: 'sound-plan', status: 'approved', target })
          ]
        },
        {
          title: 'Shot',
          target: clipTarget,
          stages: ['storyboard', 'animatic'].map((stage) =>
            reviewFixture({ stage, status: 'approved', target: clipTarget })
          )
        },
        {
          title: 'Export',
          target: { scope: 'episode', recordId: 'episode' },
          stages: [
            reviewFixture({ stage: 'export', target: { scope: 'episode', recordId: 'episode' } })
          ]
        }
      ],
      shotPrompts: [
        { sceneId: 'other', clipId: 'other', video: 'Other' },
        { sceneId: 'scene', clipId: 'shot', image: 'Portrait.', video: 'Hold still.' }
      ],
      voicePrompts: [
        { sceneId: 'other', clipId: 'shot', finalized: true },
        { sceneId: 'scene', clipId: 'other', finalized: true },
        { sceneId: 'scene', clipId: 'shot', speaker: 'HARKUN', finalized: true }
      ]
    });
    fireEvent.click(await screen.findByRole('link', { name: 'Scene 1: Welcome' }));
    expect(screen.getByRole('heading', { name: 'Scene 1: Welcome' })).toHaveFocus();
    fireEvent.click(screen.getByRole('link', { name: 'Edit this scene' }));
    fireEvent.change(screen.getAllByLabelText('Image generation prompt')[0], {
      target: { value: 'Revised first image.' }
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save scene' })[0]);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/studio/workflow/scene/save',
        expect.objectContaining({
          body: expect.objectContaining({
            scene: expect.objectContaining({
              clips: [
                expect.objectContaining({
                  production: expect.objectContaining({ imagePrompt: 'Revised first image.' })
                }),
                expect.anything()
              ]
            })
          })
        })
      )
    );
  });

  test('production issues and failed jobs expose the appropriate input links for every kind of target', async () => {
    const steps = [
      {
        kind: 'voice',
        resultAssetId: 'voice',
        target: { assetId: 'voice' },
        error: 'Voice failed'
      },
      { kind: 'dialogue', target: { sceneId: 'scene', clipId: 'shot' }, error: 'Dialogue failed' },
      {
        kind: 'image',
        target: { assetId: 'character', packageItemId: 'portrait' },
        error: 'Image failed'
      },
      { kind: 'image', target: { assetId: 'character' }, error: 'Brief missing' },
      { kind: 'music', target: { sceneId: 'scene' }, error: 'Music failed' },
      { kind: 'video', error: 'Unknown target' }
    ];
    const jobs = steps.map((step, index) => ({
      ...step,
      _id: 'job-' + index,
      title: 'Job ' + index,
      status: index % 2 ? 'uncertain' : 'failed'
    }));
    mount([], {
      blockedSteps: steps,
      jobs,
      automation: [
        {
          _id: 'failed',
          status: 'failed',
          target: { sceneId: 'other' },
          failures: [{ error: 'Unscoped failure' }]
        }
      ]
    });
    await screen.findAllByText(/Unknown target/);
    const links = screen.getAllByRole('link', {
      name: /Review inputs for|Edit dialogue for|Go to production jobs/
    });
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      expect.arrayContaining([
        '/?asset=voice',
        '#shot-dialogue-shot',
        '#music-scene',
        '#production-jobs'
      ])
    );
    for (const link of links) fireEvent.click(link);
    fireEvent.click(screen.getByRole('button', { name: 'Production jobs and retries' }));
    for (const link of screen.getAllByRole('link', { name: /Review inputs for/ }))
      fireEvent.click(link);
  });

  test('scene job issues link directly to the affected shot card', async () => {
    mount([], {
      layout: 'scenes',
      record: episode,
      groups: [],
      blockedSteps: [
        { kind: 'video', target: { sceneId: 'scene', clipId: 'shot' }, error: 'Video needs review' }
      ]
    });
    const link = await screen.findByRole('link', { name: 'Review inputs for Response' });
    expect(link).toHaveAttribute('href', '#picture-prerequisites-shot');
    fireEvent.click(link);
  });

  test('enabling a legacy board reports errors and can retry the same setup', async () => {
    mount([], { enabled: false });
    const enable = await screen.findByRole('button', {
      name: 'Enable approval workflow for this project'
    });
    vi.mocked(request).mockRejectedValueOnce(new Error('Enable unavailable'));
    fireEvent.click(enable);
    await screen.findByText('Enable unavailable');
    fireEvent.click(enable);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/studio/workflow/enable', { method: 'POST', body: {} })
    );
  });

  test('saved approval succeeds independently from a failed board refresh and explains the refresh failure', async () => {
    mount([
      reviewFixture({
        stage: 'script',
        title: 'Scene script',
        target,
        canApprove: true,
        status: 'pending-review'
      })
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Scene script Pending review' }));
    vi.mocked(request)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Board refresh offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Scene script' }));
    await screen.findByText('Could not refresh the saved production status. Try refreshing again.');
  });

  test.each(['reference:portrait', 'reference-plan:portrait', 'brief', 'animatic'])(
    'saved feedback opens the correctly scoped production conversation for %s',
    async (stage) => {
      const isAsset = stage !== 'animatic';
      const record = isAsset ? assetFixture({ _id: 'character', name: 'Harkun' }) : episode;
      const reviewTarget = isAsset
        ? { scope: 'asset' as const, recordId: 'character' }
        : { ...target, scope: 'clip' as const, clipId: 'shot' };
      mount(
        [
          reviewFixture({
            stage,
            title: 'Saved review',
            target: reviewTarget,
            status: 'needs-changes',
            lastAction: 'request-changes',
            feedback: 'Correct only this shot.',
            feedbackIsCurrent: false
          })
        ],
        {},
        record,
        isAsset ? 'asset' : 'episode'
      );
      const discuss = await screen.findByRole('button', { name: 'Discuss saved feedback' });
      vi.mocked(request).mockResolvedValueOnce({ chat: { _id: 'feedback-chat' } });
      fireEvent.click(discuss);
      await waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          '/studio/assistant/chats',
          expect.objectContaining({
            body: expect.objectContaining({
              context: isAsset
                ? {
                    assetId: 'character',
                    ...(stage === 'brief' ? {} : { packageItemId: 'portrait' })
                  }
                : { episodeId: 'episode', sceneId: 'scene', clipId: 'shot' }
            })
          })
        )
      );
      expect(JSON.parse(localStorage.getItem('roxy-chat-draft-feedback-chat')).text).toContain(
        'Correct only this shot.'
      );
    }
  );

  test.each(['storyboard', 'animatic'])(
    'whole-scene %s previews work without selecting an individual shot',
    async (stage) => {
      mount(
        [
          reviewFixture({
            stage,
            title: 'Whole scene',
            target,
            status: 'pending-review',
            retainedApproval: true,
            coveredByScene: true
          })
        ],
        {
          groups: [
            {
              title: 'Optional scene review',
              target,
              optional: true,
              stages: [
                reviewFixture({
                  stage,
                  title: 'Whole scene',
                  target,
                  status: 'pending-review',
                  retainedApproval: true,
                  coveredByScene: true
                })
              ]
            }
          ]
        }
      );
      await screen.findByText(/Optional whole-scene reviews/);
      expect(screen.getByText(/Your existing approval is retained/)).toBeVisible();
      expect(screen.getByText(/Covered by your current whole-scene approval/)).toBeVisible();
    }
  );

  test('outline and shot-plan reviews use their saved fallbacks without inventing dialogue', async () => {
    const record = episodeFixture({
      ...episode,
      premise: 'Premise fallback',
      production: {},
      scenes: [
        {
          ...episode.scenes[0],
          clips: [
            {
              id: 'silent',
              title: 'Silent',
              dialogue: undefined,
              production: { beats: 'He nods.' }
            }
          ]
        }
      ]
    });
    mount(
      [
        reviewFixture({
          key: 'outline',
          stage: 'outline',
          title: 'Outline',
          target: { scope: 'episode', recordId: 'episode' }
        }),
        reviewFixture({ key: 'shots', stage: 'shot-plan', title: 'Shot plan', target })
      ],
      {},
      record
    );
    expect(await screen.findByText('Premise fallback')).toBeVisible();
    expect(screen.getByText('Timed action: He nods.')).toBeVisible();
  });

  test.each([{ timingRepair: true }, { pendingDraft: true }])(
    'sound-plan review sends its stable approval fingerprint and displays a returned revision: %j',
    async (result) => {
      mount([
        reviewFixture({
          stage: 'sound-plan',
          title: 'Sound plan',
          target,
          status: 'pending-review',
          canApprove: true,
          approvalFingerprint: 'stable-sound'
        })
      ]);
      const approve = await screen.findByRole('button', { name: 'Approve Sound plan' });
      vi.mocked(request).mockResolvedValueOnce({
        ...result,
        message: 'A saved revision needs review',
        receipt: { feedback: 'Saved feedback' }
      });
      fireEvent.click(approve);
      await screen.findByText('A saved revision needs review');
      expect(request).toHaveBeenCalledWith(
        '/studio/workflow/review',
        expect.objectContaining({
          body: expect.objectContaining({ approvalFingerprint: 'stable-sound' })
        })
      );
      expect(screen.getByRole('link', { name: 'Go to timing draft' })).toBeVisible();
    }
  );

  test('a revised outline visibly blocks only its matching saved review', async () => {
    mount(
      [
        reviewFixture({
          stage: 'outline',
          title: 'Outline',
          target: { scope: 'episode', recordId: 'episode' },
          status: 'pending-review',
          canApprove: true
        })
      ],
      {
        proposals: [
          {
            _id: 'revision',
            status: 'pending',
            episodeId: 'episode',
            baseRevision: episode.revision,
            production: { outline: 'Changed outline' },
            text: 'Revised outline'
          }
        ]
      }
    );
    expect(await screen.findByText(/A revised draft is waiting above/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve Outline' })).toBeDisabled();
  });

  test('an asset source blocker links directly to editable evidence fields', async () => {
    mount(
      [
        reviewFixture({
          stage: 'source',
          title: 'Source evidence',
          status: 'blocked',
          target: { scope: 'asset', recordId: 'character' },
          blockers: ['Add source evidence.']
        })
      ],
      {},
      assetFixture({ _id: 'character' }),
      'asset'
    );
    fireEvent.click(await screen.findByRole('button', { name: /Source evidence/ }));
    const link = screen.getByRole('link', { name: 'Go to source evidence fields' });
    fireEvent.click(link);
    expect(link).toHaveAttribute('href', '#asset-production-inputs');
  });

  test('an approved automatic body turnaround can reopen its choice', async () => {
    const record = assetFixture({
      _id: 'character',
      production: { items: [{ id: 'body-turnaround', type: 'image', mediaId: 'portrait' }] },
      candidates: [{ id: 'body', title: 'Body', mediaIds: ['portrait'] }]
    });
    mount(
      [
        reviewFixture({
          stage: 'reference:body-turnaround',
          title: 'Body turnaround',
          target: { scope: 'asset', recordId: 'character' },
          automatic: true,
          status: 'approved'
        })
      ],
      {},
      record,
      'asset'
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Body turnaround Approved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unapprove body turnaround' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/studio/assets/character/reopen',
        expect.objectContaining({ body: expect.objectContaining({ candidateId: 'body' }) })
      )
    );
  });

  test('missing image error text, unfamiliar review states and clip blockers retain useful fallback controls', async () => {
    const record = assetFixture({
      _id: 'character',
      production: { items: [{ id: 'portrait', type: 'image' }] }
    });
    mount(
      [
        reviewFixture({
          stage: 'reference:portrait',
          title: 'Portrait',
          target: { scope: 'asset', recordId: 'character' }
        })
      ],
      {
        jobs: [
          {
            _id: 'job',
            kind: 'image',
            status: 'failed',
            target: { assetId: 'character', packageItemId: 'portrait' }
          }
        ],
        referencePrompts: [{ itemId: 'portrait', prompt: 'Portrait' }]
      },
      record,
      'asset'
    );
    expect(
      await screen.findByText('OpenArt returned no image. Check the generation history.')
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled();
  });

  test('job progress, automation and duplicate targets show current status with usable navigation', async () => {
    mount(
      [
        reviewFixture({
          stage: 'other',
          title: 'Legacy review',
          status: 'legacy-state' as never,
          target: { ...target, scope: 'clip', clipId: 'shot' },
          blockers: ['Correct inputs.']
        })
      ],
      {
        progress: {
          state: 'working',
          message: 'Preparing',
          proposalId: 'draft',
          chatId: 'chat',
          retrySteps: [{}]
        },
        automation: [
          { _id: 'running', status: 'running' },
          { _id: 'queued', status: 'queued' }
        ],
        nextSteps: [{ kind: 'video' }, { kind: 'image' }],
        jobs: [
          {
            _id: 'one',
            title: 'Ready job',
            kind: 'video',
            status: 'ready',
            target: { clipId: 'shot' },
            quote: { items: [{ totalCredits: 80 }] }
          },
          {
            _id: 'duplicate',
            title: 'Older job',
            kind: 'video',
            status: 'failed',
            target: { clipId: 'shot' }
          },
          {
            _id: 'failed',
            title: 'Failed',
            kind: 'image',
            status: 'failed',
            target: { clipId: 'prior' }
          },
          {
            _id: 'unknown',
            title: 'Unknown',
            kind: 'music',
            status: 'uncertain',
            target: { sceneId: 'scene' }
          }
        ],
        sourceEvidence: [
          { _id: 'missing', title: 'No captured frames' },
          { _id: 'empty', title: 'Empty packet', frames: [] }
        ]
      }
    );
    expect(await screen.findByRole('button', { name: 'Legacy review legacy-state' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Legacy review legacy-state' }));
    expect(screen.getByRole('link', { name: 'Go to shot images and inputs' })).toHaveAttribute(
      'href',
      '#shot-inputs-shot'
    );
    expect(screen.getByRole('button', { name: 'Retry failed requests (1)' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Start next production step (2 requests)' })
    ).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Go to proposed revision' })).toHaveAttribute(
      'href',
      '#proposal-draft'
    );
    expect(
      screen.getByRole('link', { name: 'Open story draft in production chat' })
    ).toHaveAttribute('href', '/?chat=chat');
    expect(screen.getByText(/Submission outcome unknown/)).toBeVisible();
    expect(screen.getByText(/Generation failed/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Production jobs and retries' }));
    expect(screen.getByText(/Quoted 80 list credits/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Saved gameplay evidence' }));
    expect(screen.getByText('No captured frames')).toBeVisible();
  });

  test('scene layout keeps additional whole-scene reviews in their own expandable group', async () => {
    mount([], {
      layout: 'scenes',
      record: episode,
      groups: [
        {
          title: 'Preparation',
          target,
          stages: [reviewFixture({ stage: 'script', target, status: 'approved' })]
        },
        {
          title: 'Optional composition',
          target,
          optional: true,
          stages: [reviewFixture({ stage: 'animatic', target })]
        }
      ]
    });
    fireEvent.click(await screen.findByText('Optional composition'));
    expect(
      screen.getAllByText(/Timed still-image preview with selected dialogue/).at(-1)
    ).toBeVisible();
  });

  test('background tabs, unrelated storage events and stale failed reads do not replace the current board', async () => {
    const view = mount([]);
    await screen.findByText(/Saving and approving do not generate media/);
    const count = vi.mocked(request).mock.calls.length;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    fireEvent.focus(window);
    fireEvent(window, new StorageEvent('storage', { key: 'unrelated' }));
    expect(request).toHaveBeenCalledTimes(count);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    let fail: (error: Error) => void;
    vi.mocked(request).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    fireEvent.focus(window);
    view.unmount();
    await act(async () => fail(new Error('Stale read')));
  });

  test('saved feedback without a shot or asset name uses the review title as its chat subject', async () => {
    mount([
      reviewFixture({
        title: 'Shared sound',
        stage: 'other',
        target: { ...target, sceneId: 'missing' },
        lastAction: 'request-changes',
        feedback: 'Adjust the ambience.'
      })
    ]);
    const discuss = await screen.findByRole('button', { name: 'Discuss saved feedback' });
    vi.mocked(request).mockResolvedValueOnce({ chat: { _id: 'feedback' } });
    fireEvent.click(discuss);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/studio/assistant/chats',
        expect.objectContaining({
          body: expect.objectContaining({ title: 'Requested changes: Shared sound' })
        })
      )
    );
  });

  test('a source review without saved ranges stays explicit about unverified evidence', async () => {
    mount(
      [
        reviewFixture({
          stage: 'source',
          title: 'Research',
          target: { scope: 'episode', recordId: 'episode' },
          status: 'pending-review'
        })
      ],
      {},
      episodeFixture({ ...episode, sourceReferences: undefined })
    );
    expect(await screen.findByText(/Select only ranges you reviewed/)).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
