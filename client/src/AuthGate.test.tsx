import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { request, setCsrfToken } from './api.ts';
import AuthGate, { AccountControls } from './AuthGate.tsx';
import { theme } from './theme.ts';

vi.mock('./api.ts', () => ({ request: vi.fn(), setCsrfToken: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
  vi.mocked(request).mockResolvedValue({ authenticated: false, configured: true });
});
function mount() {
  return render(
    <ThemeProvider theme={theme}>
      <StrictMode>
        <AuthGate>{({ session }) => <p>Private studio for {session.username}</p>}</AuthGate>
      </StrictMode>
    </ThemeProvider>
  );
}
test('studio does not mount until the owner signs in', async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByRole('heading', { name: 'Welcome back.' });
  expect(screen.queryByText(/Private studio for/)).not.toBeInTheDocument();
  await user.type(screen.getByLabelText(/^Password/), 'My private owner password');
  vi.mocked(request).mockResolvedValueOnce({
    authenticated: true,
    username: 'tony',
    csrfToken: 'session-token'
  });
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Private studio for tony')).toBeInTheDocument();
  expect(setCsrfToken).toHaveBeenCalledWith('session-token');
  expect(request).toHaveBeenCalledWith('/auth/login', {
    method: 'POST',
    body: { username: 'tony', password: 'My private owner password' }
  });
});
test('one-time setup works in StrictMode and removes the secret from the address bar', async () => {
  const token = 'a'.repeat(43);
  window.history.replaceState(null, '', '/#setup=' + token);
  mount();
  const user = userEvent.setup();
  await screen.findByRole('heading', { name: 'Make this studio yours.' });
  expect(window.location.hash).toBe('');
  await user.type(
    screen.getByLabelText(/^New password or passphrase/),
    'My brand new owner password'
  );
  await user.type(screen.getByLabelText(/^Confirm password/), 'My brand new owner password');
  vi.mocked(request).mockResolvedValueOnce({
    authenticated: true,
    username: 'tony',
    csrfToken: 'new-token'
  });
  await user.click(screen.getByRole('button', { name: 'Set password and open studio' }));
  expect(await screen.findByText('Private studio for tony')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/auth/activate', {
    method: 'POST',
    body: { token, password: 'My brand new owner password' }
  });
});
test('expired sessions hide private content and allow sign-in again without clearing drafts', async () => {
  localStorage.setItem('roxy-test-draft', 'unsaved words');
  vi.mocked(request).mockResolvedValue({
    authenticated: true,
    username: 'tony',
    csrfToken: 'old-token'
  });
  mount();
  await screen.findByText('Private studio for tony');
  window.dispatchEvent(new Event('studio:sign-in-required'));
  await screen.findByRole('heading', { name: 'Welcome back.' });
  expect(screen.queryByText('Private studio for tony')).not.toBeInTheDocument();
  expect(localStorage.getItem('roxy-test-draft')).toBe('unsaved words');
  localStorage.removeItem('roxy-test-draft');
});
test('connection failure gives a retry instead of exposing the workspace', async () => {
  vi.mocked(request).mockRejectedValue(new Error('Connection unavailable'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable');
  expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
});
test('password mismatch never sends the invitation to the server', async () => {
  window.history.replaceState(null, '', '/#setup=' + 'b'.repeat(43));
  mount();
  const user = userEvent.setup();
  await screen.findByRole('heading', { name: 'Make this studio yours.' });
  await user.type(
    screen.getByLabelText(/^New password or passphrase/),
    'A long new owner password'
  );
  await user.type(screen.getByLabelText(/^Confirm password/), 'A different new password');
  await user.click(screen.getByRole('button', { name: 'Set password and open studio' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('The passwords do not match.')
  );
  expect(vi.mocked(request).mock.calls.some(([path]) => path === '/auth/activate')).toBe(false);
});

test('login errors keep credentials editable and never expose the studio', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Welcome back.' });
  fireEvent.change(screen.getByLabelText('Username', { exact: false }), {
    target: { value: 'owner' }
  });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Wrong password' } });
  vi.mocked(request).mockRejectedValueOnce(new Error('Incorrect credentials'));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect credentials');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  expect(request).toHaveBeenLastCalledWith('/auth/login', {
    method: 'POST',
    body: { username: 'owner', password: 'Wrong password' }
  });
});

test('unconfigured studios explain owner setup and cannot submit a login', async () => {
  vi.mocked(request).mockResolvedValue({ authenticated: false, configured: false });
  mount();
  await screen.findByText(/Run the owner setup command/);
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
});

test('an invitation can switch back to an existing password login', async () => {
  history.replaceState(null, '', '/#setup=invitation');
  mount();
  await screen.findByRole('heading', { name: 'Make this studio yours.' });
  fireEvent.click(screen.getByRole('button', { name: 'I already have a password' }));
  expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(screen.getByLabelText('Username', { exact: false })).toBeEnabled();
});

test.each(['resolve', 'reject'])(
  'session requests ignore %s after unmount instead of updating authentication',
  async (outcome) => {
    let finish: (value?: unknown) => void;
    vi.mocked(request).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finish = outcome === 'resolve' ? resolve : reject;
        })
    );
    const view = render(<AuthGate>{() => <p>Private</p>}</AuthGate>);
    expect(screen.getByLabelText('Checking your studio session')).toBeVisible();
    const signal = vi.mocked(request).mock.calls[0][1].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish(
        outcome === 'resolve' ? { authenticated: true, csrfToken: 'late' } : new Error('Aborted')
      )
    );
    expect(setCsrfToken).not.toHaveBeenCalled();
  }
);

