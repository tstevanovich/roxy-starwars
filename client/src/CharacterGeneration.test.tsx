import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type * as Studio from '../../shared/types.ts';
import { request } from './api.ts';
import CharacterGeneration from './CharacterGeneration.tsx';
import CharacterSheets from './CharacterSheets.tsx';
import { assetFixture, mediaFixture, reviewFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';

vi.mock('./api.ts', () => ({ request: vi.fn() }));
const asset = {
  _id: 'character',
  kind: 'character' as const,
  name: 'Kory',
  revision: 4,
  production: {
    items: [
      {
        id: 'master-portrait',
        title: 'Master portrait',
        type: 'image' as const,
        required: true,
        notes: 'Portrait.',
        mediaId: null,
        imagePrompt: 'A complete portrait prompt.'
      },
      {
        id: 'rear',
        title: 'Rear view',
        type: 'image' as const,
        required: true,
        notes: 'Rear.',
        mediaId: null,
        imagePrompt: 'A complete rear prompt.'
      }
    ]
  }
};
const initial = {
  asset,
  voice: null,
  speaker: 'Kory',
  voicePrompt: 'An adult female voice with crisp diction.',
  images: asset.production.items.map((item) => ({
    itemId: item.id,
    title: item.title,
    prompt: item.imagePrompt,
    blockers: [],
    plan: null
  })),
  jobs: []
};
let state;
beforeEach(() => {
  history.replaceState(null, '', '/');
  localStorage.clear();
  state = structuredClone(initial);
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async (path, options) => {
      if (path === '/studio/assistant/character-generation/character/voice') {
        state.voice = {
          _id: 'voice',
          revision: 0,
          production: { voiceDescription: (options.body as { prompt: string }).prompt },
          candidates: []
        };
        state.voicePrompt = (options.body as { prompt: string }).prompt;
        return { voice: state.voice };
      }
      if (path === '/studio/assets/character') {
        state.asset = {
          ...(options.body as Record<string, unknown>),
          revision: state.asset.revision + 1
        };
        state.images = state.asset.production.items
          .filter((item) => item.type === 'image')
          .map((item) => ({
            ...(state.images.find((image) => image.itemId === item.id) ?? {
              blockers: [],
              plan: null
            }),
            itemId: item.id,
            title: item.title,
            mediaId: item.mediaId,
            prompt: item.imagePrompt ?? 'Complete prompt for ' + item.title
          }));
        return { asset: state.asset };
      }
      if (path === '/studio/assistant/character-generation/character')
        return structuredClone(state);
      return {};
    });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function mount(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <CharacterGeneration
        asset={assetFixture(asset)}
        media={[]}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        {...props}
      />
    </ThemeProvider>
  );
}
test('character voice and every image prompt are visible before any generation; saving is independent', async () => {
  const user = userEvent.setup();
  mount();
  const voice = await screen.findByRole('textbox', { name: 'Voice generation prompt' });
  expect(voice).toHaveValue(initial.voicePrompt);
  expect(screen.getByRole('textbox', { name: 'Master portrait image prompt' })).toHaveValue(
    'A complete portrait prompt.'
  );
  expect(screen.getByRole('textbox', { name: 'Rear view image prompt' })).toHaveValue(
    'A complete rear prompt.'
  );
  expect(
    vi.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')
  ).toHaveLength(0);
  fireEvent.change(voice, { target: { value: 'An adult female voice, warm and expressive.' } });
  await user.click(screen.getByRole('button', { name: 'Save voice prompt' }));
  expect(await screen.findByText('Voice prompt saved. No auditions generated.')).toBeVisible();
  expect(
    vi.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')
  ).toHaveLength(0);
  expect(state.asset).toEqual(asset);
  await user.click(screen.getByRole('button', { name: 'Generate voice auditions' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/studio/assistant/voice/generate',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          target: { assetId: 'voice' },
          prompt: 'An adult female voice, warm and expressive.'
        })
      })
    )
  );
  expect(
    vi.mocked(request).mock.calls.filter(([path]) => path === '/studio/assistant/image/generate')
  ).toHaveLength(0);
});
test('one image prompt saves separately and only its Generate button requests an image', async () => {
  const user = userEvent.setup();
  mount();
  const prompt = await screen.findByRole('textbox', { name: 'Rear view image prompt' });
  fireEvent.change(prompt, {
    target: { value: 'Photographic rear view; preserve the exact red costume.' }
  });
  await user.click(screen.getByRole('button', { name: 'Save rear view prompt' }));
  expect(await screen.findByText('Rear view prompt saved. No image generated.')).toBeVisible();
  expect(state.asset.production.items[0]).toEqual(asset.production.items[0]);
  expect(
    vi.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')
  ).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Generate rear view' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/studio/assistant/image/generate',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          packageItemId: 'rear',
          prompt: 'Photographic rear view; preserve the exact red costume.'
        })
      })
    )
  );
  expect(
    vi.mocked(request).mock.calls.filter(([path]) => path === '/studio/assistant/voice/generate')
  ).toHaveLength(0);
});

