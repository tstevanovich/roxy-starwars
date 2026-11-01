import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.js';
import CharacterGeneration from './CharacterGeneration.jsx';
import CharacterSheets from './CharacterSheets.jsx';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn() }));
const asset = {
  _id: 'character',
  kind: 'character',
  name: 'Kory',
  revision: 4,
  production: {
    items: [
      {
        id: 'master-portrait',
        title: 'Master portrait',
        type: 'image',
        required: true,
        notes: 'Portrait.',
        mediaId: null,
        imagePrompt: 'A complete portrait prompt.'
      },
      {
        id: 'rear',
        title: 'Rear view',
        type: 'image',
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
  localStorage.clear();
  state = structuredClone(initial);
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async (path, options) => {
      if (path === '/studio/assistant/character-generation/character/voice') {
        state.voice = {
          _id: 'voice',
          revision: 0,
          production: { voiceDescription: options.body.prompt },
          candidates: []
        };
        state.voicePrompt = options.body.prompt;
        return { voice: state.voice };
      }
      if (path === '/studio/assets/character') {
        state.asset = { ...options.body, revision: state.asset.revision + 1 };
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
function mount(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <CharacterGeneration
        asset={asset}
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
  expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  fireEvent.change(voice, { target: { value: 'An adult female voice, warm and expressive.' } });
  await user.click(screen.getByRole('button', { name: 'Save voice prompt' }));
  expect(await screen.findByText('Voice prompt saved. No auditions generated.')).toBeVisible();
  expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
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
    request.mock.calls.filter(([path]) => path === '/studio/assistant/image/generate')
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
  expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
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
    request.mock.calls.filter(([path]) => path === '/studio/assistant/voice/generate')
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
    request.mock.calls.filter(
      ([, options]) => options?.method === 'POST' || options?.method === 'PUT'
    )
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
  const original = request.getMockImplementation();
  request.mockImplementation(async (path, options) => {
    if (options?.method === 'DELETE') {
      expect(options.body.revision).toBe(state.voice.revision);
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
      { _id: 'audio-1', kind: 'audio', originalName: 'Audition one.mp3' },
      { _id: 'audio-2', kind: 'audio', originalName: 'Audition two.mp3' }
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
  expect(request.mock.calls.some(([path]) => path.includes('/generate'))).toBe(false);
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
    const [current, setCurrent] = useState(partial);
    return (
      <>
        <CharacterGeneration asset={current} media={[]} onSaved={setCurrent} />
        <CharacterSheets asset={current} media={[]} onSaved={setCurrent} />
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
  expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
});
