import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type * as Studio from '../../shared/types.ts';
import { request } from './api.ts';
import ChatGPTConnection from './ChatGPTConnection.tsx';

vi.mock('./api.ts', () => ({ request: vi.fn() }));
const realWindow = window;
const assign = vi.fn(),
  errors = vi.fn(),
  notify = vi.fn();
const profile = {
  id: 'owner',
  label: 'Owner',
  email: 'owner@example.test',
  signedIn: true,
  planEnabled: true,
  model: 'model-one',
  models: [
    { id: 'model-one', name: 'Model One' },
    { id: 'model-two', name: 'Model Two' }
  ]
};
function location(url: string) {
  const destination = new URL(url);
  vi.stubGlobal(
    'window',
    new Proxy(realWindow, {
      get(target, key) {
        if (key === 'location')
          return { protocol: destination.protocol, hostname: destination.hostname, assign };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    })
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  location('http://127.0.0.1:5000');
  vi.mocked(request).mockResolvedValue({});
});
afterEach(() => vi.unstubAllGlobals());
function mount(connection?: Partial<Studio.ChatGPTConnection>, busy = false) {
  return render(
    <ChatGPTConnection
      connection={connection as Studio.ChatGPTConnection}
      busy={busy}
      notify={notify}
      act={async (action) => {
        try {
          await action();
        } catch (error) {
          errors(error);
        }
      }}
    />
  );
}
function choose(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(within(screen.getByRole('listbox')).getByText(option));
}

test('local sign-in adds or reconnects an account through the validated PC callback address', async () => {
  vi.mocked(request).mockResolvedValue({ signInUrl: 'http://127.0.0.1:5001/auth/start/code' });
  mount({ activeProfileId: 'owner', profiles: [profile] });
  fireEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:5001/auth/start/code'));
  expect(request).toHaveBeenLastCalledWith('/studio/assistant/connections/chatgpt/connect', {
    method: 'POST',
    body: { profileId: 'owner' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
  expect(request).toHaveBeenLastCalledWith('/studio/assistant/connections/chatgpt/connect', {
    method: 'POST',
    body: { profileId: undefined }
  });
});

test.each([
  'https://127.0.0.1/auth/start/code',
  'http://example.test/auth/start/code',
  'http://127.0.0.1/unexpected',
  'invalid URL'
])('rejects an unexpected sign-in destination: %s', async (signInUrl) => {
  vi.mocked(request).mockResolvedValue({ signInUrl });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
  await waitFor(() => expect(errors).toHaveBeenCalledOnce());
  expect(assign).not.toHaveBeenCalled();
});

test('account, model and connection actions use the proper routes and display provider or fallback notices', async () => {
  mount({
    activeProfileId: 'owner',
    profiles: [
      profile,
      { id: 'second', label: 'Second', signedIn: false, planEnabled: false, models: [] }
    ],
    pending: { expiresAt: 1 },
    canChat: true,
    legacyApiKeyIgnored: true
  });
  choose('ChatGPT account', 'Second · Signed out');
  expect(request).toHaveBeenLastCalledWith('/studio/assistant/connections/chatgpt/active', {
    method: 'PUT',
    body: { profileId: 'second' }
  });
  choose('ChatGPT model', 'Model Two');
  expect(request).toHaveBeenLastCalledWith('/studio/assistant/connections/chatgpt/model', {
    method: 'PUT',
    body: { model: 'model-two' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
  expect(request).toHaveBeenLastCalledWith('/studio/assistant/connections/chatgpt/cancel', {
    method: 'POST',
    body: {}
  });
  vi.mocked(request).mockResolvedValueOnce({ message: 'Catalog refreshed' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('Catalog refreshed'));
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith('A ChatGPT plan request completed successfully.')
  );
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect ChatGPT account' }));
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith('Signed out of ChatGPT on this studio PC.')
  );
  expect(request).toHaveBeenLastCalledWith('/studio/assistant/connections/chatgpt/disconnect', {
    method: 'POST',
    body: { profileId: 'owner' }
  });
});

test.each(['https://localhost', 'http://studio.example.test'])(
  'remote connections explain the PC sign-in requirement: %s',
  (url) => {
    location(url);
    mount();
    expect(screen.getByText(/Complete sign-in on the studio PC/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toBeDisabled();
  }
);

test.each([
  'subscription_sharing_usage_limit_exceeded',
  'subscription_sharing_usage_unavailable',
  'other failure'
])('shows the actionable account state for %s', (lastError) => {
  location('http://localhost:5000');
  mount(
    {
      activeProfileId: 'owner',
      profiles: [
        {
          ...profile,
          model: undefined,
          models: undefined,
          verifiedAt: new Date().toISOString(),
          lastError
        }
      ]
    },
    true
  );
  expect(screen.getByRole('combobox', { name: 'ChatGPT model' })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  expect(screen.getByText(/Saved drafts and jobs remain available/)).toBeVisible();
  expect(screen.getByText('A request has completed using this ChatGPT connection.')).toBeVisible();
});

test('a signed-in account without plan permission explains what to enable and displays catalog errors', () => {
  mount({
    activeProfileId: 'owner',
    profiles: [{ ...profile, planEnabled: false, modelsError: 'Catalog unavailable' }]
  });
  expect(screen.getByText('Signed in · plan permission needed')).toBeVisible();
  expect(
    screen.getByText(/Your account is signed in, but ChatGPT plan usage was not granted/)
  ).toBeVisible();
  expect(screen.getByText('Catalog unavailable')).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'ChatGPT model' })).not.toBeInTheDocument();
});

test('an account list without a selected profile asks the owner to choose one', () => {
  mount({ profiles: [profile] });
  expect(screen.getByRole('combobox', { name: 'ChatGPT account' })).toBeEnabled();
  expect(screen.getByText('Connect your ChatGPT account')).toBeVisible();
});
