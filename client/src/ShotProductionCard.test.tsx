import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.ts';
import ShotProductionCard from './ShotProductionCard.tsx';
import { clipFixture, episodeFixture, reviewFixture, sceneFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';

vi.mock('./api.ts', () => ({ request: vi.fn() }));
const target = {
  scope: 'clip' as const,
  recordId: 'episode',
  sceneId: 'academy',
  clipId: 'opening'
};
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
  title: {
    storyboard: 'Storyboard continuity',
    animatic: 'Timed animatic',
    visual: 'Video picture and performance'
  }[stage],
  key: stage,
  target,
  approvalFingerprint: stage + '-inputs',
  reviewRevision: 0,
  parentRevision: 7,
  fingerprint: stage + '-hash',
  status: stage === 'storyboard' ? ('pending-review' as const) : ('blocked' as const),
  canApprove: stage === 'storyboard',
  blockers: stage === 'animatic' ? ['Approve Storyboard continuity.'] : []
}));
const mount = (props = {}) => {
  const onChanged = vi.fn(),
    onAssetSaved = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <ShotProductionCard
        episode={episodeFixture(episode)}
        scene={sceneFixture(scene)}
        clip={clipFixture(clip)}
        index={0}
        rows={rows.map((value) => reviewFixture(value))}
        sceneRows={[reviewFixture({ stage: 'sound-plan', status: 'approved' as const })]}
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
afterEach(() => vi.restoreAllMocks());

test('shot prompt fields send exact edits and video reference tags insert at the selected caret position', async () => {
  const onEdit = vi.fn();
  mount({
    onEdit,
    clip: { ...clip, dialogue: 'HARKUN: Hello.' },
    prompts: { image: 'Portrait.', video: 'Locked camera.' }
  });
  fireEvent.change(screen.getByLabelText('Image generation prompt'), {
    target: { value: 'Revised portrait.' }
  });
  expect(onEdit).toHaveBeenLastCalledWith({ production: { imagePrompt: 'Revised portrait.' } });
  fireEvent.change(screen.getByLabelText('Action and performance'), {
    target: { value: 'He remains still.' }
  });
  expect(onEdit).toHaveBeenLastCalledWith({ action: 'He remains still.' });
  fireEvent.change(screen.getByLabelText('Exact dialogue with speaker names'), {
    target: { value: 'HARKUN: Begin.' }
  });
  expect(onEdit).toHaveBeenLastCalledWith({ dialogue: 'HARKUN: Begin.' });
  const prompt = screen.getByLabelText('Video generation prompt') as HTMLTextAreaElement;
  prompt.setSelectionRange(1, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Insert @Image1 (start composition)' }));
  expect(onEdit).toHaveBeenLastCalledWith({
    production: { videoPrompt: expect.stringMatching(/^L @Image1 /) }
  });
  prompt.setSelectionRange(0, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Insert @Audio1 (voice reference)' }));
  expect(onEdit).toHaveBeenLastCalledWith({
    production: { videoPrompt: expect.stringMatching(/^@Audio1 /) }
  });
  fireEvent.click(screen.getByRole('link', { name: 'Go to image choices' }));
  fireEvent.click(screen.getByRole('link', { name: 'Go to dialogue choices' }));
  fireEvent.click(screen.getByRole('link', { name: 'Go to video generation' }));
});

test('missing finalized voices show their audition prompt and require an explicit voice generation request', async () => {
  mount({
    clip: { ...clip, dialogue: 'HARKUN: Hello.' },
    voicePrompts: [
      { speaker: 'HARKUN', prompt: 'Adult male, restrained diction.', finalized: false },
      { speaker: 'ROXY', finalized: true }
    ]
  });
  expect(screen.getByLabelText('HARKUN voice audition prompt')).toHaveValue(
    'Adult male, restrained diction.'
  );
  fireEvent.click(screen.getByRole('button', { name: /Generate HARKUN voice auditions/ }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/studio/assistant/voice/generate',
      expect.objectContaining({
        body: expect.objectContaining({
          speaker: 'HARKUN',
          prompt: 'Adult male, restrained diction.'
        })
      })
    )
  );
});

test('approving an image within the shot card updates the asset and refreshes the scene', async () => {
  const image = {
    _id: 'image-asset',
    name: 'Opening image',
    episodeId: 'episode',
    sceneId: 'academy',
    clipId: 'opening',
    revision: 1,
    candidates: [{ id: 'choice', title: 'Composition', mediaIds: ['image'] }]
  };
  vi.mocked(request).mockResolvedValue({ asset: { ...image, revision: 2 } });
  const props = mount({
    assets: [image],
    media: [{ _id: 'image', kind: 'image', originalName: 'Composition.png' }]
  });
  fireEvent.click(screen.getByRole('button', { name: 'Approve image' }));
  await waitFor(() =>
    expect(props.onAssetSaved).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }))
  );
  expect(props.onChanged).toHaveBeenCalledOnce();
});