test('returning from chat refreshes voice changes even when character revision is unchanged and preserves local drafts explicitly', async () => {
  const user = userEvent.setup();
  mount();
  const prompt = await screen.findByRole('textbox', { name: 'Voice generation prompt' });
  state.voicePrompt = 'Updated in chat: female British voice with crisp delivery.';
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(prompt).toHaveValue(state.voicePrompt));
  fireEvent.change(prompt, { target: { value: 'Keep my unsaved local wording.' } });
  state.voicePrompt = 'A newer saved voice direction from chat.';
  fireEvent(window, new Event('focus'));
  expect(await screen.findByText(state.voicePrompt)).toBeInTheDocument();
  expect(prompt).toHaveValue('Keep my unsaved local wording.');
  expect(screen.getByText(/This field contains an unsaved local voice prompt/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Use saved voice prompt' }));
  expect(prompt).toHaveValue('A newer saved voice direction from chat.');
  expect(
    vi
      .mocked(request)
      .mock.calls.filter(([, options]) => options?.method === 'POST' || options?.method === 'PUT')
  ).toHaveLength(0);
});

test('rejecting voice auditions sends the voice revision and refreshes it before the next rejection', async () => {
  const user = userEvent.setup();
  state.voice = {
    _id: 'voice',
    revision: 7,
    production: { voiceDescription: state.voicePrompt },
    candidates: [
      { id: 'audition-1', title: 'Audition one', mediaIds: ['audio-1'] },
      { id: 'audition-2', title: 'Audition two', mediaIds: ['audio-2'] }
    ]
  };
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (options?.method === 'DELETE') {
      expect((options.body as { revision: number }).revision).toBe(state.voice.revision);
      const id = path.split('/').at(-1);
      state.voice.candidates = state.voice.candidates.filter(
        (option) => !option.mediaIds.includes(id)
      );
      state.voice.revision++;
      return { deletedMediaId: id, changed: { assets: ['voice'] } };
    }
    return original(path, options);
  });
  mount({
    media: [
      { _id: 'audio-1', kind: 'audio' as const, originalName: 'Audition one.mp3' },
      { _id: 'audio-2', kind: 'audio' as const, originalName: 'Audition two.mp3' }
    ]
  });
  const buttons = await screen.findAllByRole('button', { name: 'Reject & delete' });
  await user.click(buttons[0]);
  await waitFor(() => expect(screen.queryByText('Audition one')).not.toBeInTheDocument());
  expect(request).toHaveBeenCalledWith('/studio/media/audio-1', {
    method: 'DELETE',
    body: { assetId: 'voice', revision: 7, candidateId: 'audition-1' }
  });
  await user.click(screen.getByRole('button', { name: 'Reject & delete' }));
  await waitFor(() => expect(screen.queryByText('Audition two')).not.toBeInTheDocument());
  expect(request).toHaveBeenCalledWith('/studio/media/audio-2', {
    method: 'DELETE',
    body: { assetId: 'voice', revision: 8, candidateId: 'audition-2' }
  });
  expect(state.asset).toEqual(asset);
  expect(vi.mocked(request).mock.calls.some(([path]) => path.includes('/generate'))).toBe(false);
});

