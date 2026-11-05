import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type * as Studio from '../../shared/types.ts';
import { request, uploadMedia } from './api.ts';
import ProductionChat from './ProductionChat.tsx';
import { mediaFixture, studioFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';

vi.mock('./api.ts', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));
const context = { episodeId: 'episode' };
const data = {
  assets: [],
  media: [],
  episodes: [{ _id: 'episode', title: 'Episode 01', scenes: [] }]
};
const configured: Studio.Connections = {
  chatgpt: {
    canChat: true,
    connected: true,
    planEnabled: true,
    apiKeyFallback: false,
    activeProfileId: 'profile1',
    profiles: [
      {
        id: 'profile1',
        label: 'Test account',
        email: 'test@example.com',
        signedIn: true,
        planEnabled: true,
        model: 'test-model',
        models: [{ id: 'test-model', name: 'Test model' }],
        welcomeAcknowledged: true
      }
    ]
  },
  openart: { connected: false, projectId: 'project' },
  elevenlabs: { configured: true }
};
const chat = { _id: 'chat1', title: 'Episode 01', context, activeRun: null };
let detail;
beforeEach(() => {
  history.replaceState(null, '', '/');
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true }))
  );
  vi.mocked(uploadMedia).mockReset();
  localStorage.clear();
  detail = { chat, messages: [], runs: [], jobs: [], proposals: [] };
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async (path) => {
      if (path.endsWith('/connections')) return configured;
      if (path.endsWith('/chats')) return { chats: [chat], chat };
      if (path.endsWith('/chats/chat1')) return detail;
      return {};
    });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function mount(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ProductionChat
        data={studioFixture(data)}
        onMedia={vi.fn()}
        onReview={vi.fn()}
        onChanged={vi.fn()}
        {...props}
      />
    </ThemeProvider>
  );
}
function choose(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(within(screen.getByRole('listbox')).getByText(option));
}
test('opens saved conversations and sends an idempotent contextual message', async () => {
  const user = userEvent.setup();
  mount();
  const input = await screen.findByRole('textbox', { name: 'Message your production assistant' });
  await user.type(input, 'Make the port feel busier.');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(request).toHaveBeenCalledWith('/studio/assistant/chats/chat1/messages', {
    method: 'POST',
    body: { text: 'Make the port feel busier.', mediaIds: [], requestId: expect.any(String) }
  });
  await waitFor(() => expect(input).toHaveValue(''));
});
test('captured subtitle images display directly from the conversation without reloading the global media list', async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, ...args) =>
    path.endsWith('/chats/chat1')
      ? {
          chat: { _id: 'chat1', title: 'Source dialogue' },
          messages: [
            {
              _id: 'capture-reply',
              role: 'assistant',
              text: 'Saved source evidence.',
              mediaIds: ['subtitle']
            }
          ],
          media: [
            {
              _id: 'subtitle',
              kind: 'image' as const,
              originalName: 'SOURCE-SUBTITLE-1038.png',
              sourceFrame: { requestedSeconds: 1038, view: 'subtitle-crop' }
            }
          ],
          runs: [],
          jobs: [],
          proposals: []
        }
      : original(path, ...args)
  );
  mount();
  expect(await screen.findByAltText('SOURCE-SUBTITLE-1038.png')).toHaveAttribute(
    'src',
    '/api/studio/media/subtitle'
  );
  expect(screen.getByText('Source 17:18 · Subtitle crop')).toBeVisible();
  expect(screen.queryByText('Reference deleted')).not.toBeInTheDocument();
});
test('failed send retains text and retry ID across a page reopen', async () => {
  const user = userEvent.setup();
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path.endsWith('/messages')) throw new Error('Connection lost');
    return original(path, options);
  });
  const view = mount();
  const input = await screen.findByRole('textbox', { name: 'Message your production assistant' });
  await user.type(input, 'Keep Al on model.');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(await screen.findByText('Connection lost')).toBeInTheDocument();
  const draft = JSON.parse(localStorage.getItem('roxy-chat-draft-chat1'));
  expect(draft.text).toBe('Keep Al on model.');
  view.unmount();
  mount();
  expect(
    await screen.findByRole('textbox', { name: 'Message your production assistant' })
  ).toHaveValue(draft.text);
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(request).toHaveBeenLastCalledWith('/studio/assistant/chats/chat1/messages', {
    method: 'POST',
    body: { text: draft.text, mediaIds: [], requestId: draft.requestId }
  });
});
test('contextual entry opens a new conversation with the selected episode', async () => {
  const user = userEvent.setup();
  mount({ initialContext: context });
  await screen.findByRole('heading', { name: 'What are we working on?' });
  await user.click(screen.getByRole('button', { name: 'Start conversation' }));
  expect(request).toHaveBeenCalledWith('/studio/assistant/chats', {
    method: 'POST',
    body: { title: 'Episode 01', context }
  });
  expect(
    await screen.findByRole('textbox', { name: 'Message your production assistant' })
  ).toBeInTheDocument();
});
test('render cards open existing approval screens and have no chat approval control', async () => {
  const user = userEvent.setup(),
    onReview = vi.fn();
  detail.jobs = [
    {
      _id: 'job1',
      kind: 'image' as const,
      title: 'Port reference',
      status: 'ready' as const,
      target: { episodeId: 'episode' },
      resultAssetId: 'shot',
      resultMediaIds: ['image']
    }
  ];
  mount({ onReview });
  await user.click(await screen.findByRole('button', { name: 'Review image options' }));
  expect(onReview).toHaveBeenCalledWith('library', 'shot');
  expect(screen.queryByRole('button', { name: /approve image/i })).not.toBeInTheDocument();
});
test('story proposals require an explicit Apply draft action', async () => {
  const user = userEvent.setup(),
    onChanged = vi.fn();
  detail.proposals = [
    {
      _id: 'proposal1',
      title: 'Better banter',
      text: 'Al gets the last word.',
      status: 'pending' as const,
      episodeId: 'episode'
    }
  ];
  mount({ onChanged });
  expect(await screen.findByText('Al gets the last word.')).toBeInTheDocument();
  expect(request).not.toHaveBeenCalledWith(
    '/studio/assistant/proposals/proposal1/apply',
    expect.anything()
  );
  await user.click(screen.getByRole('button', { name: 'Apply draft' }));
  expect(request).toHaveBeenCalledWith('/studio/assistant/proposals/proposal1/apply', {
    method: 'POST',
    body: {}
  });
  expect(onChanged).toHaveBeenCalled();
});
test('draft failures remain visible beside the draft across successful background refreshes', async () => {
  detail.proposals = [
    {
      _id: 'proposal1',
      title: 'Portrait revision',
      text: 'Correct realism.',
      status: 'pending' as const,
      assetId: 'asset-one'
    }
  ];
  let poll;
  const timer = vi.spyOn(globalThis, 'setInterval').mockImplementation((fn) => {
    poll = fn;
    return 123 as unknown as ReturnType<typeof setInterval>;
  });
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, ...args) => {
    if (path.endsWith('/proposal1/apply')) throw new Error('The saved asset changed.');
    return original(path, ...args);
  });
  try {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Apply draft' }));
    expect(await screen.findByText('The saved asset changed.')).toBeVisible();
    await poll();
    expect(screen.getByText('The saved asset changed.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply draft' })).toBeEnabled();
  } finally {
    timer.mockRestore();
  }
});

