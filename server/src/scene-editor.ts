import { createHash } from 'node:crypto';

import type * as Studio from '../../shared/types.ts';

const clipFields = ['title', 'duration', 'action', 'dialogue', 'camera', 'soundEffects'];
const productionFields = [
  'imagePrompt',
  'videoPrompt',
  'videoTransitionPrompt',
  'imageReferenceMediaIds',
  'videoReferenceMediaIds',
  'videoEndFrame'
];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Rebase only the fields this editor can save, using a server-owned snapshot.
// Current shot order and generated selections remain authoritative.
export function rebaseSceneEdit(base, draft, current) {
  const conflicts = [];
  if (
    !Array.isArray(draft.clips) ||
    !equal(
      draft.clips.map((c) => c.id),
      base.clips.map((c) => c.id)
    )
  )
    return { conflicts: ['shot order or added/removed shots in the local draft'] };
  const merge = (old, local, saved, label: string) => {
    if (equal(local, old)) return saved;
    if (equal(saved, old) || equal(local, saved)) return local;
    conflicts.push(label);
    return saved;
  };
  const scene = { ...current };
  for (const field of ['title', 'location', 'script'])
    scene[field] = merge(base[field], draft[field], current[field], field);
  scene.clips = current.clips.map((saved) => {
    const old = base.clips.find((c) => c.id === saved.id);
    const local = draft.clips.find((c) => c.id === saved.id);
    if (!old || !local) return saved;
    const clip = { ...saved, production: { ...saved.production } };
    for (const field of clipFields)
      clip[field] = merge(old[field], local[field], saved[field], `${saved.title}: ${field}`);
    for (const field of productionFields)
      clip.production[field] = merge(
        old.production?.[field],
        local.production?.[field],
        saved.production?.[field],
        `${saved.title}: ${field}`
      );
    return clip;
  });
  for (const old of base.clips) {
    if (current.clips.some((c) => c.id === old.id)) continue;
    const local = draft.clips.find((c) => c.id === old.id);
    if (
      clipFields.some((f) => !equal(old[f], local[f])) ||
      productionFields.some((f) => !equal(old.production?.[f], local.production?.[f]))
    )
      conflicts.push(`${old.title}: shot removed from saved scene`);
  }
  return { scene, conflicts };
}

export function sceneEditToken(scene: Studio.SceneInput) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        title: scene.title,
        location: scene.location,
        script: scene.script,
        clips: scene.clips.map((clip) => ({
          id: clip.id,
          title: clip.title,
          duration: clip.duration,
          action: clip.action,
          dialogue: clip.dialogue,
          camera: clip.camera,
          soundEffects: clip.soundEffects,
          imagePrompt: clip.production?.imagePrompt || '',
          ...(clip.production?.imageReferenceMediaIds !== undefined
            ? { imageReferenceMediaIds: clip.production.imageReferenceMediaIds }
            : {}),
          videoPrompt: clip.production?.videoPrompt || '',
          ...(clip.production?.videoReferenceMediaIds !== undefined
            ? { videoReferenceMediaIds: clip.production.videoReferenceMediaIds }
            : {}),
          ...(clip.production?.videoEndFrame
            ? { videoEndFrame: clip.production.videoEndFrame }
            : {}),
          ...(clip.production?.videoTransitionPrompt
            ? { videoTransitionPrompt: clip.production.videoTransitionPrompt }
            : {})
        }))
      })
    )
    .digest('hex');
}
