import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';

import { toError } from '../../shared/errors.ts';
import {
  imageGenerationDefaults,
  videoGenerationDefaults
} from '../../shared/production-defaults.ts';
import type * as Studio from '../../shared/types.ts';
import { request } from './api.ts';
import { downloadDraft, useDraft } from './studio-utils.ts';
export default function SeriesBible({
  settings,
  onSaved
}: {
  settings?: Studio.StudioSettings;
  onSaved: (record: Studio.StudioSettings) => void | Promise<unknown>;
}) {
  const { draft, dirty, edit, saved, reloadSaved } = useDraft(settings, 'bible');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const field = (name: string, value) =>
    edit({
      ...draft,
      [name]: value
    });
  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { settings: next } = await request<{ settings: Studio.StudioSettings }>(
        '/studio/settings',
        {
          method: 'PUT',
          body: draft
        }
      );
      saved(next);
      onSaved(next);
      setNotice('Series bible saved.');
    } catch (caughtError) {
      const e = toError(caughtError);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h1">Series bible</Typography>
        <Typography
          color="text.secondary"
          sx={{
            mt: 1
          }}
        >
          The creative rules that hold Roxy’s world together.
        </Typography>
      </Box>
      {error && (
        <Alert severity="error">
          {error}
          <Button color="inherit" onClick={reloadSaved}>
            Export draft and reload saved version
          </Button>
        </Alert>
      )}
      {notice && <Alert severity="success">{notice}</Alert>}
      <Alert severity="info">
        New videos use {videoGenerationDefaults.displayName} at native 1080p, 16:9. Approve picture,
        performance and sound together, then use the approved file directly in CapCut. No upscale
        step is required. Existing approved high-resolution files remain available.
      </Alert>
      <Alert severity="info">
        Every character, droid, and prop uses a reusable reference sheet. Characters and droids need
        front, three-quarter, side, rear, and face views. Props need both sides, top, rear, and
        detail views, with front and three-quarter views when useful. Approve sheets in the Creative
        library. Keep episode wardrobes separate from character identity.
      </Alert>
      <Box className="editor-panel">
        <Stack spacing={3}>
          <TextField
            label="Era and setting"
            value={draft.era}
            onChange={(e) => field('era', e.target.value)}
          />
          <Stack
            direction={{
              xs: 'column',
              sm: 'row'
            }}
            sx={{
              gap: 2
            }}
          >
            <TextField
              label="Episode target in seconds"
              type="number"
              fullWidth
              value={draft.targetSeconds}
              onChange={(e) => field('targetSeconds', Number(e.target.value))}
            />
            <TextField
              label="Vlog target percentage"
              disabled={settings.cinematicOnly}
              type="number"
              fullWidth
              value={draft.vlogPercent}
              onChange={(e) => field('vlogPercent', Number(e.target.value))}
            />
            <TextField
              label="Monthly OpenArt allowance"
              type="number"
              fullWidth
              value={draft.monthlyCredits}
              onChange={(e) => field('monthlyCredits', Number(e.target.value))}
            />
          </Stack>
          <TextField
            label="Story, tone, and continuity rules"
            multiline
            minRows={8}
            value={draft.notes}
            onChange={(e) => field('notes', e.target.value)}
          />
          <Stack
            direction="row"
            sx={{
              gap: 2
            }}
          >
            <Button variant="contained" disabled={busy || !dirty} onClick={save}>
              Save series bible
            </Button>
            <Button onClick={() => downloadDraft(draft, 'roxy-series-bible.json')}>
              Export series bible
            </Button>
          </Stack>
        </Stack>
      </Box>
      <Box className="pipeline-grid">
        {[
          ['Images', imageGenerationDefaults.displayName, '2K · high quality · all image assets'],
          ['Video', 'Wan 3.0', '16:9 · native 1080p · scene-led duration'],
          ['Voices', 'ElevenLabs', 'Reusable voices · original dialogue masters'],
          ['Final edit', 'CapCut', 'Selected clips · music added in the edit']
        ].map(([label, name, detail]) => (
          <Box className="editor-panel" key={name}>
            <Typography variant="overline">{label}</Typography>
            <Typography
              variant="h3"
              sx={{
                my: 1
              }}
            >
              {name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {detail}
            </Typography>
          </Box>
        ))}
      </Box>
      <Alert severity="info">
        Video audio should contain dialogue, synchronized effects, and ambience. No generated music.
        The monthly allowance is a planning reference; live provider balances and charges are not
        connected.
      </Alert>
    </Stack>
  );
}