test('applying a revision shows saving progress and links the next actual approval', async () => {
  detail.proposals = [
    {
      _id: 'proposal1',
      title: 'Portrait revision',
      text: 'Correct realism.',
      status: 'pending' as const,
      assetId: 'asset-one'
    }
  ];
  const original = vi.mocked(request).getMockImplementation();
  let finish;
  vi.mocked(request).mockImplementation((path, ...args) =>
    path.endsWith('/proposal1/apply')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(path, ...args)
  );
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Apply draft' }));
  expect(screen.getByRole('button', { name: 'Applying draft…' })).toBeDisabled();
  finish({
    applied: true,
    nextReview: {
      target: { scope: 'asset' as const, recordId: 'asset-one' },
      stage: 'reference-plan:master-portrait'
    }
  });
  const link = await screen.findByRole('link', { name: 'Review revision directions' });
  expect(link).toHaveAttribute('href', expect.stringContaining('asset=asset-one'));
  expect(await screen.findByText(/Your revised directions are saved/)).toBeVisible();
});

test('connections use ChatGPT plan sign-in and do not offer an API key or billing fallback', async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByRole('textbox', { name: 'Message your production assistant' });
  await user.click(screen.getByRole('button', { name: 'Connections' }));
  expect(screen.getByText(/no fallback to separately billed API-key usage/)).toBeInTheDocument();
  expect(screen.queryByLabelText('OpenAI API key')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'ChatGPT model' })).toHaveTextContent('Test model');
  await user.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(request).toHaveBeenCalledWith('/studio/assistant/connections/chatgpt/test', {
    method: 'POST',
    body: {}
  });
});
test('the first plan sign-in shows a one-time usage explanation that is explicitly acknowledged', async () => {
  const user = userEvent.setup();
  const first = structuredClone(configured);
  first.chatgpt.profiles[0].welcomeAcknowledged = false;
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path.endsWith('/chatgpt/welcome')) {
      first.chatgpt.profiles[0].welcomeAcknowledged = true;
      return { acknowledged: true };
    }
    if (path.endsWith('/connections')) return structuredClone(first);
    return original(path, options);
  });
  mount();
  expect(
    await screen.findByRole('heading', { name: 'You’re using your ChatGPT plan' })
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Got it' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'You’re using your ChatGPT plan' })
    ).not.toBeInTheDocument()
  );
  expect(request).toHaveBeenCalledWith('/studio/assistant/connections/chatgpt/welcome', {
    method: 'POST',
    body: {}
  });
});
test('model selection is limited to the signed-in account’s displayed catalog', async () => {
  const user = userEvent.setup();
  const account = structuredClone(configured);
  account.chatgpt.profiles[0].models.push({
    id: 'other-plan-model',
    name: 'Another eligible model'
  });
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, options) =>
    path.endsWith('/connections') ? account : original(path, options)
  );
  mount();
  await screen.findByRole('textbox', { name: 'Message your production assistant' });
  await user.click(screen.getByRole('button', { name: 'Connections' }));
  await user.click(screen.getByRole('combobox', { name: 'ChatGPT model' }));
  await user.click(screen.getByRole('option', { name: 'Another eligible model' }));
  expect(request).toHaveBeenCalledWith('/studio/assistant/connections/chatgpt/model', {
    method: 'PUT',
    body: { model: 'other-plan-model' }
  });
});
test('plan usage errors stay visible with saved messages and no API-key fallback action', async () => {
  detail.runs = [
    {
      _id: 'limited-run',
      status: 'failed' as const,
      error: 'Your ChatGPT plan usage limit has been reached. No API-billed fallback was used.'
    }
  ];
  mount();
  expect(await screen.findByText(/Your ChatGPT plan usage limit/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Manage usage' })).toHaveAttribute(
    'href',
    'https://chatgpt.com/settings/usage'
  );
  expect(
    screen.queryByRole('button', { name: /API key|buy credits|API billing/i })
  ).not.toBeInTheDocument();
});

test('OpenArt shows provider-hosted reference delivery and offers a read-only connection test', async () => {
  const user = userEvent.setup();
  const account = structuredClone(configured);
  account.openart = {
    ...account.openart,
    connected: true,
    referenceSharing: { ready: true, source: 'OpenArt storage' }
  };
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path.endsWith('/connections')) return account;
    if (path.endsWith('/openart/test'))
      return { verified: true, message: 'OpenArt responded successfully.' };
    return original(path, options);
  });
  mount();
  await screen.findByRole('textbox', { name: 'Message your production assistant' });
  await user.click(screen.getByRole('button', { name: 'Connections' }));
  expect(
    screen.getByText(/Reference files are uploaded to OpenArt and verified/)
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Test OpenArt connection' }));
  expect(await screen.findByText('OpenArt responded successfully.')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/studio/assistant/connections/openart/test', {
    method: 'POST',
    body: {}
  });
});

