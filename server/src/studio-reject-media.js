import { unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { removeMediaReferences } from '../../shared/media-rejection.js';
import { currentCharacterSheet } from './character-sheets.js';
import { StudioAsset, StudioEpisode, StudioMedia, StudioMusicCue } from './models/Studio.js';
import { belongsToProject, projectKey, withoutProject } from './project-context.js';
import { fail, id, revision } from './studio-validation.js';

// Strip deleted file references from current records and their saved history.
// Rejection deliberately does not keep a recoverable media copy.

export async function rejectMedia(directory, mediaId, context = {}) {
  const key = projectKey();
  return withoutProject(() => rejectAcrossReferences(directory, mediaId, context, key));
}
async function rejectAcrossReferences(directory, mediaId, context, key) {
  const media = await StudioMedia.findById(id(mediaId)).lean();
  if (!media) fail('Media not found.', 404);
  if (!belongsToProject(media, key)) fail('Delete this file from its original workspace.', 409);
  if (
    await StudioMedia.exists({
      $or: [
        { 'soundMix.sourceTakeId': mediaId },
        { 'soundMix.stemMediaId': mediaId },
        { 'soundMix.cleanDialogueMediaId': mediaId },
        { 'musicCue.sourceMediaId': mediaId }
      ]
    })
  )
    fail(
      'This file is used by a sound mix or prepared music track. Reject and delete the derived file first.',
      409
    );
  const root = resolve(directory);
  const target = resolve(root, media.filename);
  if (basename(media.filename) !== media.filename || dirname(target) !== root)
    fail('Invalid stored media path.');
  const assets = await StudioAsset.find().lean();
  const episodes = await StudioEpisode.find().lean();
  const cues = await StudioMusicCue.find().lean();
  for (const asset of assets)
    if (asset.identitySourceMediaIds?.map(String).includes(mediaId))
      fail(
        `This file is an identity reference for ${asset.name}. Replace that reference before deleting it.`,
        409
      );
  let owner;
  if (context.assetId) {
    owner = assets.find((asset) => String(asset._id) === id(context.assetId));
    if (!owner || !belongsToProject(owner, key) || owner.revision !== revision(context.revision))
      fail('This asset changed. Refresh before rejecting its file.', 409);
    if (context.packageItemId) {
      if (
        !owner.production?.items?.some(
          (item) => item.id === context.packageItemId && item.mediaId === mediaId
        )
      )
        fail('This file is not attached to that reference package item.');
    } else if (
      !owner.candidates.some(
        (candidate) =>
          candidate.id === context.candidateId && candidate.mediaIds.map(String).includes(mediaId)
      )
    )
      fail('This file is not attached to that option.');
  } else if (context.musicCueId) {
    owner = cues.find((c) => String(c._id) === id(context.musicCueId));
    if (!owner || !belongsToProject(owner, key) || owner.revision !== revision(context.revision))
      fail('The music record changed. Refresh before rejecting.', 409);
    if (
      !owner.candidates.some(
        (c) => c.id === context.candidateId && c.mediaIds.map(String).includes(mediaId)
      )
    )
      fail('This file is not attached to that music take.');
  } else if (context.episodeId) {
    owner = episodes.find((episode) => String(episode._id) === id(context.episodeId));
    if (!owner || !belongsToProject(owner, key) || owner.revision !== revision(context.revision))
      fail('This episode changed. Refresh before rejecting its take.', 409);
    const clip = owner.scenes
      .find((scene) => scene.id === context.sceneId)
      ?.clips.find((clip) => clip.id === context.clipId);
    if (
      !clip ||
      ![
        ...(clip.takeIds ?? []),
        clip.selectedTakeId,
        ...(clip.dialogueTakeIds ?? []),
        clip.selectedDialogueId,
        clip.production?.cleanDialogueMediaId
      ]
        .filter(Boolean)
        .map(String)
        .includes(mediaId)
    )
      fail('This take is not attached to that clip.');
  }
  for (const asset of assets) {
    const approved =
      asset.finalChoice?.mediaIds?.map(String).includes(mediaId) ||
      asset.characterSheets?.some(
        (sheet) =>
          String(sheet.mediaId) === mediaId &&
          sheet.approvedAt &&
          currentCharacterSheet(asset, sheet)
      );
    const rejectingHere =
      context.assetId === String(asset._id) && asset.finalChoice?.id === context.candidateId;
    if (approved && !rejectingHere)
      fail(
        `This file is approved in ${asset.name}. Reject it there before deleting the shared file.`,
        409
      );
  }
  for (const episode of episodes)
    for (const scene of episode.scenes)
      for (const clip of scene.clips) {
        if (
          ![clip.selectedTakeId, clip.selectedDialogueId]
            .filter(Boolean)
            .map(String)
            .includes(mediaId)
        )
          continue;
        if (
          context.episodeId !== String(episode._id) ||
          context.sceneId !== scene.id ||
          context.clipId !== clip.id
        )
          fail(
            `This file is selected in ${episode.title}, ${clip.title}. Reject it there before deleting the shared file.`,
            409
          );
      }
  for (const cue of cues)
    if (String(cue.selectedMediaId) === mediaId && context.musicCueId !== String(cue._id))
      fail('Reject this selected music take from its scene before deleting the file.', 409);
  const changed = { assets: [], episodes: [], musicCues: [] };
  // Each write checks its revision. On a concurrent edit the file is retained;
  // the caller refreshes and retries rather than overwriting that edit.
  for (const [Model, records, collection] of [
    [StudioAsset, assets, 'assets'],
    [StudioEpisode, episodes, 'episodes'],
    [StudioMusicCue, cues, 'musicCues']
  ]) {
    for (const record of records) {
      const original = JSON.parse(JSON.stringify(record));
      const next = removeMediaReferences(original, mediaId);
      if (JSON.stringify(next) === JSON.stringify(original)) continue;
      if (collection === 'assets') {
        if (original.finalChoice && !next.finalChoice)
          next.referenceRevision = (original.referenceRevision ?? original.revision) + 1;
        if (!next.finalChoice)
          next.reviewStatus = next.candidates.some(
            (candidate) => !candidate.archived && candidate.mediaIds.length
          )
            ? 'pending-choice'
            : 'development';
      }
      delete next._id;
      delete next.revision;
      delete next.createdAt;
      delete next.updatedAt;
      const saved = await Model.findOneAndUpdate(
        { _id: record._id, revision: record.revision },
        { $set: next, $inc: { revision: 1 } },
        { returnDocument: 'after' }
      ).lean();
      if (!saved)
        fail(
          'A referenced record changed. The file has been retained; refresh before rejecting again.',
          409
        );
      changed[collection].push(String(record._id));
    }
  }
  try {
    await unlink(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await StudioMedia.deleteOne({ _id: media._id });
  return { deletedMediaId: mediaId, changed };
}