test('a portrait-only package has an actionable setup link and adds missing views without replacing the portrait or generating images', async () => {
  const user = userEvent.setup();
  const master = {
    ...asset.production.items[0],
    mediaId: 'approved-master',
    imagePrompt: 'Keep the approved portrait directions.'
  };
  const partial = {
    ...asset,
    sheetLayout: 'production-package',
    production: { ...asset.production, items: [master] },
    finalChoice: null,
    candidates: [],
    characterSheets: []
  };
  state.asset = structuredClone(partial);
  state.images = [
    {
      itemId: master.id,
      title: master.title,
      mediaId: master.mediaId,
      prompt: master.imagePrompt,
      blockers: [],
      plan: null
    }
  ];
  function Editor() {
    const [current, setCurrent] = useState<Studio.Asset>(assetFixture(partial));
    return (
      <>
        <CharacterGeneration asset={assetFixture(current)} media={[]} onSaved={setCurrent} />
        <CharacterSheets asset={assetFixture(current)} media={[]} onSaved={setCurrent} />
      </>
    );
  }
  render(
    <ThemeProvider theme={theme}>
      <Editor />
    </ThemeProvider>
  );
  const setup = await screen.findByRole('button', { name: 'Add remaining reference views' });
  expect(screen.getByRole('link', { name: 'Go to reference setup' })).toHaveAttribute(
    'href',
    '#' + setup.id
  );
  await user.click(setup);
  expect(await screen.findByRole('button', { name: 'Generate body turnaround' })).toBeEnabled();
  expect(state.asset.production.items.find((item) => item.id === 'master-portrait')).toEqual(
    master
  );
  expect(screen.getByRole('link', { name: 'Go to body turnaround' })).toHaveAttribute(
    'href',
    '#asset-image-generation-character--body-turnaround'
  );
  expect(screen.getByRole('region', { name: 'Body turnaround generation' })).toContainElement(
    screen.getByRole('button', { name: 'Generate body turnaround' })
  );
  expect(
    vi.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')
  ).toHaveLength(0);
});

test('generation saves an edited image prompt and approves its exact plan before requesting that image', async () => {
  state.images[0].plan = reviewFixture({
    target: { scope: 'asset', recordId: 'character' },
    stage: 'package-plan',
    status: 'pending-review',
    fingerprint: 'plan'
  });
  mount();
  fireEvent.change(await screen.findByLabelText('Master portrait image prompt'), {
    target: { value: 'Natural face, neutral lighting.' }
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Approve prompt & generate master portrait' })
  );
  await screen.findByText('One master portrait image requested. Other views are unchanged.');
  const calls = vi.mocked(request).mock.calls;
  const save = calls.findIndex(([path]) => path === '/studio/assets/character');
  const approval = calls.findIndex(([path]) => path === '/studio/workflow/review');
  const generate = calls.findIndex(([path]) => path === '/studio/assistant/image/generate');
  expect(save).toBeLessThan(approval);
  expect(approval).toBeLessThan(generate);
  expect(calls[generate][1].body).toMatchObject({
    prompt: 'Natural face, neutral lighting.',
    revision: 5
  });
});

test('voice approval retains image choices and the approved voice remains visible', async () => {
  state.voice = {
    _id: 'voice',
    revision: 2,
    production: { voiceDescription: state.voicePrompt },
    candidates: [
      { id: 'one', title: 'Audition', mediaIds: ['voice-audio', 'missing'] },
      { id: 'archived', archived: true },
      { id: 'empty', title: 'Empty option' }
    ],
    finalChoice: { id: 'old' }
  };
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path.endsWith('/voice/finalize')) {
      state.voice.finalChoice = { id: 'one' };
      return { asset: state.voice };
    }
    return original(path, options);
  });
  mount({
    media: [mediaFixture({ _id: 'voice-audio', kind: 'audio', originalName: 'Audition.wav' })]
  });
  await screen.findByLabelText('Audition.wav');
  expect(screen.getByText('Approved voice retained')).toBeVisible();
  fireEvent.click(screen.getAllByRole('button', { name: 'Approve this voice' })[0]);
  await screen.findByText('Voice approved. Character images are unchanged.');
  expect(screen.getByRole('button', { name: 'Approved voice' })).toBeDisabled();
  expect(request).toHaveBeenCalledWith('/studio/assets/voice/finalize', {
    method: 'POST',
    body: { revision: 2, candidateId: 'one' }
  });
});

