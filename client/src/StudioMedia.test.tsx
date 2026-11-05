import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { request, uploadMedia } from './api.ts';
import MediaLibrary, { MediaAttachments, UploadButton } from './StudioMedia.tsx';
import { mediaFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';

vi.mock('./api.ts', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));

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
            kind: 'audio' as const,
            originalName: 'ElevenLabs-audition.mp3',
            bytes: 100
          }
        ].map((value) => mediaFixture(value))}
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

test('media filters and filename search show only matching originals and preserve project download URLs', () => {
  history.replaceState(null, '', '/?project=sith');
  const view = render(
    <MediaLibrary
      media={[
        mediaFixture({ _id: 'image', originalName: 'Portrait.png' }),
        mediaFixture({ _id: 'video', originalName: 'Scene.mp4', kind: 'video' }),
        mediaFixture({ _id: 'audio', originalName: 'Voice.wav', kind: 'audio' })
      ]}
      onMedia={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Video' }));
  expect(screen.getByLabelText('Scene.mp4')).toBeVisible();
  expect(screen.queryByAltText('Portrait.png')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download original' })).toHaveAttribute(
    'href',
    '/api/studio/media/video?project=sith&download=1'
  );
  fireEvent.click(screen.getByRole('button', { name: 'All files' }));
  fireEvent.change(screen.getByLabelText('Search filenames'), { target: { value: 'PORTRAIT' } });
  expect(screen.getByAltText('Portrait.png')).toBeVisible();
  expect(screen.queryByLabelText('Scene.mp4')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search filenames'), { target: { value: 'missing' } });
  expect(screen.getByText('Make room for your references.')).toBeVisible();
  view.unmount();
  history.replaceState(null, '', '/');
});

test('attachment controls add a saved file and detach a missing reference without deleting other files', () => {
  const onChange = vi.fn();
  render(
    <MediaAttachments
      ids={['missing', 'existing']}
      media={[
        mediaFixture({ _id: 'new', originalName: 'New.png' }),
        mediaFixture({ _id: 'existing', originalName: 'Existing.png' })
      ]}
      onChange={onChange}
      onUploaded={vi.fn()}
    />
  );
  expect(screen.getByText('Missing reference')).toBeVisible();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Attach saved media' }));
  fireEvent.click(within(screen.getByRole('listbox')).getByText('New.png'));
  expect(onChange).toHaveBeenLastCalledWith(['missing', 'existing', 'new']);
  fireEvent.click(screen.getAllByRole('button', { name: 'Detach' })[0]);
  expect(onChange).toHaveBeenLastCalledWith(['existing']);
});

test('cancelling the file picker does not attempt an upload', () => {
  vi.mocked(uploadMedia).mockReset();
  render(<UploadButton onUploaded={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Upload reference'), { target: { files: [] } });
  expect(uploadMedia).not.toHaveBeenCalled();
});
