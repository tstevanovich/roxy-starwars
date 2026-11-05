import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { animaticTimingIssue, splitDialogueForTiming } from './animatic-timing-rules.ts';
import { Chat, Proposal } from './assistant/models.ts';
import { saveWorkingDraft } from './assistant/working-drafts.ts';
import { StudioEpisode, StudioMedia } from './models/Studio.ts';
import { assertMediaAccess } from './projects.ts';
import { fail } from './studio-validation.ts';

function splitId(base, seed, occupied) {
  const suffix = createHash('sha256').update(seed).digest('hex').slice(0, 8);
  let index = 1,
    candidate;
  do {
    candidate = `${base.slice(0, 72)}-timing-${suffix}-${index++}`;
  } while (occupied.has(candidate));
  occupied.add(candidate);
  return candidate;
}

export async function dialogueDuration(mediaId, directory: string, { refresh = false } = {}) {
  await assertMediaAccess([String(mediaId)]);
  const media = await StudioMedia.findById(mediaId).lean();
  if (media?.kind !== 'audio') fail('Choose an existing dialogue audio file.');
  if (!refresh && Number.isFinite(media.durationSeconds)) return media.durationSeconds;
  const { stdout } = await promisify(execFile)(
    process.env.FFPROBE_PATH || 'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      join(directory, media.filename)
    ],
    { windowsHide: true, timeout: 20000, maxBuffer: 100000 }
  );
  const seconds = Number(JSON.parse(stdout).format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0)
    fail('The dialogue duration could not be verified.');
  await StudioMedia.updateOne(
    { _id: media._id, sha256: media.sha256 },
    { $set: { durationSeconds: seconds } }
  );
  return seconds;
}

