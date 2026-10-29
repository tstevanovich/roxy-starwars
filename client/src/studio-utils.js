import { useEffect, useState } from 'react';

import { removeMediaReferences } from '../../shared/media-rejection.js';
import { reconcileEpisodeDraft } from './episode-draft.js';
import { studioUrl } from './project-url.js';

export function forgetRejectedMedia(mediaId) {
  const key = 'roxy-studio-rejected-media';
  let ids = [];
  try {
    ids = JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    /* no saved deletion list */
  }
  ids = [...new Set([...ids, mediaId])];
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* notify active editors anyway */
  }
  window.dispatchEvent(new CustomEvent('studio-media-deleted', { detail: { ids } }));
}

export const categories = {
  character: 'Characters',
  droid: 'Droids',
  ship: 'Ships',
  environment: 'Environments',
  prop: 'Props',
  wardrobe: 'Wardrobes',
  voice: 'Voices',
  sound: 'Sound effects & ambience'
};
export const assetStatuses = {
  development: 'In development',
  'pending-choice': 'Pending choice',
  finalized: 'Finalized'
};
export function assetStatus(asset) {
  if (asset.workflowStatus) return asset.workflowStatus;
  if (asset.reviewStatus === 'pending-choice') return 'pending-choice';
  if (asset.finalChoice) return 'finalized';
  if (!asset.reviewStatus && asset.candidates?.some((c) => !c.archived && c.mediaIds?.length))
    return 'pending-choice';
  return 'development';
}
export const assetStatusColor = (asset) =>
  ({ finalized: 'success', 'pending-choice': 'warning', development: 'default' })[
    assetStatus(asset)
  ];
export const uid = () => crypto.randomUUID();
export const runtime = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
export const mediaUrl = (id) => studioUrl(`/api/studio/media/${id}`);
export function pendingVideoChoices(episode, media) {
  const videos = new Set(media.filter((file) => file.kind === 'video').map((file) => file._id));
  return (episode.scenes ?? []).flatMap((scene) =>
    (scene.clips ?? [])
      .filter(
        (clip) =>
          clip.takeIds?.some(
            (id) =>
              id !== clip.selectedTakeId &&
              media.some(
                (m) =>
                  m._id === id &&
                  m.kind === 'video' &&
                  m.videoReview?.state === 'pending' &&
                  m.videoReview.episodeId === episode._id &&
                  m.videoReview.sceneId === scene.id &&
                  m.videoReview.clipId === clip.id
              )
          ) ||
          ((!clip.selectedTakeId || clip.soundReviewStatus === 'needs-review') &&
            clip.takeIds?.some(
              (id) =>
                videos.has(id) &&
                (clip.pictureApprovalStatus !== 'approved' ||
                  media.find((m) => m._id === id)?.soundMix)
            ))
      )
      .map((clip) => ({ scene, clip }))
  );
}
export function episodeTiming(episode) {
  const total = episode.scenes.reduce(
    (sum, s) => sum + s.clips.reduce((n, c) => n + Number(c.duration || 0), 0),
    0
  );
  const vlog = episode.scenes
    .filter((s) => s.style === 'vlog')
    .reduce((sum, s) => sum + s.clips.reduce((n, c) => n + Number(c.duration || 0), 0), 0);
  return { total, vlogPercent: total ? Math.round((vlog / total) * 100) : 0 };
}
export function downloadDraft(value, filename = 'roxy-draft.json') {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function useDraft(record, prefix, availableMedia) {
  const key = `roxy-studio-${prefix}-${record._id}`;
  const [cached] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key)) || null;
    } catch {
      return null;
    }
  });
  const [storedDraft, setDraft] = useState(cached || record);
  const [dirty, setDirty] = useState(Boolean(cached));
  const [deletedIds, setDeletedIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('roxy-studio-rejected-media')) || [];
    } catch {
      return [];
    }
  });
  const sanitize = (value) => {
    const removed = new Set(deletedIds);
    if (availableMedia) {
      const available = new Set(availableMedia.map((file) => file._id));
      const visit = (item, key = '') => {
        if (Array.isArray(item)) {
          if (
            [
              'mediaIds',
              'takeIds',
              'dialogueTakeIds',
              'sourceMediaIds',
              'referenceMediaIds'
            ].includes(key)
          )
            item.forEach((id) => {
              if (!available.has(id)) removed.add(id);
            });
          else item.forEach((entry) => visit(entry));
        } else if (item && typeof item === 'object') {
          Object.entries(item).forEach(([name, entry]) => {
            if (
              [
                'mediaId',
                'selectedTakeId',
                'selectedDialogueId',
                'sourceTakeId',
                'resultMediaId',
                'visualTakeId',
                'upscaleMediaId',
                'upscaleSourceTakeId'
              ].includes(name) &&
              entry &&
              !available.has(entry)
            )
              removed.add(entry);
            else visit(entry, name);
          });
        }
      };
      visit(value);
    }
    return [...removed].reduce((next, id) => removeMediaReferences(next, id), value);
  };
  useEffect(() => {
    const deleted = (event) => setDeletedIds(event.detail.ids);
    const changed = (event) => {
      if (event.key !== 'roxy-studio-rejected-media') return;
      try {
        setDeletedIds(JSON.parse(event.newValue) || []);
      } catch {
        /* ignore invalid browser storage */
      }
    };
    window.addEventListener('studio-media-deleted', deleted);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('studio-media-deleted', deleted);
      window.removeEventListener('storage', changed);
    };
  }, []);
  const recovery =
    prefix === 'episode' && dirty && storedDraft.revision < record.revision
      ? reconcileEpisodeDraft(storedDraft, record)
      : null;
  const draft = sanitize(
    recovery?.episode ?? (dirty || storedDraft.revision > record.revision ? storedDraft : record)
  );
  const newerSavedVersion = dirty && draft.revision < record.revision;
  useEffect(() => {
    try {
      if (recovery) {
        const backupKey = `${key}-recovery-${storedDraft.revision}`;
        if (!localStorage.getItem(backupKey))
          localStorage.setItem(backupKey, JSON.stringify(storedDraft));
      }
      if (dirty) localStorage.setItem(key, JSON.stringify(draft));
      else localStorage.removeItem(key);
    } catch {
      /* The editor remains usable when browser storage is full. */
    }
  }, [draft, dirty, key, recovery, storedDraft]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function edit(next) {
    setDraft((current) => {
      const source = dirty || current.revision > record.revision ? current : record;
      const effective =
        prefix === 'episode' && source.revision < record.revision
          ? reconcileEpisodeDraft(source, record).episode
          : source;
      return sanitize(typeof next === 'function' ? next(sanitize(effective)) : next);
    });
    setDirty(true);
  }
  function saved(next) {
    setDraft(next);
    setDirty(false);
  }
  function reloadSaved() {
    downloadDraft(draft, 'roxy-recovered-draft.json');
    localStorage.removeItem(key);
    saved(record);
  }
  function resolveSavedConflicts(prefer) {
    const result = reconcileEpisodeDraft(storedDraft, record, prefer);
    if (!result.unavailable) edit(result.episode);
  }
  return {
    draft,
    dirty,
    edit,
    saved,
    reloadSaved,
    newerSavedVersion,
    recovery,
    resolveSavedConflicts
  };
}
