import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { request, setCsrfToken } from './api.js';
import AuthGate from './AuthGate.jsx';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn(), setCsrfToken: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
  request.mockResolvedValue({ authenticated: false, configured: true });
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
  request.mockResolvedValueOnce({
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
  request.mockResolvedValueOnce({ authenticated: true, username: 'tony', csrfToken: 'new-token' });
  await user.click(screen.getByRole('button', { name: 'Set password and open studio' }));
  expect(await screen.findByText('Private studio for tony')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/auth/activate', {
    method: 'POST',
    body: { token, password: 'My brand new owner password' }
  });
});
test('expired sessions hide private content and allow sign-in again without clearing drafts', async () => {
  localStorage.setItem('roxy-test-draft', 'unsaved words');
  request.mockResolvedValue({ authenticated: true, username: 'tony', csrfToken: 'old-token' });
  mount();
  await screen.findByText('Private studio for tony');
  window.dispatchEvent(new Event('studio:sign-in-required'));
  await screen.findByRole('heading', { name: 'Welcome back.' });
  expect(screen.queryByText('Private studio for tony')).not.toBeInTheDocument();
  expect(localStorage.getItem('roxy-test-draft')).toBe('unsaved words');
  localStorage.removeItem('roxy-test-draft');
});
test('connection failure gives a retry instead of exposing the workspace', async () => {
  request.mockRejectedValue(new Error('Connection unavailable'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable');
  expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
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
  expect(request.mock.calls.some(([path]) => path === '/auth/activate')).toBe(false);
});
