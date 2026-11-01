import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.js';
import ShotProductionCard from './ShotProductionCard.jsx';
import ShotTransitionSummary from './ShotTransitionSummary.jsx';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn() }));
const target = { scope: 'clip', recordId: 'episode', sceneId: 'academy', clipId: 'opening' };
const clip = {
  id: 'opening',
  title: 'Harkun opens',
  duration: 5,
  dialogue: '',
  production: {},
  takeIds: []
};
const scene = { id: 'academy', title: 'Academy', clips: [clip] };
const episode = { _id: 'episode', revision: 7, scenes: [scene] };
const rows = ['storyboard', 'animatic', 'visual'].map((stage) => ({
  stage,
  key: stage,
  target,
  approvalFingerprint: stage + '-inputs',
  reviewRevision: 0,
  parentRevision: 7,
  fingerprint: stage + '-hash',
  status: stage === 'storyboard' ? 'pending-review' : 'blocked',
  canApprove: stage === 'storyboard',
  blockers: stage === 'animatic' ? ['Approve Storyboard continuity.'] : []
}));
const mount = (props = {}) => {
  const onChanged = vi.fn(),
    onAssetSaved = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <ShotProductionCard
        episode={episode}
        scene={scene}
        clip={clip}
        index={0}
        rows={rows}
        sceneRows={[{ stage: 'sound-plan', status: 'approved' }]}
        assets={[]}
        media={[]}
        onChanged={onChanged}
        onAssetSaved={onAssetSaved}
        renderReview={(r) => <div key={r.key}>{r.stage} details</div>}
        {...props}
      />
    </ThemeProvider>
  );
  return { onChanged, onAssetSaved };
};
beforeEach(() => {
  localStorage.clear();
  vi.mocked(request).mockReset();
  vi.mocked(request).mockResolvedValue({ message: 'This shot is queued.' });
});

test('a custom prompt automatically shows sound timing, character mapping and the exact combined request', async () => {
  const user = userEvent.setup();
  const speaking = {
    ...clip,
    dialogue: 'HARKUN: Hello.',
    soundEffects: 'Soft robe rustle.',
    selectedDialogueId: 'voice',
    production: { videoPrompt: 'ACTION: Harkun stays planted.\nAUDIO: Preserve custom room tone.' }
  };
  const localScene = {
    ...scene,
    assetIds: ['harkun'],
    clips: [speaking],
    soundPlan: {
      layers: [
        {
          id: 'rustle',
          clipId: speaking.id,
          type: 'effect',
          start: 1,
          duration: 2,
          description: 'Robe movement.'
        }
      ]
    }
  };
  const onEdit = vi.fn();
  mount({
    clip: speaking,
    scene: localScene,
    episode: { ...episode, scenes: [localScene] },
    onEdit,
    assets: [
      {
        _id: 'harkun',
        kind: 'character',
        name: 'Overseer Harkun',
        finalChoice: { mediaIds: ['identity'] }
      }
    ],
    media: [{ _id: 'identity', kind: 'image', originalName: 'Harkun identity.png' }]
  });
  const complete = screen.getByRole('textbox', { name: 'Complete video prompt sent to Wan' });
  expect(complete.value).toContain('HARKUN = @Image2 identity');
  expect(complete.value).toContain('Effect 1–3s: Robe movement.');
  expect(complete.value).toContain('Preserve custom room tone.');
  expect(screen.getByText('HARKUN = Image 2')).toBeVisible();
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Sound effects and ambience for this shot' }),
    { target: { value: 'Quiet armor movement.' } }
  );
  expect(onEdit).toHaveBeenCalledWith({ soundEffects: 'Quiet armor movement.' });
  expect(request).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Generate video' }));
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/shot/approve',
    expect.objectContaining({ body: expect.objectContaining({ prompt: complete.value }) })
  );
});

