import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { uploadMedia } from './api.js';
import { theme } from './theme.js';
import UpscaleImport from './UpscaleImport.jsx';

vi.mock('./api.js', () => ({ uploadMedia: vi.fn() }));
const clip = { id: 'shot', title: 'Canyon flight', selectedTakeId: 'original', production: {} };
const file = { _id: 'upscaled', kind: 'video', originalName: 'Canyon-1440p.mp4' };
const mount = (props = {}) =>
  render(
    <ThemeProvider theme={theme}>
      <UpscaleImport
        clip={clip}
        media={[file]}
        episodeId="episode"
        sceneId="arrival"
        onImport={vi.fn()}
        showReviewLink
        {...props}
      />
    </ThemeProvider>
  );
beforeEach(() => vi.mocked(uploadMedia).mockReset());

test('an upscale request alone is never shown as an imported file, and missing references do not claim success', () => {
  const view = mount({ clip: { ...clip, upscale: { status: 'waiting-provider' } } });
  expect(screen.getByText('No upscale imported for this clip')).toBeVisible();
  expect(screen.queryByText(/Upscale file saved/)).not.toBeInTheDocument();
  view.rerender(
    <ThemeProvider theme={theme}>
      <UpscaleImport
        clip={{
          ...clip,
          production: { upscaleMediaId: 'missing', upscaleSourceTakeId: 'original' }
        }}
        media={[file]}
      />
    </ThemeProvider>
  );
  expect(screen.getByText('Upscale file missing or belongs to an older take')).toBeVisible();
});

test('upload stays busy until validation and linking finish, then confirms the saved filename and links to quality review', async () => {
  const user = userEvent.setup();
  let finish;
  const onImport = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  vi.mocked(uploadMedia).mockResolvedValue(file);
  mount({ onImport });
  const input = screen.getByLabelText('Import 1440p video file');
  await user.upload(input, new File(['video'], 'Canyon-1440p.mp4', { type: 'video/mp4' }));
  await waitFor(() => expect(onImport).toHaveBeenCalledWith('arrival', 'shot', file));
  expect(screen.getByText(/Keep this page open/)).toBeVisible();
  expect(screen.queryByText(/Upscale file saved/)).not.toBeInTheDocument();
  finish({ importedAt: '2026-10-24T17:00:00Z' });
  expect(await screen.findByText('Upscale file saved — quality approval pending')).toBeVisible();
  expect(screen.getByText('Saved file: Canyon-1440p.mp4')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Go to 1440p quality approval' })).toHaveAttribute(
    'href',
    '#review-clip--episode--arrival--shot--upscale'
  );
});

test('failed linking reports the error and never claims an imported upscale', async () => {
  vi.mocked(uploadMedia).mockResolvedValue(file);
  const onImport = vi.fn().mockRejectedValue(new Error('Import a 2560 × 1440 video.'));
  mount({ onImport });
  await userEvent.upload(
    screen.getByLabelText('Import 1440p video file'),
    new File(['video'], 'clip.mp4', { type: 'video/mp4' })
  );
  expect(await screen.findByText('Import a 2560 × 1440 video.')).toBeVisible();
  expect(screen.getByText('No upscale imported for this clip')).toBeVisible();
});

test('saved imports remain identified after reload and quality approval is a separate state', () => {
  mount({
    clip: {
      ...clip,
      production: { upscaleMediaId: file._id, upscaleSourceTakeId: 'original' },
      upscale: {
        importedAt: '2026-10-24T17:00:00Z',
        verified: { width: 2562, height: 1440, duration: 12.028, audio: true }
      },
      upscaleReview: { status: 'approved' }
    }
  });
  expect(screen.getByText('1440p upscale approved')).toBeVisible();
  expect(screen.getByText(/Verified: 2562 × 1440.*12.03 seconds/)).toBeVisible();
  expect(screen.getByText(/no episode save is required/)).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'Go to 1440p quality approval' })
  ).not.toBeInTheDocument();
});
