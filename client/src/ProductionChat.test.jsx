import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.js';
import ProductionChat from './ProductionChat.jsx';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn(), uploadMedia: vi.fn() }));
const context = { episodeId: 'episode' };
const data = {
  assets: [],
  media: [],
  episodes: [{ _id: 'episode', title: 'Episode 01', scenes: [] }]
};
const configured = {
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
function mount(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ProductionChat
        data={data}
        onMedia={vi.fn()}
        onReview={vi.fn()}
        onChanged={vi.fn()}
        {...props}
      />
    </ThemeProvider>
  );
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
      kind: 'image',
      title: 'Port reference',
      status: 'ready',
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
      status: 'pending',
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
      status: 'failed',
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

test('OpenArt shows secure sharing status and offers a read-only connection test', async () => {
  const user = userEvent.setup();
  const account = structuredClone(configured);
  account.openart = {
    ...account.openart,
    connected: true,
    referenceSharing: { ready: true, origin: 'https://studio.example.com' }
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
  expect(screen.getByText(/Local PC sign-in is supported/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Test OpenArt connection' }));
  expect(await screen.findByText('OpenArt responded successfully.')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/studio/assistant/connections/openart/test', {
    method: 'POST',
    body: {}
  });
});
