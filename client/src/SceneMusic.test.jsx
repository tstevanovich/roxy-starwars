import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { request } from './api.js';
import SceneMusic from './SceneMusic.jsx';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn() }));
test('completed music shows the approved track status without asking to approve generation again', async () => {
  vi.mocked(request).mockResolvedValue({
    cue: { enabled: true, prompt: 'Saved music', bufferSeconds: 5, candidates: [] },
    defaults: { prompt: 'Saved music' },
    targetSeconds: 37,
    planReview: { status: 'approved', blockers: [] },
    takeReview: { status: 'approved', blockers: [] },
    jobs: []
  });
  render(
    <ThemeProvider theme={theme}>
      <SceneMusic
        episode={{ _id: 'episode' }}
        scene={{ id: 'arrival' }}
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
    fingerprint: 'current',
    planReview: { status: 'approved', blockers: [] },
    takeReview: { status: 'approved', blockers: [] },
    jobs: []
  });
  try {
    render(
      <ThemeProvider theme={theme}>
        <SceneMusic
          episode={{ _id: 'episode' }}
          scene={{ id: 'scene' }}
          dirty={false}
          busy={false}
        />
      </ThemeProvider>
    );
    const link = await screen.findByRole('link', { name: 'Download scene-length audio' });
    const url = new URL(link.href);
    expect(url.searchParams.get('project')).toBe('old-republic-sith-inquisitor');
    expect(url.searchParams.get('download')).toBe('1');
  } finally {
    window.history.replaceState({}, '', '/');
  }
});
test('shows complete prompt, bounded duration and one-output estimate; approval uses the saved workflow gate', async () => {
  const target = { scope: 'scene', recordId: 'episode', sceneId: 'arrival' };
  const prompt =
    'Complete original instrumental prompt. Begin immediately; continue through 42 seconds. No early fade.';
  const row = {
    target,
    stage: 'music-plan',
    fingerprint: 'saved-brief',
    parentRevision: 60,
    reviewRevision: 0,
    status: 'pending-review',
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
    takeReview: { ...row, stage: 'music', status: 'draft', canApprove: false },
    jobs: []
  };
  vi.mocked(request).mockImplementation(async (url) => (url.endsWith('/review') ? {} : data));
  const user = userEvent.setup();
  render(
    <ThemeProvider theme={theme}>
      <SceneMusic
        episode={{ _id: 'episode' }}
        scene={{ id: 'arrival' }}
        dirty={false}
        busy={false}
      />
    </ThemeProvider>
  );
  expect(await screen.findByLabelText('Complete background music prompt')).toHaveValue(prompt);
  expect(screen.getByText(/Scene: 37 seconds. Generate: 42 seconds/)).toHaveTextContent(
    '630 credits'
  );
  await user.click(screen.getByRole('button', { name: 'Generate music' }));
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
  expect(vi.mocked(request).mock.calls.some(([url]) => url.endsWith('/music/generate'))).toBe(true);
});