test('a pending video revision links to that revision without starting a replacement', () => {
  mount({
    proposals: [
      { _id: 'other', targetClipId: 'other' },
      {
        _id: 'revision',
        status: 'pending',
        render: { target: { sceneId: 'academy', clipId: 'opening' } }
      }
    ]
  });
  fireEvent.click(screen.getByRole('link', { name: 'Go to pending revision' }));
  expect(screen.getByRole('button', { name: 'Approve shot & generate video' })).toBeDisabled();
  expect(request).not.toHaveBeenCalled();
});

test('timing blockers offer an explicit preparation request and retain the provider explanation', async () => {
  const timingRows = rows.map((row) => ({
    ...row,
    status: 'blocked',
    canApprove: false,
    blockers: ['Fit selected dialogue.'],
    timingIssues: [{ message: 'Split the long recording.' }]
  }));
  timingRows[0] = { ...timingRows[0], status: 'approved' };
  vi.mocked(request).mockResolvedValue({
    status: 'blocked',
    message: 'A split proposal needs review.'
  });
  mount({ rows: timingRows, clip: { ...clip, dialogue: 'HARKUN: Hello.' } });
  expect(screen.getByText('Split the long recording.')).toBeVisible();
  fireEvent.click(screen.getByRole('link', { name: 'Go to shot image approval' }));
  fireEvent.click(screen.getByRole('link', { name: 'Go to selected dialogue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare split or retimed shots' }));
  await screen.findByText('A split proposal needs review.');
  expect(request).toHaveBeenCalledWith('/studio/workflow/animatic/prepare', {
    method: 'POST',
    body: { target, parentRevision: 7 }
  });
});

test('an active shot request and an invalid prompt point to their specific editor sections', () => {
  const viewProps = { onEdit: vi.fn(), prompts: { image: 'Image.', video: 'Video.' } };
  mount({
    ...viewProps,
    jobs: [
      {
        _id: 'active',
        kind: 'video',
        status: 'queued',
        target: { sceneId: 'academy', clipId: 'opening' }
      }
    ]
  });
  fireEvent.click(screen.getByRole('link', { name: 'Go to video request' }));
  expect(screen.getByRole('button', { name: 'Generate video' })).toBeDisabled();
});

test('a blank prompt and a scene refreshing after save explain their independent blockers', () => {
  const { unmount } = render(
    <ShotProductionCard
      episode={episodeFixture(episode)}
      scene={sceneFixture(scene)}
      clip={clipFixture(clip)}
      index={0}
      rows={rows.map(reviewFixture)}
      sceneRows={[reviewFixture({ stage: 'sound-plan', status: 'approved' })]}
      assets={[]}
      media={[]}
      onEdit={vi.fn()}
      onChanged={vi.fn()}
      renderReview={() => null}
    />
  );
  fireEvent.click(screen.getByRole('link', { name: 'Go to video prompt' }));
  expect(screen.getByText('Add a video prompt before generating this shot.')).toBeVisible();
  unmount();
  mount({
    sceneRefreshing: true,
    onRefreshScene: vi.fn(),
    sceneSaveError: 'Refresh failed',
    onEdit: vi.fn(),
    prompts: { video: 'Motion.' }
  });
  expect(
    screen.getByText('The scene was saved. Refresh its status before generating.')
  ).toBeVisible();
});

