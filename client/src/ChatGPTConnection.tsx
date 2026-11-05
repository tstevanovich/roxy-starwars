import { Alert, Box, Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';

import type * as Studio from '../../shared/types.ts';
import { request } from './api.ts';

const usageUrl = 'https://chatgpt.com/settings/usage';
export default function ChatGPTConnection({
  connection,
  busy,
  act,
  notify
}: {
  connection?: Studio.ChatGPTConnection;
  busy?: boolean;
  act: (action: () => Promise<void>) => Promise<void>;
  notify: (message: string) => void;
}) {
  const active = connection?.profiles?.find((p) => p.id === connection.activeProfileId);
  const local =
    window.location.protocol === 'http:' &&
    ['127.0.0.1', 'localhost'].includes(window.location.hostname);
  async function connect(profileId?) {
    await act(async () => {
      const result = await request<{ signInUrl: string }>(
        '/studio/assistant/connections/chatgpt/connect',
        {
          method: 'POST',
          body: { profileId }
        }
      );
      const destination = new URL(result.signInUrl);
      if (
        destination.protocol !== 'http:' ||
        destination.hostname !== '127.0.0.1' ||
        !destination.pathname.startsWith('/auth/start/')
      )
        throw new Error('The studio returned an unexpected sign-in address.');
      window.location.assign(destination.toString());
    });
  }
  async function action(path, body?, message?: string) {
    await act(async () => {
      const result = await request<Studio.ActionResult>(
        '/studio/assistant/connections/chatgpt/' + path,
        {
          method: path === 'model' || path === 'active' ? 'PUT' : 'POST',
          body: body ?? {}
        }
      );
      if (message || result.message) notify(result.message ?? message);
    });
  }
  return (
    <Stack spacing={2}>
      <Typography variant="h3">ChatGPT · story and production chat</Typography>
      <Typography variant="body2">
        Use your ChatGPT plan for eligible studio conversations. Usage follows your ChatGPT plan
        limits and credits settings. This studio has no fallback to separately billed API-key usage.
      </Typography>
      <Chip
        sx={{ alignSelf: 'flex-start' }}
        color={active?.signedIn && active?.planEnabled ? 'success' : 'warning'}
        label={
          active?.signedIn
            ? active.planEnabled
              ? 'Signed in · plan permission granted'
              : 'Signed in · plan permission needed'
            : 'Connect your ChatGPT account'
        }
      />
      {!local && (
        <Alert severity="info">
          Complete sign-in on the studio PC: open <strong>http://127.0.0.1:5000</strong>, then
          Production chat → Connections. Once connected, you can use studio chat from this phone.
        </Alert>
      )}
      {connection?.profiles?.length > 0 && (
        <TextField
          select
          fullWidth
          label="ChatGPT account"
          value={connection.activeProfileId ?? ''}
          onChange={(e) => action('active', { profileId: e.target.value })}
          disabled={busy}
        >
          {connection.profiles.map((p) => (
            <MenuItem
              value={p.id}
              key={p.id}
              sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
            >
              {p.label}
              {p.email ? ` · ${p.email}` : ''}
              {p.signedIn ? '' : ' · Signed out'}
            </MenuItem>
          ))}
        </TextField>
      )}
      {active?.email && (
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {active.email}
        </Typography>
      )}
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" disabled={!local || busy} onClick={() => connect(active?.id)}>
          Continue with ChatGPT
        </Button>
        {connection?.profiles?.length > 0 && (
          <Button variant="outlined" disabled={!local || busy} onClick={() => connect()}>
            Add account
          </Button>
        )}
        <Button component="a" href={usageUrl} target="_blank" rel="noopener noreferrer">
          Manage usage
        </Button>
      </Stack>
      {connection?.pending && (
        <Alert
          severity="info"
          action={
            <Button disabled={busy} onClick={() => action('cancel')}>
              Cancel sign-in
            </Button>
          }
        >
          A sign-in attempt is waiting in the PC browser. It expires after ten minutes.
        </Alert>
      )}
      {active?.signedIn && !active.planEnabled && (
        <Alert severity="warning">
          Your account is signed in, but ChatGPT plan usage was not granted. Enable it for this app
          in ChatGPT’s usage settings before sending a message.
        </Alert>
      )}
      {active?.modelsError && <Alert severity="warning">{active.modelsError}</Alert>}
      {active?.signedIn && active.planEnabled && (
        <>
          <TextField
            select
            fullWidth
            label="ChatGPT model"
            value={active.model ?? ''}
            disabled={busy || !active.models?.length}
            helperText="Models come from this account’s catalog. A completed reply or connection test verifies access."
            onChange={(e) => action('model', { model: e.target.value })}
          >
            <MenuItem value="">Choose an available model</MenuItem>
            {(active.models ?? []).map((m) => (
              <MenuItem
                key={m.id}
                value={m.id}
                sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
              >
                {m.name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
            <Button disabled={busy} onClick={() => action('models')}>
              Refresh models
            </Button>
            <Button
              variant="outlined"
              disabled={busy || !connection.canChat}
              onClick={() => action('test', {}, 'A ChatGPT plan request completed successfully.')}
            >
              Test connection
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {active.verifiedAt
              ? 'A request has completed using this ChatGPT connection.'
              : 'Sign-in is complete. Test connection makes a short request using your ChatGPT plan; it does not generate production assets.'}
          </Typography>
        </>
      )}
      {active?.lastError && (
        <Alert severity="warning">
          {active.lastError === 'subscription_sharing_usage_limit_exceeded'
            ? 'Your ChatGPT plan or this app’s limit has been reached.'
            : active.lastError === 'subscription_sharing_usage_unavailable'
              ? 'ChatGPT plan usage is currently unavailable for this account or app.'
              : 'The last ChatGPT request could not complete. Check this connection and Manage usage.'}{' '}
          Saved drafts and jobs remain available. No API-key fallback was used.
        </Alert>
      )}
      {active?.signedIn && (
        <Box>
          <Button
            color="error"
            disabled={busy}
            onClick={() =>
              action(
                'disconnect',
                { profileId: active.id },
                'Signed out of ChatGPT on this studio PC.'
              )
            }
          >
            Disconnect ChatGPT account
          </Button>
        </Box>
      )}
      {connection?.legacyApiKeyIgnored && (
        <Typography variant="caption">
          A previously configured OpenAI API key is ignored by studio chat.
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary">
        Your studio login remains separate. ChatGPT sign-in does not import your other ChatGPT
        conversations. Connection credentials stay encrypted on this PC.
      </Typography>
    </Stack>
  );
}
