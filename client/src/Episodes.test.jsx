import { ThemeProvider } from '@mui/material/styles';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.js';
import Episodes from './Episodes.jsx';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));
const episode = {
  _id: 'episode-1',
  title: 'Episode 01 · The Passenger Pays Double',
  synopsis: 'Roxy takes Tavin from Corellia to Ord Mantell. His con puts the Fortune at risk.',
  premise: `DRAFT OUTLINE ROUND 02\n\n${'Detailed shot and story directions. '.repeat(120)}`,
  notes: 'Preserve the cockpit and weapon continuity.',
  scenes: [],
  revision: 7
};
const settings = { targetSeconds: 600, vlogPercent: 33 };
function mount(record = episode, onSaved = vi.fn(), media = [], onRejected = vi.fn()) {
  return render(
    <ThemeProvider theme={theme}>
      <Episodes
        episodes={[record]}
        assets={[]}
        media={media}
        settings={settings}
        onSaved={onSaved}
        onMedia={vi.fn()}
        onRejected={onRejected}
      />
    </ThemeProvider>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.mocked(request).mockReset();
  vi.stubGlobal('scrollTo', vi.fn());
});

test('unsaved episode edits block dialogue rejection', async () => {
  const user = userEvent.setup();
  const { base } = staleEpisodeCase(false);
  const clip = {
    ...base.scenes[0].clips[0],
    dialogueTakeIds: ['al-dialogue'],
    selectedDialogueId: 'al-dialogue'
  };
  const record = { ...base, scenes: [{ ...base.scenes[0], clips: [clip] }] };
  const onRejected = vi.fn();
  const result = { deletedMediaId: 'al-dialogue' };
  vi.mocked(request).mockResolvedValue(result);
  mount(
    record,
    vi.fn(),
    [{ _id: 'al-dialogue', kind: 'audio', originalName: 'Al-eleven-v3-dialogue.mp3' }],
    onRejected
  );
  await user.click(screen.getByRole('button', { name: 'Open episode' }));
  const review = screen.getByRole('region', { name: 'Dialogue takes for Al questions the berth' });
  expect(within(review).getByLabelText('Al-eleven-v3-dialogue.mp3')).toBeInTheDocument();
  expect(within(review).getByRole('button', { name: 'Selected dialogue' })).toBeDisabled();
  await user.type(
    screen.getByRole('textbox', { name: 'Episode continuity notes' }),
    ' Keep this edit.'
  );
  expect(within(review).getByRole('button', { name: 'Reject & delete' })).toBeDisabled();
  expect(request).not.toHaveBeenCalled();
});

test('dialogue rejection submits the owning episode revision and clip, then refreshes media', async () => {
  const user = userEvent.setup();
  const { base } = staleEpisodeCase(false);
  const clip = {
    ...base.scenes[0].clips[0],
    dialogueTakeIds: ['al-dialogue'],
    selectedDialogueId: 'al-dialogue'
  };
  const record = { ...base, scenes: [{ ...base.scenes[0], clips: [clip] }] };
  const onRejected = vi.fn();
  const result = { deletedMediaId: 'al-dialogue' };
  vi.mocked(request).mockResolvedValue(result);
  mount(
    record,
    vi.fn(),
    [{ _id: 'al-dialogue', kind: 'audio', originalName: 'Al-eleven-v3-dialogue.mp3' }],
    onRejected
  );
  await user.click(screen.getByRole('button', { name: 'Open episode' }));
  const review = screen.getByRole('region', { name: 'Dialogue takes for Al questions the berth' });
  await user.click(within(review).getByRole('button', { name: 'Reject & delete' }));
  expect(request).toHaveBeenCalledWith('/studio/media/al-dialogue', {
    method: 'DELETE',
    body: { episodeId: 'episode-1', revision: 7, sceneId: 'scene', clipId: 'clip' }
  });
  expect(onRejected).toHaveBeenCalledWith(result);
});