test('shot link opens its reusable contextual chat without sending a message or generating media', async () => {
  window.history.replaceState({}, '', '/?chat=1&episode=episode&scene=academy&shot=opening');
  const shotContext = { episodeId: 'episode', sceneId: 'academy', clipId: 'opening' };
  const shotChat = { ...chat, context: shotContext, title: 'Academy / Opening' };
  detail = { ...detail, chat: shotChat };
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path.endsWith('/chats') && options?.method === 'POST') return { chat: shotChat };
    return original(path, options);
  });
  mount({
    data: {
      ...data,
      episodes: [
        {
          ...data.episodes[0],
          scenes: [
            { id: 'academy', title: 'Academy', clips: [{ id: 'opening', title: 'Opening' }] }
          ]
        }
      ]
    }
  });
  expect(
    await screen.findByRole('textbox', { name: 'Message your production assistant' })
  ).toBeVisible();
  expect(request).toHaveBeenCalledWith('/studio/assistant/chats', {
    method: 'POST',
    body: { context: shotContext, reuseShot: true }
  });
  expect(screen.getByText(/Discussing: Episode 01 \/ Academy \/ Opening/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Back to shot' })).toHaveAttribute(
    'href',
    '/?episode=episode#picture-prerequisites-opening'
  );
  expect(screen.getByRole('link', { name: 'Open scene chat' })).toHaveAttribute(
    'href',
    '/?chat=1&episode=episode&scene=academy'
  );
  expect(
    vi.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')
  ).toHaveLength(1);
  expect(new URLSearchParams(window.location.search).get('chat')).toBe('chat1');
  window.history.replaceState({}, '', '/');
});

