import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { request, uploadMedia } from './api.ts';
import SourceVideoImport from './SourceVideoImport.tsx';
import { mediaFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';
vi.mock('./api.ts', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));
test('source upload saves the original timeline mapping and confirms the actual filename', async () => {
  const file = mediaFixture({
    _id: 'source-copy',
    kind: 'video' as const,
    originalName: 'Initial-Trials.mp4'
  });
  vi.mocked(uploadMedia).mockResolvedValue(file);
  vi.mocked(request).mockResolvedValue({
    media: file,
    message: 'Source video saved with its original-video timestamp mapping.'
  });
  render(
    <ThemeProvider theme={theme}>
      <SourceVideoImport episodeId="episode" sourceId="trials" onMedia={vi.fn()} />
    </ThemeProvider>
  );
  const user = userEvent.setup(),
    start = screen.getByLabelText('Original-video timestamp of this file’s first frame');
  await user.clear(start);
  await user.type(start, '16:47.160');
  await user.upload(
    screen.getByLabelText('Attach gameplay source video'),
    new File(['video'], 'Initial-Trials.mp4', { type: 'video/mp4' as const })
  );
  expect(request).toHaveBeenCalledWith('/studio/assistant/source-video', {
    method: 'POST',
    body: {
      episodeId: 'episode',
      sourceId: 'trials',
      mediaId: 'source-copy',
      originalStartTime: '16:47.160'
    }
  });
  expect(await screen.findByText(/Initial-Trials.mp4: Source video saved/)).toBeVisible();
});
