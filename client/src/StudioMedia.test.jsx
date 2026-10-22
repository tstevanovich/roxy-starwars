import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { request } from './api.js';
import MediaLibrary from './StudioMedia.jsx';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));

test('audio files in the media library can be rejected and deleted', async () => {
  const user = userEvent.setup();
  const result = { deletedMediaId: 'eleven-audio' };
  vi.mocked(request).mockResolvedValue(result);
  const onRejected = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <MediaLibrary
        media={[
          {
            _id: 'eleven-audio',
            kind: 'audio',
            originalName: 'ElevenLabs-audition.mp3',
            bytes: 100
          }
        ]}
        onMedia={vi.fn()}
        onRejected={onRejected}
      />
    </ThemeProvider>
  );
  expect(screen.getByLabelText('ElevenLabs-audition.mp3')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Reject & delete' }));
  expect(request).toHaveBeenCalledWith('/studio/media/eleven-audio', {
    method: 'DELETE',
    body: {}
  });
  expect(onRejected).toHaveBeenCalledWith(result);
});
