import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { request, uploadMedia } from './api.js';
import SourceVideoImport from './SourceVideoImport.jsx';
import { theme } from './theme.js';
vi.mock('./api.js', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));
test('source upload saves the original timeline mapping and confirms the actual filename', async () => {
  const file = { _id: 'source-copy', kind: 'video', originalName: 'Initial-Trials.mp4' };
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
    new File(['video'], 'Initial-Trials.mp4', { type: 'video/mp4' })
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