test('scene link opens its reusable scene chat without retaining a shot or starting generation', async () => {
  window.history.replaceState({}, '', '/?chat=1&episode=episode&scene=academy');
  const sceneContext = { episodeId: 'episode', sceneId: 'academy' };
  const sceneChat = { ...chat, context: sceneContext, title: 'Academy / Scene chat' };
  detail = { ...detail, chat: sceneChat };
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path.endsWith('/chats') && options?.method === 'POST') return { chat: sceneChat };
    return original(path, options);
  });
  mount({
    data: {
      ...data,
      episodes: [{ ...data.episodes[0], scenes: [{ id: 'academy', title: 'Academy', clips: [] }] }]
    }
  });
  expect(
    await screen.findByText(/Discussing: Episode 01 \/ Academy \/ Entire scene/)
  ).toBeVisible();
  expect(request).toHaveBeenCalledWith('/studio/assistant/chats', {
    method: 'POST',
    body: { context: sceneContext, reuseScene: true }
  });
  expect(screen.getByRole('link', { name: 'Back to scene' })).toHaveAttribute(
    'href',
    '/?episode=episode#board-scene-academy'
  );
  expect(screen.queryByRole('link', { name: 'Back to shot' })).not.toBeInTheDocument();
  expect(
    vi.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')
  ).toHaveLength(1);
  expect(new URLSearchParams(window.location.search).has('scene')).toBe(false);
  window.history.replaceState({}, '', '/');
});

test('new conversations can target a character, episode, scene or individual shot', async () => {
  mount({
    data: studioFixture({
      assets: [
        { _id: 'character', name: 'Harkun' },
        { _id: 'archived', archived: true, name: 'Archived' }
      ],
      episodes: [
        {
          _id: 'episode',
          title: 'Episode 01',
          scenes: [{ id: 'academy', title: 'Academy', clips: [{ id: 'reply', title: 'Reply' }] }]
        }
      ]
    })
  });
  await screen.findByLabelText('Message your production assistant');
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  choose('Creative context', 'Harkun');
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  await screen.findByLabelText('Message your production assistant');
  expect(request).toHaveBeenCalledWith('/studio/assistant/chats', {
    method: 'POST',
    body: { title: 'Harkun', context: { assetId: 'character' } }
  });
  choose('Conversation', 'Start a new conversation');
  expect(location.search).toBe('?chat=1');
  choose('Creative context', 'Episode 01');
  choose('Scene (optional)', 'Academy');
  choose('Clip (optional)', 'Reply');
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path.endsWith('/chats') && options?.method === 'POST')
      throw new Error('Could not create conversation');
    return original(path, options);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  expect(await screen.findByText('Could not create conversation')).toBeVisible();
  expect(request).toHaveBeenCalledWith('/studio/assistant/chats', {
    method: 'POST',
    body: {
      title: 'Episode 01',
      context: { episodeId: 'episode', sceneId: 'academy', clipId: 'reply' }
    }
  });
  choose('Creative context', 'Whole series · story and creative planning');
  vi.mocked(request).mockImplementation(original);
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  await screen.findByLabelText('Message your production assistant');
  expect(request).toHaveBeenCalledWith('/studio/assistant/chats', {
    method: 'POST',
    body: { title: 'Production conversation', context: {} }
  });
});

