import type * as Studio from './types.ts';
const setting = (scene: Studio.SceneInput, clip: Studio.ClipInput) =>
  (clip.production?.location || scene.location || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');

// Omit unset defaults so installing continuity support does not reopen existing approvals.
export function continuityInput(production: Studio.PersistedInput<Studio.ProductionSettings> = {}) {
  const { continuityMode, continuitySources, continuityNotes } = production;
  return continuityMode || continuitySources?.length || continuityNotes
    ? {
        continuity: {
          mode: continuityMode || 'auto',
          sources: continuitySources ?? [],
          notes: continuityNotes ?? ''
        }
      }
    : {};
}

export function shotContinuity(
  episode,
  scene: Studio.SceneInput,
  clip: Studio.ClipInput,
  assets: Studio.AssetInput[],
  media?: Studio.MediaInput[]
) {
  const shots = (episode?.scenes ?? [scene]).flatMap((s) =>
    (s.clips ?? []).map((c) => ({ scene: s, clip: c }))
  );
  const index = shots.findIndex((s) => s.scene.id === scene.id && s.clip.id === clip.id);
  const previous = shots.slice(0, Math.max(0, index));
  const mode = clip.production?.continuityMode || 'auto';
  const errors = [];
  const invalidSources = [];
  let selected = [];
  if (mode === 'explicit') {
    for (const source of clip.production?.continuitySources ?? []) {
      const found = previous.find(
        (s) => s.scene.id === source.sceneId && s.clip.id === source.clipId
      );
      if (!found)
        invalidSources.push(
          `Continuity source ${source.clipId} must be an earlier shot in this episode.`
        );
      else selected.push(found);
    }
    if (!selected.length && !invalidSources.length)
      invalidSources.push('Choose an earlier shot for explicit continuity.');
  } else if (mode === 'auto') {
    const location = setting(scene, clip);
    let matching = previous.filter(
      (s) =>
        s.scene.id === scene.id &&
        location &&
        setting(s.scene, s.clip) === location &&
        (s.clip.production?.environment || '') === (clip.production?.environment || '')
    );
    const reset = matching.findLastIndex((s) => s.clip.production?.continuityMode === 'new-setup');
    if (reset >= 0) matching = matching.slice(reset);
    // The establishing view fixes geography; the nearest matching view fixes the latest state.
    selected = matching.length ? [matching[0], matching.at(-1)] : [];
  }
  selected = selected.filter(
    (s, i, a) => a.findIndex((t) => t.scene.id === s.scene.id && t.clip.id === s.clip.id) === i
  );
  const sources = selected.map(({ scene: s, clip: c }) => {
    const asset = assets.find(
      (a) =>
        !a.archived &&
        a.sceneId === s.id &&
        a.clipId === c.id &&
        (!episode?._id || String(a.episodeId) === String(episode._id))
    );
    const ids = asset?.finalChoice?.mediaIds ?? [];
    const mediaId = ids.length === 1 ? String(ids[0]) : null;
    if (
      !mediaId ||
      asset.reviewStatus === 'pending-choice' ||
      (media && !media.some((m) => String(m._id) === mediaId && m.kind === 'image'))
    )
      errors.push(`Approve the continuity image for ${c.title} before rendering ${clip.title}.`);
    return {
      sceneId: s.id,
      clipId: c.id,
      title: c.title,
      assetId: asset ? String(asset._id) : null,
      mediaId
    };
  });
  const notes = clip.production?.continuityNotes ?? '';
  const directions = sources.length
    ? [
        'SHOT-TO-SHOT CONTINUITY: The FIRST supplied images are the approved earlier shot images listed below, in this order. They are controlling evidence for the same physical set and objects; do not design similar replacements.',
        ...sources.map(
          (s, i) =>
            `Continuity image ${i + 1}: ${s.title}.${i === 0 ? ' Establishing geometry and layout.' : ' Most recent approved staging and physical state.'}`
        ),
        'Preserve the exact ship silhouette, proportions, scale relative to the set, heading, landing gear, ramp and support contact points; exact platform outline, turret count/positions, metal walkway/causeway width, routing, railings, deck panels, background landmarks, materials, light and weather. Change only the action, physical state or camera explicitly specified for the new shot. Do not copy a reference character into a shot that excludes them. Do not copy a character removal or reset the story state; respect offscreen positions. Do not import scenery from a different location.',
        notes
      ]
        .filter(Boolean)
        .join('\n')
    : notes;
  return {
    mode,
    sources,
    mediaIds: sources.map((s) => s.mediaId).filter(Boolean),
    errors: [...invalidSources, ...errors],
    invalidSources,
    notes,
    directions
  };
}