export async function prepareAnimaticTiming({ episodeId, sceneId, clipIds, mediaDirectory }) {
  const episode = await StudioEpisode.findById(episodeId).lean();
  const scene = episode?.scenes.find((scene) => scene.id === sceneId);
  if (!scene) fail('Choose the scene needing an animatic timing revision.');
  const existing = await Proposal.findOne({
    episodeId,
    'scene.id': sceneId,
    status: 'pending'
  }).lean();
  // Never replace a creative draft already waiting for its owner.
  if (existing) return existing;
  const repairs = [];
  const occupiedClips = new Set(scene.clips.map((clip) => clip.id));
  for (const clip of scene.clips.filter(
    (clip) =>
      (!clipIds || clipIds.includes(clip.id)) && clip.dialogue?.trim() && clip.selectedDialogueId
  )) {
    const seconds = await dialogueDuration(clip.selectedDialogueId, mediaDirectory);
    const issue = animaticTimingIssue(clip, seconds);
    if (!issue) continue;
    const parts = issue.split
      ? splitDialogueForTiming(clip.dialogue, seconds, clip.duration)
      : [
          {
            dialogue: clip.dialogue,
            duration: Math.min(15, Math.max(2, Math.ceil(seconds * 2) / 2))
          }
        ];
    if (issue.split && parts.length < 2)
      fail(
        'This recording has too little spoken material for a safe text split. Prepare a shorter performance for this line before approving the animatic.',
        409
      );
    repairs.push({
      ...issue,
      sourceMediaId: String(clip.selectedDialogueId),
      parts: parts.map((part, index: number) => ({
        ...clip,
        ...part,
        id: index
          ? splitId(clip.id, `${clip.selectedDialogueId}:${index}`, occupiedClips)
          : clip.id,
        title:
          parts.length > 1
            ? `${clip.title.slice(0, 135)} - part ${index + 1} of ${parts.length}`
            : clip.title,
        ...(issue.split ? { selectedDialogueId: null, dialogueTakeIds: [] } : {}),
        ...(index ? { takeIds: [], selectedTakeId: null, upscale: null } : {}),
        production: {
          ...clip.production,
          cleanDialogueMediaId: null,
          ...(issue.split
            ? {
                beats: part.dialogue,
                passCondition:
                  'Perform only the listed dialogue in source order. Preserve approved cast, costume, set, framing and geography. Measure the selected performance and fit it within this shot and the 15-second audio-reference limit before animatic approval.'
              }
            : {}),
          ...(index
            ? {
                visualTakeId: null,
                upscaleMediaId: null,
                upscaleSourceTakeId: null,
                audioRepairTakeId: null
              }
            : {})
        }
      }))
    });
  }
  if (!repairs.length) return null;
  const revised = {
    ...scene,
    clips: scene.clips.flatMap(
      (clip) => repairs.find((repair) => repair.clipId === clip.id)?.parts ?? [clip]
    )
  };
  if (revised.clips.length > 60)
    fail('This split needs more than 60 shots. Divide the scene before preparing its animatic.');
  // Reuse ambience/effects instructions with clip-relative timing; no new files
  // or claims about a sound's content are invented by a mechanical split.
  const occupiedLayers = new Set((scene.soundPlan?.layers ?? []).map((layer) => layer.id));
  if (scene.soundPlan)
    revised.soundPlan = {
      ...scene.soundPlan,
      layers: (scene.soundPlan.layers ?? []).flatMap((layer) => {
        const repair = repairs.find((repair) => repair.clipId === layer.clipId);
        const nativeBed =
          layer.type === 'ambience' &&
          layer.loop === true &&
          !layer.assetId &&
          (layer.start ?? 0) === 0;
        if (!repair) {
          if (
            nativeBed &&
            !layer.clipId &&
            layer.duration >= scene.clips.reduce((sum, clip) => sum + clip.duration, 0) - 0.1
          )
            return [
              { ...layer, duration: revised.clips.reduce((sum, clip) => sum + clip.duration, 0) }
            ];
          return [layer];
        }
        if (
          nativeBed &&
          layer.duration >= scene.clips.find((clip) => clip.id === layer.clipId).duration - 0.1
        )
          return repair.parts.map((part, index: number) => ({
            ...layer,
            id: index ? splitId(layer.id, `${part.id}:${index}`, occupiedLayers) : layer.id,
            clipId: part.id,
            duration: part.duration,
            sourceStart: 0
          }));
        let offset = 0;
        return repair.parts.flatMap((part, index: number) => {
          const from = Math.max(offset, layer.start ?? 0),
            to = Math.min(offset + part.duration, (layer.start ?? 0) + layer.duration);
          const sourceStart = (layer.sourceStart ?? 0) + Math.max(0, from - (layer.start ?? 0));
          const start = from - offset;
          offset += part.duration;
          return to > from
            ? [
                {
                  ...layer,
                  id: index ? splitId(layer.id, `${part.id}:${index}`, occupiedLayers) : layer.id,
                  clipId: part.id,
                  start,
                  duration: to - from,
                  sourceStart: layer.assetId ? sourceStart : 0
                }
              ]
            : [];
        });
      })
    };
  const key =
    'animatic-timing-' +
    createHash('sha256')
      .update(
        JSON.stringify({
          episodeId,
          sceneId,
          revision: episode.revision,
          repairs: repairs.map((repair) => [
            repair.clipId,
            repair.sourceMediaId,
            repair.audioSeconds
          ])
        })
      )
      .digest('hex');
  const chat = await Chat.findOneAndUpdate(
    { workflowKey: key },
    {
      $setOnInsert: {
        title: 'Workflow - split or retime animatic',
        context: { episodeId, sceneId, ...(clipIds?.length === 1 ? { clipId: clipIds[0] } : {}) }
      }
    },
    { upsert: true, returnDocument: 'after' }
  ).lean();
  return saveWorkingDraft({
    chatId: chat._id,
    episodeId,
    baseRevision: episode.revision,
    title: 'Split or retime dialogue for the 15-second animatic limit',
    text:
      repairs
        .map(
          (repair) =>
            `${repair.message} ${repair.split ? `Split into ${repair.parts.length} shots with every spoken word and speaker retained in order. The original recording stays in Media library and episode history. Applying this draft clears that oversized performance from the revised shots; approving the revised script and shot plan lets Production generate shorter dialogue takes automatically. Each take will be measured again; estimates do not authorize an over-limit reference.` : `Retime this shot to ${repair.parts[0].duration}s and reuse the existing dialogue recording.`}`
        )
        .join('\n\n') +
      '\n\nThe episode outline, source research, scene script, unrelated shots, images and accepted takes are unchanged. Applying this draft grants no approval and starts no render.',
    scene: revised,
    timingRepair: {
      repairs: repairs.map(({ parts, ...repair }) => ({
        ...repair,
        parts: parts.map((part) => ({ clipId: part.id, duration: part.duration }))
      }))
    },
    reviewStages: ['scene', 'shot-plan', 'sound-plan', 'animatic']
  });
}