test('composer restores a legacy text draft, caps attachments and sends with Enter only on a fine pointer', async () => {
  localStorage.setItem('roxy-chat-draft-chat1', 'Keep the camera static.');
  mount({
    data: studioFixture({
      ...data,
      media: Array.from({ length: 5 }, (_, index) => ({
        _id: 'image' + index,
        originalName: 'Image ' + index
      }))
    })
  });
  const input = await screen.findByLabelText('Message your production assistant');
  expect(input).toHaveValue('Keep the camera static.');
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Attach saved media (up to four)' }));
  for (let index = 0; index < 5; index++)
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Image ' + index));
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  expect(JSON.parse(localStorage.getItem('roxy-chat-draft-chat1')).mediaIds).toHaveLength(4);
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(vi.mocked(request).mock.calls.filter(([path]) => path.endsWith('/messages'))).toHaveLength(
    0
  );
  vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(input).toHaveValue(''));
  expect(request).toHaveBeenCalledWith(
    '/studio/assistant/chats/chat1/messages',
    expect.objectContaining({
      body: expect.objectContaining({ mediaIds: ['image0', 'image1', 'image2', 'image3'] })
    })
  );
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(vi.mocked(request).mock.calls.filter(([path]) => path.endsWith('/messages'))).toHaveLength(
    1
  );
});

test('reference uploads attach a successful result and report a failed upload without clearing the message', async () => {
  const onMedia = vi.fn();
  mount({ onMedia });
  const input = await screen.findByLabelText('Message your production assistant');
  fireEvent.change(input, { target: { value: 'Use this reference.' } });
  const upload = screen.getByLabelText('Upload reference');
  fireEvent.change(upload, { target: { files: [] } });
  expect(uploadMedia).not.toHaveBeenCalled();
  const file = new File(['image'], 'image.png', { type: 'image/png' });
  vi.mocked(uploadMedia).mockRejectedValueOnce(new Error('Upload offline'));
  fireEvent.change(upload, { target: { files: [file] } });
  expect(await screen.findByText('Upload offline')).toBeVisible();
  expect(input).toHaveValue('Use this reference.');
  vi.mocked(uploadMedia).mockResolvedValueOnce(mediaFixture({ _id: 'uploaded' }));
  fireEvent.change(upload, { target: { files: [file] } });
  await waitFor(() =>
    expect(onMedia).toHaveBeenCalledWith(expect.objectContaining({ _id: 'uploaded' }))
  );
  expect(JSON.parse(localStorage.getItem('roxy-chat-draft-chat1')).mediaIds).toEqual(['uploaded']);
});

