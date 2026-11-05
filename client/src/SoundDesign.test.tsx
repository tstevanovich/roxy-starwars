import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { request, uploadMedia } from './api.ts';
import SoundDesign from './SoundDesign.tsx';
import { assetFixture, episodeFixture, mediaFixture, sceneFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';
vi.mock('./api.ts', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));
const layer = {
  id: 'bed',
  title: 'Busy port',
  description: 'Distant spacecraft. No music.',
  type: 'ambience' as const,
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
  approvalStatus: 'approved' as const,
  soundApprovalStatus: 'approved' as const,
  soundPlan: { notes: 'Same ambience across cuts.', dialogueGainDb: 0, layers: [layer] },
  clips: [{ id: 'clip', title: 'Roxy reply', duration: 8, takeIds: ['raw', 'mixed'] }]
};
const media = [
  { _id: 'audio', originalName: 'port.wav', kind: 'audio' as const },
  { _id: 'audio2', originalName: 'port-option.wav', kind: 'audio' as const },
  { _id: 'raw', originalName: 'original.mp4', kind: 'video' as const },
  {
    _id: 'mixed',
    originalName: 'mixed.mp4',
    kind: 'video' as const,
    soundMix: { fingerprint: 'mixed' }
  }
];
const asset = {
  _id: 'sound',
  name: 'Port bed',
  kind: 'sound' as const,
  scope: 'reusable' as const,
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
      <SoundDesign
        {...props}
        episode={episodeFixture(props.episode)}
        scene={sceneFixture(props.scene)}
        assets={props.assets.map(assetFixture)}
        media={props.media.map(mediaFixture)}
      />
    </ThemeProvider>
  );
  return props;
}
beforeEach(() => {
  vi.mocked(uploadMedia).mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(request).mockImplementation(async (path) =>
    path.includes('/sound/jobs')
      ? { jobs: [] }
      : { job: { _id: 'job', title: 'Test sound job', status: 'queued' as const } }
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function choose(label: string, option: string) {
  fireEvent.mouseDown(screen.getAllByRole('combobox', { name: label })[0]);
  fireEvent.click(within(screen.getByRole('listbox')).getByText(option));
}
test('an existing approved script gets a separate editable sound plan without reapproving its images', async () => {
  const user = userEvent.setup(),
    props = mount({ scene: { ...scene, soundPlan: null, soundApprovalStatus: 'draft' as const } });
  await user.click(screen.getByRole('button', { name: 'Add sound plan' }));
  expect(props.onEdit).toHaveBeenCalledWith(
    expect.objectContaining({
      notes: expect.stringContaining('No music'),
      layers: [expect.objectContaining({ loop: true, type: 'ambience' as const })]
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
  mount({ dirty: true, scene: { ...scene, soundApprovalStatus: 'needs-review' as const } });
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

test('sound plan edits preserve other layers and convert numeric, clip and reusable sound choices', () => {
  const onEdit = vi.fn();
  function Editor() {
    const [draft, setDraft] = useState(
      sceneFixture({
        ...scene,
        soundPlan: {
          ...scene.soundPlan,
          layers: [layer, { ...layer, id: 'other', title: 'Other bed', assetId: null }]
        }
      })
    );
    return (
      <SoundDesign
        episode={episodeFixture({ _id: 'episode' })}
        scene={draft}
        assets={[
          assetFixture(asset),
          assetFixture({
            _id: 'approved',
            kind: 'sound',
            name: 'Approved bed',
            finalChoice: { id: 'selected', mediaIds: ['audio'] }
          }),
          assetFixture({ _id: 'wrong', kind: 'sound', scope: 'episode', episodeId: 'other' }),
          assetFixture({ _id: 'archived', kind: 'sound', archived: true }),
          assetFixture({ kind: 'character' })
        ]}
        media={media.map(mediaFixture)}
        onMedia={vi.fn()}
        onSaved={vi.fn()}
        onEdit={(plan) => {
          onEdit(plan);
          setDraft({ ...draft, soundPlan: plan });
        }}
      />
    );
  }
  render(<Editor />);
  for (const [label, key, value] of [
    ['Sound continuity and notes', 'notes', 'Quiet continuous room tone.'],
    ['Clean dialogue level (dB)', 'dialogueGainDb', '-3']
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(onEdit.mock.lastCall[0][key]).toBe(key === 'notes' ? value : Number(value));
  }
  for (const [label, key, value] of [
    ['Sound title', 'title', 'Room bed'],
    ['Sound description / ElevenLabs prompt', 'description', 'Low ventilation'],
    ['Start in clip (seconds)', 'start', '1'],
    ['Sound length (seconds)', 'duration', '10'],
    ['Start in audio source (seconds)', 'sourceStart', '2'],
    ['Effect level (dB)', 'gainDb', '-20'],
    ['Low-pass filter (Hz; 0 = off)', 'lowpassHz', '3000']
  ]) {
    fireEvent.change(screen.getAllByLabelText(label)[0], { target: { value } });
    expect(onEdit.mock.lastCall[0].layers[0][key]).toBe(
      ['title', 'description'].includes(key) ? value : Number(value)
    );
    expect(onEdit.mock.lastCall[0].layers[1].title).toBe('Other bed');
  }
  choose('Layer type', 'Timed effect');
  expect(onEdit.mock.lastCall[0].layers[0]).toMatchObject({
    type: 'effect',
    clipId: 'clip',
    loop: false
  });
  choose('Layer type', 'Continuous ambience');
  choose('Apply to clip', 'Roxy reply');
  expect(onEdit.mock.lastCall[0].layers[0].clipId).toBe('clip');
  choose('Apply to clip', 'All clips in this scene');
  expect(onEdit.mock.lastCall[0].layers[0].clipId).toBeNull();
  fireEvent.click(screen.getAllByRole('switch')[0]);
  expect(onEdit.mock.lastCall[0].layers[0].loop).toBe(false);
  choose('Reusable or episode sound', 'Approved bed - approved');
  expect(onEdit.mock.lastCall[0].layers[0].assetId).toBe('approved');
  expect(screen.getByText('Sound 1: Room bed - Approved sound')).toBeVisible();
  choose('Reusable or episode sound', 'Create a new reusable sound');
  expect(onEdit.mock.lastCall[0].layers[0].assetId).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove layer from plan' })[0]);
  expect(onEdit.mock.lastCall[0].layers.map((item) => item.id)).toEqual(['other']);
  fireEvent.click(screen.getByRole('button', { name: 'Add sound layer' }));
  expect(onEdit.mock.lastCall[0].layers[1]).toMatchObject({
    type: 'ambience',
    title: 'Continuous ambience'
  });
});

test('sound approval, generation and saved imports submit only explicit requests and apply returned records', async () => {
  const episode = episodeFixture({ _id: 'episode', revision: 13 });
  const updated = assetFixture({ ...asset, reviewStatus: 'approved' });
  vi.mocked(request).mockImplementation(async (path) =>
    path.includes('/sound/jobs')
      ? { jobs: [] }
      : { episode, asset: updated, job: { _id: 'job', title: 'Generated sound', status: 'queued' } }
  );
  const props = mount({ scene: { ...scene, soundApprovalStatus: 'needs-review' as const } });
  fireEvent.click(screen.getByRole('button', { name: 'Approve sound plan' }));
  await screen.findByText('Sound plan approved. Review each sound before mixing.');
  expect(request).toHaveBeenCalledWith(
    '/studio/episodes/episode/scenes/scene/sound-plan/approve',
    expect.objectContaining({ method: 'POST' })
  );
  expect(props.onSaved).toHaveBeenCalledWith(episode);
  expect(props.onAssetSaved).toHaveBeenCalledWith(updated);
});

test('sound generation and imports report their own pending-review state and merge repeated job receipts', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Generate new sound option' }));
  await screen.findByText('Sound generation queued. Its audio will need your approval.');
  expect(request).toHaveBeenCalledWith(
    '/studio/assistant/sound/generate',
    expect.objectContaining({ body: expect.objectContaining({ layerId: 'bed' }) })
  );
  choose('Import saved audio as an option', 'port.wav');
  fireEvent.click(screen.getByRole('button', { name: 'Import sound option' }));
  await screen.findByText('Audio imported as a pending choice.');
  expect(screen.getAllByText('Test sound job: queued')).toHaveLength(1);
  expect(request).toHaveBeenCalledWith(
    '/studio/assistant/sound/import',
    expect.objectContaining({ body: expect.objectContaining({ mediaId: 'audio', layerId: 'bed' }) })
  );
});

test('uploaded sound options validate audio and keep upload errors recoverable', async () => {
  const props = mount();
  const input = screen.getByLabelText('Upload sound option');
  vi.mocked(uploadMedia).mockResolvedValueOnce(mediaFixture({ _id: 'wrong', kind: 'image' }));
  fireEvent.change(input, { target: { files: [new File(['image'], 'image.png')] } });
  expect(await screen.findByText('Choose an audio file for this sound layer.')).toBeVisible();
  vi.mocked(uploadMedia).mockResolvedValueOnce(mediaFixture({ _id: 'voice', kind: 'audio' }));
  fireEvent.change(input, { target: { files: [new File(['audio'], 'audio.wav')] } });
  await screen.findByText('Audio imported as a pending choice.');
  expect(props.onMedia).toHaveBeenCalledWith(expect.objectContaining({ _id: 'voice' }));
});

test.each([409, 500])(
  'sound mutation failure %i retains the plan and refreshes only stale revisions',
  async (status) => {
    const props = mount();
    await act(async () => {
      await Promise.resolve();
    });
    vi.mocked(request).mockRejectedValueOnce(
      Object.assign(new Error('Sound request failed'), { status })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate new sound option' }));
    expect(await screen.findByText('Sound request failed')).toBeVisible();
    expect(props.onReload).toHaveBeenCalledTimes(status === 409 ? 1 : 0);
    vi.mocked(request).mockRejectedValueOnce(new Error('Audition approval failed'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve this sound' })[0]);
    expect(await screen.findByText('Audition approval failed')).toBeVisible();
  }
);

test('sound job polling refreshes terminal changes once and ignores malformed or late status responses', async () => {
  vi.useFakeTimers();
  let jobs: {
    _id: string;
    title: string;
    status: string;
    error?: string;
    receipt?: { creditsCharged: number };
  }[] = [{ _id: 'job', title: 'Sound render', status: 'queued' }];
  vi.mocked(request).mockImplementation(async () => ({ jobs }));
  const props = mount();
  await act(async () => {
    await Promise.resolve();
  });
  jobs = [
    {
      _id: 'job',
      title: 'Sound render',
      status: 'ready',
      error: 'Original retained',
      receipt: { creditsCharged: 80 }
    }
  ];
  await act(async () => vi.advanceTimersByTime(4000));
  expect(props.onReload).toHaveBeenCalledOnce();
  expect(screen.getByText(/80 ElevenLabs credits charged/)).toBeVisible();
  await act(async () => vi.advanceTimersByTime(4000));
  expect(props.onReload).toHaveBeenCalledOnce();
  jobs = [{ _id: 'job', title: 'Sound render', status: 'failed' }];
  await act(async () => vi.advanceTimersByTime(4000));
  expect(props.onReload).toHaveBeenCalledTimes(2);
  vi.mocked(request)
    .mockResolvedValueOnce({ jobs: null })
    .mockRejectedValueOnce(new Error('Offline'));
  await act(async () => vi.advanceTimersByTime(8000));
  expect(screen.getByText('Sound render: failed')).toBeVisible();
});

test('missing location and scene approval remain explicit in new sound planning', () => {
  const props = mount({
    scene: {
      ...scene,
      location: '',
      approvalStatus: 'draft' as const,
      soundPlan: { ...scene.soundPlan, layers: [] }
    }
  });
  expect(
    screen.getByText('Approve the scene script to approve its sound plan together.')
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Add sound layer' }));
  expect(props.onEdit.mock.lastCall[0].layers[0].description).toContain(
    'Describe the scene environment'
  );
});

test('approved sound choices stay approved and repair mixes require a clean dialogue stem', async () => {
  vi.mocked(request).mockImplementation(async (path) =>
    path.includes('/sound/jobs') ? { jobs: [] } : {}
  );
  mount({
    episode: { _id: 'episode', revision: 12, workflowVersion: 1 },
    assets: [{ ...asset, finalChoice: { id: 'a' }, reviewStatus: 'approved' }],
    scene: {
      ...scene,
      clips: [{ ...scene.clips[0], dialogue: 'ROXY: Hello.', production: { visualTakeId: 'raw' } }]
    }
  });
  expect(screen.getByRole('button', { name: 'Approved sound' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Approve sound plan' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Create sound mix/ })).toBeDisabled();
});

test('a saved picture and clean dialogue stem can be mixed without choosing the picture again', async () => {
  vi.mocked(request).mockImplementation(async (path) =>
    path.includes('/sound/jobs') ? { jobs: [] } : {}
  );
  mount({
    assets: [{ ...asset, finalChoice: { id: 'a' }, reviewStatus: 'pending-choice' }],
    scene: {
      ...scene,
      clips: [
        {
          ...scene.clips[0],
          takeIds: undefined,
          dialogue: 'ROXY: Hello.',
          production: { visualTakeId: 'raw', cleanDialogueMediaId: 'audio' }
        }
      ]
    }
  });
  expect(screen.getAllByRole('button', { name: 'Approve this sound' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /Create sound mix/ }));
  await screen.findByText('Local sound mix requested. Review the finished video below when ready.');
  expect(request).toHaveBeenCalledWith(
    '/studio/assistant/sound/mix',
    expect.objectContaining({ body: expect.objectContaining({ sourceTakeId: 'raw' }) })
  );
});

test('a timed effect in a scene without clips has no invented clip target', () => {
  const props = mount({ scene: { ...scene, clips: [] } });
  choose('Layer type', 'Timed effect');
  expect(props.onEdit.mock.lastCall[0].layers[0].clipId).toBeNull();
});