test('voice-only pages link to their approved character evidence and save the voice record independently', async () => {
  state.asset = { ...state.asset, kind: 'voice' };
  state.voice = {
    ...state.asset,
    _id: 'voice',
    production: { voiceDescription: 'Saved voice' },
    candidates: []
  };
  state.characterSource = { assetId: 'source-character', name: 'Kory', status: 'approved' };
  const onSaved = vi.fn();
  mount({ asset: assetFixture(state.asset), onSaved });
  await screen.findByText('Character source evidence approved');
  expect(screen.getByRole('link', { name: 'Open character images' })).toHaveAttribute(
    'href',
    expect.stringContaining('source-character')
  );
  expect(screen.getByRole('link', { name: 'View character source evidence' })).toBeVisible();
  fireEvent.change(screen.getByLabelText('Voice generation prompt'), {
    target: { value: 'New voice description' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save voice prompt' }));
  await screen.findByText('Voice prompt saved. No auditions generated.');
  expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ _id: 'voice' }));
});

test('voice generation reuses a saved description and reports request failures without changing prompts', async () => {
  state.voice = {
    _id: 'voice',
    production: { voiceDescription: state.voicePrompt },
    candidates: []
  };
  mount();
  await screen.findByLabelText('Voice generation prompt');
  vi.mocked(request).mockRejectedValueOnce(new Error('Voice provider offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate voice auditions' }));
  expect(await screen.findByText('Voice provider offline')).toBeVisible();
  expect(screen.getByLabelText('Voice generation prompt')).toHaveValue(initial.voicePrompt);
  expect(request).toHaveBeenCalledWith(
    '/studio/assistant/voice/generate',
    expect.objectContaining({ body: expect.objectContaining({ target: { assetId: 'voice' } }) })
  );
});

test('image references update the complete prompt and save the chosen attachment list', async () => {
  const reference = {
    mediaId: 'source',
    title: 'Gameplay',
    filename: 'Source.png',
    role: 'Source evidence',
    imageNumber: 1
  };
  state.images[0].imageReferences = {
    items: [reference],
    selected: ['source'],
    choices: [reference],
    omittedItems: []
  };
  mount({ media: [mediaFixture({ _id: 'source', originalName: 'Source.png' })] });
  const section = await screen.findByRole('region', { name: 'Master portrait generation' });
  fireEvent.click(within(section).getByRole('button', { name: 'Insert @image1' }));
  expect(
    (within(section).getByLabelText('Master portrait image prompt') as HTMLTextAreaElement).value
  ).toContain('@image1');
  fireEvent.click(within(section).getByRole('button', { name: 'Remove all references' }));
  expect(
    within(section).getByText('No reference images are attached to this request.')
  ).toBeVisible();
  fireEvent.click(within(section).getByRole('button', { name: 'Save master portrait prompt' }));
  await screen.findByText(/Master portrait prompt saved/);
  expect(
    vi.mocked(request).mock.calls.find(([path]) => path === '/studio/assets/character')[1].body
  ).toMatchObject({
    production: {
      items: [expect.objectContaining({ imageReferenceMediaIds: [] }), expect.anything()]
    }
  });
});

test('image blockers have a direct creative brief link, and existing generated images remain reviewable', async () => {
  state.images[0].blockers = ['Approve Creative brief.'];
  state.images[0].job = { status: 'failed', error: 'Generation failed' };
  state.images[0].mediaId = 'portrait';
  state.images[1].blockers = ['Approve master portrait.'];
  state.images[1].job = { status: 'ready' };
  mount({ media: [mediaFixture({ _id: 'portrait', originalName: 'Portrait.png' })] });
  const section = await screen.findByRole('region', { name: 'Master portrait generation' });
  expect(within(section).getByRole('link', { name: 'Review creative brief' })).toHaveAttribute(
    'href',
    '#review-asset--character------brief'
  );
  expect(screen.getByAltText('Portrait.png')).toBeVisible();
  expect(within(section).getByRole('button', { name: 'Generate master portrait' })).toBeDisabled();
});