test.each([
  { transition: { endImageId: 'next' }, text: 'Generated with start + end image references' },
  { transition: { finalPart: false }, text: 'Generated with start image only' },
  { transition: { finalPart: true }, text: 'Generated with start image only · final part' },
  { imageIds: ['image'], text: 'Generated with one image reference' }
])(
  'saved video provenance stays visible for earlier generation setups: $text',
  ({ text, ...snapshot }) => {
    mount({
      clip: { ...clip, takeIds: ['video'] },
      media: [
        { _id: 'video', kind: 'video', originalName: 'Video.mp4', productionJobId: 'different' }
      ],
      jobs: [
        {
          _id: 'job',
          kind: 'video',
          status: 'ready',
          target: { sceneId: 'academy', clipId: 'opening' },
          resultMediaIds: ['video'],
          snapshot: { ...snapshot, characterReferences: [{ names: ['HARKUN'] }] },
          settings: { params: { mode: 'prime', resolution: '1080p' } }
        }
      ]
    });
    expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByText('Character identity references included: HARKUN')).toBeVisible();
  }
);

test('image reference insertion handles the start and whitespace without losing the current attachment order', () => {
  const onEdit = vi.fn();
  const reference = { mediaId: 'source', imageNumber: 1, title: 'Source', role: 'Source image' };
  mount({
    onEdit,
    prompts: {
      image: 'Portrait of Harkun.',
      video: 'Hold still.',
      imageReferences: {
        items: [reference],
        selected: ['source'],
        choices: [reference],
        omitted: []
      }
    }
  });
  const input = screen.getByLabelText('Image generation prompt') as HTMLTextAreaElement;
  input.setSelectionRange(0, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Insert @image1' }));
  expect(onEdit).toHaveBeenLastCalledWith({
    production: { imagePrompt: '@image1 Portrait of Harkun.', imageReferenceMediaIds: ['source'] }
  });
  input.setSelectionRange(9, 9);
  fireEvent.click(screen.getByRole('button', { name: 'Insert @image1' }));
  expect(onEdit).toHaveBeenLastCalledWith({
    production: { imagePrompt: 'Portrait @image1 of Harkun.', imageReferenceMediaIds: ['source'] }
  });
  input.setSelectionRange(input.value.length, input.value.length);
  fireEvent.click(screen.getByRole('button', { name: 'Insert @image1' }));
  expect(onEdit).toHaveBeenLastCalledWith({
    production: { imagePrompt: 'Portrait of Harkun. @image1 ', imageReferenceMediaIds: ['source'] }
  });
  fireEvent.change(input, { target: { value: 'Revised portrait.' } });
  expect(onEdit).toHaveBeenLastCalledWith({
    production: { imagePrompt: 'Revised portrait.', imageReferenceMediaIds: ['source'] }
  });
});

test.each([{ blockers: undefined }, { blockers: ['Review saved timing.'] }])(
  'timing review uses available blockers and a fallback when no detailed issues exist: %j',
  ({ blockers }) => {
    const timingRows = rows.map((row) =>
      row.stage === 'storyboard'
        ? { ...row, status: 'approved' }
        : { ...row, canApprove: false, blockers, timingIssues: [] }
    );
    mount({ rows: timingRows });
    expect(
      screen.getByText(blockers?.[0] || 'Review this shot’s timing before generating its video.')
    ).toBeVisible();
  }
);

test('unknown historical modes and failed jobs stay visible alongside scene save feedback', () => {
  mount({
    onEdit: vi.fn(),
    onRejected: vi.fn(),
    disabled: true,
    sceneSaveNotice: 'Scene saved.',
    prompts: { video: 'Hold still.' },
    episode: { ...episode, scenes: undefined },
    clip: { ...clip, dialogue: undefined, takeIds: ['video'] },
    media: [{ _id: 'video', kind: 'video', originalName: 'Take.mp4' }],
    jobs: [
      {
        _id: 'image-job',
        kind: 'image',
        title: 'Image',
        status: 'failed',
        target: { sceneId: 'academy', clipId: 'opening' }
      },
      {
        _id: 'video-job',
        kind: 'video',
        status: 'ready',
        target: { sceneId: 'academy', clipId: 'opening' },
        resultMediaIds: ['video'],
        settings: { mode: 'historical-mode', params: { mode: 'standard', resolution: '1080p' } }
      }
    ],
    proposals: [
      {
        _id: 'unrelated',
        targetClipId: 'opening',
        render: { target: { sceneId: 'other', clipId: 'other' } }
      }
    ]
  });
  expect(screen.getByText('historical-mode')).toBeVisible();
  expect(screen.getByText('Scene saved.')).toBeVisible();
  expect(screen.getByText('This scene is being saved. Wait for the save to finish.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Reject & delete' })).toBeDisabled();
  expect(screen.getByText('Generated with Wan 3.0 Standard · 1080p')).toBeVisible();
});

