import { Router } from 'express';

import { characterPackageLayout } from '../../../shared/character-package.ts';
import { toError } from '../../../shared/errors.ts';
import { imageReferenceItems, imageReferenceSelection } from '../../../shared/image-references.ts';
import type * as Studio from '../../../shared/types.ts';
import { packageImageBasePrompt, packageImagePrompt } from '../asset-image-prompts.ts';
import { StudioAsset } from '../models/Studio.ts';
import { workflowContext, workflowEnabled } from '../production-workflow.ts';
import { projectEra, projectKey } from '../project-context.ts';
import { fail, id, text } from '../studio-validation.ts';
import { Job } from './models.ts';
import { voiceDirection, voiceRevisionFields } from './voice-production.ts';

const publicAsset = (asset: Studio.AssetInput) => {
  if (!asset) return null;
  const record = { ...asset };
  delete record.history;
  return record;
};
const active = ['queued', 'preparing', 'submitting', 'rendering', 'importing', 'uncertain'];
const root = (value) =>
  value
    .trim()
    .split(/\s+[—–-]\s+|\s+(?:voice|auditions)\b/i)[0]
    .toLowerCase()
    .replace(/^(?:overseer|lord|darth|master|captain|commander)\s+/, '')
    .replace(/['\u2019]s$/, '')
    .replace(/^al-1b$/, 'al');
const speakerName = (asset: Studio.AssetInput, voice?) =>
  (
    voice?.aliases?.[0] ||
    asset.name
      .split(/\s+[\u2014\u2013-]\s+/)[0]
      .replace(/^(?:overseer|lord|darth|master|captain|commander)\s+/i, '')
  ).slice(0, 80);
export function characterVoice(character, assets: Studio.AssetInput[]) {
  const linked = assets.find(
    (asset) =>
      asset.kind === 'voice' &&
      !asset.archived &&
      asset.production?.characterAssetId === String(character._id)
  );
  if (linked) return linked;
  const names = [character.name, ...(character.aliases ?? [])].map(root);
  const matches = assets.filter(
    (asset) =>
      asset.kind === 'voice' &&
      !asset.archived &&
      [asset.name, ...(asset.aliases ?? [])].some((name) => names.includes(root(name)))
  );
  return matches.length === 1 ? matches[0] : null;
}
export const voicePromptSource = (asset: Studio.AssetInput, voice) =>
  voice?.production?.voiceDescription?.trim()
    ? 'saved-voice'
    : asset.production?.voiceDescription?.trim()
      ? 'saved-character'
      : voice?.brief?.trim()
        ? 'saved-voice-brief'
        : 'suggested-default';
export function characterVoicePrompt(asset: Studio.AssetInput, voice) {
  const speaker = speakerName(asset, voice);
  return (
    voice?.production?.voiceDescription?.trim() ||
    asset.production?.voiceDescription?.trim() ||
    voice?.brief?.trim() ||
    voiceDirection(speaker, [
      ...(voice ? [{ ...voice, aliases: [speaker, ...(voice.aliases ?? [])] }] : []),
      { ...asset, aliases: [speaker, ...(asset.aliases ?? [])] }
    ])
  );
}
export async function ensureCharacterVoice(
  asset: Studio.AssetInput,
  assets: Studio.AssetInput[],
  initialPrompt?
) {
  const existing = characterVoice(asset, assets);
  if (existing) return existing;
  const speaker = speakerName(asset);
  const description = initialPrompt ?? characterVoicePrompt(asset, null);
  const seedKey = `character-voice-${projectKey()}-${asset._id}`;
  const fields = {
    seedKey,
    name: `${speaker} - voice auditions`,
    aliases: [
      ...new Set([
        speaker,
        ...(asset.aliases ?? []),
        ...(/^al(?:-1b)?$/i.test(speaker) ? ['Al'] : [])
      ])
    ],
    kind: 'voice',
    scope: asset.scope,
    episodeId: asset.episodeId,
    brief: description,
    production: { voiceDescription: description, characterAssetId: String(asset._id) },
    candidates: [],
    reviewStatus: 'development'
  };
  try {
    return await StudioAsset.findOneAndUpdate(
      { seedKey },
      { $setOnInsert: fields },
      { upsert: true, returnDocument: 'after' }
    ).lean();
  } catch (caughtError) {
    const error = toError(caughtError);
    if (error.code !== 11000) throw error;
    const voice = await StudioAsset.findOne({ seedKey }).lean();
    if (!voice) throw error;
    return voice;
  }
}
export function characterGenerationRouter() {
  const router = Router();
  async function character(assetId: string) {
    const record = await StudioAsset.findById(id(assetId)).lean();
    if (!record || record.archived || !['character', 'droid', 'voice'].includes(record.kind))
      fail('Choose an active character, droid or voice reference.', 404);
    return record;
  }
  router.get('/:id', async (req, res) => {
    const asset = await character(req.params.id);
    const context = await workflowContext();
    const voice = asset.kind === 'voice' ? asset : characterVoice(asset, context.assets);
    const sourceCharacter =
      asset.kind !== 'voice'
        ? asset
        : (context.assets.find(
            (candidate) =>
              ['character', 'droid'].includes(candidate.kind) &&
              String(candidate._id) === asset.production?.characterAssetId
          ) ??
          context.assets.find(
            (candidate) =>
              ['character', 'droid'].includes(candidate.kind) &&
              String(characterVoice(candidate, context.assets)?._id) === String(asset._id)
          ));
    const speaker = speakerName(asset, voice);
    const prompt = characterVoicePrompt(asset, voice);
    const jobs = await Job.find({
      $or: [
        { 'target.assetId': String(asset._id) },
        ...(voice ? [{ resultAssetId: String(voice._id) }] : [])
      ]
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .select('kind target title status error resultAssetId')
      .lean();
    const target = { scope: 'asset' as const, recordId: String(asset._id) };
    const images = (asset.production?.items ?? [])
      .filter((item) => item.type === 'image')
      .map((item) => {
        const stages = ['brief'];
        const masterId = asset.production.items.find(
          (entry) => entry.id === 'master-portrait'
        )?.mediaId;
        if (
          asset.sheetLayout === characterPackageLayout &&
          item.id !== 'master-portrait' &&
          (item.imageReferenceMediaIds === undefined ||
            item.imageReferenceMediaIds.includes(String(masterId)))
        )
          stages.push('reference:master-portrait');
        for (const mediaId of item.imageReferenceMediaIds ?? item.referenceMediaIds ?? []) {
          const reference = asset.production.items.find(
            (entry) => entry.id !== item.id && String(entry.mediaId) === String(mediaId)
          );
          if (reference) stages.push('reference:' + reference.id);
        }
        const blockers = stages.flatMap((stage) => {
          const row = context.evaluate(target, stage);
          return row.status === 'approved' ? [] : [`Approve ${row.title}.`, ...row.blockers];
        });
        const plan = item.requiresPlanApproval
          ? context.evaluate(target, 'reference-plan:' + item.id)
          : null;
        if (plan && plan.status !== 'approved' && !plan.canApprove) blockers.push(...plan.blockers);
        const selection = imageReferenceSelection({
          asset,
          packageItemId: item.id,
          workflow: workflowEnabled()
        });
        return {
          itemId: item.id,
          title: item.title,
          mediaId: item.mediaId,
          prompt: packageImagePrompt(asset, item, {
            era: projectEra(),
            assets: context.assets,
            workflow: workflowEnabled()
          }),
          promptBase: packageImageBasePrompt(asset, item, { era: projectEra() }),
          imageReferences: {
            ...selection,
            choices: imageReferenceItems(
              context.media.filter((file) => file.kind === 'image').map((file) => String(file._id)),
              { assets: context.assets, media: context.media }
            ),
            items: imageReferenceItems(selection.selected, {
              assets: context.assets,
              media: context.media
            }),
            omittedItems: imageReferenceItems(selection.omitted, {
              assets: context.assets,
              media: context.media
            })
          },
          plan,
          blockers: [...new Set(blockers)],
          job: jobs.find((job) => job.kind === 'image' && job.target?.packageItemId === item.id)
        };
      });
    res.json({
      asset: publicAsset(asset),
      voice: publicAsset(voice),
      speaker,
      voicePrompt: prompt,
      voicePromptSource: voicePromptSource(asset, voice),
      characterSource: sourceCharacter
        ? {
            assetId: String(sourceCharacter._id),
            name: sourceCharacter.name,
            status: context.evaluate(
              { scope: 'asset' as const, recordId: String(sourceCharacter._id) },
              'source'
            ).status
          }
        : null,
      images,
      jobs,
      voiceJob: jobs.find((job) => job.kind === 'voice' && active.includes(job.status))
    });
  });
  router.put('/:id/voice', async (req, res) => {
    const asset = await character(req.params.id);
    if (asset.revision !== req.body.revision)
      fail('This character changed. Reload its saved details before saving voice directions.', 409);
    const description = text(req.body.prompt, 'Voice generation prompt', 1000, true).trim();
    const assets = await StudioAsset.find({ archived: { $ne: true } }).lean();
    let voice = asset.kind === 'voice' ? asset : characterVoice(asset, assets);
    if (voice && voice.revision !== req.body.voiceRevision)
      fail('The voice changed. Reload its saved directions before saving.', 409);
    if (
      voice &&
      (await Job.exists({
        kind: 'voice',
        resultAssetId: String(voice._id),
        status: { $in: active }
      }))
    )
      fail('Wait for the current voice request before changing its directions.', 409);
    const speaker = speakerName(asset, voice);
    if (!voice) {
      voice = await ensureCharacterVoice(asset, assets, description);
      if (voice.production?.voiceDescription !== description)
        fail(
          'A voice was just saved for this character. Reload its current directions before saving.',
          409
        );
    } else if (
      voice.production?.voiceDescription !== description ||
      (asset.kind !== 'voice' && voice.production?.characterAssetId !== String(asset._id))
    ) {
      const snapshot = { ...voice };
      delete snapshot.history;
      const next = await StudioAsset.findOneAndUpdate(
        { _id: voice._id, revision: voice.revision },
        {
          $set: voiceRevisionFields(voice, {
            ...voice.production,
            voiceDescription: description,
            ...(asset.kind !== 'voice' ? { characterAssetId: String(asset._id) } : {})
          }),
          $inc: { revision: 1 },
          $push: { history: { $each: [{ ...snapshot, savedAt: new Date() }], $slice: -30 } }
        },
        { returnDocument: 'after' }
      ).lean();
      if (!next)
        fail('The voice changed while saving. Your prompt is retained; reload and try again.', 409);
      voice = next;
    }
    res.json({ voice, speaker, prompt: description });
  });
  return router;
}
