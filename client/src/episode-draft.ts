import type * as Studio from '../../shared/types.ts';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const textFields = (value, names) =>
  Object.fromEntries(names.map((name: string) => [name, value[name] ?? '']));

function editable(episode) {
  return {
    ...textFields(episode, ['title', 'synopsis', 'premise', 'notes']),
    production: episode.production ?? {},
    sourceReferences: episode.sourceReferences ?? [],
    decisions: episode.decisions ?? [],
    scenes: (episode.scenes ?? []).map((scene: Studio.Scene) => ({
      id: scene.id,
      ...textFields(scene, ['title', 'style', 'location', 'script', 'sourceNotes']),
      assetIds: scene.assetIds ?? [],
      sourceReferenceIds: scene.sourceReferenceIds ?? [],
      production: scene.production ?? {},
      soundPlan: scene.soundPlan
        ? {
            notes: scene.soundPlan.notes,
            dialogueGainDb: scene.soundPlan.dialogueGainDb,
            layers: scene.soundPlan.layers
          }
        : null,
      clips: (scene.clips ?? []).map((clip: Studio.Clip) => ({
        id: clip.id,
        ...textFields(clip, ['title', 'action', 'dialogue', 'camera', 'soundEffects']),
        duration: clip.duration,
        takeIds: clip.takeIds ?? [],
        dialogueTakeIds: clip.dialogueTakeIds ?? [],
        selectedTakeId: clip.selectedTakeId ?? null,
        selectedDialogueId: clip.selectedDialogueId ?? null,
        production: clip.production ?? {}
      }))
    }))
  };
}

// Only merge user-editable fields. Approvals, historical delivery links and revisions come
// from the saved record, and the server still validates the resulting save.
export function reconcileEpisodeDraft(local, latest, prefer?: string) {
  const newVideoPass = Boolean(latest.videoPass?.id && latest.videoPass.id !== local.videoPass?.id);
  const base = latest.history?.find((entry) => entry.revision === local.revision);
  if (!base)
    return {
      episode: local,
      conflicts: ['Original saved revision is unavailable'],
      unavailable: true
    };
  const conflicts = [];
  function conflict(path, mine, theirs) {
    conflicts.push(path.join(' / '));
    return prefer === 'saved' ? theirs : mine;
  }
  function merge(before, mine, theirs, path = []) {
    const key = path.at(-1);
    if (
      newVideoPass &&
      [
        'takeIds',
        'selectedTakeId',
        'visualTakeId',
        'upscaleMediaId',
        'upscaleSourceTakeId',
        'cleanDialogueMediaId',
        'audioRepairTakeId'
      ].includes(key)
    )
      return theirs;
    if (key === 'takeIds' || key === 'dialogueTakeIds')
      return [...new Set([...(theirs ?? []), ...(mine ?? [])])];
    if (equal(mine, before)) return theirs;
    if (equal(theirs, before) || equal(mine, theirs)) return mine;
    if (
      (key === 'scenes' ||
        key === 'clips' ||
        key === 'layers' ||
        key === 'items' ||
        key === 'sourceReferences' ||
        key === 'decisions') &&
      Array.isArray(mine) &&
      Array.isArray(theirs)
    ) {
      const old = new Map((before ?? []).map((item) => [item.id, item]));
      const left = new Map(mine.map((item) => [item.id, item]));
      const right = new Map(theirs.map((item) => [item.id, item]));
      const common = (before ?? [])
        .map((item) => item.id)
        .filter((id) => left.has(id) && right.has(id));
      const leftOrder = mine.map((item) => item.id).filter((id) => common.includes(id));
      const rightOrder = theirs.map((item) => item.id).filter((id) => common.includes(id));
      let order = equal(leftOrder, common) ? theirs : mine;
      if (!equal(leftOrder, common) && !equal(rightOrder, common) && !equal(leftOrder, rightOrder))
        order = conflict([...path, 'order'], mine, theirs);
      return [...new Set([...order.map((item) => item.id), ...right.keys(), ...left.keys()])]
        .map((id) => merge(old.get(id), left.get(id), right.get(id), [...path, id]))
        .filter(Boolean);
    }
    if (
      mine &&
      theirs &&
      !Array.isArray(mine) &&
      !Array.isArray(theirs) &&
      typeof mine === 'object' &&
      typeof theirs === 'object'
    ) {
      return Object.fromEntries(
        [...new Set([...Object.keys(mine), ...Object.keys(theirs)])].map((name: string) => [
          name,
          merge(before?.[name], mine[name], theirs[name], [...path, name])
        ])
      );
    }
    return conflict(path, mine, theirs);
  }
  const fields = merge(editable(base), editable(local), editable(latest));
  const episode = {
    ...latest,
    ...fields,
    revision: conflicts.length && !prefer ? local.revision : latest.revision,
    scenes: fields.scenes.map((scene: Studio.Scene) => {
      const savedScene = latest.scenes.find((item) => item.id === scene.id);
      const localScene = local.scenes.find((item) => item.id === scene.id);
      return {
        ...(savedScene ?? localScene),
        ...scene,
        soundPlan: scene.soundPlan
          ? { ...scene.soundPlan, approval: savedScene?.soundPlan?.approval ?? null }
          : null,
        clips: scene.clips.map((clip: Studio.Clip) => ({
          ...(savedScene?.clips.find((item) => item.id === clip.id) ??
            localScene?.clips.find((item) => item.id === clip.id)),
          ...clip
        }))
      };
    })
  };
  return { episode, conflicts: prefer ? [] : conflicts, unavailable: false };
}