test('a blocked composer preserves edits even when storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Unavailable');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Full');
  });
  detail.chat = { ...chat, activeRun: 'run' };
  detail.runs = [{ _id: 'run', status: 'running', preview: 'Checking the saved shot.' }];
  mount();
  const input = await screen.findByLabelText('Message your production assistant');
  fireEvent.change(input, { target: { value: 'Keep this note.' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  expect(screen.getByText('Checking the saved shot.')).toBeVisible();
  expect(vi.mocked(request).mock.calls.filter(([path]) => path.endsWith('/messages'))).toHaveLength(
    0
  );
});

test('chat displays applied and blocked drafts, proposed clips and reference fallbacks', async () => {
  detail.messages = [
    { _id: 'user', role: 'user', text: 'Correct this shot.', mediaIds: ['fallback', 'gone'] }
  ];
  detail.proposals = [
    {
      _id: 'scene',
      title: 'Scene correction',
      text: 'Saved scene draft',
      status: 'pending',
      episodeId: 'episode',
      scene: {
        script: 'Updated script.',
        clips: [
          {
            id: 'reply',
            title: 'New reply',
            duration: 5,
            action: 'He replies.',
            dialogue: 'HARKUN: Begin.'
          }
        ]
      },
      application: { canApply: false, reason: 'Newer saved edits need review.' }
    },
    {
      _id: 'applied',
      title: 'Applied story',
      text: 'Saved',
      status: 'applied',
      assetId: 'character'
    },
    {
      _id: 'video',
      title: 'Applied video',
      status: 'applied',
      render: { prompt: 'Hold the frame.', model: 'Wan', duration: 5, target: {} }
    }
  ];
  mount({
    data: studioFixture({
      ...data,
      media: [
        {
          _id: 'fallback',
          originalName: 'Frame.png',
          sourceFrame: { requestedSeconds: 62, view: 'full-frame' }
        }
      ]
    })
  });
  expect(await screen.findByText('Newer saved edits need review.')).toBeVisible();
  expect(screen.getByText('Reference deleted')).toBeVisible();
  expect(screen.getByText('Source 1:02 · Full frame')).toBeVisible();
  expect(screen.getByText('Video revision approved')).toBeVisible();
  expect(screen.getByText('Draft applied')).toBeVisible();
  fireEvent.click(screen.getByText('Read proposed scene and clips'));
  expect(screen.getByText('New reply · 5s')).toBeVisible();
});

test('proposal and job controls navigate to their owning records and cancellation errors are actionable', async () => {
  const onReview = vi.fn();
  detail.proposals = [
    {
      _id: 'pending',
      title: 'Pending',
      text: 'Draft text',
      status: 'pending',
      assetId: 'character'
    }
  ];
  detail.jobs = [
    {
      _id: 'queued',
      title: 'Queued picture',
      kind: 'image',
      status: 'queued',
      target: {},
      resultAssetId: 'character'
    },
    {
      _id: 'video',
      title: 'Video',
      kind: 'video',
      status: 'ready',
      settings: { params: { mode: 'prime' } },
      target: { episodeId: 'episode' },
      resultMediaIds: ['video'],
      quote: { items: [{ totalCredits: 80 }], pricingNote: 'Recorded quote' }
    },
    { _id: 'standard', title: 'Standard video', kind: 'video', status: 'uncertain', target: {} },
    {
      _id: 'sound',
      title: 'Sound',
      kind: 'sound',
      status: 'failed',
      target: {},
      error: 'Sound submission failed'
    },
    { _id: 'mix', title: 'Mix', kind: 'mix', status: 'custom-state', target: {} },
    { _id: 'voice', title: 'Voice', kind: 'dialogue', status: 'preparing', target: {} }
  ];
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path.endsWith('/cancel')) throw new Error('Cancellation unavailable');
    return original(path, options);
  });
  mount({ onReview });
  await screen.findByText('Queued picture');
  fireEvent.click(screen.getByRole('button', { name: 'Open asset' }));
  expect(onReview).toHaveBeenLastCalledWith('library', 'character');
  fireEvent.click(screen.getByRole('button', { name: 'Review image options' }));
  expect(onReview).toHaveBeenLastCalledWith('library', 'character');
  fireEvent.click(screen.getByRole('button', { name: 'Open episode for review' }));
  expect(onReview).toHaveBeenLastCalledWith('episodes', 'episode');
  fireEvent.click(screen.getByRole('button', { name: 'Open media library' }));
  expect(onReview).toHaveBeenLastCalledWith('media');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel queued request' }));
  expect(await screen.findByText('Cancellation unavailable')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss draft' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('/studio/assistant/proposals/pending/dismiss', {
      method: 'POST',
      body: {}
    })
  );
});