test('timed effect descriptions appear in the exact video prompt, including legacy cues with no ID', () => {
  mount({
    onEdit: vi.fn(),
    prompts: { video: 'A locked shot.' },
    scene: {
      ...scene,
      soundPlan: {
        layers: [
          {
            id: '',
            type: 'effect',
            clipId: 'opening',
            description: 'A short cloth rustle.',
            start: 1,
            duration: 1
          }
        ]
      }
    }
  });
  expect(
    (screen.getByLabelText('Complete video prompt sent to Wan') as HTMLTextAreaElement).value
  ).toContain('Effect 1–2s: A short cloth rustle.');
});

test('generation without a provider message uses a saved receipt and errors retain the original conflict when refresh fails', async () => {
  const onChanged = vi.fn();
  vi.mocked(request).mockResolvedValueOnce({});
  mount({ onChanged });
  fireEvent.click(screen.getByRole('button', { name: 'Approve shot & generate video' }));
  await screen.findByText('Saved.');
  vi.mocked(request).mockRejectedValueOnce(
    Object.assign(new Error('Inputs changed'), { status: 409 })
  );
  onChanged.mockRejectedValueOnce(new Error('Refresh offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Approve shot & generate video' }));
  await screen.findByText('Inputs changed');
  vi.mocked(request).mockRejectedValueOnce(new Error('Provider offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Approve shot & generate video' }));
  await screen.findByText('Provider offline');
});