function staleEpisodeCase(cache = true) {
  const clip = {
    id: 'clip',
    title: 'Al questions the berth',
    duration: 8,
    action: 'Al speaks.',
    dialogue: 'AL: A private berth.',
    camera: 'Static.',
    soundEffects: 'Ventilation.',
    takeIds: [],
    selectedTakeId: null
  };
  const base = {
    ...episode,
    scenes: [
      {
        id: 'scene',
        title: 'Easy credits',
        script: 'Approved script.',
        style: 'cinematic',
        location: 'Cockpit',
        assetIds: [],
        approvalStatus: 'approved',
        clips: [clip]
      }
    ]
  };
  const local = { ...base, notes: 'Keep my unsaved notes.' };
  const latest = {
    ...base,
    revision: 8,
    history: [base],
    scenes: [{ ...base.scenes[0], clips: [{ ...clip, takeIds: ['new-video'] }] }]
  };
  const media = [
    {
      _id: 'new-video',
      kind: 'video',
      soundMix: { fingerprint: 'fixture-mix' },
      originalName: 'al-new-take.mp4'
    }
  ];
  if (cache) localStorage.setItem('roxy-studio-episode-episode-1', JSON.stringify(local));
  return { base, local, latest, media };
}

test('opening a cached episode merges new video takes, preserves notes and saves with the current revision', async () => {
  const user = userEvent.setup();
  const { local, latest, media } = staleEpisodeCase();
  vi.mocked(request).mockImplementation(async (_path, { body }) => ({
    episode: { ...body, revision: 9 }
  }));
  mount(latest, vi.fn(), media);
  await user.click(screen.getByRole('button', { name: 'Open episode' }));
  expect(screen.getByLabelText('al-new-take.mp4')).toHaveAttribute(
    'src',
    '/api/studio/media/new-video'
  );
  expect(screen.getByRole('textbox', { name: 'Episode continuity notes' })).toHaveValue(
    local.notes
  );
  expect(screen.getByRole('button', { name: 'Save episode' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Save episode' }));
  expect(request).toHaveBeenLastCalledWith('/studio/episodes/episode-1', {
    method: 'PUT',
    body: expect.objectContaining({
      revision: 8,
      notes: local.notes,
      scenes: [
        expect.objectContaining({
          clips: [expect.objectContaining({ takeIds: ['new-video'], selectedTakeId: null })]
        })
      ]
    })
  });
  expect(await screen.findByRole('button', { name: 'Approve video take' })).toBeEnabled();
  expect(JSON.parse(localStorage.getItem('roxy-studio-episode-episode-1-recovery-7'))).toEqual(
    local
  );
});

test('overlapping episode edits require a choice while the imported video remains visible', async () => {
  const user = userEvent.setup();
  const { local, latest, media } = staleEpisodeCase();
  mount({ ...latest, notes: 'Different saved notes.' }, vi.fn(), media);
  await user.click(screen.getByRole('button', { name: 'Open episode' }));
  expect(screen.getByLabelText('al-new-take.mp4')).toBeInTheDocument();
  expect(screen.getByText('Conflicting fields: notes')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save episode' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Keep my edits in conflicting fields' }));
  expect(screen.getByRole('textbox', { name: 'Episode continuity notes' })).toHaveValue(
    local.notes
  );
  expect(screen.getByRole('button', { name: 'Save episode' })).toBeEnabled();
  expect(screen.queryByText('Conflicting fields: notes')).not.toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
});

test('saved videos can still be watched when an old draft cannot be merged safely', async () => {
  const user = userEvent.setup();
  const { local, latest, media } = staleEpisodeCase();
  mount({ ...latest, history: [] }, vi.fn(), media);
  await user.click(screen.getByRole('button', { name: 'Open episode' }));
  expect(
    within(screen.getByRole('region', { name: 'Pending video choices' })).getByLabelText(
      'al-new-take.mp4'
    )
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save episode' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Episode continuity notes' })).toHaveValue(
    local.notes
  );
});

