import { createHash } from 'node:crypto';

import mongoose from 'mongoose';

import type * as Studio from '../../shared/types.ts';
import { activeProject } from './project-context.ts';

export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('A JSON object is required.');
  return value as Record<string, unknown>;
}
function isOneOf<const T>(values: readonly T[], value: unknown): value is T {
  return values.includes(value as T);
}
function assertObject(value: unknown): asserts value is Record<string, unknown> {
  object(value);
}
export function text(value: unknown, label: string, max: number = 12000, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    fail(`${label} must be ${required ? 'nonempty text' : 'text'} with at most ${max} characters.`);
  return value.trim();
}
export function list(value: unknown, label: string, max: number = 100): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    fail(`${label} must be a list with at most ${max} entries.`);
  return value;
}
export function id(value: unknown) {
  if (typeof value !== 'string' || !mongoose.isObjectIdOrHexString(value))
    fail('Invalid record ID.');
  return value;
}
function uid(value: unknown) {
  return text(value, 'Item ID', 100, true);
}
function unique<T extends { id: string }>(items: T[]): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length) fail('Item IDs must be unique.');
  return items;
}
export function number(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    fail(`${label} must be an integer between ${min} and ${max}.`);
  return value;
}
export function revision(value: unknown) {
  return number(value, 'Revision', 0, Number.MAX_SAFE_INTEGER);
}
function clipDuration(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 2 || value > 30)
    fail('Clip duration must be a number between 2 and 30 seconds.');
  return value;
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
] as const;
export function soundPlanInput(value: unknown): Studio.SoundPlan | null {
  if (!value) return null;
  assertObject(value);
  const decimal = (v, label: string, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
      fail(`${label} must be between ${min} and ${max}.`);
    return v;
  };
  return {
    notes: text(value.notes ?? '', 'Sound continuity notes', 4000),
    dialogueGainDb: decimal(value.dialogueGainDb ?? 0, 'Dialogue level', -30, 6),
    layers: unique(
      list(value.layers ?? [], 'Sound layers', 30).map((layer) => {
        assertObject(layer);
        if (!isOneOf(['ambience', 'effect'], layer.type)) fail('Choose ambience or effect.');
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
export function assetOrganization(input: Record<string, unknown>) {
  const scope = input.scope ?? 'reusable';
  if (!isOneOf(['reusable', 'episode'], scope)) fail('Choose reusable or episode-only use.');
  if (scope === 'episode' && !input.episodeId)
    fail('Choose an episode for this episode-only asset.');
  const reviewStatus = input.reviewStatus ?? null;
  if (reviewStatus !== null && !isOneOf(['development', 'pending-choice'], reviewStatus))
    fail('Choose In development or Pending choice. Finalize an option to approve it.');
  if (input.archived !== undefined && typeof input.archived !== 'boolean')
    fail('Archived must be a boolean.');
  if (Boolean(input.sceneId) !== Boolean(input.clipId) || (input.clipId && scope !== 'episode'))
    fail('A shot image must belong to an episode, scene and clip.');
  return {
    scope: scope as 'episode' | 'reusable',
    episodeId: scope === 'episode' ? id(input.episodeId) : null,
    sceneId: input.sceneId ? uid(input.sceneId) : null,
    clipId: input.clipId ? uid(input.clipId) : null,
    reviewStatus: reviewStatus as 'development' | 'pending-choice' | null,
    archived: input.archived === true,
    relatedAssetId: input.relatedAssetId ? id(input.relatedAssetId) : null
  };
}

export function assetCreativeFields(asset: Studio.AssetInput) {
  const { name, kind, aliases, brief, notes, candidates, sceneId, clipId } = asset;
  return { name, kind, aliases, brief, notes, candidates, sceneId, clipId };
}

export function assetInput(input: unknown) {
  assertObject(input);
  if (!isOneOf(kinds, input.kind)) fail('Choose a valid asset category.');
  return {
    ...assetOrganization(input),
    name: text(input.name, 'Name', 160, true),
    kind: input.kind,
    aliases: list(input.aliases ?? [], 'Aliases', 20).map((v) => text(v, 'Alias', 100, true)),
    brief: text(input.brief ?? '', 'Creative brief'),
    notes: text(input.notes ?? '', 'Notes'),
    production: assetProductionInput(input.production),
    candidates: unique(
      list(input.candidates ?? [], 'Candidates', 50).map((item) => {
        assertObject(item);
        if (item.archived !== undefined && typeof item.archived !== 'boolean')
          fail('Archived must be a boolean.');
        return {
          id: uid(item.id),
          title: text(item.title, 'Option title', 160, true),
          description: text(item.description ?? '', 'Option description'),
          mediaIds: [...new Set(list(item.mediaIds ?? [], 'Reference files', 30).map(id))],
          voiceId: text(item.voiceId ?? '', 'ElevenLabs voice ID', 200),
          generatedVoiceId: text(item.generatedVoiceId ?? '', 'Generated voice preview ID', 200),
          ...(item.voiceDescription !== undefined
            ? { voiceDescription: text(item.voiceDescription, 'Audition voice description', 1000) }
            : {}),
          voiceModel: text(item.voiceModel ?? '', 'Voice model', 100),
          archived: item.archived === true
        };
      })
    )
  };
}
export function assetProductionInput(value: unknown = {}) {
  assertObject(value);
  const sourceMode = value.sourceMode ?? 'footage';
  if (!isOneOf(['footage', 'original'], sourceMode))
    fail('Choose footage or original source direction.');
  let sourceUrl = text(value.sourceUrl ?? '', 'Source URL', 2000);
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
      sourceUrl = url.href;
    } catch {
      fail('Use an HTTPS source URL.');
    }
  }
  const sourceMediaIds = [
    ...new Set(list(value.sourceMediaIds ?? [], 'Source images', 20).map(id))
  ];
  return {
    managed: value.managed === true,
    ...(value.characterAssetId ? { characterAssetId: id(value.characterAssetId) } : {}),
    ...(value.voiceDescription !== undefined
      ? { voiceDescription: text(value.voiceDescription, 'Prepared voice description', 1000) }
      : {}),
    sourceMode,
    sourceUrl,
    sourceNotes: text(value.sourceNotes ?? '', 'Source evidence', 8000),
    sourceMediaIds,
    items: unique(
      list(value.items ?? [], 'Reference package', 30).map((item) => {
        assertObject(item);
        if (!isOneOf(['image', 'audio', 'notes'], item.type))
          fail('Choose image, audio or notes for a package item.');
        if (typeof item.required !== 'boolean') fail('Required must be a boolean.');
        return {
          id: uid(item.id),
          title: text(item.title, 'Reference title', 160, true),
          type: item.type,
          required: item.required,
          ...(item.requiresPlanApproval ? { requiresPlanApproval: true } : {}),
          ...(item.revisionSourceMediaId !== undefined
            ? {
                revisionSourceMediaId: item.revisionSourceMediaId
                  ? id(item.revisionSourceMediaId)
                  : null
              }
            : {}),
          mediaId: item.mediaId ? id(item.mediaId) : null,
          ...(item.imageReferenceMediaIds !== undefined
            ? {
                imageReferenceMediaIds: [
                  ...new Set(
                    list(item.imageReferenceMediaIds, 'Image request references', 16).map(id)
                  )
                ]
              }
            : {}),
          ...(item.referenceMediaIds !== undefined
            ? {
                referenceMediaIds: [
                  ...new Set(
                    list(item.referenceMediaIds, 'Approved package references', 16).map(id)
                  )
                ]
              }
            : {}),
          ...(item.sourceMediaIds !== undefined
            ? {
                sourceMediaIds: [
                  ...new Set(
                    list(item.sourceMediaIds, 'Item source images', 20).map((mid) => {
                      id(mid);
                      if (!sourceMediaIds.includes(id(mid)))
                        fail('Choose item source images from this asset’s source evidence.');
                      return id(mid);
                    })
                  )
                ]
              }
            : {}),
          notes: text(item.notes ?? '', 'Reference instructions', 4000),
          ...(item.imagePrompt !== undefined
            ? { imagePrompt: text(item.imagePrompt, 'Image generation prompt', 6000) }
            : {})
        };
      })
    )
  };
}
function sourceReferencesInput(value: unknown) {
  return unique(
    list(value ?? [], 'Source references', 30).map((ref) => {
      assertObject(ref);
      let url;
      try {
        url = new URL(text(ref.url, 'Source URL', 2000, true));
      } catch {
        fail('Use an HTTPS source URL.');
      }
      if (url.protocol !== 'https:' || url.username || url.password)
        fail('Use an HTTPS source URL.');
      const startSeconds = ref.startSeconds ?? 0,
        endSeconds = ref.endSeconds ?? null;
      if (
        typeof startSeconds !== 'number' ||
        !Number.isFinite(startSeconds) ||
        startSeconds < 0 ||
        startSeconds > 86400
      )
        fail('Invalid source start time.');
      if (
        endSeconds !== null &&
        (typeof endSeconds !== 'number' ||
          !Number.isFinite(endSeconds) ||
          endSeconds <= startSeconds ||
          endSeconds > 86400)
      )
        fail('Source end must follow its start.');
      if (!isOneOf(['unreviewed', 'verified'], ref.status ?? 'unreviewed'))
        fail('Choose a source review state.');
      return {
        id: uid(ref.id),
        title: text(ref.title, 'Source title', 200, true),
        url: text(url.href, 'Source URL', 2000, true),
        chapter: text(ref.chapter ?? '', 'Chapter', 200),
        startSeconds,
        endSeconds: endSeconds as number | null,
        status: isOneOf(['unreviewed', 'verified'], ref.status) ? ref.status : 'unreviewed',
        notes: text(ref.notes ?? '', 'Source notes', 8000)
      };
    })
  );
}
export function episodeInput(input: unknown) {
  assertObject(input);
  const production = object(input.production ?? {});
  const sourceReferences = sourceReferencesInput(input.sourceReferences);
  const decisions = unique(
    list(input.decisions ?? [], 'Recorded decisions', 100).map((choice) => {
      assertObject(choice);
      if (!sourceReferences.some((ref) => ref.id === choice.sourceId))
        fail('Link each decision to a source reference.');
      return {
        id: uid(choice.id),
        sourceId: uid(choice.sourceId),
        timestampSeconds: number(choice.timestampSeconds ?? 0, 'Decision timestamp', 0, 86400),
        choice: text(choice.choice, 'Recorded choice', 2000, true),
        outcome: text(choice.outcome ?? '', 'Recorded outcome', 4000)
      };
    })
  );
  return {
    sourceReferences,
    decisions,
    title: text(input.title, 'Episode title', 160, true),
    synopsis: text(input.synopsis ?? '', 'Episode summary', 1200),
    premise: text(input.premise ?? '', 'Premise'),
    notes: text(input.notes ?? '', 'Notes'),
    production: {
      sourceNotes: text(production.sourceNotes ?? '', 'Episode source research', 8000),
      outline: text(production.outline ?? '', 'Episode outline', 12000),
      ...(production.outlineNeedsRevision === true ? { outlineNeedsRevision: true } : {})
    },
    scenes: unique(
      list(input.scenes ?? [], 'Scenes', 60).map((scene) => {
        assertObject(scene);
        if (!isOneOf(['vlog', 'cinematic'], scene.style))
          fail('Choose vlog or cinematic presentation.');
        const sceneProduction = object(scene.production ?? {});
        const sourceReferenceIds = list(scene.sourceReferenceIds ?? [], 'Scene sources', 30).map(
          uid
        );
        const assetIds = list(scene.assetIds ?? [], 'Scene assets', 30).map(id);
        return {
          id: uid(scene.id),
          title: text(scene.title, 'Scene title', 160, true),
          style: scene.style,
          location: text(scene.location ?? '', 'Location', 300),
          script: text(scene.script ?? '', 'Scene script', 20000),
          production: {
            notes: text(sceneProduction.notes ?? '', 'Scene production notes', 4000),
            ...(sceneProduction.manualGeneration ? { manualGeneration: true } : {})
          },
          assetIds: [...new Set(assetIds)],
          sourceReferenceIds: [
            ...new Set(
              list(scene.sourceReferenceIds ?? [], 'Scene sources', 30).map((value) => {
                const ref = uid(value);
                if (!sourceReferences.some((source) => source.id === ref))
                  fail('Choose an episode source for this scene.');
                return ref;
              })
            )
          ],
          sourceNotes: text(scene.sourceNotes ?? '', 'Scene source notes', 4000),
          ...(sourceReferenceIds.length
            ? {
                sourceEvidenceHash: createHash('sha256')
                  .update(
                    JSON.stringify({
                      sources: sourceReferences.filter((ref) =>
                        sourceReferenceIds.includes(ref.id)
                      ),
                      decisions: decisions.filter((choice) =>
                        sourceReferenceIds.includes(choice.sourceId)
                      )
                    })
                  )
                  .digest('hex')
              }
            : {}),
          soundPlan: soundPlanInput(scene.soundPlan),
          clips: unique(
            list(scene.clips ?? [], 'Clips', 60).map((entry) => {
              const clip = object(entry);
              const production = clipProductionInput(clip.production);
              if (production.referenceAssetIds?.some((assetId) => !assetIds.includes(assetId)))
                fail("Choose this shot's reference assets from its scene.");
              return {
                id: uid(clip.id),
                title: text(clip.title, 'Clip title', 160, true),
                duration: clipDuration(clip.duration),
                action: text(clip.action ?? '', 'Action', 5000),
                dialogue: text(clip.dialogue ?? '', 'Dialogue', 5000),
                camera: text(clip.camera ?? '', 'Camera direction', 2000),
                soundEffects: text(clip.soundEffects ?? '', 'Sound effects', 2000),
                production,
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
function clipProductionInput(value: unknown = {}) {
  assertObject(value);
  if (
    value.continuityMode !== undefined &&
    !isOneOf(['auto', 'explicit', 'new-setup'], value.continuityMode)
  )
    fail('Choose automatic continuity, specific earlier shots, or a new setup.');
  const continuity =
    value.continuityMode ||
    (Array.isArray(value.continuitySources) && value.continuitySources.length) ||
    value.continuityNotes
      ? {
          continuityMode: (value.continuityMode as string) || 'auto',
          continuitySources: list(value.continuitySources ?? [], 'Continuity sources', 4).map(
            (source) => {
              assertObject(source);
              return { sceneId: uid(source.sceneId), clipId: uid(source.clipId) };
            }
          ),
          continuityNotes: text(value.continuityNotes ?? '', 'Continuity locks', 2000)
        }
      : {};
  const videoEndFrame = value.videoEndFrame ? object(value.videoEndFrame) : null;
  const mode = value.mode ?? '';
  if (!isOneOf(['', 'image2video', 'voice-reference'], mode))
    fail('Choose a currently supported generation mode.');
  const environment = value.environment ?? '';
  if (!isOneOf(['', 'space-exterior', 'surface-exterior', 'interior'], environment))
    fail('Choose the shot physical environment.');
  return {
    ...continuity,
    location: text(value.location ?? '', 'Shot location', 500),
    environment,
    physicalConstraints: text(value.physicalConstraints ?? '', 'Physical continuity', 2000),
    cleanDialogueMediaId: value.cleanDialogueMediaId ? id(value.cleanDialogueMediaId) : null,
    mode,
    framing: text(value.framing ?? '', 'Framing', 300),
    beats: text(value.beats ?? '', 'Timed action beats', 3000),
    passCondition: text(value.passCondition ?? '', 'Pass conditions', 2000),
    ...(value.imagePrompt
      ? { imagePrompt: text(value.imagePrompt, 'Image generation prompt', 12000) }
      : {}),
    ...(value.videoPrompt
      ? { videoPrompt: text(value.videoPrompt, 'Video generation prompt', 4500) }
      : {}),
    ...(value.videoTransitionPrompt
      ? {
          videoTransitionPrompt: text(
            value.videoTransitionPrompt,
            'Video transition instructions',
            1500
          )
        }
      : {}),
    ...(value.videoEndFrame
      ? {
          videoEndFrame:
            videoEndFrame.mode === 'none'
              ? { mode: 'none' }
              : videoEndFrame.mode === 'image'
                ? {
                    mode: 'image',
                    assetId: id(videoEndFrame.assetId),
                    mediaId: id(videoEndFrame.mediaId)
                  }
                : fail('Choose an approved end image or No end image.')
        }
      : {}),
    ...(value.startState || value.endState || value.allowedMotion
      ? {
          startState: text(value.startState ?? '', 'Shot starting state', 1000),
          endState: text(value.endState ?? '', 'Shot ending state', 1000),
          allowedMotion: text(value.allowedMotion ?? '', 'Allowed movement', 1000)
        }
      : {}),
    ...(value.imageReferenceMediaIds !== undefined
      ? {
          imageReferenceMediaIds: [
            ...new Set(list(value.imageReferenceMediaIds, 'Image request references', 16).map(id))
          ]
        }
      : {}),
    ...(value.videoReferenceMediaIds !== undefined
      ? {
          videoReferenceMediaIds: [
            ...new Set(list(value.videoReferenceMediaIds, 'Video identity references', 9).map(id))
          ]
        }
      : {}),
    referenceMediaIds: [
      ...new Set(list(value.referenceMediaIds ?? [], 'Shot reference images', 12).map(id))
    ],
    ...(value.referenceAssetIds !== undefined
      ? {
          referenceAssetIds: [
            ...new Set(list(value.referenceAssetIds, 'Shot reference assets', 30).map(id))
          ]
        }
      : {}),
    visualTakeId: value.visualTakeId ? id(value.visualTakeId) : null,
    upscaleMediaId: value.upscaleMediaId ? id(value.upscaleMediaId) : null,
    upscaleSourceTakeId: value.upscaleSourceTakeId ? id(value.upscaleSourceTakeId) : null
  };
}
export function sceneFingerprint(scene: Studio.SceneInput, assets: Studio.AssetInput[]) {
  const source = {
    ...(scene.sourceReferenceIds?.length || scene.sourceNotes
      ? {
          sourceReferenceIds: scene.sourceReferenceIds ?? [],
          sourceNotes: scene.sourceNotes ?? '',
          sourceEvidenceHash: scene.sourceEvidenceHash ?? null
        }
      : {}),
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
export function episodeView(episode, assets: Studio.AssetInput[]) {
  return {
    ...episode,
    ...(activeProject()?.workflowVersion === 1 ? { workflowVersion: 1 } : {}),
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
export function soundPlanFingerprint(scene: Studio.SceneInput, assets: Studio.AssetInput[]) {
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
