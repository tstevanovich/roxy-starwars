import { createHash } from 'node:crypto';

import mongoose from 'mongoose';

export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('A JSON object is required.');
  return value;
}
export function text(value, label, max = 12000, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    fail(`${label} must be ${required ? 'nonempty text' : 'text'} with at most ${max} characters.`);
  return value.trim();
}
export function list(value, label, max = 100) {
  if (!Array.isArray(value) || value.length > max)
    fail(`${label} must be a list with at most ${max} entries.`);
  return value;
}
export function id(value) {
  if (typeof value !== 'string' || !mongoose.isObjectIdOrHexString(value))
    fail('Invalid record ID.');
  return value;
}
function uid(value) {
  return text(value, 'Item ID', 100, true);
}
function unique(items) {
  if (new Set(items.map((item) => item.id)).size !== items.length) fail('Item IDs must be unique.');
  return items;
}
export function number(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max)
    fail(`${label} must be an integer between ${min} and ${max}.`);
  return value;
}
export function revision(value) {
  return number(value, 'Revision', 0, Number.MAX_SAFE_INTEGER);
}
export const kinds = [
  'character',
  'droid',
  'ship',
  'environment',
  'prop',
  'wardrobe',
  'voice',
  'sound'
];
export function soundPlanInput(value) {
  if (!value) return null;
  object(value);
  const decimal = (v, label, min, max) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
      fail(`${label} must be between ${min} and ${max}.`);
    return v;
  };
  return {
    notes: text(value.notes ?? '', 'Sound continuity notes', 4000),
    dialogueGainDb: decimal(value.dialogueGainDb ?? 0, 'Dialogue level', -30, 6),
    layers: unique(
      list(value.layers ?? [], 'Sound layers', 30).map((layer) => {
        object(layer);
        if (!['ambience', 'effect'].includes(layer.type)) fail('Choose ambience or effect.');
        if (typeof layer.loop !== 'boolean') fail('Loop must be a boolean.');
        return {
          id: uid(layer.id),
          title: text(layer.title, 'Sound title', 160, true),
          type: layer.type,
          description: text(layer.description, 'Sound description', 1500, true),
          assetId: layer.assetId ? id(layer.assetId) : null,
          clipId: layer.clipId ? uid(layer.clipId) : null,
          start: decimal(layer.start ?? 0, 'Effect start time', 0, 30),
          sourceStart: decimal(layer.sourceStart ?? 0, 'Audio trim start', 0, 3600),
          duration: decimal(layer.duration ?? 10, 'Sound duration', 0.5, 30),
          gainDb: decimal(layer.gainDb ?? -20, 'Sound level', -60, 6),
          lowpassHz: decimal(layer.lowpassHz ?? 0, 'Muffle frequency', 0, 20000),
          loop: layer.loop
        };
      })
    )
  };
}
export function assetOrganization(input) {
  const scope = input.scope ?? 'reusable';
  if (!['reusable', 'episode'].includes(scope)) fail('Choose reusable or episode-only use.');
  if (scope === 'episode' && !input.episodeId)
    fail('Choose an episode for this episode-only asset.');
  const reviewStatus = input.reviewStatus ?? null;
  if (reviewStatus !== null && !['development', 'pending-choice'].includes(reviewStatus))
    fail('Choose In development or Pending choice. Finalize an option to approve it.');
  if (input.archived !== undefined && typeof input.archived !== 'boolean')
    fail('Archived must be a boolean.');
  if (Boolean(input.sceneId) !== Boolean(input.clipId) || (input.clipId && scope !== 'episode'))
    fail('A shot image must belong to an episode, scene and clip.');
  return {
    scope,
    episodeId: scope === 'episode' ? id(input.episodeId) : null,
    sceneId: input.sceneId ? uid(input.sceneId) : null,
    clipId: input.clipId ? uid(input.clipId) : null,
    reviewStatus,
    archived: input.archived ?? false,
    relatedAssetId: input.relatedAssetId ? id(input.relatedAssetId) : null
  };
}

export function assetCreativeFields(asset) {
  const { name, kind, aliases, brief, notes, candidates, sceneId, clipId } = asset;
  return { name, kind, aliases, brief, notes, candidates, sceneId, clipId };
}

