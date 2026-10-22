import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { json, Router } from 'express';

import {
  imageGenerationDefaults,
  videoUpscaleDefaults
} from '../../../shared/production-defaults.js';
import {
  approvedCharacterSheets,
  characterSheetInput,
  currentCharacterSheet
} from '../character-sheets.js';
import { StudioAsset, StudioEpisode, StudioMedia, StudioSettings } from '../models/Studio.js';
import { validateMixedSelection } from '../sound-design.js';
import { mediaRouter, mediaView } from '../studio-media.js';
import { clipPrompts } from '../studio-prompts.js';
import { seedStudio } from '../studio-seed.js';
import { upscaleForSelection } from '../studio-upscale.js';
import {
  assetCreativeFields,
  assetInput,
  assetOrganization,
  episodeInput,
  episodeView,
  fail,
  id,
  number,
  object,
  revision,
  sceneFingerprint,
  soundPlanFingerprint,
  text
} from '../studio-validation.js';
import { sendZip } from '../studio-zip.js';

const defaultMediaDirectory = fileURLToPath(new URL('../../../.data/media/', import.meta.url));
async function referencedMedia(ids, kind) {
  const unique = [...new Set(ids.map(String))];
  const media = await StudioMedia.find({ _id: { $in: unique } }).lean();
  if (media.length !== unique.length || (kind && media.some((file) => file.kind !== kind)))
    fail(`Choose saved ${kind ?? 'reference'} files from the media library.`);
  return media;
}
function snapshot(record) {
  const source = { ...record };
  delete source.history;
  return { ...source, savedAt: new Date() };
}
async function existing(model, recordId, expectedRevision) {
  const record = await model.findById(id(recordId)).lean();
  if (!record) fail('Record not found.', 404);
  if (record.revision !== revision(expectedRevision))
    fail(
      'This record changed in another tab. Your draft is preserved. Reload the saved version or copy your edits before trying again.',
      409
    );
  return record;
}
async function save(model, old, fields, preserveReferences = false) {
  if (model === StudioAsset)
    fields.referenceRevision = preserveReferences
      ? (old.referenceRevision ?? old.revision)
      : old.revision + 1;
  const updated = await model
    .findOneAndUpdate(
      { _id: old._id, revision: old.revision },
      {
        $set: fields,
        $inc: { revision: 1 },
        $push: { history: { $each: [snapshot(old)], $slice: -30 } }
      },
      { returnDocument: 'after' }
    )
    .lean();
  if (!updated) fail('This record changed while saving. Your draft is preserved.', 409);
  return updated;
}
async function validateEpisodeReferences(episode, episodeId) {
  const ids = [...new Set(episode.scenes.flatMap((scene) => scene.assetIds))];
  const assets = await StudioAsset.find({ _id: { $in: ids } }).lean();
  if (assets.length !== ids.length) fail('A linked asset no longer exists.');
  if (assets.some((a) => a.scope === 'episode' && String(a.episodeId) !== String(episodeId)))
    fail('An episode-only asset belongs to a different episode.');
  for (const scene of episode.scenes) {
    for (const layer of scene.soundPlan?.layers ?? []) {
      if (layer.clipId && !scene.clips.some((c) => c.id === layer.clipId))
        fail('Choose a clip in this scene for the sound effect.');
      if (layer.type === 'effect' && !layer.clipId)
        fail('Assign timed effects to an individual clip.');
      if (layer.assetId) {
        const sound = await StudioAsset.findById(layer.assetId).lean();
        if (
          !sound ||
          sound.kind !== 'sound' ||
          (sound.scope === 'episode' && String(sound.episodeId) !== String(episodeId))
        )
          fail('Choose a sound from this episode or the reusable library.');
      }
    }
  }
  await referencedMedia(
    episode.scenes.flatMap((scene) =>
      scene.clips.flatMap((clip) => [...(clip.takeIds ?? []), clip.selectedTakeId].filter(Boolean))
    ),
    'video'
  );
  await referencedMedia(
    episode.scenes.flatMap((scene) =>
      scene.clips.flatMap((clip) =>
        [...(clip.dialogueTakeIds ?? []), clip.selectedDialogueId].filter(Boolean)
      )
    ),
    'audio'
  );
}
async function validateOrganization(fields, assetId) {
  if (fields.scope === 'episode' && !(await StudioEpisode.exists({ _id: fields.episodeId })))
    fail('Choose an existing episode.');
  if (fields.clipId) {
    const episode = await StudioEpisode.findById(fields.episodeId).lean();
    if (
      !episode?.scenes
        .find((scene) => scene.id === fields.sceneId)
        ?.clips.some((clip) => clip.id === fields.clipId)
    )
      fail('Choose an existing scene and clip for this shot image.');
    for (const candidate of fields.candidates?.filter((item) => !item.archived) ?? []) {
      if (candidate.mediaIds.length > 1)
        fail(
          'Each shot image option must contain exactly one image. Add alternatives as separate options.'
        );
      if (candidate.mediaIds.length) await referencedMedia(candidate.mediaIds, 'image');
    }
  }
  if (
    fields.scope === 'episode' &&
    assetId &&
    (await StudioEpisode.exists({
      _id: { $ne: fields.episodeId },
      'scenes.assetIds': assetId
    }))
  )
    fail('This asset is used by another episode. Keep it reusable or remove those links first.');
  if (fields.relatedAssetId) {
    if (String(fields.relatedAssetId) === String(assetId)) fail('An asset cannot contain itself.');
    const parent = await StudioAsset.findById(fields.relatedAssetId).lean();
    if (!parent || parent.archived || parent.relatedAssetId)
      fail('Choose an active main asset for comparison history.');
  }
}

