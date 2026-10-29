export function proposalReviewStages(proposal, record) {
  if (proposal.reviewStages?.length) return proposal.reviewStages;
  if (proposal.render) return ['video-revision'];
  if (proposal.scene) return ['scene'];
  if (proposal.scope === 'asset' || proposal.assetId) return ['reference-package'];
  const base =
    record?.revision === proposal.baseRevision
      ? record
      : record?.history?.find((snapshot) => snapshot.revision === proposal.baseRevision);
  if (!base || !proposal.production) return [];
  const stages = [];
  if (proposalBlocksReview(proposal, 'source', base)) stages.push('source');
  if (
    proposal.production.outline !== undefined &&
    proposal.production.outline !== (base.production?.outline ?? '')
  )
    stages.push('outline');
  return stages;
}

export function proposalStageLabel(proposal, record) {
  const stages = proposalReviewStages(proposal, record);
  const labels = {
    source: 'Source research',
    outline: 'Episode outline',
    scene: 'Scene',
    'shot-plan': 'Shot plan',
    'sound-plan': 'Sound plan',
    'reference-package': 'Reference package',
    'video-revision': 'Video revision'
  };
  return stages.length ? stages.map((stage) => labels[stage]).join(' and ') : 'Episode note';
}

export function proposalBlocksReview(proposal, stage, record, target) {
  if (
    record?.revision !== undefined &&
    proposal.baseRevision !== undefined &&
    proposal.baseRevision !== record.revision &&
    !proposalApplication(proposal, record).canApply
  )
    return false;
  if (target?.scope === 'scene' && proposal.scene?.id === target.sceneId)
    return proposalReviewStages(proposal, record).some(
      (reviewStage) => reviewStage === stage || (reviewStage === 'scene' && stage === 'script')
    );
  if (stage === 'source')
    return (
      (proposal.production?.sourceNotes !== undefined &&
        proposal.production.sourceNotes !== (record.production?.sourceNotes ?? '')) ||
      (proposal.sourceReferences !== undefined &&
        JSON.stringify(proposal.sourceReferences) !== JSON.stringify(record.sourceReferences ?? []))
    );
  if (stage === 'outline')
    return Boolean(
      proposal.production?.outlineNeedsRevision ||
      (proposal.production?.outline !== undefined &&
        proposal.production.outline !== record.production?.outline)
    );
  return false;
}

const clipOutputs = [
  'takeIds',
  'selectedTakeId',
  'dialogueTakeIds',
  'selectedDialogueId',
  'soundLegacyTakeId',
  'upscale'
];
const productionOutputs = [
  'visualTakeId',
  'audioRepairTakeId',
  'cleanDialogueMediaId',
  'upscaleMediaId',
  'upscaleSourceTakeId'
];
function sceneInputs(scene) {
  if (!scene) return null;
  const value = JSON.parse(JSON.stringify(scene));
  delete value.approval;
  for (const clip of value.clips ?? []) {
    clip.production ??= {};
    for (const key of clipOutputs) delete clip[key];
    for (const key of productionOutputs) delete clip.production?.[key];
  }
  if (value.soundPlan) delete value.soundPlan.approval;
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  return value;
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Apply only fields deliberately changed from the draft's saved baseline.
// Imported/deleted reference files and unrelated package edits remain current.
export function mergeAssetProduction(proposal, record) {
  const base =
    proposal.baseProduction ??
    (record.revision === proposal.baseRevision
      ? record.production
      : record.history?.find((s) => s.revision === proposal.baseRevision)?.production);
  if (!base) return null;
  const empty = (value) =>
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);
  const same = (a, b) =>
    equal(a, b) || ((a === undefined || b === undefined) && empty(a) && empty(b));
  const merge = (before, proposed, current, ignored = []) => {
    const output = { ...current };
    for (const key of Object.keys(proposed)) {
      if (ignored.includes(key) || same(proposed[key], before?.[key])) continue;
      if (!same(current?.[key], before?.[key]) && !same(current?.[key], proposed[key])) return null;
      output[key] = proposed[key];
    }
    return output;
  };
  const production = merge(base, proposal.production, record.production, ['items', 'managed']);
  if (!production) return null;
  const original = new Map((base.items ?? []).map((i) => [i.id, i]));
  const current = new Map((record.production?.items ?? []).map((i) => [i.id, i]));
  const proposed = new Map((proposal.production.items ?? base.items ?? []).map((i) => [i.id, i]));
  for (const [key, before] of original) {
    if (proposed.has(key)) continue;
    if (current.has(key) && !equal(current.get(key), before)) return null;
    current.delete(key);
  }
  for (const [key, item] of proposed) {
    const before = original.get(key),
      saved = current.get(key);
    if (!before) {
      if (saved && !equal(saved, item)) return null;
      current.set(key, saved ?? item);
    } else if (!saved) {
      if (!equal(before, item)) return null;
    } else {
      const merged = merge(before, item, saved, ['requiresPlanApproval', 'revisionSourceMediaId']);
      if (!merged) return null;
      current.set(key, merged);
    }
  }
  return { ...production, items: [...current.values()], managed: true };
}

// A saved note or a take decision must not strand an otherwise unchanged scene draft.
// Rebase only when the targeted scene and episode preparation are still unchanged.
export function proposalApplication(proposal, record) {
  if (!record) return { canApply: false, reason: 'The saved record is missing.' };
  if (proposal.production && (proposal.scope === 'asset' || proposal.assetId))
    return mergeAssetProduction(proposal, record)
      ? { canApply: true, rebased: proposal.baseRevision !== record.revision }
      : {
          canApply: false,
          reason:
            'This asset draft conflicts with newer edits to the same source or reference instructions, or its saved base is unavailable. Refresh the draft before applying.'
        };
  if (proposal.baseRevision === record.revision) return { canApply: true, rebased: false };
  // Notes append through a CAS save; they never replace newer scene or planning fields.
  if (!proposal.scene && !proposal.production && !proposal.render)
    return { canApply: true, rebased: true };
  const checked = proposal.application;
  if (checked?.recordRevision === record.revision) return checked;
  const base = record.history?.find((item) => item.revision === proposal.baseRevision);
  if ((proposal.scene || proposal.render) && !proposal.production && base) {
    const sceneId = proposal.scene?.id ?? proposal.render.target.sceneId;
    const before = base.scenes?.find((scene) => scene.id === sceneId);
    const current = record.scenes?.find((scene) => scene.id === sceneId);
    if (
      equal(sceneInputs(before), sceneInputs(current)) &&
      equal(base.production, record.production) &&
      equal(base.sourceReferences, record.sourceReferences) &&
      equal(base.decisions, record.decisions)
    )
      return { canApply: true, rebased: true };
  }
  return {
    canApply: false,
    reason:
      'This draft conflicts with newer scene or episode preparation changes, or its saved base is no longer available. Ask production chat to update it before applying.'
  };
}

export function mergeSceneProposal(proposed, current) {
  return {
    ...proposed,
    approval: null,
    clips: proposed.clips.map((clip) => {
      const saved = current?.clips?.find((item) => item.id === clip.id);
      if (!saved) return clip;
      const merged = { ...clip, production: { ...clip.production } };
      for (const key of clipOutputs) merged[key] = saved[key];
      for (const key of productionOutputs) merged.production[key] = saved.production?.[key];
      if ((clip.dialogue ?? '') !== (saved.dialogue ?? '')) {
        merged.selectedDialogueId = null;
        merged.production.cleanDialogueMediaId = null;
      }
      return merged;
    })
  };
}