test('prompt fields and Generate video use the same generator-only text while saved originals are retained', async () => {
  const user = userEvent.setup();
  const original =
    'ACTION: Keep the camera fixed.\nAUDIO: No background music. Music is added later in CapCut.\nWORKFLOW: Review before generating.';
  const stored = { ...clip, production: { videoPrompt: original, imagePrompt: original } };
  mount({ clip: stored, onEdit: vi.fn() });
  const shown = screen.getByRole('textbox', { name: 'Video generation prompt' }).value;
  expect(shown).toContain('No background music.');
  expect(shown).not.toContain('CapCut');
  expect(shown).not.toContain('WORKFLOW');
  expect(screen.getByRole('textbox', { name: 'Image generation prompt' }).value).toBe(shown);
  await user.click(screen.getByRole('button', { name: 'Generate video' }));
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/shot/approve',
    expect.objectContaining({
      body: expect.objectContaining({
        prompt: screen.getByRole('textbox', { name: 'Complete video prompt sent to Wan' }).value
      })
    })
  );
  expect(stored.production.videoPrompt).toBe(original);
});

test('an ordinary shot offers only the next shot image in this episode without saving or rendering', async () => {
  const user = userEvent.setup();
  const onEdit = vi.fn();
  mount({
    onEdit,
    episode: { ...episode, scenes: [{ ...scene, clips: [clip, { ...clip, id: 'next-shot' }] }] },
    transitionChoices: [
      {
        assetId: 'foreign',
        mediaId: 'foreign-image',
        episodeId: 'episode',
        sceneId: scene.id,
        clipId: 'next-shot',
        label: 'Episode 01 / Academy / Next shot'
      },
      {
        assetId: 'other',
        mediaId: 'other',
        episodeId: 'episode-two',
        sceneId: 'next-scene',
        clipId: 'next-shot',
        label: 'Other episode'
      }
    ]
  });
  await user.click(screen.getByRole('combobox', { name: 'End image (optional)' }));
  expect(screen.queryByRole('option', { name: 'Other episode' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: 'Episode 01 / Academy / Next shot' }));
  expect(onEdit).toHaveBeenCalledWith({
    production: { videoEndFrame: { mode: 'image', assetId: 'foreign', mediaId: 'foreign-image' } }
  });
  expect(request).not.toHaveBeenCalled();
});

test('an ordinary shot previews its chosen next-shot end image and submits both reference IDs', async () => {
  const user = userEvent.setup();
  const selected = {
    ...clip,
    production: { videoEndFrame: { mode: 'image', assetId: 'foreign', mediaId: 'end' } }
  };
  const nextScene = { id: 'next-scene', clips: [{ ...clip, id: 'next-shot' }] };
  const choice = {
    assetId: 'foreign',
    mediaId: 'end',
    episodeId: 'episode',
    sceneId: 'next-scene',
    clipId: 'next-shot',
    label: 'Episode 01 / Next scene / Opening'
  };
  mount({
    clip: selected,
    episode: { ...episode, scenes: [{ ...scene, clips: [selected] }, nextScene] },
    onEdit: vi.fn(),
    prompts: { videoBase: 'Saved shot directions.' },
    transitionChoices: [choice],
    assets: [
      {
        episodeId: 'episode',
        sceneId: scene.id,
        clipId: clip.id,
        finalChoice: { mediaIds: ['start'] }
      },
      {
        _id: 'foreign',
        episodeId: 'episode',
        sceneId: 'next-scene',
        clipId: 'next-shot',
        name: 'Next opening',
        finalChoice: { mediaIds: ['end'] }
      }
    ],
    media: [
      { _id: 'start', kind: 'image', originalName: 'start.png' },
      { _id: 'end', kind: 'image', originalName: 'end.png' }
    ]
  });
  expect(screen.getByAltText('end.png')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Review end image' })).toHaveAttribute(
    'href',
    '#picture-prerequisites-next-shot'
  );
  await user.click(screen.getByRole('button', { name: 'Generate video' }));
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/shot/approve',
    expect.objectContaining({
      body: expect.objectContaining({
        transitionImageIds: ['start', 'end'],
        prompt: expect.stringContaining('END reference')
      })
    })
  );
});

