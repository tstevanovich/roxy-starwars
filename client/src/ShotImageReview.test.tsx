import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.ts';
import ShotImageReview from './ShotImageReview.tsx';
import { assetFixture, mediaFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';

vi.mock('./api.ts', () => ({ request: vi.fn() }));
const asset = {
  _id: 'shot',
  name: 'Scene 2 · Clip 2 image',
  brief: 'Parked cockpit, Al looks toward Roxy.',
  revision: 3,
  finalChoice: null,
  candidates: [
    {
      id: 'a',
      title: 'Al close-up',
      description: 'Fixed window view.',
      mediaIds: ['one'],
      archived: false
    },
    {
      id: 'b',
      title: 'Al over-shoulder',
      description: 'Roxy remains offscreen.',
      mediaIds: ['two'],
      archived: false
    }
  ]
};
const media = [
  { _id: 'one', kind: 'image' as const, originalName: 'one.png' },
  { _id: 'two', kind: 'image' as const, originalName: 'two.png' }
];
beforeEach(() => {
  vi.mocked(request).mockReset();
});
function mount(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ShotImageReview
        asset={assetFixture(asset)}
        media={media.map((value) => mediaFixture(value))}
        onSaved={vi.fn()}
        onRejected={vi.fn()}
        {...props}
      />
    </ThemeProvider>
  );
}

test('image review can return to the library, open its shot chat and reopen an approved choice', async () => {
  const onBack = vi.fn(),
    onChat = vi.fn();
  vi.mocked(request).mockResolvedValue({ asset: assetFixture(asset) });
  mount({
    asset: assetFixture({
      ...asset,
      episodeId: 'episode',
      sceneId: 'scene',
      clipId: 'clip',
      finalChoice: { id: 'a', mediaIds: ['one'] }
    }),
    onBack,
    onChat
  });
  fireEvent.click(screen.getByRole('button', { name: 'Creative library' }));
  expect(onBack).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Discuss in chat' }));
  expect(onChat).toHaveBeenCalledWith({
    assetId: 'shot',
    episodeId: 'episode',
    sceneId: 'scene',
    clipId: 'clip'
  });
  fireEvent.click(screen.getByRole('button', { name: 'Un-finalize' }));
  await screen.findByRole('button', { name: 'Un-finalize' });
  expect(request).toHaveBeenCalledWith('/studio/assets/shot/reopen', {
    method: 'POST',
    body: { revision: 3, candidateId: 'a' }
  });
});

test('image approval errors retain the pending choices and missing candidates explain how to progress', async () => {
  vi.mocked(request).mockRejectedValue(new Error('Choice changed'));
  const view = mount();
  fireEvent.click(screen.getAllByRole('button', { name: 'Approve image' })[0]);
  expect(await screen.findByText('Choice changed')).toBeVisible();
  view.unmount();
  mount({ asset: assetFixture({ ...asset, candidates: [] }) });
  expect(screen.getByText('Needs a new image')).toBeVisible();
});

test('each alternative has its own single image and approval saves only the chosen option', async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  const next = { ...asset, revision: 4, finalChoice: asset.candidates[1] };
  vi.mocked(request).mockResolvedValue({ asset: next });
  mount({ onSaved });
  expect(
    within(screen.getByRole('article', { name: 'Al close-up' })).getAllByRole('img')
  ).toHaveLength(1);
  const choice = within(screen.getByRole('article', { name: 'Al over-shoulder' }));
  expect(choice.getAllByRole('img')).toHaveLength(1);
  await user.click(choice.getByRole('button', { name: 'Approve image' }));
  expect(request).toHaveBeenCalledWith('/studio/assets/shot/finalize', {
    method: 'POST',
    body: { revision: 3, candidateId: 'b' }
  });
  expect(onSaved).toHaveBeenCalledWith(next);
});

test('reject deletes the individual file directly, without an archive action', async () => {
  const user = userEvent.setup();
  const onRejected = vi.fn();
  const result = { deletedMediaId: 'one' };
  vi.mocked(request).mockResolvedValue(result);
  mount({ onRejected });
  await user.click(
    within(screen.getByRole('article', { name: 'Al close-up' })).getByRole('button', {
      name: 'Reject & delete'
    })
  );
  expect(request).toHaveBeenCalledWith('/studio/media/one', {
    method: 'DELETE',
    body: { assetId: 'shot', revision: 3, candidateId: 'a' }
  });
  expect(onRejected).toHaveBeenCalledWith(result);
  expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
});

test('an invalid multi-image shot option cannot be approved as a bundle', () => {
  mount({
    asset: { ...asset, candidates: [{ ...asset.candidates[0], mediaIds: ['one', 'two'] }] }
  });
  expect(screen.getByRole('button', { name: 'Approve image' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('must contain one image');
});

test('continuity references are clearly marked comparison-only and approval still targets just one new image', async () => {
  const user = userEvent.setup();
  vi.mocked(request).mockResolvedValue({ asset });
  mount({
    asset: {
      ...asset,
      candidates: [
        {
          ...asset.candidates[1],
          continuitySources: [{ mediaId: 'one', title: 'Earlier parked ship' }]
        }
      ]
    }
  });
  expect(screen.getAllByRole('button', { name: 'Approve image' })).toHaveLength(1);
  await user.click(
    screen.getByRole('button', { name: 'Earlier approved images — reference only' })
  );
  expect(screen.getByText('Earlier parked ship · reference only')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Approve image' }));
  expect(request).toHaveBeenCalledWith('/studio/assets/shot/finalize', {
    method: 'POST',
    body: { revision: 3, candidateId: 'b' }
  });
});