test('a shot ready for timed review can generate directly and links to its exact timing approval', () => {
  mount({
    onEdit: vi.fn(),
    clip: {
      ...clip,
      dialogue: 'ROXY: Hello.',
      selectedDialogueId: 'voice',
      production: { videoPrompt: 'Roxy speaks. Locked camera.' }
    },
    rows: rows.map((row) => ({
      ...row,
      status: row.stage === 'storyboard' ? 'approved' : 'needs-review',
      canApprove: true,
      blockers: []
    }))
  });
  expect(screen.getByText(/Ready to generate this shot/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Generate video' })).toBeEnabled();
  expect(screen.getByRole('link', { name: 'Go to Timed animatic' })).toHaveAttribute(
    'href',
    '#review-clip--episode--academy--opening--animatic'
  );
  expect(screen.getByRole('link', { name: 'Go to dialogue choices' })).toHaveAttribute(
    'href',
    '#shot-dialogue-opening'
  );
  expect(screen.getByRole('link', { name: 'Go to video generation' })).toHaveAttribute(
    'href',
    '#shot-video-generation-opening'
  );
  expect(request).not.toHaveBeenCalled();
});

test('unsaved mobile scene edits offer an inline save beside the disabled video button', async () => {
  const onSaveScene = vi.fn();
  const onUseSavedScene = vi.fn();
  mount({
    onEdit: vi.fn(),
    sceneDirty: true,
    disabled: true,
    onSaveScene,
    sceneSaveError: 'This scene has conflicting edits: video prompt.',
    onUseSavedScene
  });
  expect(screen.getByText('This scene has conflicting edits: video prompt.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Generate video' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Save scene to continue' }));
  expect(onSaveScene).toHaveBeenCalledOnce();
  await userEvent.click(
    screen.getByRole('button', { name: 'Keep local draft and use saved scene' })
  );
  expect(onUseSavedScene).toHaveBeenCalledOnce();
  expect(request).not.toHaveBeenCalled();
});

test('a rejected generation refreshes changed inputs without submitting the video again', async () => {
  vi.mocked(request).mockRejectedValue(
    Object.assign(new Error('This shot review changed.'), { status: 409 })
  );
  const { onChanged } = mount({
    onEdit: vi.fn(),
    clip: { ...clip, production: { videoPrompt: 'Locked camera. A stationary character.' } }
  });
  await userEvent.click(screen.getByRole('button', { name: 'Generate video' }));
  expect(await screen.findByText('This shot review changed.')).toBeVisible();
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledTimes(1);
});

test('an oversized video prompt explains the disabled button and links directly to the prompt', () => {
  mount({
    onEdit: vi.fn(),
    clip: { ...clip, production: { videoPrompt: 'Keep the room fixed. '.repeat(250) } }
  });
  expect(screen.getByText(/The complete video prompt is .*the limit is 4500/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Generate video' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Go to video prompt' })).toHaveAttribute(
    'href',
    '#shot-video-prompt-opening'
  );
});

test('a shot blocked by scene preparation links to the actual shared approval and local image', () => {
  const sceneTarget = { scope: 'scene' as const, recordId: 'episode', sceneId: 'academy' };
  mount({
    onEdit: vi.fn(),
    sceneRows: [
      { stage: 'sound-plan', status: 'approved' as const },
      {
        key: 'plan',
        title: 'Shot plan',
        stage: 'shot-plan',
        status: 'needs-review' as const,
        target: sceneTarget
      }
    ],
    rows: rows.map((row) => ({ ...row, status: 'blocked' as const, canApprove: false }))
  });
  expect(screen.getByRole('link', { name: 'Go to Shot plan' })).toHaveAttribute(
    'href',
    '#review-scene--episode--academy----shot-plan'
  );
  expect(screen.getByRole('link', { name: 'Go to shot image approval' })).toHaveAttribute(
    'href',
    '#shot-image-choices-opening'
  );
  expect(screen.getByRole('button', { name: 'Generate video' })).toBeDisabled();
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
          type: 'effect' as const,
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
        kind: 'character' as const,
        name: 'Overseer Harkun',
        finalChoice: { mediaIds: ['identity'] }
      }
    ],
    media: [{ _id: 'identity', kind: 'image' as const, originalName: 'Harkun identity.png' }]
  });
  const complete = screen.getByRole('textbox', { name: 'Complete video prompt sent to Wan' });
  expect((complete as HTMLInputElement | HTMLTextAreaElement).value).toContain(
    'HARKUN = @Image2 identity'
  );
  expect((complete as HTMLInputElement | HTMLTextAreaElement).value).toContain(
    'Effect 1–3s: Robe movement.'
  );
  expect((complete as HTMLInputElement | HTMLTextAreaElement).value).toContain(
    'Preserve custom room tone.'
  );
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
    expect.objectContaining({
      body: expect.objectContaining({
        prompt: (complete as HTMLInputElement | HTMLTextAreaElement).value
      })
    })
  );
});