test('dialogue includes automatic lip sync in the visible custom prompt and generation request without an extra button', async () => {
  const user = userEvent.setup();
  const onEdit = vi.fn();
  const prompt = 'DIALOGUE: HARKUN: Hello.\nCAMERA: Fixed.';
  mount({
    clip: { ...clip, dialogue: 'HARKUN: Hello.', selectedDialogueId: 'voice' },
    onEdit,
    prompts: { videoBase: prompt }
  });
  const improved = screen.getByRole('textbox', { name: 'Video generation prompt' }).value;
  expect(improved).toContain('HARKUN says: "Hello."');
  expect(improved).toContain('Lip sync.');
  expect(improved).toContain('CAMERA: Fixed.');
  expect(screen.getByText('Lip sync included automatically')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Improve lip sync' })).not.toBeInTheDocument();
  expect(onEdit).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Generate video' }));
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/shot/approve',
    expect.objectContaining({
      body: expect.objectContaining({
        prompt: screen.getByRole('textbox', { name: 'Complete video prompt sent to Wan' }).value
      })
    })
  );
});

test('numbered shots display both reference images and submit the full reviewed transition prompt with their voice', async () => {
  const user = userEvent.setup();
  const first = {
    ...clip,
    title: 'Exchange - part 1 of 2',
    dialogue: 'ROXY: Hello.',
    selectedDialogueId: 'voice',
    takeIds: ['earlier-video']
  };
  const next = { ...clip, id: 'next', title: 'Exchange - part 2 of 2' };
  const assets = [first, next].map((item, index) => ({
    _id: `asset-${index}`,
    episodeId: 'episode',
    sceneId: 'academy',
    clipId: item.id,
    finalChoice: { mediaIds: [`image-${index}`] }
  }));
  mount({
    clip: first,
    scene: { ...scene, clips: [first, next] },
    onEdit: vi.fn(),
    prompts: { image: 'Image prompt', videoBase: 'Saved camera and dialogue directions.' },
    assets,
    jobs: [
      {
        _id: 'earlier-job',
        kind: 'video',
        status: 'ready',
        target: { sceneId: scene.id, clipId: first.id },
        resultMediaIds: ['earlier-video'],
        snapshot: { imageIds: ['image-0'] }
      }
    ],
    media: [
      { _id: 'image-0', kind: 'image', originalName: 'start.png' },
      { _id: 'image-1', kind: 'image', originalName: 'end.png' },
      { _id: 'voice', kind: 'audio' },
      { _id: 'earlier-video', kind: 'video', originalName: 'earlier.mp4' }
    ]
  });
  expect(screen.getAllByAltText('start.png')[0]).toBeVisible();
  expect(screen.getByAltText('end.png')).toBeVisible();
  expect(screen.getByText('Next generation: start + end image references')).toBeVisible();
  expect(screen.getByText('Generated with one image reference')).toBeVisible();
  expect(screen.queryByText('Generated with start + end image references')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Start/end reference instructions' }).value).toContain(
    'Audio 1'
  );
  await user.click(screen.getByRole('button', { name: 'Generate video' }));
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/shot/approve',
    expect.objectContaining({
      body: expect.objectContaining({
        transitionImageIds: ['image-0', 'image-1'],
        prompt: expect.stringContaining('@Image2 is the END')
      })
    })
  );
});

test('the final numbered part needs only its own approved image and remains downloadable', () => {
  const last = { ...clip, title: 'Exchange - part 3 of 3', takeIds: ['video'] };
  mount({
    clip: last,
    scene: { ...scene, clips: [last] },
    onEdit: vi.fn(),
    prompts: { videoBase: 'End this exchange.' },
    assets: [
      {
        episodeId: 'episode',
        sceneId: 'academy',
        clipId: last.id,
        finalChoice: { mediaIds: ['start'] }
      }
    ],
    media: [
      { _id: 'start', kind: 'image', originalName: 'final.png' },
      { _id: 'video', kind: 'video', originalName: 'approved.mp4' }
    ]
  });
  expect(screen.getByRole('button', { name: 'Generate video' })).toBeEnabled();
  expect(screen.queryByText(/Image 2 · End reference/)).not.toBeInTheDocument();
  expect(screen.getByText('Next generation: start image only · final part')).toBeVisible();
  expect(screen.getAllByRole('link', { name: 'Download video' })).toHaveLength(2);
});