test('the account callbacks update the gate session and sign out without clearing browser drafts', async () => {
  vi.mocked(request).mockResolvedValue({ authenticated: true, username: 'owner' });
  render(
    <AuthGate>
      {(account) => (
        <>
          <p>{account.session.username}</p>
          <button
            onClick={() =>
              account.onSession({
                authenticated: true,
                username: 'renamed',
                configured: true,
                csrfToken: 'new'
              })
            }
          >
            Refresh session
          </button>
          <button onClick={account.onSignedOut}>Leave studio</button>
        </>
      )}
    </AuthGate>
  );
  await screen.findByText('owner');
  fireEvent.click(screen.getByText('Refresh session'));
  expect(screen.getByText('renamed')).toBeVisible();
  expect(setCsrfToken).toHaveBeenCalledWith('new');
  fireEvent.click(screen.getByText('Leave studio'));
  expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
});

test('account logout reports a failure and permits retry before clearing the session token', async () => {
  const onSignedOut = vi.fn();
  render(<AccountControls username="owner" onSignedOut={onSignedOut} onSession={vi.fn()} />);
  vi.mocked(request).mockRejectedValueOnce(new Error('Logout unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Logout unavailable');
  expect(onSignedOut).not.toHaveBeenCalled();
  vi.mocked(request).mockResolvedValueOnce({ authenticated: false });
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
  expect(setCsrfToken).toHaveBeenCalledWith('');
});

test('account password changes validate confirmation, retain failures, then save and clear the form', async () => {
  const onSession = vi.fn();
  render(<AccountControls username="owner" onSignedOut={vi.fn()} onSession={onSession} />);
  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
  fireEvent.change(screen.getByLabelText(/^Current password/), {
    target: { value: 'Current password' }
  });
  fireEvent.change(screen.getByLabelText(/^New password/), {
    target: { value: 'New secure password' }
  });
  fireEvent.change(screen.getByLabelText(/^Confirm password/), {
    target: { value: 'Mismatch password' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  expect(screen.getByRole('alert')).toHaveTextContent('The new passwords do not match.');
  expect(request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/^Confirm password/), {
    target: { value: 'New secure password' }
  });
  vi.mocked(request).mockRejectedValueOnce(new Error('Current password incorrect'));
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText('Current password incorrect')).toBeVisible();
  expect(screen.getByLabelText(/^New password/)).toHaveValue('New secure password');
  let finish: (value: unknown) => void;
  vi.mocked(request).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeVisible();
  await act(async () => finish({ authenticated: true, csrfToken: 'changed' }));
  expect(onSession).toHaveBeenCalledWith({ authenticated: true, csrfToken: 'changed' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
  expect(screen.getByLabelText(/^Current password/)).toHaveValue('');
  expect(screen.getByLabelText(/^New password/)).toHaveValue('');
  expect(screen.getByLabelText(/^Confirm password/)).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
