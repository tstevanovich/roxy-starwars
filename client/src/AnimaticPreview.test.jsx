import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import AnimaticPreview from './AnimaticPreview.jsx';
import { theme } from './theme.js';

const scene = {
  id: 's',
  clips: [
    { id: 'one', title: 'Arrival', duration: 2, camera: 'Wide', dialogue: '' },
    { id: 'two', title: 'Reply', duration: 3, camera: 'Close', dialogue: '' }
  ]
};
const assets = scene.clips.map((c, i) => ({
  episodeId: 'e',
  sceneId: 's',
  clipId: c.id,
  finalChoice: { mediaIds: ['image' + i] }
}));
const media = [
  { _id: 'image0', kind: 'image', originalName: 'arrival.png' },
  { _id: 'image1', kind: 'image', originalName: 'reply.png' }
];
afterEach(() => vi.useRealTimers());
function mount(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <AnimaticPreview episodeId="e" scene={scene} assets={assets} media={media} {...props} />
    </ThemeProvider>
  );
}
test('animatic uses shot durations, advances stills and resets without autoplaying', () => {
  vi.useFakeTimers();
  mount();
  expect(screen.getByText('Arrival · 0.0 / 5s')).toBeVisible();
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText('Arrival · 0.0 / 5s')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
  act(() => vi.advanceTimersByTime(2200));
  expect(screen.getByText('Reply · 2.2 / 5s')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Reset preview' }));
  expect(screen.getByText('Arrival · 0.0 / 5s')).toBeVisible();
});
test('storyboard does not offer timed playback; missing dialogue prevents animatic playback', () => {
  const view = mount({ playable: false });
  expect(screen.queryByRole('button', { name: 'Play preview' })).not.toBeInTheDocument();
  view.rerender(
    <ThemeProvider theme={theme}>
      <AnimaticPreview
        episodeId="e"
        scene={{ ...scene, clips: scene.clips.map((c) => ({ ...c, dialogue: 'ROXY: Hello.' })) }}
        assets={assets}
        media={media}
      />
    </ThemeProvider>
  );
  expect(screen.getByRole('button', { name: 'Play preview' })).toBeDisabled();
});