test('the numbered transition table shows forward image links and marks the final part', () => {
  const clips = [1, 2, 3].map((part) => ({
    ...clip,
    id: `part-${part}`,
    title: `Exchange - part ${part} of 3`
  }));
  const assets = clips.map((part) => ({
    episodeId: 'episode',
    sceneId: 'academy',
    clipId: part.id,
    finalChoice: { mediaIds: [part.id] }
  }));
  render(
    <ThemeProvider theme={theme}>
      <ShotTransitionSummary
        episodeId="episode"
        scene={{ ...scene, clips }}
        assets={assets}
        media={clips.map((part) => ({ _id: part.id, kind: 'image' }))}
      />
    </ThemeProvider>
  );
  expect(screen.getByRole('table', { name: 'Transition references for Academy' })).toBeVisible();
  expect(screen.getAllByText('Both images approved')).toHaveLength(2);
  expect(screen.getByText('Final part · no end image')).toBeVisible();
  expect(
    screen
      .getAllByRole('link', { name: 'Exchange - part 2 of 3' })
      .every((link) => link.getAttribute('href') === '#picture-prerequisites-part-2')
  ).toBe(true);
});

test('one inline approval submits only the chosen shot and both reviewed input versions', async () => {
  const user = userEvent.setup();
  const { onChanged } = mount();
  expect(screen.getByText(/Frame-to-video/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Approve shot & generate video' }));
  expect(request).toHaveBeenCalledExactlyOnceWith('/studio/workflow/shot/approve', {
    method: 'POST',
    body: {
      target,
      parentRevision: 7,
      reviews: {
        storyboard: { approvalFingerprint: 'storyboard-inputs', reviewRevision: 0 },
        animatic: { approvalFingerprint: 'animatic-inputs', reviewRevision: 0 }
      }
    }
  });
  expect(await screen.findByRole('status')).toHaveTextContent('This shot is queued.');
  expect(onChanged).toHaveBeenCalledOnce();
});
test('later shots awaiting review or generation do not block this shot', async () => {
  const user = userEvent.setup();
  mount({
    onEdit: vi.fn(),
    prompts: { image: 'Image prompt', video: 'Video prompt' },
    awaitingVideo: { id: 'later', title: 'Part 2 of 3' },
    jobs: [
      {
        _id: 'later-job',
        kind: 'video',
        status: 'rendering',
        target: { episodeId: 'episode', sceneId: 'academy', clipId: 'later' }
      }
    ]
  });
  expect(screen.getByRole('button', { name: 'Generate video' })).toBeEnabled();
  expect(
    screen.queryByRole('link', { name: 'Go to video awaiting review' })
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Review.*Part 2/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Generate video' }));
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/shot/approve',
    expect.objectContaining({ body: expect.objectContaining({ target, generate: true }) })
  );
});
test('an active request for this same shot still prevents a duplicate submission', () => {
  mount({
    jobs: [
      {
        _id: 'own-job',
        kind: 'video',
        status: 'rendering',
        target: { episodeId: 'episode', sceneId: 'academy', clipId: 'opening' }
      }
    ]
  });
  expect(screen.getByRole('button', { name: 'Approve shot & generate video' })).toBeDisabled();
  expect(screen.getByText(/This shot already has a video request/)).toBeVisible();
});

test('obsolete hold metadata does not disable an otherwise ready shot', () => {
  mount({
    episode: {
      ...episode,
      videoGenerationHold: { active: true, reason: 'Paused while exact lip sync is repaired.' }
    },
    clip: { ...clip, dialogue: 'HARKUN: Go.', selectedDialogueId: 'audio' }
  });
  expect(screen.getByRole('button', { name: 'Approve shot & generate video' })).toBeEnabled();
  expect(screen.queryByText('Paused while exact lip sync is repaired.')).not.toBeInTheDocument();
  expect(screen.getByText(/Reference-to-video/)).toBeVisible();
  expect(screen.getByText('Dialogue choices')).toBeVisible();
  expect(request).not.toHaveBeenCalled();
});

test('dialogue is approved and saved in the shot card without replacing the whole episode', async () => {
  const user = userEvent.setup();
  mount({
    clip: { ...clip, dialogue: 'HARKUN: Begin.', dialogueTakeIds: ['audio'] },
    media: [{ _id: 'audio', kind: 'audio', originalName: 'harkun.wav' }]
  });
  await user.click(screen.getByRole('button', { name: 'Approve dialogue' }));
  expect(request).toHaveBeenCalledWith('/studio/workflow/shot/dialogue', {
    method: 'POST',
    body: { target, parentRevision: 7, mediaId: 'audio' }
  });
});

test.each(['approved', 'alternative'])(
  'a shot can reject and delete its %s dialogue and refresh the choices',
  async (choice) => {
    const onRejected = vi.fn(),
      onChanged = vi.fn();
    request.mockResolvedValue({ deletedMediaId: choice, changed: { episodes: ['episode'] } });
    mount({
      onRejected,
      onChanged,
      clip: {
        ...clip,
        dialogue: 'HARKUN: Begin.',
        dialogueTakeIds: ['approved', 'alternative'],
        selectedDialogueId: 'approved'
      },
      media: ['approved', 'alternative'].map((_id) => ({
        _id,
        kind: 'audio',
        originalName: _id + '.wav'
      }))
    });
    const take = screen.getByRole('region', { name: `Dialogue take: ${choice}.wav` });
    expect(within(take).getByRole('button', { name: 'Reject & delete' })).toBeEnabled();
    await userEvent.setup().click(within(take).getByRole('button', { name: 'Reject & delete' }));
    expect(request).toHaveBeenCalledWith(`/studio/media/${choice}`, {
      method: 'DELETE',
      body: { episodeId: 'episode', revision: 7, sceneId: 'academy', clipId: 'opening' }
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ deletedMediaId: choice }));
    expect(request).toHaveBeenCalledTimes(1);
  }
);

test('a selected legacy dialogue missing from the take list still has a rejection control', () => {
  mount({
    clip: {
      ...clip,
      dialogue: 'HARKUN: Begin.',
      dialogueTakeIds: [],
      selectedDialogueId: 'approved'
    },
    media: [{ _id: 'approved', kind: 'audio', originalName: 'approved.wav' }]
  });
  const take = screen.getByRole('region', { name: 'Dialogue take: approved.wav' });
  expect(within(take).getByRole('button', { name: 'Dialogue approved' })).toBeDisabled();
  expect(within(take).getByRole('button', { name: 'Reject & delete' })).toBeEnabled();
  expect(screen.queryByText(/No dialogue take yet/)).not.toBeInTheDocument();
});
test('dialogue generation requires its explicit button and sends the exact saved text', async () => {
  const user = userEvent.setup();
  mount({ clip: { ...clip, dialogue: 'HARKUN: Begin.' } });
  expect(request).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Generate dialogue' }));
  expect(request).toHaveBeenCalledExactlyOnceWith('/studio/workflow/shot/dialogue/generate', {
    method: 'POST',
    body: { target, parentRevision: 7, dialogue: 'HARKUN: Begin.', requestId: expect.any(String) }
  });
});

test('a generated video can be reviewed and approved from the same shot card', async () => {
  const user = userEvent.setup();
  mount({
    clip: { ...clip, takeIds: ['video'] },
    rows: rows.map((row) => (row.stage === 'animatic' ? { ...row, status: 'approved' } : row)),
    media: [{ _id: 'video', kind: 'video', originalName: 'opening.mp4' }]
  });
  await user.click(screen.getByRole('button', { name: 'Approve picture, performance & sound' }));
  expect(request).toHaveBeenCalledWith('/studio/workflow/review', {
    method: 'POST',
    body: {
      target,
      stage: 'visual',
      action: 'approve',
      fingerprint: 'visual-hash',
      parentRevision: 7,
      reviewRevision: 0,
      feedback: '',
      takeId: 'video'
    }
  });
  expect(
    screen.queryByRole('button', { name: 'Approve shot & generate video' })
  ).not.toBeInTheDocument();
});
test('approved videos have individual downloads without an episode package', () => {
  mount({
    clip: {
      ...clip,
      takeIds: ['video'],
      selectedTakeId: 'video',
      production: { visualTakeId: 'video' }
    },
    rows: rows.map((row) => ({ ...row, status: 'approved' })),
    media: [{ _id: 'video', kind: 'video', originalName: 'opening.mp4' }]
  });
  expect(screen.getByRole('link', { name: 'Download approved video' })).toHaveAttribute(
    'href',
    '/api/studio/media/video?download=1'
  );
  expect(screen.queryByText(/CapCut package/)).not.toBeInTheDocument();
});
test('a completed shot exposes approved image and dialogue choices, both editable prompts and both generation buttons', async () => {
  const onEdit = vi.fn();
  const completed = {
    ...clip,
    dialogue: 'HARKUN: Begin.',
    dialogueTakeIds: ['audio'],
    selectedDialogueId: 'audio',
    takeIds: ['video'],
    selectedTakeId: 'video',
    production: { visualTakeId: 'video' }
  };
  mount({
    clip: completed,
    draftClip: completed,
    onEdit,
    onSaveScene: vi.fn(),
    prompts: { image: 'The exact image prompt', video: 'The exact video prompt' },
    sceneRows: ['sound-plan', 'shot-plan', 'references'].map((stage) => ({
      stage,
      status: 'approved'
    })),
    rows: rows.map((row) => ({ ...row, status: 'approved' })),
    assets: [
      {
        _id: 'image-asset',
        name: 'Opening image',
        episodeId: 'episode',
        sceneId: 'academy',
        clipId: 'opening',
        revision: 1,
        candidates: [{ id: 'candidate', title: 'Opening still', mediaIds: ['image'] }],
        finalChoice: { id: 'candidate', mediaIds: ['image'] }
      }
    ],
    media: [
      { _id: 'image', kind: 'image', originalName: 'opening.png' },
      { _id: 'audio', kind: 'audio', originalName: 'harkun.wav' },
      { _id: 'video', kind: 'video', originalName: 'opening.mp4' }
    ]
  });
  expect(screen.getByRole('link', { name: 'Download approved video' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Image approved' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Dialogue approved' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Image generation prompt' })).toHaveValue(
    'The exact image prompt'
  );
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Generate video' })).toBeEnabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Video generation prompt' }), {
    target: { value: 'Keep the camera static.' }
  });
  expect(onEdit).toHaveBeenCalledWith({ production: { videoPrompt: 'Keep the camera static.' } });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Generate image' }));
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/shot/image',
    expect.objectContaining({
      body: expect.objectContaining({ prompt: 'The exact image prompt', target })
    })
  );
});