test('a save conflict refreshes the episode and exposes new takes without retrying the write or losing edits', async () => {
  const user = userEvent.setup();
  const { base, local, latest, media } = staleEpisodeCase();
  let view;
  const onSaved = vi.fn((next) =>
    view.rerender(
      <ThemeProvider theme={theme}>
        <Episodes
          episodes={[next]}
          assets={[]}
          media={media}
          settings={settings}
          onSaved={onSaved}
          onMedia={vi.fn()}
        />
      </ThemeProvider>
    )
  );
  vi.mocked(request)
    .mockRejectedValueOnce(
      Object.assign(new Error('This record changed in another tab.'), { status: 409 })
    )
    .mockResolvedValueOnce({ episodes: [latest] });
  view = mount(base, onSaved, media);
  await user.click(screen.getByRole('button', { name: 'Open episode' }));
  expect(screen.queryByLabelText('al-new-take.mp4')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save episode' }));
  expect(await screen.findByLabelText('al-new-take.mp4')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Episode continuity notes' })).toHaveValue(
    local.notes
  );
  expect(screen.getByRole('button', { name: 'Save episode' })).toBeEnabled();
  expect(onSaved).toHaveBeenCalledWith(latest);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith('/studio');
});

test('overview shows a concise summary and truthful progress, then opens the complete existing editor', async () => {
  const user = userEvent.setup();
  mount();
  const card = screen.getByRole('article', { name: episode.title });
  expect(within(card).getByText(episode.synopsis)).toBeInTheDocument();
  expect(within(card).getByText('Outline draft')).toBeInTheDocument();
  expect(within(card).getByText('10:00')).toBeInTheDocument();
  expect(within(card).getByText('Scene planning has not started yet.')).toBeInTheDocument();
  expect(screen.queryByText(/Detailed shot and story directions/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('textbox', { name: 'Premise and story outline' })
  ).not.toBeInTheDocument();
  await user.click(within(card).getByRole('button', { name: 'Open episode' }));
  expect(screen.getByRole('textbox', { name: 'Premise and story outline' })).toHaveValue(
    episode.premise
  );
  expect(screen.getByRole('textbox', { name: 'Episode continuity notes' })).toHaveValue(
    episode.notes
  );
  expect(screen.getByRole('heading', { name: 'Scene board' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'All episodes' }));
  expect(screen.getByRole('article', { name: episode.title })).toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
});

test('summary edits save separately from the full production outline', async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  const synopsis = 'A costly charter from Corellia to Ord Mantell.';
  vi.mocked(request).mockResolvedValue({ episode: { ...episode, synopsis, revision: 8 } });
  mount(episode, onSaved);
  await user.click(screen.getByRole('button', { name: 'Open episode' }));
  await user.clear(screen.getByRole('textbox', { name: 'Episode summary' }));
  await user.type(screen.getByRole('textbox', { name: 'Episode summary' }), synopsis);
  await user.click(screen.getByRole('button', { name: 'Save episode' }));
  expect(request).toHaveBeenCalledWith('/studio/episodes/episode-1', {
    method: 'PUT',
    body: { ...episode, synopsis }
  });
  expect(
    await screen.findByText('Episode saved. Changed scenes need renewed approval.')
  ).toBeInTheDocument();
  expect(onSaved).toHaveBeenCalledWith({ ...episode, synopsis, revision: 8 });
});

test('legacy outlines are bounded and progress reflects approvals and selected takes', () => {
  const scenes = [
    {
      id: 'scene-one',
      title: 'Departure',
      script: 'Roxy lifts off.',
      style: 'cinematic',
      location: 'Corellia',
      assetIds: [],
      approvalStatus: 'approved',
      clips: [{ id: 'clip-one', duration: 25, selectedTakeId: 'take-one' }]
    }
  ];
  mount({ ...episode, synopsis: '', scenes });
  const card = screen.getByRole('article', { name: episode.title });
  expect(within(card).getByText(/DRAFT OUTLINE ROUND 02/).textContent.length).toBeLessThan(285);
  expect(within(card).getByText('Ready for editing')).toBeInTheDocument();
  expect(within(card).getByText('0:25 of clips planned')).toBeInTheDocument();
  expect(within(card).getAllByText('1 / 1')).toHaveLength(2);
});

test('unselected takes are playable beside their clip and require an explicit selection', async () => {
  const user = userEvent.setup();
  const clip = {
    id: 'opening-clip',
    title: 'Corellia wide',
    duration: 6,
    action: 'The ship waits.',
    dialogue: '',
    camera: 'Slow lateral move.',
    soundEffects: 'Wind.',
    dialogueTakeIds: ['dialogue-one'],
    selectedDialogueId: 'dialogue-one',
    takeIds: ['take-one'],
    selectedTakeId: null
  };
  const record = {
    ...episode,
    scenes: [
      {
        id: 'opening',
        title: 'Corellia pickup',
        style: 'cinematic',
        location: 'Corellia',
        script: 'A parked ship.',
        assetIds: [],
        approvalStatus: 'approved',
        clips: [clip]
      }
    ]
  };
  const next = {
    ...record,
    revision: 8,
    scenes: [
      {
        ...record.scenes[0],
        clips: [
          {
            ...clip,
            selectedTakeId: 'take-one',
            upscale: {
              sourceTakeId: 'take-one',
              status: 'waiting-provider',
              message: 'No upscale job has been submitted or charged.'
            }
          }
        ]
      }
    ]
  };
  vi.mocked(request).mockResolvedValue({ episode: next });
  mount(record, vi.fn(), [
    {
      _id: 'take-one',
      kind: 'video',
      soundMix: { fingerprint: 'fixture-mix' },
      originalName: 'Corellia-take01.mp4'
    },
    { _id: 'dialogue-one', kind: 'audio', originalName: 'Corellia-dialogue.mp3' }
  ]);
  expect(screen.getByText('Pending choice (1 video clip)')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open episode' }));
  expect(screen.getByRole('region', { name: 'Pending video choices' })).toBeInTheDocument();
  const videoReview = screen.getByRole('region', { name: 'Video takes for Corellia wide' });
  expect(
    within(videoReview).getByRole('heading', { name: 'Video takes to review' })
  ).toBeInTheDocument();
  const video = within(videoReview).getByLabelText('Corellia-take01.mp4');
  expect(video).toHaveAttribute('src', '/api/studio/media/take-one');
  expect(video).toHaveAttribute('controls');
  expect(video).toAppearBefore(screen.getByRole('textbox', { name: 'Action and performance' }));
  expect(video).toAppearBefore(screen.getByLabelText('Corellia-dialogue.mp3'));
  expect(within(videoReview).getByRole('button', { name: 'Approve video take' })).toBeEnabled();
  expect(screen.getByRole('combobox', { name: 'Selected video take' })).toHaveTextContent(
    'No take selected'
  );
  await user.click(screen.getByRole('button', { name: 'Approve video take' }));
  expect(request).toHaveBeenLastCalledWith('/studio/episodes/episode-1', {
    method: 'PUT',
    body: expect.objectContaining({
      scenes: [
        expect.objectContaining({
          clips: [expect.objectContaining({ takeIds: ['take-one'], selectedTakeId: 'take-one' })]
        })
      ]
    })
  });
  expect(screen.getByText('2K upscale waiting for provider connection.')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Pending video choices' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Selected for edit' })).toBeDisabled();
  expect(screen.getByText('Script approved')).toBeInTheDocument();
});