test('character jobs poll to completion, preserve transient errors and stop when the editor closes', async () => {
  vi.useFakeTimers();
  state.jobs = [{ _id: 'voice-job', kind: 'voice', title: 'Auditions', status: 'queued' }];
  const onReload = vi.fn();
  const view = mount({ onReload });
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByText('Auditions: queued.')).toBeVisible();
  vi.mocked(request).mockRejectedValueOnce(new Error('Polling offline'));
  await act(async () => vi.advanceTimersByTime(3000));
  expect(screen.getByText('Polling offline')).toBeVisible();
  await act(async () => vi.advanceTimersByTime(3000));
  expect(onReload).not.toHaveBeenCalled();
  state.jobs[0].status = 'failed';
  await act(async () => vi.advanceTimersByTime(3000));
  expect(onReload).toHaveBeenCalledOnce();
  expect(screen.getByText('Auditions: failed.')).toBeVisible();
  view.unmount();
});

test('failed initial loading offers a readable error and unavailable storage does not lose prompt edits', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Full');
  });
  vi.mocked(request).mockRejectedValueOnce(new Error('Character prompts offline'));
  mount();
  expect(await screen.findByText('Character prompts offline')).toBeVisible();
  fireEvent(window, new Event('focus'));
  await screen.findByLabelText('Voice generation prompt');
  fireEvent.change(screen.getByLabelText('Voice generation prompt'), {
    target: { value: 'Keep locally' }
  });
  expect(screen.getByLabelText('Voice generation prompt')).toHaveValue('Keep locally');
});

test('body-turnaround deep links focus the actual image prompt and preserve source review navigation', async () => {
  state.images[1] = { ...state.images[1], itemId: 'body-turnaround', title: 'Body turnaround' };
  state.characterSource = { assetId: 'character', name: 'Kory', status: 'pending-review' };
  history.replaceState(null, '', '/#asset-image-generation-character--body-turnaround');
  mount();
  const section = await screen.findByRole('region', { name: 'Body turnaround generation' });
  await waitFor(() => expect(section).toHaveFocus());
  fireEvent.click(screen.getByRole('link', { name: 'Jump to body turnaround' }));
  expect(section).toHaveFocus();
  expect(screen.getByRole('link', { name: 'Review saved source evidence' })).toHaveAttribute(
    'href',
    '#review-asset--character------source'
  );
});

test('an edited saved voice description is saved before generating replacement auditions', async () => {
  state.voice = {
    _id: 'voice',
    revision: 1,
    production: { voiceDescription: state.voicePrompt },
    candidates: []
  };
  mount();
  fireEvent.change(await screen.findByLabelText('Voice generation prompt'), {
    target: { value: 'Adult female, calm British diction.' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prompt & generate voice auditions' }));
  await screen.findByText(
    'Voice auditions requested. They will appear here for listening and selection.'
  );
  expect(request).toHaveBeenCalledWith(
    '/studio/assistant/voice/generate',
    expect.objectContaining({
      body: expect.objectContaining({ prompt: 'Adult female, calm British diction.' })
    })
  );
});

test.each(['resolve', 'reject'])(
  'a late initial character %s cannot restore an unmounted editor',
  async (outcome) => {
    let finish: (value: unknown) => void;
    vi.mocked(request).mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = outcome === 'resolve' ? resolve : reject;
        })
    );
    const view = mount();
    view.unmount();
    await act(async () => finish(outcome === 'resolve' ? state : new Error('Closed editor')));
    expect(screen.queryByLabelText('Voice generation prompt')).not.toBeInTheDocument();
  }
);

test.each(['resolve', 'reject'])(
  'a late character job poll %s is ignored after unmount',
  async (outcome) => {
    vi.useFakeTimers();
    state.jobs = [{ _id: 'job', kind: 'voice', status: 'queued' }];
    const view = mount();
    await act(async () => {
      await Promise.resolve();
    });
    let finish: (value: unknown) => void;
    vi.mocked(request).mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = outcome === 'resolve' ? resolve : reject;
        })
    );
    await act(async () => vi.advanceTimersByTime(3000));
    view.unmount();
    await act(async () => finish(outcome === 'resolve' ? state : new Error('Closed editor')));
    expect(screen.queryByLabelText('Voice generation prompt')).not.toBeInTheDocument();
  }
);

test('empty reference packages offer setup and a hidden tab waits until visible to refresh', async () => {
  state.asset.production = {};
  state.images = [];
  mount();
  await screen.findByRole('button', { name: 'Add image reference package' });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const count = vi.mocked(request).mock.calls.length;
  fireEvent(window, new Event('focus'));
  expect(request).toHaveBeenCalledTimes(count);
});
