import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type * as Studio from '../../shared/types.ts';
import { request } from './api.ts';
import SceneMusic from './SceneMusic.tsx';
import { episodeFixture, reviewFixture, sceneFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';

vi.mock('./api.ts', () => ({ request: vi.fn() }));

describe('component behavior', () => {
  test('completed music shows the approved track status without asking to approve generation again', async () => {
    vi.mocked(request).mockResolvedValue({
      cue: { enabled: true, prompt: 'Saved music', bufferSeconds: 5, candidates: [] },
      defaults: { prompt: 'Saved music' },
      targetSeconds: 37,
      planReview: { status: 'approved' as const, blockers: [] },
      takeReview: { status: 'approved' as const, blockers: [] },
      jobs: []
    });
    render(
      <ThemeProvider theme={theme}>
        <SceneMusic
          episode={episodeFixture({ _id: 'episode' })}
          scene={sceneFixture({ id: 'arrival' })}
          dirty={false}
          busy={false}
        />
      </ThemeProvider>
    );
    expect(
      await screen.findByText(
        'Approved music covers this 37-second scene. No new generation is needed.'
      )
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Generate music' })).not.toBeInTheDocument();
  });

  test('music downloads preserve both the active project and attachment query', async () => {
    window.history.replaceState({}, '', '/?project=old-republic-sith-inquisitor');
    vi.mocked(request).mockResolvedValue({
      cue: {
        enabled: true,
        prompt: 'Saved cue',
        bufferSeconds: 5,
        selectedMediaId: 'music',
        candidates: [
          {
            id: 'choice',
            mediaIds: ['music'],
            sourceMediaId: 'original',
            fingerprint: 'current',
            qc: { passed: true, preparedSeconds: 37, leadingSeconds: 0, trailingSeconds: 0 }
          }
        ]
      },
      defaults: { prompt: 'Saved cue' },
      targetSeconds: 37,
      fingerprint: 'new-stable-fingerprint',
      currentCandidateIds: ['choice'],
      planReview: { status: 'approved' as const, blockers: [] },
      takeReview: { status: 'approved' as const, blockers: [] },
      jobs: []
    });
    try {
      render(
        <ThemeProvider theme={theme}>
          <SceneMusic
            episode={episodeFixture({ _id: 'episode' })}
            scene={sceneFixture({ id: 'scene' })}
            dirty={false}
            busy={false}
          />
        </ThemeProvider>
      );
      const link = await screen.findByRole('link', { name: 'Download scene-length audio' });
      const url = new URL((link as HTMLAnchorElement).href);
      expect(url.searchParams.get('project')).toBe('old-republic-sith-inquisitor');
      expect(url.searchParams.get('download')).toBe('1');
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });

  test('shows complete prompt, bounded duration and one-output estimate; approval uses the saved workflow gate', async () => {
    const target = { scope: 'scene' as const, recordId: 'episode', sceneId: 'arrival' };
    const prompt =
      'Complete original instrumental prompt. Begin immediately; continue through 42 seconds. No early fade.';
    const row = {
      target,
      stage: 'music-plan',
      fingerprint: 'saved-brief',
      parentRevision: 60,
      reviewRevision: 0,
      status: 'pending-review' as Studio.ReviewStatus,
      canApprove: true,
      blockers: []
    };
    const data = {
      cue: { revision: 0, prompt, enabled: true, bufferSeconds: 5, candidates: [] },
      keyConfigured: true,
      defaults: { prompt },
      targetSeconds: 37,
      fingerprint: 'music-inputs',
      planReview: row,
      takeReview: { ...row, stage: 'music', status: 'draft' as const, canApprove: false },
      jobs: []
    };
    vi.mocked(request).mockImplementation(async (url) => {
      if (url.endsWith('/review')) {
        data.planReview = { ...row, status: 'approved' as const };
        return {};
      }
      return data;
    });
    const user = userEvent.setup();
    render(
      <ThemeProvider theme={theme}>
        <SceneMusic
          episode={episodeFixture({ _id: 'episode' })}
          scene={sceneFixture({ id: 'arrival' })}
          dirty={false}
          busy={false}
        />
      </ThemeProvider>
    );
    expect(await screen.findByLabelText('Complete background music prompt')).toHaveValue(prompt);
    expect(screen.getByText(/Scene: 37 seconds. Generate: 42 seconds/)).toHaveTextContent(
      '630 credits'
    );
    await user.click(screen.getByRole('button', { name: 'Approve music brief' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/studio/workflow/review',
        expect.objectContaining({
          body: expect.objectContaining({
            stage: 'music-plan',
            action: 'approve',
            fingerprint: 'saved-brief'
          })
        })
      )
    );
    expect(vi.mocked(request).mock.calls.some(([url]) => url.endsWith('/music/generate'))).toBe(
      false
    );
    await user.click(await screen.findByRole('button', { name: 'Generate music' }));
    await waitFor(() =>
      expect(
        vi.mocked(request).mock.calls.filter(([url]) => url.endsWith('/music/generate'))
      ).toHaveLength(1)
    );
  });
});

describe('music editing and review', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset();
  });

  afterEach(() => vi.useRealTimers());

  const episode = episodeFixture(),
    scene = sceneFixture({ id: 'arrival', title: 'Arrival', clips: [{ duration: 20 }] });

  function status(value: Partial<Studio.MusicStatus> = {}): Studio.MusicStatus {
    return {
      defaults: { prompt: 'Original orchestral score.', model: 'music', bufferSeconds: 5 },
      jobs: [],
      planReview: reviewFixture({
        target: { scope: 'scene', recordId: episode._id, sceneId: scene.id },
        stage: 'music-plan',
        status: 'pending-review',
        canApprove: true,
        fingerprint: 'brief',
        parentRevision: 2,
        reviewRevision: 3
      }),
      takeReview: reviewFixture({ status: 'pending-review' }),
      targetSeconds: 20,
      generatedSeconds: 25,
      estimatedCredits: 375,
      media: [],
      candidates: [],
      ...value
    };
  }

  function cue(value: Partial<Studio.MusicCue> = {}): Studio.MusicCue {
    return {
      _id: 'cue',
      revision: 3,
      enabled: true,
      prompt: 'Saved score.',
      bufferSeconds: 5,
      candidates: [],
      ...value
    } as Studio.MusicCue;
  }

  const option = {
    id: 'audition',
    title: 'Audition',
    mediaIds: ['music'],
    sourceMediaId: 'original',
    fingerprint: 'current',
    qc: { passed: true, preparedSeconds: 20, leadingSeconds: 0, trailingSeconds: 0 }
  };

  function mount(props: Partial<Parameters<typeof SceneMusic>[0]> = {}) {
    return render(<SceneMusic episode={episode} scene={scene} {...props} />);
  }

  test('prepares an edited music brief, rebuilds it from timing, and can remove the music requirement', async () => {
    let data = status();
    const onReload = vi.fn();
    vi.mocked(request).mockImplementation(async (path, options) => {
      if (path.endsWith('/plan'))
        data = { ...data, cue: cue(options.body as Partial<Studio.MusicCue>) };
      return data;
    });
    mount({ onReload });
    const prompt = await screen.findByLabelText('Complete background music prompt');
    fireEvent.change(prompt, { target: { value: 'Quiet horns and strings.' } });
    fireEvent.change(screen.getByLabelText('Extra seconds for silence allowance'), {
      target: { value: '3' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare music brief' }));
    await screen.findByText(/Music brief saved/);
    expect(request).toHaveBeenCalledWith('/studio/assistant/music/plan', {
      method: 'POST',
      body: {
        episodeId: 'episode',
        sceneId: 'arrival',
        cueRevision: undefined,
        prompt: 'Quiet horns and strings.',
        bufferSeconds: 3,
        enabled: true
      }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Rebuild complete prompt from scene timing' })
    );
    expect(prompt).not.toHaveValue('Quiet horns and strings.');
    expect((prompt as HTMLTextAreaElement).value).toContain('20');
    expect(screen.getByRole('button', { name: 'Approve music brief' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save music brief' }));
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Remove music requirement' }));
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith(expect.stringContaining('/music?episodeId='))
    );
    expect(
      vi
        .mocked(request)
        .mock.calls.filter(([path]) => path.endsWith('/plan'))
        .at(-1)[1].body
    ).toMatchObject({ enabled: false, cueRevision: 3 });
    const { unmount } = render(<section id="episode-top" aria-label="Episode top" tabIndex={-1} />);
    const top = screen.getByRole('region', { name: 'Episode top' });
    fireEvent.click(screen.getByRole('button', { name: 'Back to episode top' }));
    expect(top).toHaveFocus();
    unmount();
  });

  test('approves an individual music audition, cancels deletion, then rejects it explicitly', async () => {
    let data = status({
      cue: cue({ candidates: [option] }),
      fingerprint: 'current',
      planReview: reviewFixture({ status: 'approved' }),
      takeReview: reviewFixture({
        target: { scope: 'scene', recordId: 'episode', sceneId: 'arrival' },
        fingerprint: 'take',
        parentRevision: 2,
        reviewRevision: 1,
        canApprove: true
      })
    });
    vi.mocked(request).mockImplementation(async (path) => {
      if (path.endsWith('/review'))
        data = {
          ...data,
          takeReview: { ...data.takeReview, status: 'approved' },
          cue: { ...data.cue, selectedMediaId: 'music' }
        };
      if (path.endsWith('/reject')) data = { ...data, cue: { ...data.cue, candidates: [] } };
      return data;
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve this music take' }));
    await screen.findByText('Music take approved. Download it separately for this section.');
    expect(request).toHaveBeenCalledWith('/studio/workflow/review', {
      method: 'POST',
      body: {
        target: data.takeReview.target,
        stage: 'music',
        action: 'approve',
        fingerprint: 'take',
        parentRevision: 2,
        reviewRevision: 1,
        musicMediaId: 'music'
      }
    });
    expect(screen.getByText('Approved', { exact: true })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reject and delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.queryByRole('button', { name: 'Delete this music take' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reject and delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this music take' }));
    await screen.findByText('Rejected music and its original audio deleted.');
    expect(request).toHaveBeenCalledWith('/studio/assistant/music/reject', {
      method: 'POST',
      body: { episodeId: 'episode', sceneId: 'arrival', cueRevision: 3, candidateId: 'audition' }
    });
    expect(screen.queryByLabelText('Music audition 1')).not.toBeInTheDocument();
  });

  test('shows failed jobs, credit receipts, incomplete audio and stale candidates without allowing their approval', async () => {
    vi.mocked(request).mockResolvedValue(
      status({
        keyConfigured: false,
        cue: cue({
          candidates: [
            {
              ...option,
              fingerprint: 'old',
              qc: { ...option.qc, passed: false, audibleSeconds: 12.5 }
            }
          ]
        }),
        fingerprint: 'current',
        planReview: reviewFixture({ blockers: ['Review the complete music brief.'] }),
        automation: [
          { _id: 'failed', status: 'failed', error: 'Provider unavailable' },
          { _id: 'done', status: 'ready' }
        ],
        jobs: ['queued', 'failed', 'ready', 'uncertain'].map((state, index) => ({
          _id: state,
          status: state,
          error: state === 'failed' ? 'Timed out' : '',
          receipt: index ? { creditsCharged: 10 } : undefined
        })) as Studio.Job[]
      })
    );
    mount({ dirty: true });
    await screen.findByText('Earlier brief');
    expect(screen.getByRole('button', { name: 'Approve this music take' })).toBeDisabled();
    expect(screen.getByText(/Save the episode before working on its music timing/)).toBeVisible();
    expect(screen.getByText('Review the complete music brief.')).toBeVisible();
    expect(screen.getByText(/ElevenLabs API key is not configured/)).toBeVisible();
    expect(screen.getByText(/Music submission failed: Provider unavailable/)).toBeVisible();
    expect(screen.getByText(/Insufficient audible music: 12.50 seconds/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Download available audio' })).toHaveAttribute(
      'download'
    );
    expect(screen.getAllByText(/10 credits reported/)).toHaveLength(3);
  });

  test('failed music mutations keep the cue available for retry', async () => {
    vi.mocked(request).mockResolvedValue(
      status({ cue: cue(), planReview: reviewFixture({ status: 'approved' }) })
    );
    mount();
    const generate = await screen.findByRole('button', { name: 'Generate music' });
    vi.mocked(request).mockRejectedValueOnce(new Error('Provider quota reached'));
    fireEvent.click(generate);
    expect(await screen.findByText('Provider quota reached')).toBeVisible();
    expect(generate).toBeEnabled();
  });

  test.each([{}, { defaults: {}, jobs: null }])(
    'invalid music status explains recovery instead of showing empty controls: %j',
    async (response) => {
      vi.mocked(request).mockResolvedValue(response);
      mount();
      expect(await screen.findByRole('alert')).toHaveTextContent('Music status is unavailable.');
    }
  );

  test('polling preserves local prompt edits until save and stops on unmount', async () => {
    vi.useFakeTimers();
    vi.mocked(request).mockResolvedValue(status({ cue: cue() }));
    const view = mount();
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.change(screen.getByLabelText('Complete background music prompt'), {
      target: { value: 'My local prompt' }
    });
    await act(async () => vi.advanceTimersByTime(5000));
    expect(screen.getByLabelText('Complete background music prompt')).toHaveValue(
      'My local prompt'
    );
    const count = vi.mocked(request).mock.calls.length;
    view.unmount();
    await act(async () => vi.advanceTimersByTime(5000));
    expect(request).toHaveBeenCalledTimes(count);
  });

  test.each(['resolve', 'reject'])(
    'late music status %s does not restore an unmounted editor',
    async (outcome) => {
      let finish: (value: unknown) => void;
      vi.mocked(request).mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            finish = outcome === 'resolve' ? resolve : reject;
          })
      );
      const view = mount();
      view.unmount();
      await act(async () => finish(outcome === 'resolve' ? status() : new Error('Disconnected')));
      expect(screen.queryByLabelText('Complete background music prompt')).not.toBeInTheDocument();
    }
  );
});