test('connection errors and missing plan access link to the connection dialog', async () => {
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, options) =>
    path.endsWith('/connections')
      ? {
          ...configured,
          chatgpt: { ...configured.chatgpt, canChat: false },
          elevenlabs: { configured: false },
          openart: {
            connected: true,
            referenceSharing: { ready: false, message: 'References unavailable' }
          }
        }
      : original(path, options)
  );
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Set up' }));
  await screen.findByRole('dialog', { name: 'Production connections' });
  expect(screen.getByText('References unavailable')).toBeVisible();
  expect(screen.getByText(/Add ELEVENLABS_API_KEY/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('OpenArt project ID'), {
    target: { value: 'render-project' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save render project' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('/studio/assistant/connections/openart', {
      method: 'PUT',
      body: { projectId: 'render-project' }
    })
  );
  vi.mocked(request).mockRejectedValueOnce(new Error('Disconnect unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect OpenArt' }));
  expect(await screen.findByText('Disconnect unavailable')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect OpenArt' }));
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect OpenArt' }));
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('initial and conversation read failures preserve a recoverable page', async () => {
  vi.mocked(request).mockRejectedValue(new Error('Chat is offline'));
  const view = mount();
  await screen.findByText('Chat is offline');
  view.unmount();
  vi.mocked(request).mockImplementation(async (path) => {
    if (path.endsWith('/connections')) return configured;
    if (path.endsWith('/chats')) return { chats: [chat] };
    throw new Error('Conversation unavailable');
  });
  mount();
  expect(await screen.findByText('Conversation unavailable')).toBeVisible();
});

test('connection polling refreshes visible tabs, coalesces requests and stops after unmount', async () => {
  vi.useFakeTimers();
  const view = mount();
  await act(async () => {
    await Promise.resolve();
  });
  const original = vi.mocked(request).getMockImplementation();
  let finish: (value: unknown) => void;
  vi.mocked(request).mockImplementation((path, options) =>
    path.endsWith('/connections')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(path, options)
  );
  fireEvent(window, new Event('focus'));
  fireEvent(window, new Event('focus'));
  const count = vi
    .mocked(request)
    .mock.calls.filter(([path]) => path.endsWith('/connections')).length;
  expect(count).toBe(2);
  await act(async () => finish(configured));
  fireEvent(window, new Event('focus'));
  await act(async () => finish({ ...configured, elevenlabs: { configured: false } }));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  fireEvent(window, new Event('focus'));
  expect(
    vi.mocked(request).mock.calls.filter(([path]) => path.endsWith('/connections'))
  ).toHaveLength(count + 1);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.mocked(request).mockImplementation(original).mockRejectedValueOnce(new Error('Offline poll'));
  fireEvent(window, new Event('focus'));
  await act(async () => {
    await Promise.resolve();
  });
  vi.mocked(request).mockImplementation((path, options) =>
    path.endsWith('/connections')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(path, options)
  );
  fireEvent(window, new Event('focus'));
  view.unmount();
  await act(async () => finish(configured));
});

test('plan acknowledgement keeps the dialog open on failure and closes after a successful retry', async () => {
  const original = vi.mocked(request).getMockImplementation();
  let acknowledged = false;
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path.endsWith('/connections') && !acknowledged)
      return {
        ...configured,
        chatgpt: {
          ...configured.chatgpt,
          profiles: [{ ...configured.chatgpt.profiles[0], welcomeAcknowledged: false }]
        }
      };
    if (path.endsWith('/welcome')) {
      acknowledged = true;
      return {};
    }
    return original(path, options);
  });
  mount();
  const gotIt = await screen.findByRole('button', { name: 'Got it' });
  vi.mocked(request).mockRejectedValueOnce(new Error('Could not save acknowledgement'));
  fireEvent.click(gotIt);
  expect(await screen.findByText('Could not save acknowledgement')).toBeVisible();
  fireEvent.click(gotIt);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('job cancellation cannot submit twice while a previous mutation is awaiting a reply', async () => {
  detail.jobs = [
    { _id: 'job', title: 'Queued image', kind: 'image', status: 'queued', target: {} }
  ];
  mount();
  const cancel = await screen.findByRole('button', { name: 'Cancel queued request' });
  let finish: (value: unknown) => void;
  vi.mocked(request).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  fireEvent.click(cancel);
  fireEvent.click(cancel);
  expect(vi.mocked(request).mock.calls.filter(([path]) => path.endsWith('/cancel'))).toHaveLength(
    1
  );
  await act(async () => finish({}));
});

test('conversation polling ignores a second tick during a pending read and accepts newer saved messages', async () => {
  vi.useFakeTimers();
  const view = mount();
  await act(async () => {
    await Promise.resolve();
  });
  const original = vi.mocked(request).getMockImplementation();
  let finish: (value: unknown) => void;
  vi.mocked(request).mockImplementation((path, options) =>
    path.endsWith('/chats/chat1')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(path, options)
  );
  await act(async () => vi.advanceTimersByTime(6000));
  expect(
    vi.mocked(request).mock.calls.filter(([path]) => path.endsWith('/chats/chat1'))
  ).toHaveLength(2);
  await act(async () => finish(detail));
  await act(async () => vi.advanceTimersByTime(3000));
  view.unmount();
  await act(async () => finish(detail));
});