test('shot chat link carries its exact focus and keeps unsaved scene edits in the current tab', () => {
  window.history.replaceState({}, '', '/?project=old-republic-sith-inquisitor');
  mount({ sceneDirty: true });
  const link = screen.getByRole('link', { name: 'Discuss this shot' });
  const url = new URL(link.href);
  expect(url.searchParams.get('episode')).toBe('episode');
  expect(url.searchParams.get('scene')).toBe('academy');
  expect(url.searchParams.get('shot')).toBe('opening');
  expect(url.searchParams.get('project')).toBe('old-republic-sith-inquisitor');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener');
  expect(request).not.toHaveBeenCalled();
  window.history.replaceState({}, '', '/');
});

test('each shot collapses independently while retaining its header, status and mounted prompt draft', async () => {
  const user = userEvent.setup();
  mount({
    onEdit: vi.fn(),
    draftClip: { ...clip, production: { videoPrompt: 'My unsaved shot instructions.' } }
  });
  const prompt = screen.getByRole('textbox', { name: 'Video generation prompt' });
  const discuss = screen.getByRole('link', { name: 'Discuss this shot' });
  await user.click(screen.getByText('Collapse shot'));
  await waitFor(() => expect(discuss).not.toBeVisible());
  expect(screen.getByRole('heading', { name: 'Harkun opens' })).toBeVisible();
  expect(screen.getByText('Image needs approval')).toBeVisible();
  expect(localStorage.getItem('roxy-shot-expanded-episode-academy-opening')).toBe('false');
  await user.click(screen.getByText('Expand shot'));
  await waitFor(() => expect(discuss).toBeVisible());
  expect(screen.getByRole('textbox', { name: 'Video generation prompt' })).toBe(prompt);
  expect(prompt).toHaveValue('My unsaved shot instructions.');
  expect(request).not.toHaveBeenCalled();
});

