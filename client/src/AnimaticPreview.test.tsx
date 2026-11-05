import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import AnimaticPreview from './AnimaticPreview.tsx';
import { assetFixture, mediaFixture, sceneFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';

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
  { _id: 'image0', kind: 'image' as const, originalName: 'arrival.png' },
  { _id: 'image1', kind: 'image' as const, originalName: 'reply.png' }
];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function mount(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <AnimaticPreview
        episodeId="e"
        scene={sceneFixture(scene)}
        assets={assets.map((value) => assetFixture(value))}
        media={media.map((value) => mediaFixture(value))}
        {...props}
      />
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
        scene={sceneFixture({
          ...scene,
          clips: scene.clips.map((c) => ({ ...c, dialogue: 'ROXY: Hello.' }))
        })}
        assets={assets.map((value) => assetFixture(value))}
        media={media.map((value) => mediaFixture(value))}
      />
    </ThemeProvider>
  );
  expect(screen.getByRole('button', { name: 'Play preview' })).toBeDisabled();
});

test('selected dialogue plays at the shot offset, pauses and completes at the scene boundary', async () => {
  vi.useFakeTimers();
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
  mount({
    scene: sceneFixture({
      ...scene,
      clips: scene.clips.map((clip) => ({
        ...clip,
        dialogue: 'ROXY: Hello.',
        selectedDialogueId: 'voice'
      }))
    })
  });
  fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(play).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(2200));
  expect(
    (screen.getByLabelText('Selected dialogue preview') as HTMLAudioElement).currentTime
  ).toBeCloseTo(0.2);
  fireEvent.click(screen.getByRole('button', { name: 'Pause preview' }));
  expect(pause).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByRole('button', { name: 'Play preview' })).toBeEnabled();
  expect(screen.getByText('Arrival · 0.0 / 5s')).toBeVisible();
});

test('a browser audio denial explains recovery, and a rejected play after pause stays cancelled', async () => {
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockRejectedValueOnce(new Error('Gesture required'));
  mount({
    scene: sceneFixture({
      ...scene,
      clips: [{ ...scene.clips[0], dialogue: 'ROXY: Hello.', selectedDialogueId: 'voice' }]
    })
  });
  fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
  await screen.findByText(/Audio playback needs a user gesture/);
  let reject: (error: Error) => void;
  play.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pause preview' }));
  await act(async () => reject(new Error('Cancelled play')));
  expect(screen.queryByText(/Audio playback needs a user gesture/)).not.toBeInTheDocument();
});

test('empty scenes and archived or unselected shot images cannot start playback', () => {
  const view = mount({ scene: sceneFixture(), assets: [] });
  expect(screen.getByRole('button', { name: 'Play preview' })).toBeDisabled();
  view.unmount();
  mount({
    assets: [
      assetFixture({ ...assets[0], archived: true }),
      assetFixture({ ...assets[0], episodeId: 'other' }),
      assetFixture({ ...assets[0], sceneId: 'other' }),
      assetFixture({ ...assets[0], finalChoice: null })
    ],
    showShotList: false
  });
  expect(screen.getByRole('button', { name: 'Play preview' })).toBeDisabled();
  expect(screen.queryByText('Arrival · 2s')).not.toBeInTheDocument();
});
