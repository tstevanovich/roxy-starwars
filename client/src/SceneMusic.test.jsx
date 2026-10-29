import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { request } from './api.js';
import SceneMusic from './SceneMusic.jsx';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn() }));
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
  await user.click(screen.getByRole('button', { name: 'Approve brief & generate one cue' }));
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
});