test('video identity controls remove, reorder and add independently of image attachments without generating', async () => {
  const user = userEvent.setup(),
    onEdit = vi.fn();
  const assets = ['Harkun', 'Roxy', 'Kory'].map((name) => ({
    _id: name.toLowerCase(),
    name,
    kind: 'character' as const,
    finalChoice: { mediaIds: [name + '-image'] }
  }));
  const speaking = {
    ...clip,
    dialogue: 'HARKUN: Hello.',
    production: {
      videoReferenceMediaIds: ['Harkun-image', 'Roxy-image'],
      imageReferenceMediaIds: ['composition'],
      videoPrompt: 'HARKUN from Image 2 faces ROXY from Image 3.'
    }
  };
  mount({
    clip: speaking,
    onEdit,
    assets,
    media: assets.map((a) => ({
      _id: a.finalChoice.mediaIds[0],
      kind: 'image' as const,
      originalName: a.name + '.png'
    }))
  });
  const editor = screen.getByRole('region', { name: 'Video identity references' });
  await user.click(within(editor).getByRole('button', { name: 'Remove video image 3' }));
  expect(onEdit).toHaveBeenLastCalledWith({
    production: expect.objectContaining({ videoReferenceMediaIds: ['Harkun-image'] })
  });
  await user.click(within(editor).getByRole('button', { name: 'Move video image 2 later' }));
  expect(onEdit).toHaveBeenLastCalledWith({
    production: {
      videoReferenceMediaIds: ['Roxy-image', 'Harkun-image'],
      videoPrompt: expect.stringContaining('HARKUN from @Image3 faces ROXY from @Image2')
    }
  });
  await user.click(within(editor).getByRole('combobox', { name: 'Add video character reference' }));
  await user.click(await screen.findByRole('option', { name: 'Kory' }));
  expect(onEdit).toHaveBeenLastCalledWith({
    production: expect.objectContaining({
      videoReferenceMediaIds: ['Harkun-image', 'Roxy-image', 'Kory-image']
    })
  });
  await user.click(
    within(editor).getByRole('button', { name: 'Remove all video identity references' })
  );
  expect(onEdit).toHaveBeenLastCalledWith({
    production: expect.objectContaining({ videoReferenceMediaIds: [] })
  });
  expect(speaking.production.imageReferenceMediaIds).toEqual(['composition']);
  expect(request).not.toHaveBeenCalled();
});

test('automatic video identities include non-speaking characters selected for this shot image', () => {
  const assets = ['Harkun', 'Roxy', 'Kory'].map((name) => ({
    _id: name.toLowerCase(),
    name,
    kind: 'character' as const,
    finalChoice: { mediaIds: [name + '-image'] }
  }));
  const speaking = {
    ...clip,
    dialogue: 'HARKUN: Listen.',
    action: 'Harkun addresses Roxy and acolytes.',
    production: {
      referenceAssetIds: ['harkun', 'roxy'],
      imageReferenceMediaIds: ['Roxy-image', 'Kory-image'],
      videoPrompt: 'Harkun addresses Roxy and the listening group. Only Harkun speaks.'
    }
  };
  mount({
    clip: speaking,
    scene: { ...scene, assetIds: ['harkun', 'roxy'], clips: [speaking] },
    onEdit: vi.fn(),
    assets,
    media: assets.map((a) => ({
      _id: a.finalChoice.mediaIds[0],
      kind: 'image' as const,
      originalName: a.name + '.png'
    }))
  });
  const references = screen.getByRole('region', { name: 'Video identity references' });
  expect(within(references).getByRole('article', { name: /KORY/ })).toBeVisible();
  expect(within(references).getAllByRole('article')).toHaveLength(3);
  expect(
    (
      screen.getByRole('textbox', { name: 'Complete video prompt sent to Wan' }) as
        HTMLInputElement | HTMLTextAreaElement
    ).value
  ).toMatch(/KORY = @Image\d identity/);
  expect(request).not.toHaveBeenCalled();
});