test('new saved replies update the conversation without forcing a reader away from earlier messages', async () => {
  detail = { ...detail, messages: [{ _id: 'first', role: 'assistant', text: 'Earlier reply' }] };
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path.endsWith('/messages')) {
      detail = {
        ...detail,
        messages: [...detail.messages, { _id: 'next', role: 'assistant', text: 'New saved reply' }]
      };
      return {};
    }
    return original(path, options);
  });
  mount();
  await screen.findByText('Earlier reply');
  const log = screen.getByRole('log');
  Object.defineProperties(log, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 } });
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
  scroll.mockClear();
  fireEvent.change(screen.getByLabelText('Message your production assistant'), {
    target: { value: 'Update this' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(await screen.findByText('New saved reply')).toBeVisible();
  expect(scroll).not.toHaveBeenCalled();
});

test('pending video revisions save separately from rendering and production descriptions omit embedded payloads', async () => {
  const onReview = vi.fn();
  detail.proposals = [
    {
      _id: 'video',
      title: 'Video revision',
      status: 'pending',
      episodeId: 'episode',
      render: { prompt: 'Hold still.', model: 'Wan', duration: 5, target: {} }
    },
    {
      _id: 'brief',
      title: 'Brief revision',
      status: 'pending',
      text: 'Readable directions\n\n{"hidden":"payload"}',
      production: { brief: 'Revised brief' }
    }
  ];
  mount({ onReview });
  expect(await screen.findByRole('button', { name: 'Approve revision' })).toBeEnabled();
  expect(screen.getByText('Readable directions')).toBeVisible();
  expect(screen.queryByText(/hidden.*payload/)).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Open episode' })[0]);
  expect(onReview).toHaveBeenCalledWith('episodes', 'episode');
});

test('initial conversation reads and focused scene creation stop updating an unmounted chat', async () => {
  const original = vi.mocked(request).getMockImplementation();
  let finish: (value: unknown) => void;
  vi.mocked(request).mockImplementation((path, options) =>
    path.endsWith('/chats') && options?.method === 'POST'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(path, options)
  );
  const view = mount({ initialContext: { episodeId: 'episode', sceneId: 'scene' } });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.unmount();
  await act(async () =>
    finish({ chat: { ...chat, context: { episodeId: 'episode', sceneId: 'scene' } } })
  );
  expect(location.search).not.toContain('chat=');
});

test.each(['resolve', 'reject'])(
  'an initial conversation list that %s after unmount is ignored',
  async (outcome) => {
    const original = vi.mocked(request).getMockImplementation();
    let finish: (value: unknown) => void, fail: (error: Error) => void;
    vi.mocked(request).mockImplementation((path, options) =>
      path.endsWith('/chats')
        ? new Promise((resolve, reject) => {
            finish = resolve;
            fail = reject;
          })
        : original(path, options)
    );
    const view = mount();
    view.unmount();
    await act(async () => {
      if (outcome === 'resolve') finish({ chats: [chat] });
      else fail(new Error('Late failure'));
    });
    expect(request).not.toHaveBeenCalledWith('/studio/assistant/chats/chat1');
  }
);

test('an empty conversation list and an older model ID retain usable conversation creation', async () => {
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation(async (path, options) =>
    path.endsWith('/chats')
      ? { chats: [] }
      : path.endsWith('/connections')
        ? {
            ...configured,
            chatgpt: {
              ...configured.chatgpt,
              profiles: [{ ...configured.chatgpt.profiles[0], model: 'older-model' }]
            }
          }
        : original(path, options)
  );
  mount();
  expect(await screen.findByText('older-model')).toBeVisible();
  expect(screen.getByRole('button', { name: 'New conversation' })).toBeEnabled();
});

test('conversation polling displays a recoverable error and ignores a late failure after closing', async () => {
  vi.useFakeTimers();
  const view = mount();
  await act(async () => {
    await Promise.resolve();
  });
  const original = vi.mocked(request).getMockImplementation();
  vi.mocked(request).mockImplementation((path, options) =>
    path.endsWith('/chats/chat1')
      ? Promise.reject(new Error('Conversation offline'))
      : original(path, options)
  );
  await act(async () => vi.advanceTimersByTime(3000));
  expect(screen.getByText('Conversation offline')).toBeVisible();
  let fail: (error: Error) => void;
  vi.mocked(request).mockImplementation((path, options) =>
    path.endsWith('/chats/chat1')
      ? new Promise((_resolve, reject) => {
          fail = reject;
        })
      : original(path, options)
  );
  await act(async () => vi.advanceTimersByTime(3000));
  view.unmount();
  await act(async () => fail(new Error('Late failure')));
});
