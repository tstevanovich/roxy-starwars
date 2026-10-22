import LockOutlined from '@mui/icons-material/LockOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useEffect, useState } from 'react';

import { request, setCsrfToken } from './api.js';

function takeSetupToken() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('setup') || '';
  return token;
}
function PasswordFields({ password, setPassword, confirmation, setConfirmation }) {
  return (
    <>
      <TextField
        fullWidth
        label="New password or passphrase"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        helperText="At least 15 characters. A few memorable words work well."
        required
        slotProps={{ htmlInput: { minLength: 15, maxLength: 256 } }}
      />
      <TextField
        fullWidth
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        required
        slotProps={{ htmlInput: { minLength: 15, maxLength: 256 } }}
      />
    </>
  );
}
export function AccountControls({ username, onSignedOut, onSession }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState('');
  async function logout() {
    setBusy(true);
    setError('');
    try {
      await request('/auth/logout', { method: 'POST' });
      setCsrfToken('');
      onSignedOut();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function change(event) {
    event.preventDefault();
    if (password !== confirmation) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await request('/auth/password', {
        method: 'POST',
        body: { currentPassword: current, password }
      });
      onSession(data);
      setCurrent('');
      setPassword('');
      setConfirmation('');
      setOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Stack
        direction="row"
        className="account-controls"
        sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <Button
          size="small"
          startIcon={<LockOutlined />}
          onClick={() => {
            setError('');
            setOpen(true);
          }}
        >
          Account
        </Button>
        <Button size="small" startIcon={<LogoutOutlined />} disabled={busy} onClick={logout}>
          Sign out
        </Button>
      </Stack>
      {error && !open && <Alert severity="error">{error}</Alert>}
      <Dialog open={open} onClose={() => !busy && setOpen(false)} fullWidth maxWidth="xs">
        <Box component="form" onSubmit={change}>
          <DialogTitle>Your studio account</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography>
                Signed in as {username}. Changing your password signs out all other devices.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Unsaved edits stay in this browser. Save them before switching devices.
              </Typography>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
              <PasswordFields {...{ password, setPassword, confirmation, setConfirmation }} />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? 'Saving…' : 'Change password'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </>
  );
}
export default function AuthGate({ children }) {
  const [setupToken] = useState(takeSetupToken);
  const [session, setSession] = useState(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [username, setUsername] = useState('tony'),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [activating, setActivating] = useState(Boolean(setupToken));
  function accept(data) {
    setCsrfToken(data.csrfToken);
    setSession(data);
    setPassword('');
    setConfirmation('');
    setError('');
  }
  useEffect(() => {
    if (setupToken)
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const controller = new AbortController();
    request('/auth/session', { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setCsrfToken(data.csrfToken);
          setSession(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    const expired = () => {
      setCsrfToken('');
      setSession({ authenticated: false, configured: true });
      setError('Please sign in again. Your saved records and browser drafts are retained.');
    };
    window.addEventListener('studio:sign-in-required', expired);
    return () => {
      controller.abort();
      window.removeEventListener('studio:sign-in-required', expired);
    };
  }, [setupToken]);
  async function submit(event) {
    event.preventDefault();
    if (activating && password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      accept(
        await request(activating ? '/auth/activate' : '/auth/login', {
          method: 'POST',
          body: activating ? { token: setupToken, password } : { username, password }
        })
      );
      setActivating(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <Box className="sign-in-shell">
        <CircularProgress aria-label="Checking your studio session" />
      </Box>
    );
  if (session?.authenticated && !activating)
    return children({
      session,
      onSession: accept,
      onSignedOut: () => setSession({ authenticated: false, configured: true })
    });
  return (
    <Box className="sign-in-shell">
      <Box component="form" className="sign-in-card" onSubmit={submit}>
        <Box className="brand-mark">RK</Box>
        <Typography variant="overline">ROXY KANE / PRIVATE STUDIO</Typography>
        <Typography variant="h1">
          {activating ? 'Make this studio yours.' : 'Welcome back.'}
        </Typography>
        <Typography color="text.secondary">
          {activating
            ? 'Set your password to finish connecting your private studio. This setup link can only be used once.'
            : 'Sign in to review your scenes and creative choices.'}
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {session?.configured === false && (
          <Alert severity="info">
            Run the owner setup command on the studio computer first. There is no public account
            registration.
          </Alert>
        )}
        <TextField
          fullWidth
          label="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          disabled={activating}
        />
        {activating ? (
          <PasswordFields {...{ password, setPassword, confirmation, setConfirmation }} />
        ) : (
          <TextField
            fullWidth
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            slotProps={{ htmlInput: { maxLength: 256 } }}
          />
        )}
        <Button
          fullWidth
          type="submit"
          variant="contained"
          disabled={busy || session?.configured === false}
        >
          {busy ? 'Please wait…' : activating ? 'Set password and open studio' : 'Sign in'}
        </Button>
        {activating && (
          <Button onClick={() => setActivating(false)}>I already have a password</Button>
        )}
        {!session && <Button onClick={() => window.location.reload()}>Retry connection</Button>}
        <Typography variant="caption" color="text.secondary">
          Your records and original files stay on your studio computer.
        </Typography>
      </Box>
    </Box>
  );
}