test('the shot previews Standard without end-image controls or end-image prompt instructions', async () => {
  const user = userEvent.setup();
  const first = {
    ...clip,
    title: 'Exchange - part 1 of 2',
    duration: 7,
    dialogue: 'HARKUN: Hello.',
    production: {
      videoEndFrame: { mode: 'image', assetId: 'next', mediaId: 'image-1' },
      videoPrompt:
        'Begin with Image 1 and move toward Image 2 at 7 seconds. Preserve the room. HARKUN says: "Hello."'
    }
  };
  const second = { ...clip, id: 'next', title: 'Exchange - part 2 of 2' };
  const localScene = { ...scene, clips: [first, second] };
  mount({
    clip: first,
    scene: localScene,
    episode: { ...episode, scenes: [localScene] },
    onEdit: vi.fn()
  });
  expect(screen.getByText(/Next generation: Wan 3\.0 Standard.*1080p.*16:9/)).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'End image (optional)' })).not.toBeInTheDocument();
  expect(
    screen.queryByRole('textbox', { name: 'Start/end reference instructions' })
  ).not.toBeInTheDocument();
  const prompt = (
    screen.getByRole('textbox', { name: 'Complete video prompt sent to Wan' }) as
      HTMLInputElement | HTMLTextAreaElement
  ).value;
  expect(prompt).not.toMatch(/@Image2|ending composition|END reference/);
  expect(prompt).toContain('Generate one continuous shot');
  expect(first.production.videoEndFrame.mediaId).toBe('image-1');
  await user.click(screen.getByRole('button', { name: 'Generate video' }));
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/shot/approve',
    expect.objectContaining({ body: expect.objectContaining({ prompt }) })
  );
  expect(vi.mocked(request).mock.calls.at(-1)[1].body).not.toHaveProperty('transitionImageIds');
});

