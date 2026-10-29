import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { request, uploadMedia } from './api.js';
import NativeVideoImport from './NativeVideoImport.jsx';
import { pendingVideoChoices } from './studio-utils.js';
import { theme } from './theme.js';
vi.mock('./api.js', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));
const file = { _id: 'new-1080', kind: 'video', originalName: 'fleet-1080.mp4' };
const episode = { _id: 'episode', revision: 61 };
test('a corrected take remains pending beside an approved selection, then leaves pending after its review', () => {
  const media = [
    { _id: 'old', kind: 'video' },
    {
      ...file,
      videoReview: { state: 'pending', episodeId: 'episode', sceneId: 'arrival', clipId: 'fleet' }
    }
  ];
  const e = {
    ...episode,
    scenes: [
      {
        id: 'arrival',
        clips: [
          {
            id: 'fleet',
            takeIds: ['old', file._id],
            selectedTakeId: 'old',
            pictureApprovalStatus: 'approved'
          }
        ]
      }
    ]
  };
  expect(pendingVideoChoices(e, media)).toHaveLength(1);
  media[1].videoReview.state = 'approved';
  expect(pendingVideoChoices(e, media)).toHaveLength(0);
});
beforeEach(() => {
  vi.mocked(request).mockReset();
  vi.mocked(uploadMedia).mockResolvedValue(file);
});
const mount = (onSaved = vi.fn()) =>
  render(
    <ThemeProvider theme={theme}>
      <NativeVideoImport
        episode={episode}
        scene={{ id: 'arrival' }}
        clip={{ id: 'fleet' }}
        onSaved={onSaved}
        onMedia={vi.fn()}
      />
    </ThemeProvider>
  );
test('native import waits for server verification and confirms linking without selecting or approving a take', async () => {
  const onSaved = vi.fn();
  let finish;
  vi.mocked(request).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  mount(onSaved);
  await userEvent.upload(
    screen.getByLabelText('Import native 1080p video'),
    new File(['video'], 'fleet-1080.mp4', { type: 'video/mp4' })
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/studio/workflow/video/import',
      expect.objectContaining({
        body: {
          target: { scope: 'clip', recordId: 'episode', sceneId: 'arrival', clipId: 'fleet' },
          parentRevision: 61,
          mediaId: 'new-1080'
        }
      })
    )
  );
  expect(screen.getByText(/Keep this page open/)).toBeVisible();
  expect(onSaved).not.toHaveBeenCalled();
  finish({
    episode: { ...episode, revision: 62 },
    media: file,
    message:
      '1080p video imported and verified. Review this take before approving it; your previous selection is unchanged.'
  });
  expect(await screen.findByText(/1080p video imported and verified/)).toBeVisible();
  expect(onSaved).toHaveBeenCalledWith({ ...episode, revision: 62 });
  expect(request).toHaveBeenCalledTimes(1);
});
test('a failed native import shows the validation error and never claims success', async () => {
  vi.mocked(request).mockRejectedValue(
    new Error('Import the native 1920 × 1080 video; this file is 854 × 480.')
  );
  mount();
  await userEvent.upload(
    screen.getByLabelText('Import native 1080p video'),
    new File(['video'], 'fleet.mp4', { type: 'video/mp4' })
  );
  expect(await screen.findByText(/this file is 854 × 480/)).toBeVisible();
  expect(screen.queryByText(/imported and verified/)).not.toBeInTheDocument();
});