test('an approval failure keeps the video pending and unsaved drafts block immediate approval', async () => {
  const user = userEvent.setup();
  const clip = {
    id: 'clip',
    title: 'Opening',
    duration: 8,
    action: '',
    dialogue: '',
    camera: '',
    soundEffects: '',
    takeIds: ['video'],
    selectedTakeId: null
  };
  const record = {
    ...episode,
    scenes: [
      {
        id: 'scene',
        title: 'Opening scene',
        script: 'A ship.',
        style: 'cinematic',
        location: 'Corellia',
        assetIds: [],
        approvalStatus: 'approved',
        clips: [clip]
      }
    ]
  };
  const onSaved = vi.fn();
  vi.mocked(request).mockRejectedValue(new Error('This record changed in another tab.'));
  mount(record, onSaved, [
    {
      _id: 'video',
      kind: 'video',
      soundMix: { fingerprint: 'fixture-mix' },
      originalName: 'opening.mp4'
    }
  ]);
  await user.click(screen.getByRole('button', { name: 'Open episode' }));
  await user.click(screen.getByRole('button', { name: 'Approve video take' }));
  expect(await screen.findByText('This record changed in another tab.')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Pending video choices' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Selected video take' })).toHaveTextContent(
    'No take selected'
  );
  expect(onSaved).not.toHaveBeenCalled();
  await user.type(
    screen.getByRole('textbox', { name: 'Episode continuity notes' }),
    ' Keep this draft.'
  );
  expect(screen.getByRole('button', { name: 'Approve video take' })).toBeDisabled();
  expect(JSON.parse(localStorage.getItem('roxy-studio-episode-episode-1')).notes).toContain(
    'Keep this draft.'
  );
  expect(request).toHaveBeenCalledTimes(1);
});