test('prompt fields and Generate video use the same generator-only text while saved originals are retained', async () => {
  const user = userEvent.setup();
  const original =
    'ACTION: Keep the camera fixed.\nAUDIO: No background music. Music is added later in CapCut.\nWORKFLOW: Review before generating.';
  const stored = { ...clip, production: { videoPrompt: original, imagePrompt: original } };
  mount({ clip: stored, onEdit: vi.fn() });
  const shown = (
    screen.getByRole('textbox', { name: 'Video generation prompt' }) as
      HTMLInputElement | HTMLTextAreaElement
  ).value;
  expect(shown).toContain('No background music.');
  expect(shown).not.toContain('CapCut');
  expect(shown).not.toContain('WORKFLOW');
  expect(
    (
      screen.getByRole('textbox', { name: 'Image generation prompt' }) as
        HTMLInputElement | HTMLTextAreaElement
    ).value
  ).toBe(shown);
  await user.click(screen.getByRole('button', { name: 'Generate video' }));
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/shot/approve',
    expect.objectContaining({
      body: expect.objectContaining({
        prompt: (
          screen.getByRole('textbox', { name: 'Complete video prompt sent to Wan' }) as
            HTMLInputElement | HTMLTextAreaElement
        ).value
      })
    })
  );
  expect(stored.production.videoPrompt).toBe(original);
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
  const improved = (
    screen.getByRole('textbox', { name: 'Video generation prompt' }) as
      HTMLInputElement | HTMLTextAreaElement
  ).value;
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
        prompt: (
          screen.getByRole('textbox', { name: 'Complete video prompt sent to Wan' }) as
            HTMLInputElement | HTMLTextAreaElement
        ).value
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
      { _id: 'start', kind: 'image' as const, originalName: 'final.png' },
      { _id: 'video', kind: 'video' as const, originalName: 'approved.mp4' }
    ]
  });
  expect(screen.getByRole('button', { name: 'Generate video' })).toBeEnabled();
  expect(screen.queryByText(/Image 2 · End reference/)).not.toBeInTheDocument();
  expect(screen.getByText(/Next generation: Wan 3\.0 Standard.*1080p.*16:9/)).toBeVisible();
  expect(screen.getAllByRole('link', { name: 'Download video' })).toHaveLength(2);
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
        kind: 'video' as const,
        status: 'rendering' as const,
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
        kind: 'video' as const,
        status: 'rendering' as const,
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
    media: [{ _id: 'audio', kind: 'audio' as const, originalName: 'harkun.wav' }]
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
    vi.mocked(request).mockResolvedValue({
      deletedMediaId: choice,
      changed: { episodes: ['episode'] }
    });
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
        kind: 'audio' as const,
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
    media: [{ _id: 'approved', kind: 'audio' as const, originalName: 'approved.wav' }]
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
    rows: rows.map((row) =>
      row.stage === 'animatic' ? { ...row, status: 'approved' as const } : row
    ),
    media: [{ _id: 'video', kind: 'video' as const, originalName: 'opening.mp4' }]
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
    rows: rows.map((row) => ({ ...row, status: 'approved' as const })),
    media: [{ _id: 'video', kind: 'video' as const, originalName: 'opening.mp4' }]
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
      status: 'approved' as const
    })),
    rows: rows.map((row) => ({ ...row, status: 'approved' as const })),
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
      { _id: 'image', kind: 'image' as const, originalName: 'opening.png' },
      { _id: 'audio', kind: 'audio' as const, originalName: 'harkun.wav' },
      { _id: 'video', kind: 'video' as const, originalName: 'opening.mp4' }
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
  const url = new URL((link as HTMLAnchorElement).href);
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
  const collapse = screen.getByRole('button', { name: 'Collapse shot' });
  expect(collapse).toHaveAttribute('aria-expanded', 'true');
  expect(collapse).toHaveAttribute('aria-controls', 'picture-prerequisites-opening-content');
  await user.click(collapse);
  await waitFor(() => expect(discuss).not.toBeVisible());
  expect(screen.getByRole('heading', { name: 'Harkun opens' })).toBeVisible();
  expect(screen.getByText('Image needs approval')).toBeVisible();
  expect(localStorage.getItem('roxy-shot-expanded-episode-academy-opening')).toBe('false');
  expect(screen.getByRole('button', { name: 'Expand shot' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await user.click(screen.getByRole('button', { name: 'Expand shot' }));
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
      { stage: 'sound-plan', status: 'approved' as const },
      { stage: 'references', status: 'approved' as const },
      { stage: 'shot-plan', status: 'approved' as const }
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
      { _id: 'previous-image', kind: 'image' as const, originalName: 'previous.png' },
      { _id: 'ship-image', kind: 'image' as const, originalName: 'ship.png' }
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
  const fullPrompt = (
    screen.getByRole('textbox', {
      name: 'Complete image prompt sent to OpenArt'
    }) as HTMLInputElement | HTMLTextAreaElement
  ).value;
  expect(fullPrompt).toContain('@image1: Continuity - earlier shot image');
  expect(fullPrompt).toContain('@image2: Ship design');
  const imageInput = screen.getByRole('textbox', { name: 'Image generation prompt' });
  (imageInput as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(0, 0);
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
      kind: 'image' as const,
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
    (
      screen.getByRole('textbox', { name: 'Complete image prompt sent to OpenArt' }) as
        HTMLInputElement | HTMLTextAreaElement
    ).value
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

test('a saved video take can be rejected without first changing its approval', async () => {
  const onRejected = vi.fn();
  vi.mocked(request).mockResolvedValue({ deletedMediaId: 'video' });
  mount({
    onRejected,
    clip: { ...clip, takeIds: ['video'] },
    media: [{ _id: 'video', kind: 'video', originalName: 'take.mp4' }]
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reject & delete' }));
  await waitFor(() => expect(onRejected).toHaveBeenCalledWith({ deletedMediaId: 'video' }));
});
