import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

import { request } from './api.js';
import { currentProjectKey } from './project-url.js';

export default function SceneBoardEditor({ episode, scene, disabled, onChanged, children }) {
  const key = `roxy-scene-board-${currentProjectKey()}-${episode._id}-${scene.id}`;
  const [draft, setDraft] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key)) || null;
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const dirty = Boolean(draft);
  const current = draft?.scene ?? scene;
  useEffect(() => {
    try {
      if (draft) localStorage.setItem(key, JSON.stringify(draft));
      else localStorage.removeItem(key);
    } catch {
      /* Keep editing when browser storage is full. */
    }
  }, [draft, key]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function edit(change) {
    setDraft((old) => ({
      editToken: old?.editToken ?? scene.editToken,
      scene:
        typeof change === 'function'
          ? change(old?.scene ?? scene)
          : { ...(old?.scene ?? scene), ...change }
    }));
    setNotice('');
  }
  function editClip(id, change) {
    edit((value) => ({
      ...value,
      clips: value.clips.map((clip) =>
        clip.id === id
          ? { ...clip, ...change, production: { ...clip.production, ...change.production } }
          : clip
      )
    }));
  }
  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request('/studio/workflow/scene/save', {
        method: 'POST',
        body: {
          target: { scope: 'scene', recordId: episode._id, sceneId: scene.id },
          editToken: draft.editToken,
          scene: current
        }
      });
      await onChanged();
      setDraft(null);
      setNotice(result.message);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  const saveButton = (
    <Button variant="contained" disabled={disabled || busy || !dirty} onClick={save}>
      {busy ? 'Saving scene…' : 'Save scene'}
    </Button>
  );
  return (
    <Stack spacing={2}>
      <Box
        component="details"
        id={`board-scene-edit-${scene.id}`}
        tabIndex={-1}
        sx={{ scrollMarginTop: '110px' }}
      >
        <Typography component="summary" sx={{ cursor: 'pointer', fontWeight: 600 }}>
          Edit scene details
        </Typography>
        <Stack spacing={2} sx={{ mt: 2 }}>
          <TextField
            label="Scene title"
            value={current.title}
            disabled={disabled || busy}
            onChange={(event) => edit({ title: event.target.value })}
          />
          <TextField
            label="Scene location"
            value={current.location ?? ''}
            disabled={disabled || busy}
            onChange={(event) => edit({ location: event.target.value })}
          />
          <TextField
            label="Scene script"
            multiline
            minRows={4}
            value={current.script ?? ''}
            disabled={disabled || busy}
            onChange={(event) => edit({ script: event.target.value })}
          />
        </Stack>
      </Box>
      {dirty && (
        <Alert severity="info">
          This scene has unsaved edits. Save this scene before generating or approving its images,
          dialogue or videos.
        </Alert>
      )}
      {draft && scene.editToken !== draft.editToken && (
        <Alert severity="warning">
          This scene changed elsewhere. Your local draft is retained; the save will check for
          conflicting edits.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {notice && (
        <Alert severity="success" role="status">
          {notice}
        </Alert>
      )}
      {saveButton}
      {children({ draftScene: current, editClip, dirty, busy, save })}
      {dirty && saveButton}
    </Stack>
  );
}