test('a saved collapsed shot automatically expands when linked to its card', async () => {
  localStorage.setItem('roxy-shot-expanded-episode-academy-opening', 'false');
  window.history.replaceState({}, '', '/');
  mount();
  expect(screen.getByText('Expand shot')).toBeVisible();
  window.history.replaceState({}, '', '/#picture-prerequisites-opening');
  fireEvent(window, new HashChangeEvent('hashchange'));
  expect(await screen.findByText('Collapse shot')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Discuss this shot' })).toBeVisible();
  window.history.replaceState({}, '', '/');
});

test('the image request displays ordered thumbnails and continuity roles and submits that exact attachment list', async () => {
  const selected = ['previous-image', 'ship-image'];
  const onEdit = vi.fn();
  mount({
    onEdit,
    sceneRows: [
      { stage: 'sound-plan', status: 'approved' },
      { stage: 'references', status: 'approved' },
      { stage: 'shot-plan', status: 'approved' }
    ],
    prompts: {
      image: 'Keep the same ship and platform.',
      imageReferences: {
        selected,
        omitted: [],
        items: [
          {
            mediaId: 'previous-image',
            imageNumber: 1,
            title: 'Previous landing shot',
            role: 'Continuity - earlier shot image',
            sourceClipId: 'previous-shot',
            sourceType: 'approved-shot-image'
          },
          { mediaId: 'ship-image', imageNumber: 2, title: 'Transport design', role: 'Ship design' }
        ]
      }
    },
    media: [
      { _id: 'previous-image', kind: 'image', originalName: 'previous.png' },
      { _id: 'ship-image', kind: 'image', originalName: 'ship.png' }
    ]
  });
  expect(screen.getByRole('region', { name: 'Images attached to this request' })).toBeVisible();
  expect(screen.getByText('Image 1 - Continuity - earlier shot image')).toBeVisible();
  expect(screen.getByText('Image 2 - Ship design')).toBeVisible();
  expect(screen.getByAltText('previous.png')).toBeVisible();
  expect(screen.getByAltText('ship.png')).toBeVisible();
  expect(screen.getByText(/video end frames are not extracted automatically/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Review source shot' })).toHaveAttribute(
    'href',
    '#picture-prerequisites-previous-shot'
  );
  expect(request).not.toHaveBeenCalled();
  const fullPrompt = screen.getByRole('textbox', {
    name: 'Complete image prompt sent to OpenArt'
  }).value;
  expect(fullPrompt).toContain('@image1: Continuity - earlier shot image');
  expect(fullPrompt).toContain('@image2: Ship design');
  const imageInput = screen.getByRole('textbox', { name: 'Image generation prompt' });
  imageInput.setSelectionRange(0, 0);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Insert @image2' }));
  expect(onEdit).toHaveBeenCalledWith({
    production: {
      imagePrompt: '@image2 Keep the same ship and platform.',
      imageReferenceMediaIds: selected
    }
  });
  expect(request).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Generate image' }));
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/shot/image',
    expect.objectContaining({
      body: expect.objectContaining({ imageReferenceIds: selected, prompt: fullPrompt })
    })
  );
});

test('image reference controls remove, reorder, add and select character sheets with remapped prompt tags', async () => {
  const onEdit = vi.fn(),
    user = userEvent.setup();
  const items = [
    {
      mediaId: 'roxy',
      imageNumber: 1,
      assetId: 'roxy-asset',
      title: 'Roxy',
      subject: 'Roxy',
      role: 'Character identity',
      view: 'Body turnaround'
    },
    {
      mediaId: 'room',
      imageNumber: 2,
      title: 'Academy trial room',
      subject: 'Academy trial room',
      role: 'Environment / set'
    },
    {
      mediaId: 'harkun',
      imageNumber: 3,
      assetId: 'harkun-asset',
      title: 'Harkun',
      subject: 'Harkun',
      role: 'Character identity',
      view: 'Body turnaround'
    }
  ];
  mount({
    onEdit,
    prompts: {
      imageBase: 'Roxy @image1 faces Harkun @image3 in @image2.',
      imageReferences: {
        selected: ['roxy', 'room', 'harkun'],
        items,
        omitted: [],
        choices: [...items, { mediaId: 'blade', title: 'Training blade', role: 'Prop design' }]
      }
    },
    media: ['roxy', 'room', 'harkun', 'blade'].map((_id) => ({
      _id,
      kind: 'image',
      originalName: _id + '.png'
    }))
  });
  await user.click(screen.getByRole('button', { name: 'Remove image 2' }));
  expect(onEdit).toHaveBeenLastCalledWith({
    production: {
      imageReferenceMediaIds: ['roxy', 'harkun'],
      imagePrompt: 'Roxy @image1 faces Harkun @image2 in Academy trial room.'
    }
  });
  await user.click(screen.getByRole('button', { name: 'Move image 3 earlier' }));
  expect(onEdit).toHaveBeenLastCalledWith({
    production: {
      imageReferenceMediaIds: ['roxy', 'harkun', 'room'],
      imagePrompt: 'Roxy @image1 faces Harkun @image2 in @image3.'
    }
  });
  await user.click(screen.getByRole('button', { name: 'Character sheets only' }));
  expect(onEdit.mock.lastCall[0].production.imageReferenceMediaIds).toEqual(['roxy', 'harkun']);
  await user.type(screen.getByRole('combobox', { name: 'Add image reference' }), 'Training blade');
  await user.click(await screen.findByRole('option', { name: 'Training blade' }));
  expect(onEdit.mock.lastCall[0].production.imageReferenceMediaIds).toEqual([
    'roxy',
    'room',
    'harkun',
    'blade'
  ]);
  await user.click(screen.getByRole('button', { name: 'Remove all references' }));
  expect(onEdit.mock.lastCall[0].production.imageReferenceMediaIds).toEqual([]);
  expect(onEdit.mock.lastCall[0].production.imagePrompt).not.toMatch(/@image\d/);
  expect(request).not.toHaveBeenCalled();
});

test('an exact unsaved selection previews only its images and disables generation until saved', () => {
  const items = [
    { mediaId: 'roxy', imageNumber: 1, title: 'Roxy', role: 'Character identity' },
    { mediaId: 'room', imageNumber: 2, title: 'Academy room', role: 'Environment / set' }
  ];
  mount({
    onEdit: vi.fn(),
    sceneDirty: true,
    draftClip: { ...clip, production: { imageReferenceMediaIds: ['roxy'] } },
    prompts: {
      imageBase: 'Show Roxy.',
      imageReferences: { selected: ['roxy', 'room'], items, omitted: [], choices: items }
    }
  });
  expect(
    screen.getByRole('textbox', { name: 'Complete image prompt sent to OpenArt' }).value
  ).not.toContain('@image2');
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save image setup' })).toBeEnabled();
});

test('the image reference picker enforces the sixteen image limit while allowing removals', async () => {
  const onEdit = vi.fn();
  const items = Array.from({ length: 16 }, (_, i) => ({
    mediaId: `image-${i}`,
    imageNumber: i + 1,
    title: `View ${i}`,
    role: 'Image reference'
  }));
  mount({
    onEdit,
    prompts: {
      imageBase: 'Create one still.',
      imageReferences: {
        selected: items.map((item) => item.mediaId),
        items,
        omitted: [],
        choices: [...items, { mediaId: 'extra', title: 'Extra view' }]
      }
    }
  });
  expect(screen.getByRole('combobox', { name: 'Add image reference' })).toBeDisabled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Remove image 1' }));
  expect(onEdit.mock.lastCall[0].production.imageReferenceMediaIds).toHaveLength(15);
  expect(request).not.toHaveBeenCalled();
});
