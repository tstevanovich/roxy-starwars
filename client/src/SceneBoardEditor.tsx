import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import type * as React from 'react';
import { useEffect, useState } from 'react';

import { toError } from '../../shared/errors.ts';
import type * as Studio from '../../shared/types.ts';
import { request } from './api.ts';
import { currentProjectKey } from './project-url.ts';
import { sceneDraftMatches } from './scene-board-draft.ts';

export interface SceneEditorState {
  draftScene: Studio.Scene;
  editClip: (id: string, change: Partial<Studio.Clip>) => void;
  dirty: boolean;
  busy: boolean;
  save: () => Promise<void>;
  saveError: string;
  saveNotice: string;
  pendingRefresh: boolean;
  refreshSaved: () => Promise<void>;
  useSaved: () => void;
}
export default function SceneBoardEditor({
  episode,
  scene,
  disabled,
  onChanged,
  children
}: {
  episode: Studio.Episode;
  scene: Studio.Scene;
  disabled?: boolean;
  onChanged: () => void | Promise<unknown>;
  children?: (state: SceneEditorState) => React.ReactNode;
}) {
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
  const [pendingRefresh, setPendingRefresh] = useState(false),
    [savedScene, setSavedScene] = useState<Studio.Scene | null>(null);
  const [recovery, setRecovery] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key + '-recovery')) || null;
    } catch {
      return null;
    }
  });
  const dirty = Boolean(draft) && !sceneDraftMatches(draft.scene, scene);
  const waitingForRefresh =
    pendingRefresh && !(savedScene?.editToken && scene.editToken === savedScene.editToken);
  const visibleError = pendingRefresh && !waitingForRefresh ? '' : error;
  const current = dirty ? draft.scene : savedScene && waitingForRefresh ? savedScene : scene;
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(key, JSON.stringify(draft));
      else localStorage.removeItem(key);
    } catch {
      /* Keep editing when browser storage is full. */
    }
  }, [draft, dirty, key]);
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
    setDraft((stored) => {
      const old = stored && !sceneDraftMatches(stored.scene, scene) ? stored : null;
      return {
        editToken: old?.editToken ?? scene.editToken,
        scene:
          typeof change === 'function'
            ? change(old?.scene ?? scene)
            : { ...(old?.scene ?? scene), ...change }
      };
    });
    setNotice('');
  }
  function editClip(id, change) {
    edit((value) => ({
      ...value,
      clips: value.clips.map((clip: Studio.Clip) =>
        clip.id === id
          ? { ...clip, ...change, production: { ...clip.production, ...change.production } }
          : clip
      )
    }));
  }
  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    setPendingRefresh(false);
    setError('');
    setNotice('');
    try {
      const result = await request<{
        scene: Studio.Scene;
        episodeRevision: number;
        message: string;
      }>('/studio/workflow/scene/save', {
        method: 'POST',
        body: {
          target: { scope: 'scene' as const, recordId: episode._id, sceneId: scene.id },
          editToken: draft.editToken,
          scene: current
        }
      });
      // The save is acknowledged. Clear the local draft before a separate
      // refresh can fail or the phone can leave this page.
      setSavedScene(result.scene ?? current);
      setDraft(null);
      try {
        localStorage.removeItem(key);
      } catch {
        /* State remains saved. */
      }
      setNotice(result.message);
      setPendingRefresh(true);
      await refreshSaved();
    } catch (caughtError) {
      const failure = toError(caughtError);
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  async function refreshSaved() {
    try {
      await onChanged();
      setPendingRefresh(false);
      setError('');
    } catch (caughtError) {
      const failure = toError(caughtError);
      setError('The scene was saved, but its status could not refresh. ' + failure.message);
    }
  }
  function useSaved() {
    if (!draft) return;
    const backup = { savedAt: new Date().toISOString(), draft };
    try {
      localStorage.setItem(key + '-recovery-' + Date.now(), JSON.stringify(backup));
      localStorage.setItem(key + '-recovery', JSON.stringify(backup));
      localStorage.removeItem(key);
    } catch {
      setError('Could not keep a recovery copy of your local draft. Your edits are still open.');
      return;
    }
    setRecovery(backup);
    setDraft(null);
    setError('');
    setNotice('Using the saved scene. Your local edits are kept in Restore local draft.');
  }
  const saveButton = (
    <Button
      variant="contained"
      disabled={disabled || busy || waitingForRefresh || !dirty}
      onClick={save}
    >
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
            disabled={disabled || busy || waitingForRefresh}
            onChange={(event) => edit({ title: event.target.value })}
          />
          <TextField
            label="Scene location"
            value={current.location ?? ''}
            disabled={disabled || busy || waitingForRefresh}
            onChange={(event) => edit({ location: event.target.value })}
          />
          <TextField
            label="Scene script"
            multiline
            minRows={4}
            value={current.script ?? ''}
            disabled={disabled || busy || waitingForRefresh}
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
      {visibleError && <Alert severity="error">{visibleError}</Alert>}
      {notice && (
        <Alert severity="success" role="status">
          {notice}
        </Alert>
      )}
      {saveButton}
      {recovery && !dirty && (
        <Button
          disabled={disabled || busy || waitingForRefresh}
          onClick={() => {
            setDraft(recovery.draft);
            setError('');
            setNotice('Local draft restored for review.');
          }}
        >
          Restore local draft
        </Button>
      )}
      {children({
        draftScene: current,
        editClip,
        dirty,
        busy: busy || waitingForRefresh,
        save,
        saveError: visibleError,
        saveNotice: notice,
        pendingRefresh: waitingForRefresh,
        refreshSaved,
        useSaved
      })}
      {dirty && saveButton}
    </Stack>
  );
}