export function createStudioRouter({ mediaDirectory = defaultMediaDirectory } = {}) {
  const router = Router();
  router.use('/media', mediaRouter(mediaDirectory));
  router.use(json({ limit: '2mb' }));
  router.get('/', async (_req, res) => {
    await seedStudio();
    const [assets, episodes, media, settings] = await Promise.all([
      StudioAsset.find().sort({ createdAt: 1 }).lean(),
      StudioEpisode.find().sort({ createdAt: -1 }).lean(),
      StudioMedia.find().sort({ createdAt: -1 }).lean(),
      StudioSettings.findOne({ key: 'series' }).lean()
    ]);
    res.json({
      assets,
      episodes: await Promise.all(
        episodes.map(async (e) => {
          const view = episodeView(e, assets);
          for (const scene of view.scenes)
            for (const clip of scene.clips) {
              if (!clip.selectedTakeId) continue;
              try {
                await validateMixedSelection(e, scene, clip);
                clip.soundReviewStatus =
                  String(clip.selectedTakeId) === String(clip.soundLegacyTakeId)
                    ? 'legacy-approved'
                    : 'approved';
              } catch {
                clip.soundReviewStatus = 'needs-review';
              }
            }
          return view;
        })
      ),
      media: media.map(mediaView),
      settings
    });
  });
  router.post('/assets', async (req, res) => {
    const fields = assetInput(req.body);
    await validateOrganization(fields);
    await referencedMedia(fields.candidates.flatMap((c) => c.mediaIds));
    const asset = await StudioAsset.create(fields);
    res.status(201).json({ asset: asset.toObject() });
  });
  router.put('/assets/:id', async (req, res) => {
    object(req.body);
    const old = await existing(StudioAsset, req.params.id, req.body.revision);
    const fields = assetInput(req.body);
    await validateOrganization(fields, old._id);
    await referencedMedia(fields.candidates.flatMap((c) => c.mediaIds));
    const oldFields = assetInput(JSON.parse(JSON.stringify(old)));
    const organizationOnly =
      JSON.stringify(assetCreativeFields(fields)) ===
      JSON.stringify(assetCreativeFields(oldFields));
    res.json({
      asset: await save(
        StudioAsset,
        old,
        { ...fields, finalChoice: organizationOnly ? old.finalChoice : null },
        organizationOnly
      )
    });
  });
  router.patch('/assets/:id/organization', async (req, res) => {
    object(req.body);
    const old = await existing(StudioAsset, req.params.id, req.body.revision);
    const fields = assetOrganization({ ...JSON.parse(JSON.stringify(old)), ...req.body });
    await validateOrganization(fields, old._id);
    res.json({ asset: await save(StudioAsset, old, fields, true) });
  });
  router.post('/assets/:id/consolidate', async (req, res) => {
    object(req.body);
    const source = await existing(StudioAsset, req.params.id, req.body.revision);
    const target = await existing(StudioAsset, req.body.targetId, req.body.targetRevision);
    if (String(source._id) === String(target._id)) fail('Choose a different main asset.');
    if (source.archived || target.archived || target.relatedAssetId || source.kind !== target.kind)
      fail('Consolidate into an active main asset of the same category.');
    if (await StudioAsset.exists({ relatedAssetId: source._id }))
      fail(
        'This asset already contains comparison history. Consolidate its comparisons individually.'
      );
    const knownMedia = new Set(target.candidates.flatMap((c) => c.mediaIds.map(String)));
    const resolved = Boolean(
      source.finalChoice &&
      target.finalChoice &&
      source.finalChoice.mediaIds.every((mediaId) =>
        target.finalChoice.mediaIds.map(String).includes(String(mediaId))
      ) &&
      source.finalChoice.voiceId === target.finalChoice.voiceId &&
      source.finalChoice.voiceModel === target.finalChoice.voiceModel
    );
    const additions = source.candidates.map((c) => ({
      ...c,
      id: `comparison-${source._id}-${createHash('sha256').update(c.id).digest('hex').slice(0, 12)}`,
      archived:
        resolved || c.archived || c.mediaIds.every((mediaId) => knownMedia.has(String(mediaId)))
    }));
    const candidates = [...target.candidates];
    for (const c of additions) if (!candidates.some((item) => item.id === c.id)) candidates.push(c);
    if (candidates.length > 50)
      fail('The main asset has too many options; archive the comparison separately.');
    const pending = additions.some((c) => !c.archived);
    const updated = await save(
      StudioAsset,
      target,
      { candidates, ...(pending ? { reviewStatus: 'pending-choice' } : {}) },
      true
    );
    const archived = await save(
      StudioAsset,
      source,
      { archived: true, relatedAssetId: target._id },
      true
    );
    res.json({ asset: updated, archivedAsset: archived });
  });
  router.post('/assets/:id/finalize', async (req, res) => {
    object(req.body);
    const old = await existing(StudioAsset, req.params.id, req.body.revision);
    const candidate = old.candidates.find((c) => c.id === req.body.candidateId && !c.archived);
    if (!candidate || !candidate.mediaIds.length)
      fail('Attach and save reference media before finalizing this option.');
    const media = await referencedMedia(candidate.mediaIds);
    if (old.clipId && (media.length !== 1 || media[0].kind !== 'image'))
      fail('Approve one image for this clip. Alternatives need separate options.');
    if (['voice', 'sound'].includes(old.kind) && !media.some((m) => m.kind === 'audio'))
      fail('A finalized voice needs an audio audition.');
    if (old.kind === 'sound' && (media.length !== 1 || media[0].kind !== 'audio'))
      fail('Approve exactly one audio file for each sound option.');
    if (
      !['voice', 'sound'].includes(old.kind) &&
      !media.some((m) => ['image', 'video'].includes(m.kind))
    )
      fail('A finalized visual asset needs an image or video reference.');
    const finalizedAt = new Date();
    const generatedSheet =
      ['character', 'droid', 'prop'].includes(old.kind) &&
      media.length === 1 &&
      media[0].kind === 'image' &&
      candidate.id === `chat-${media[0].productionJobId}`;
    const sheetFields = generatedSheet
      ? {
          characterSheets: [
            ...(old.characterSheets ?? []).filter((sheet) => sheet.id !== candidate.id),
            {
              id: candidate.id,
              title: candidate.title,
              mediaId: media[0]._id,
              views:
                old.kind === 'prop'
                  ? ['front', 'three-quarter', 'side', 'rear', 'detail']
                  : ['front', 'three-quarter', 'side', 'rear', 'face'],
              sourceCandidateId: candidate.id,
              sourceFinalizedAt: finalizedAt,
              approvedAt: finalizedAt
            }
          ]
        }
      : {};
    res.json({
      asset: await save(StudioAsset, old, {
        ...sheetFields,
        reviewStatus: null,
        finalChoice: {
          ...candidate,
          finalizedAt,
          assetBrief: old.brief,
          assetName: old.name
        }
      })
    });
  });
  router.post('/assets/:id/reopen', async (req, res) => {
    object(req.body);
    const old = await existing(StudioAsset, req.params.id, req.body.revision);
    res.json({
      asset: await save(StudioAsset, old, { finalChoice: null, reviewStatus: 'pending-choice' })
    });
  });
  router.post('/assets/:id/character-sheets', async (req, res) => {
    object(req.body);
    const old = await existing(StudioAsset, req.params.id, req.body.revision);
    if (!['character', 'droid', 'prop'].includes(old.kind) || !old.finalChoice)
      fail('Finalize a character, droid, or prop design before adding its reference sheet.');
    const sheets = old.characterSheets ?? [];
    if (sheets.length >= 20) fail('This identity already has 20 saved character sheets.');
    const fields = characterSheetInput(req.body, old.kind);
    await referencedMedia([fields.mediaId], 'image');
    const sheet = {
      ...fields,
      id: randomUUID(),
      sourceCandidateId: old.finalChoice.id,
      sourceFinalizedAt: old.finalChoice.finalizedAt,
      approvedAt: null
    };
    res.status(201).json({
      asset: await save(StudioAsset, old, { characterSheets: [...sheets, sheet] })
    });
  });
  router.post('/assets/:id/character-sheets/:sheetId/approve', async (req, res) => {
    object(req.body);
    const old = await existing(StudioAsset, req.params.id, req.body.revision);
    const sheet = (old.characterSheets ?? []).find((sheet) => sheet.id === req.params.sheetId);
    if (!sheet) fail('Character sheet not found.', 404);
    if (!['character', 'droid', 'prop'].includes(old.kind) || !currentCharacterSheet(old, sheet))
      fail('The design changed. Add a sheet for the current finalized design.');
    await referencedMedia([sheet.mediaId], 'image');
    if (sheet.approvedAt) return res.json({ asset: old });
    sheet.approvedAt = new Date();
    res.json({ asset: await save(StudioAsset, old, { characterSheets: old.characterSheets }) });
  });
  router.post('/episodes', async (req, res) => {
    const fields = episodeInput(req.body);
    await validateEpisodeReferences(fields);
    for (const scene of fields.scenes)
      for (const clip of scene.clips)
        if (clip.selectedTakeId)
          fail('Create and review a sound mix after saving the episode before selecting a video.');
    fields.scenes = fields.scenes.map((scene) => ({
      ...scene,
      clips: scene.clips.map((clip) => ({ ...clip, upscale: upscaleForSelection(clip) }))
    }));
    const episode = await StudioEpisode.create(fields);
    res
      .status(201)
      .json({ episode: episodeView(episode.toObject(), await StudioAsset.find().lean()) });
  });
  router.put('/episodes/:id', async (req, res) => {
    object(req.body);
    const old = await existing(StudioEpisode, req.params.id, req.body.revision);
    const fields = episodeInput(req.body);
    await validateEpisodeReferences(fields, req.params.id);
    fields.scenes = fields.scenes.map((scene) => ({
      ...scene,
      approval: old.scenes.find((s) => s.id === scene.id)?.approval ?? null,
      soundPlan: scene.soundPlan
        ? {
            ...scene.soundPlan,
            approval: old.scenes.find((s) => s.id === scene.id)?.soundPlan?.approval ?? null
          }
        : (old.scenes.find((s) => s.id === scene.id)?.soundPlan ?? null),
      clips: scene.clips.map((clip) => ({
        ...clip,
        soundLegacyTakeId:
          old.scenes.find((s) => s.id === scene.id)?.clips.find((c) => c.id === clip.id)
            ?.soundLegacyTakeId ??
          (!old.scenes.find((s) => s.id === scene.id)?.soundPlan
            ? old.scenes.find((s) => s.id === scene.id)?.clips.find((c) => c.id === clip.id)
                ?.selectedTakeId
            : null) ??
          null,
        upscale: upscaleForSelection(
          clip,
          old.scenes.find((s) => s.id === scene.id)?.clips.find((c) => c.id === clip.id)
        )
      }))
    }));
    for (const scene of fields.scenes) {
      for (const clip of scene.clips) {
        const previous = old.scenes
          .find((s) => s.id === scene.id)
          ?.clips.find((c) => c.id === clip.id);
        if (clip.selectedTakeId && String(clip.selectedTakeId) !== String(previous?.selectedTakeId))
          await validateMixedSelection({ ...fields, _id: old._id }, scene, clip);
      }
    }
    const episode = await save(StudioEpisode, old, fields);
    res.json({ episode: episodeView(episode, await StudioAsset.find().lean()) });
  });
  router.post('/episodes/:id/scenes/:sceneId/approve', async (req, res) => {
    object(req.body);
    const old = await existing(StudioEpisode, req.params.id, req.body.revision);
    const scene = old.scenes.find((s) => s.id === req.params.sceneId);
    if (!scene) fail('Scene not found.', 404);
    if (!scene.script.trim() || !scene.clips.length)
      fail('Write the scene script and plan at least one clip before approval.');
    const assets = await StudioAsset.find().lean();
    if (!scene.soundPlan?.layers?.length)
      fail('Write the scene sound plan before approving a new or revised scene.');
    scene.approval = { approvedAt: new Date(), fingerprint: sceneFingerprint(scene, assets) };
    scene.soundPlan.approval = {
      approvedAt: new Date(),
      fingerprint: soundPlanFingerprint(scene, assets)
    };
    res.json({
      episode: episodeView(await save(StudioEpisode, old, { scenes: old.scenes }), assets)
    });
  });
  router.post('/episodes/:id/scenes/:sceneId/sound-plan/approve', async (req, res) => {
    const old = await existing(StudioEpisode, req.params.id, req.body.revision);
    const scene = old.scenes.find((s) => s.id === req.params.sceneId);
    if (!scene) fail('Scene not found.', 404);
    const assets = await StudioAsset.find().lean();
    if (scene.approval?.fingerprint !== sceneFingerprint(scene, assets))
      fail('Approve the current script together with its sound plan first.');
    if (!scene.soundPlan?.layers?.length) fail('Add at least one planned sound layer.');
    scene.soundPlan.approval = {
      approvedAt: new Date(),
      fingerprint: soundPlanFingerprint(scene, assets)
    };
    res.json({
      episode: episodeView(await save(StudioEpisode, old, { scenes: old.scenes }), assets)
    });
  });
  router.get('/episodes/:id/brief', async (req, res) => {
    const episode = await StudioEpisode.findById(id(req.params.id)).lean();
    if (!episode) fail('Episode not found.', 404);
    const assets = await StudioAsset.find().lean();
    res.attachment('roxy-production-brief.json').json({
      ...episodeView(episode, assets),
      prompts: episode.scenes.flatMap((s) =>
        s.clips.map((c) => ({ scene: s.title, clip: c.title, ...clipPrompts(s, c, assets) }))
      )
    });
  });
  router.post('/prompts', async (req, res) => {
    const episode = episodeInput(req.body);
    const assets = await StudioAsset.find().lean();
    res.json({
      prompts: episode.scenes.flatMap((s) =>
        s.clips.map((c) => ({ sceneId: s.id, clipId: c.id, ...clipPrompts(s, c, assets) }))
      )
    });
  });
  router.get('/episodes/:id/package', async (req, res) => {
    const source = await StudioEpisode.findById(id(req.params.id)).lean();
    if (!source) fail('Episode not found.', 404);
    const assets = await StudioAsset.find().lean();
    const episode = episodeView(source, assets);
    for (const scene of episode.scenes)
      for (const clip of scene.clips) await validateMixedSelection(episode, scene, clip);
    if (
      !episode.scenes.length ||
      episode.scenes.some(
        (s) =>
          s.approvalStatus !== 'approved' ||
          !s.clips.length ||
          s.clips.some((c) => !c.selectedTakeId)
      )
    )
      fail(
        'Approve every scene and select a video take for every clip before exporting the editing package.'
      );
    const linked = assets.filter((a) =>
      episode.scenes.some((s) => s.assetIds.map(String).includes(String(a._id)))
    );
    const ids = [
      ...episode.scenes.flatMap((s) => s.clips.map((c) => c.selectedTakeId)),
      ...episode.scenes.flatMap((s) => s.clips.map((c) => c.selectedDialogueId).filter(Boolean)),
      ...linked.flatMap((a) => a.finalChoice?.mediaIds ?? []),
      ...linked.flatMap((a) => approvedCharacterSheets(a).map((sheet) => sheet.mediaId))
    ];
    for (const scene of episode.scenes)
      for (const layer of scene.soundPlan?.layers ?? []) {
        const sound = assets.find((a) => String(a._id) === String(layer.assetId));
        if (sound?.finalChoice) ids.push(...sound.finalChoice.mediaIds);
      }
    for (const scene of episode.scenes)
      for (const clip of scene.clips) {
        const mixed = await StudioMedia.findById(clip.selectedTakeId).lean();
        if (mixed?.soundMix) {
          ids.push(mixed.soundMix.sourceTakeId, mixed.soundMix.stemMediaId);
        }
      }
    const media = await referencedMedia(ids);
    await sendZip(res, mediaDirectory, media, {
      episode,
      assets: [
        ...linked,
        ...assets.filter(
          (a) =>
            a.kind === 'sound' &&
            episode.scenes.some((s) =>
              s.soundPlan?.layers.some((l) => String(l.assetId) === String(a._id))
            ) &&
            !linked.some((link) => String(link._id) === String(a._id))
        )
      ],
      media: media.map((m) => ({
        id: m._id,
        file: `media/${m._id}-${m.originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
        kind: m.kind
      })),
      editing:
        'Import the selected mixed clips into CapCut. Original sources, dialogue and separate effects stems are included for adjustment; do not stack them on top of the mixed track unless replacing that audio. Add music during final assembly.'
    });
  });
  router.put('/settings', async (req, res) => {
    object(req.body);
    const fields = {
      era: text(req.body.era, 'Era', 200, true),
      targetSeconds: number(req.body.targetSeconds, 'Target runtime', 60, 7200),
      vlogPercent: number(req.body.vlogPercent, 'Vlog percentage', 0, 100),
      monthlyCredits: number(req.body.monthlyCredits, 'Monthly allowance', 0, 10000000),
      imageGeneration: structuredClone(imageGenerationDefaults),
      videoUpscale: structuredClone(videoUpscaleDefaults),
      notes: text(req.body.notes ?? '', 'Series notes', 20000)
    };
    const settings = await StudioSettings.findOneAndUpdate(
      { key: 'series', revision: revision(req.body.revision) },
      { $set: fields, $inc: { revision: 1 } },
      { returnDocument: 'after' }
    ).lean();
    if (!settings) fail('Series settings changed in another tab. Your draft is preserved.', 409);
    res.json({ settings });
  });
  router.use((error, _req, res, next) => {
    if (error.status >= 400 && error.status < 500)
      return res.status(error.status).json({
        message:
          error.type === 'entity.too.large'
            ? 'File or request exceeds the upload limit (250 MB per file).'
            : error.message
      });
    next(error);
  });
  return router;
}
