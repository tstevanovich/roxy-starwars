import { ThemeProvider } from '@mui/material/styles';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.js';
import SoundDesign from './SoundDesign.jsx';
import { theme } from './theme.js';
vi.mock('./api.js', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));
const layer = {
  id: 'bed',
  title: 'Busy port',
  description: 'Distant spacecraft. No music.',
  type: 'ambience',
  duration: 15,
  start: 0,
  sourceStart: 0,
  gainDb: -22,
  lowpassHz: 0,
  loop: true,
  assetId: 'sound',
  clipId: null
};
const scene = {
  id: 'scene',
  title: 'Boarding',
  location: 'Corellia',
  approvalStatus: 'approved',
  soundApprovalStatus: 'approved',
  soundPlan: { notes: 'Same ambience across cuts.', dialogueGainDb: 0, layers: [layer] },
  clips: [{ id: 'clip', title: 'Roxy reply', duration: 8, takeIds: ['raw', 'mixed'] }]
};
const media = [
  { _id: 'audio', originalName: 'port.wav', kind: 'audio' },
  { _id: 'audio2', originalName: 'port-option.wav', kind: 'audio' },
  { _id: 'raw', originalName: 'original.mp4', kind: 'video' },
  { _id: 'mixed', originalName: 'mixed.mp4', kind: 'video', soundMix: { fingerprint: 'mixed' } }
];
const asset = {
  _id: 'sound',
  name: 'Port bed',
  kind: 'sound',
  scope: 'reusable',
  revision: 3,
  reviewStatus: 'pending-choice',
  candidates: [
    { id: 'a', title: 'Port one', mediaIds: ['audio'] },
    { id: 'b', title: 'Port two', mediaIds: ['audio2'] }
  ]
};
function mount(patch = {}) {
  const props = {
    episode: { _id: 'episode', revision: 12 },
    scene,
    assets: [asset],
    media,
    dirty: false,
    busy: false,
    onEdit: vi.fn(),
    onSaved: vi.fn(),
    onAssetSaved: vi.fn(),
    onMedia: vi.fn(),
    onRejected: vi.fn(),
    onReload: vi.fn(),
    ...patch
  };
  render(
    <ThemeProvider theme={theme}>
      <SoundDesign {...props} />
    </ThemeProvider>
  );
  return props;
}
beforeEach(() => {
  vi.mocked(request).mockReset();
  vi.mocked(request).mockImplementation(async (path) =>
    path.includes('/sound/jobs')
      ? { jobs: [] }
      : { job: { _id: 'job', title: 'Test sound job', status: 'queued' } }
  );
});
test('an existing approved script gets a separate editable sound plan without reapproving its images', async () => {
  const user = userEvent.setup(),
    props = mount({ scene: { ...scene, soundPlan: null, soundApprovalStatus: 'draft' } });
  await user.click(screen.getByRole('button', { name: 'Add sound plan' }));
  expect(props.onEdit).toHaveBeenCalledWith(
    expect.objectContaining({
      notes: expect.stringContaining('No music'),
      layers: [expect.objectContaining({ loop: true, type: 'ambience' })]
    })
  );
  expect(request).not.toHaveBeenCalled();
});
test('each sound option has its own player, approval and permanent rejection', async () => {
  const user = userEvent.setup();
  vi.mocked(request).mockImplementation(async (path) =>
    path.includes('/sound/jobs') ? { jobs: [] } : { asset: { ...asset, finalChoice: { id: 'a' } } }
  );
  const props = mount();
  expect(screen.getByLabelText('port.wav')).toHaveAttribute('controls');
  expect(screen.getByLabelText('port-option.wav')).toHaveAttribute('controls');
  expect(screen.getAllByRole('button', { name: 'Approve this sound' })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: 'Reject & delete' })).toHaveLength(2);
  await user.click(screen.getAllByRole('button', { name: 'Approve this sound' })[0]);
  expect(request).toHaveBeenCalledWith('/studio/assets/sound/finalize', {
    method: 'POST',
    body: { revision: 3, candidateId: 'a' }
  });
  expect(props.onAssetSaved).toHaveBeenCalled();
});
test('unsaved edits and unapproved sound plans block generation, import and mixing', () => {
  mount({ dirty: true, scene: { ...scene, soundApprovalStatus: 'needs-review' } });
  expect(screen.getByRole('button', { name: 'Generate new sound option' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Approve sound plan' })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Create sound mix.*Roxy reply/ })).toBeDisabled();
});
test('local mixing offers only originals and leaves the resulting video unapproved', async () => {
  const user = userEvent.setup(),
    props = mount();
  await user.click(screen.getByRole('combobox', { name: 'Original take: Roxy reply' }));
  const options = within(screen.getByRole('listbox'));
  expect(options.queryByRole('option', { name: 'mixed.mp4' })).not.toBeInTheDocument();
  await user.click(options.getByRole('option', { name: 'original.mp4' }));
  await user.click(screen.getByRole('button', { name: /Create sound mix.*Roxy reply/ }));
  expect(request).toHaveBeenCalledWith('/studio/assistant/sound/mix', {
    method: 'POST',
    body: expect.objectContaining({
      episodeId: 'episode',
      sceneId: 'scene',
      clipId: 'clip',
      sourceTakeId: 'raw',
      revision: 12,
      requestId: expect.any(String)
    })
  });
  expect(props.onSaved).not.toHaveBeenCalled();
  expect(screen.getByText('Test sound job: queued')).toBeInTheDocument();
});