export function assetInput(input) {
  object(input);
  if (!kinds.includes(input.kind)) fail('Choose a valid asset category.');
  return {
    ...assetOrganization(input),
    name: text(input.name, 'Name', 160, true),
    kind: input.kind,
    aliases: list(input.aliases ?? [], 'Aliases', 20).map((v) => text(v, 'Alias', 100, true)),
    brief: text(input.brief ?? '', 'Creative brief'),
    notes: text(input.notes ?? '', 'Notes'),
    candidates: unique(
      list(input.candidates ?? [], 'Candidates', 50).map((item) => {
        object(item);
        if (item.archived !== undefined && typeof item.archived !== 'boolean')
          fail('Archived must be a boolean.');
        return {
          id: uid(item.id),
          title: text(item.title, 'Option title', 160, true),
          description: text(item.description ?? '', 'Option description'),
          mediaIds: [...new Set(list(item.mediaIds ?? [], 'Reference files', 30).map(id))],
          voiceId: text(item.voiceId ?? '', 'ElevenLabs voice ID', 200),
          voiceModel: text(item.voiceModel ?? '', 'Voice model', 100),
          archived: item.archived ?? false
        };
      })
    )
  };
}
export function episodeInput(input) {
  object(input);
  return {
    title: text(input.title, 'Episode title', 160, true),
    synopsis: text(input.synopsis ?? '', 'Episode summary', 1200),
    premise: text(input.premise ?? '', 'Premise'),
    notes: text(input.notes ?? '', 'Notes'),
    scenes: unique(
      list(input.scenes ?? [], 'Scenes', 60).map((scene) => {
        object(scene);
        if (!['vlog', 'cinematic'].includes(scene.style))
          fail('Choose vlog or cinematic presentation.');
        return {
          id: uid(scene.id),
          title: text(scene.title, 'Scene title', 160, true),
          style: scene.style,
          location: text(scene.location ?? '', 'Location', 300),
          script: text(scene.script ?? '', 'Scene script', 20000),
          assetIds: [...new Set(list(scene.assetIds ?? [], 'Scene assets', 30).map(id))],
          soundPlan: soundPlanInput(scene.soundPlan),
          clips: unique(
            list(scene.clips ?? [], 'Clips', 60).map((entry) => {
              const clip = object(entry);
              return {
                id: uid(clip.id),
                title: text(clip.title, 'Clip title', 160, true),
                duration: number(clip.duration, 'Clip duration', 2, 30),
                action: text(clip.action ?? '', 'Action', 5000),
                dialogue: text(clip.dialogue ?? '', 'Dialogue', 5000),
                camera: text(clip.camera ?? '', 'Camera direction', 2000),
                soundEffects: text(clip.soundEffects ?? '', 'Sound effects', 2000),
                dialogueTakeIds: [
                  ...new Set(list(clip.dialogueTakeIds ?? [], 'Dialogue takes', 30).map(id))
                ],
                selectedDialogueId: clip.selectedDialogueId ? id(clip.selectedDialogueId) : null,
                takeIds: [...new Set(list(clip.takeIds ?? [], 'Video takes', 30).map(id))],
                selectedTakeId: clip.selectedTakeId ? id(clip.selectedTakeId) : null
              };
            })
          )
        };
      })
    )
  };
}
export function sceneFingerprint(scene, assets) {
  const source = {
    title: scene.title,
    style: scene.style,
    location: scene.location,
    script: scene.script,
    assetIds: scene.assetIds.map(String),
    clips: scene.clips.map(({ id, title, duration, action, dialogue, camera, soundEffects }) => ({
      id,
      title,
      duration,
      action,
      dialogue,
      camera,
      soundEffects
    })),
    references: assets
      .filter((a) => scene.assetIds.map(String).includes(String(a._id)))
      .map((a) => ({ id: String(a._id), revision: a.referenceRevision ?? a.revision }))
      .sort((a, b) => a.id.localeCompare(b.id))
  };
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}
export function episodeView(episode, assets) {
  return {
    ...episode,
    scenes: episode.scenes.map((scene) => ({
      ...scene,
      soundApprovalStatus: !scene.soundPlan?.approval
        ? 'draft'
        : scene.soundPlan.approval.fingerprint === soundPlanFingerprint(scene, assets)
          ? 'approved'
          : 'needs-review',
      approvalStatus: !scene.approval
        ? 'draft'
        : scene.approval.fingerprint === sceneFingerprint(scene, assets)
          ? 'approved'
          : 'needs-review'
    }))
  };
}
export function soundPlanFingerprint(scene, assets) {
  const plan = scene.soundPlan;
  return createHash('sha256')
    .update(
      JSON.stringify({
        script: sceneFingerprint(scene, assets),
        notes: plan?.notes ?? '',
        dialogueGainDb: plan?.dialogueGainDb ?? 0,
        layers: (plan?.layers ?? []).map((layer) => {
          const copy = { ...layer };
          delete copy.assetId;
          delete copy.approval;
          return copy;
        })
      })
    )
    .digest('hex');
}