test('dialogue can be played, explicitly selected and reopened without changing the script', async () => {
  const user = userEvent.setup();
  const record = {
    ...episode,
    scenes: [
      {
        id: 'opening',
        title: 'Captain vlog',
        style: 'vlog',
        location: 'Cockpit',
        script: 'Roxy introduces the charter.',
        assetIds: [],
        approvalStatus: 'approved',
        clips: [
          {
            id: 'log',
            title: 'The charter',
            duration: 24,
            action: '',
            dialogue: 'ROXY: Easy credits.',
            camera: '',
            soundEffects: '',
            dialogueTakeIds: ['dialogue-one'],
            selectedDialogueId: null,
            takeIds: [],
            selectedTakeId: null
          }
        ]
      }
    ]
  };
  mount(record, vi.fn(), [
    { _id: 'dialogue-one', kind: 'audio', originalName: 'roxy-dialogue.mp3' }
  ]);
  vi.mocked(request).mockImplementation(async (_path, { body }) => ({
    episode: { ...body, revision: body.revision + 1 }
  }));
  await user.click(screen.getByRole('button', { name: 'Open episode' }));
  expect(screen.getByLabelText('roxy-dialogue.mp3')).toHaveAttribute(
    'src',
    '/api/studio/media/dialogue-one'
  );
  expect(screen.getByRole('button', { name: 'Save episode' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Use this dialogue' }));
  await user.click(screen.getByRole('button', { name: 'Save episode' }));
  expect(request).toHaveBeenLastCalledWith('/studio/episodes/episode-1', {
    method: 'PUT',
    body: expect.objectContaining({
      scenes: [
        expect.objectContaining({
          script: record.scenes[0].script,
          clips: [
            expect.objectContaining({ selectedDialogueId: 'dialogue-one', selectedTakeId: null })
          ]
        })
      ]
    })
  });
  await user.click(screen.getByRole('button', { name: 'Clear dialogue selection' }));
  expect(screen.getByRole('button', { name: 'Use this dialogue' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Save episode' }));
  expect(request).toHaveBeenLastCalledWith('/studio/episodes/episode-1', {
    method: 'PUT',
    body: expect.objectContaining({
      scenes: [
        expect.objectContaining({
          clips: [
            expect.objectContaining({ dialogueTakeIds: ['dialogue-one'], selectedDialogueId: null })
          ]
        })
      ]
    })
  });
});
