import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Router } from 'express';

import { hasNativeAudio } from '../../shared/audio-policy.ts';
import { nativeAudioPolicy } from '../../shared/audio-policy.ts';
import { toError } from '../../shared/errors.ts';
import { imageReferenceItems, imageReferenceSelection } from '../../shared/image-references.ts';
import {
  proposalApplication,
  proposalBlocksReview,
  proposalReviewStages
} from '../../shared/production-proposals.ts';
import { dialogueDuration, prepareAnimaticTiming } from './animatic-timing.ts';
import { animaticTimingIssue } from './animatic-timing-rules.ts';
import { packageImagePrompt } from './asset-image-prompts.ts';
import { dialogueTurns, speakerAsset } from './assistant/dialogue.ts';
import { Job, Proposal } from './assistant/models.ts';
import { assertNoPendingRevision, proposeVideoRevision } from './assistant/render-revisions.ts';
import { voiceDirection } from './assistant/voice-production.ts';
import {
  StudioAutomation,
  StudioEpisode,
  StudioMedia,
  StudioMusicCue,
  StudioProject,
  StudioReview
} from './models/Studio.ts';
import { musicCandidateCurrent } from './music-state.ts';
import { validatedTarget, workflowContext, workflowEnabled } from './production-workflow.ts';
import { activeProject, projectEra, projectKey } from './project-context.ts';
import { assertMediaAccess, legacyProfile } from './projects.ts';
import { rebaseSceneEdit, sceneEditToken } from './scene-editor.ts';
import { sourceEvidence } from './source-evidence.ts';
import { mediaView } from './studio-media.ts';
import { clipPrompts, productionVideoPrompt } from './studio-prompts.ts';
import { episodeInput, fail, id, object, revision, text } from './studio-validation.ts';
import { deliveryMediaId, inspectNativeVideo, videoReviewStages } from './video-policy.ts';
import { finalizeReviewedPackage } from './workflow-automation.ts';
export function workflowRouter(mediaDirectory: string) {
  const router = Router();
  async function probeMedia(mediaId) {
    await assertMediaAccess([String(mediaId)]);
    const media = await StudioMedia.findById(mediaId).lean();
    if (!media) fail('The reviewed file is missing.');
    try {
      return JSON.parse(
        (
          await promisify(execFile)(
            process.env.FFPROBE_PATH || 'ffprobe',
            [
              '-v',
              'error',
              '-show_entries',
              'stream=codec_type,width,height:format=duration',
              '-of',
              'json',
              join(mediaDirectory, media.filename)
            ],
            { timeout: 20000, maxBuffer: 100000, windowsHide: true }
          )
        ).stdout
      );
    } catch {
      fail('The reviewed media file could not be inspected.');
    }
  }
  router.post('/enable', async (_req, res) => {
    await StudioProject.updateOne(
      { key: projectKey() },
      {
        $set: { workflowVersion: 1 },
        $setOnInsert: projectKey() === legacyProfile.key ? { ...legacyProfile } : {}
      },
      { upsert: true }
    );
    res.json({ enabled: true });
  });
  router.post('/board', async (req, res) => {
    let context = await workflowContext();
    const target = validatedTarget(req.body.target);
    const { parent } = context.locate(target);
    if (target.scope !== 'asset') {
      for (const clip of parent.scenes
        .flatMap((scene) => scene.clips)
        .filter((clip) => clip.dialogue?.trim() && clip.selectedDialogueId))
        await dialogueDuration(clip.selectedDialogueId, mediaDirectory);
      context = await workflowContext();
    }
    let groups;
    if (target.scope === 'asset') {
      groups =
        parent.kind === 'voice'
          ? []
          : [{ title: 'Source and creative brief', target, stages: ['source', 'brief'] }];
      if (parent.kind !== 'voice' && parent.production?.items?.length)
        groups.push({
          title: 'Reference package',
          target,
          stages: parent.production.items.flatMap((item) => [
            ...(item.requiresPlanApproval ? ['reference-plan:' + item.id] : []),
            'reference:' + item.id
          ])
        });
    } else {
      groups = [
        {
          title: 'Episode preparation',
          target: { scope: 'episode' as const, recordId: target.recordId },
          stages: ['source', 'outline']
        }
      ];
      for (const scene of parent.scenes) {
        const sceneTarget = {
          scope: 'scene' as const,
          recordId: target.recordId,
          sceneId: scene.id
        };
        groups.push({
          title: scene.title,
          target: sceneTarget,
          stages: ['script', 'references', 'shot-plan', 'sound-plan']
        });
        for (const clip of scene.clips)
          groups.push({
            title: scene.title + ' / ' + clip.title,
            target: { ...sceneTarget, scope: 'clip' as const, clipId: clip.id },
            stages: videoReviewStages()
          });
        groups.push({
          title: scene.title + ' / Optional whole-scene reviews',
          target: sceneTarget,
          optional: true,
          stages: ['storyboard', 'animatic']
        });
        if (
          context.musicCues.some(
            (c) => c.enabled && String(c.episodeId) === String(parent._id) && c.sceneId === scene.id
          )
        )
          groups.push({
            title: scene.title + ' / Background music',
            target: sceneTarget,
            stages: ['music-plan', 'music']
          });
      }
    }
    res.json({
      record: {
        ...parent,
        history: undefined,
        ...(parent.scenes
          ? {
              scenes: parent.scenes.map((scene) => ({ ...scene, editToken: sceneEditToken(scene) }))
            }
          : {})
      },
      shotPrompts:
        target.scope === 'asset'
          ? []
          : parent.scenes.flatMap((scene) =>
              scene.clips.map((clip) => {
                const prompts = clipPrompts(scene, clip, context.assets, parent);
                const selection = imageReferenceSelection({
                  prompts,
                  referenceIds: clip.production?.referenceMediaIds ?? [],
                  workflow: workflowEnabled()
                });
                return {
                  sceneId: scene.id,
                  clipId: clip.id,
                  image: prompts.image,
                  imageBase: prompts.imageBase,
                  imageReferences: {
                    ...selection,
                    choices: imageReferenceItems(
                      context.media
                        .filter((file) => file.kind === 'image')
                        .map((file) => String(file._id)),
                      {
                        assets: context.assets,
                        media: context.media,
                        continuity: prompts.continuity
                      }
                    ),
                    items: imageReferenceItems(selection.selected, {
                      assets: context.assets,
                      media: context.media,
                      continuity: prompts.continuity
                    }),
                    omittedItems: imageReferenceItems(selection.omitted, {
                      assets: context.assets,
                      media: context.media,
                      continuity: prompts.continuity
                    })
                  },
                  video: productionVideoPrompt(scene, clip, '', {
                    assets: context.assets,
                    media: context.media
                  }),
                  videoBase: productionVideoPrompt(scene, clip, '', {
                    includeTransition: false,
                    assets: context.assets,
                    media: context.media
                  })
                };
              })
            ),
      layout: target.scope === 'asset' ? 'asset' : 'scenes',
      referencePrompts:
        target.scope === 'asset'
          ? (parent.production?.items ?? [])
              .filter((item) => item.type === 'image')
              .map((item) => ({
                itemId: item.id,
                prompt: packageImagePrompt(parent, item, {
                  era: projectEra(),
                  assets: context.assets,
                  workflow: workflowEnabled()
                })
              }))
          : [],
      voicePrompts:
        target.scope === 'asset'
          ? []
          : parent.scenes.flatMap((scene) =>
              scene.clips.flatMap((clip) => {
                let turns = [];
                try {
                  if (clip.dialogue?.trim()) turns = dialogueTurns(clip.dialogue);
                } catch {
                  return [];
                }
                return [...new Set(turns.map((turn) => turn.speaker))].map((speaker) => ({
                  sceneId: scene.id,
                  clipId: clip.id,
                  speaker,
                  prompt: voiceDirection(speaker, context.assets),
                  finalized: Boolean(speakerAsset(speaker, context.assets)?.finalChoice?.voiceId)
                }));
              })
            ),
      enabled: workflowEnabled(),
      sourceEvidence: target.scope === 'asset' ? [] : await sourceEvidence(parent),
      proposals: await Proposal.find({
        status: 'pending',
        ...(target.scope === 'asset'
          ? { assetId: String(parent._id) }
          : { episodeId: String(parent._id) })
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean()
        .then((proposals) =>
          proposals.map((proposal) => ({
            ...proposal,
            application: {
              ...proposalApplication(proposal, parent),
              recordRevision: parent.revision
            },
            reviewStages: proposalReviewStages(proposal, parent)
          }))
        ),
      nextSteps: await req.app.locals.assistant.automation.plan(target),
      blockedSteps: (
        await req.app.locals.assistant.automation.plan(target, { includeBlocked: true })
      ).filter((step) => step.error),
      progress: await req.app.locals.assistant.automation.progress(target).then((progress) =>
        req.body.boardVersion === 3 || target.scope === 'asset'
          ? progress
          : {
              ...progress,
              message:
                'The production board has been updated. Reload this page (Ctrl+F5) for the image, dialogue, prompt, generation and download controls. ' +
                progress.message
            }
      ),
      automation: await StudioAutomation.find({
        'target.scope': target.scope,
        'target.recordId': target.recordId,
        ...(target.sceneId ? { 'target.sceneId': target.sceneId } : {})
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('status error failures target jobIds createdAt')
        .lean(),
      jobs: context.jobs.filter((job) =>
        target.scope === 'asset'
          ? job.target?.assetId === String(parent._id)
          : job.target?.episodeId === String(parent._id)
      ),
      groups: groups.map((group) => ({
        ...group,
        stages: group.stages.map((stage) => context.evaluate(group.target, stage))
      }))
    });
  });
  router.get('/shot/:episodeId/:sceneId/:clipId/video', async (req, res, next) => {
    const target = validatedTarget({
      scope: 'clip' as const,
      recordId: req.params.episodeId,
      sceneId: req.params.sceneId,
      clipId: req.params.clipId
    });
    const context = await workflowContext();
    const { clip } = context.locate(target);
    const candidates = [
      deliveryMediaId(clip, context.media),
      clip.production?.visualTakeId,
      ...(clip.takeIds ?? []).slice().reverse()
    ];
    const file = candidates
      .map((mediaId) =>
        context.media.find((m) => String(m._id) === String(mediaId) && m.kind === 'video')
      )
      .find(Boolean);
    if (!file) fail('This shot has no saved video to download.', 404);
    await assertMediaAccess([String(file._id)]);
    res.attachment(file.originalName).type(file.mime);
    res.sendFile(
      file.filename,
      { root: mediaDirectory, acceptRanges: true, dotfiles: 'deny' },
      (error) => {
        if (error && !res.headersSent) {
          if (toError(error).code === 'ENOENT')
            return res.status(404).type('application/json').json({
              message: 'The video file is missing. Restore it from your backup.'
            });
          next(error);
        }
      }
    );
  });
  router.post('/scene/save', async (req, res) => {
    const target = validatedTarget(req.body.target);
    if (target.scope !== 'scene') fail('Choose one scene to save.');
    const context = await workflowContext();
    const { parent, scene } = context.locate({ ...target, scope: 'scene' as const });
    let input = object(req.body.scene);
    let rebased = false;
    if (req.body.editToken !== sceneEditToken(scene)) {
      if (Array.isArray(input.clips) && sceneEditToken(input) === sceneEditToken(scene))
        return res.json({
          scene: { ...scene, editToken: sceneEditToken(scene) },
          episodeRevision: parent.revision,
          message: 'This scene is already saved. No generation was started.'
        });
      const baseScene = (parent.history ?? [])
        .flatMap((snapshot) => snapshot.scenes ?? [])
        .find((saved) => saved.id === scene.id && sceneEditToken(saved) === req.body.editToken);
      if (!baseScene)
        fail(
          'The original saved version for this local draft is no longer available. Your edits are retained; keep a recovery copy before using the saved scene.',
          409
        );
      const merged = rebaseSceneEdit(baseScene, input, scene);
      if (merged.conflicts.length)
        fail(
          'This scene has conflicting edits: ' +
            merged.conflicts.join('; ') +
            '. Your local draft is retained.',
          409
        );
      input = merged.scene;
      rebased = true;
    }
    if (
      !Array.isArray(input.clips) ||
      input.clips.map((c) => c.id).join('|') !== scene.clips.map((c) => c.id).join('|')
    )
      fail(
        "Save edits to this scene's existing shots here. Use the story editor to add, remove or reorder shots."
      );
    const candidate = {
      ...scene,
      title: input.title,
      location: input.location,
      script: input.script,
      clips: scene.clips.map((old, index: number) => {
        const sent = input.clips[index];
        const production = { ...old.production };
        if (sent.production?.imageReferenceMediaIds !== undefined)
          production.imageReferenceMediaIds = sent.production.imageReferenceMediaIds;
        if (sent.production?.videoReferenceMediaIds !== undefined)
          production.videoReferenceMediaIds = sent.production.videoReferenceMediaIds;
        if (sent.production?.videoEndFrame)
          production.videoEndFrame = sent.production.videoEndFrame;
        else delete production.videoEndFrame;
        for (const field of ['imagePrompt', 'videoPrompt', 'videoTransitionPrompt']) {
          if (sent.production?.[field]?.trim()) production[field] = sent.production[field];
          else delete production[field];
        }
        return {
          ...old,
          title: sent.title,
          duration: sent.duration,
          action: sent.action,
          dialogue: sent.dialogue,
          camera: sent.camera,
          soundEffects: sent.soundEffects,
          production
        };
      })
    };
    const normalized = episodeInput(JSON.parse(JSON.stringify({ ...parent, scenes: [candidate] })))
      .scenes[0];
    const imageIds = normalized.clips.flatMap(
      (clip) => clip.production?.imageReferenceMediaIds ?? []
    );
    await assertMediaAccess(imageIds);
    const videoIds = normalized.clips.flatMap(
      (clip) => clip.production?.videoReferenceMediaIds ?? []
    );
    await assertMediaAccess(videoIds);
    if (
      videoIds.some(
        (id) => !context.media.some((file) => String(file._id) === id && file.kind === 'image')
      )
    )
      fail('Choose available image files for video identity references.');
    if (
      imageIds.some(
        (id) => !context.media.some((file) => String(file._id) === id && file.kind === 'image')
      )
    )
      fail('Choose available image files for the image request references.');
    const next = {
      ...scene,
      title: normalized.title,
      location: normalized.location,
      script: normalized.script,
      production: { ...scene.production, manualGeneration: true },
      clips: scene.clips.map((old, index: number) => {
        const clip = normalized.clips[index];
        const production = { ...old.production };
        if (clip.production.imageReferenceMediaIds !== undefined)
          production.imageReferenceMediaIds = clip.production.imageReferenceMediaIds;
        if (clip.production.videoReferenceMediaIds !== undefined)
          production.videoReferenceMediaIds = clip.production.videoReferenceMediaIds;
        if (clip.production.videoEndFrame) production.videoEndFrame = clip.production.videoEndFrame;
        else delete production.videoEndFrame;
        for (const field of ['imagePrompt', 'videoPrompt', 'videoTransitionPrompt']) {
          if (clip.production[field]) production[field] = clip.production[field];
          else delete production[field];
        }
        return {
          ...old,
          title: clip.title,
          duration: clip.duration,
          action: clip.action,
          dialogue: clip.dialogue,
          camera: clip.camera,
          soundEffects: clip.soundEffects,
          production,
          ...(clip.dialogue !== old.dialogue ? { selectedDialogueId: null } : {})
        };
      })
    };
    const snapshot = { ...parent };
    delete snapshot.history;
    const index = parent.scenes.findIndex((s) => s.id === scene.id);
    const saved = await StudioEpisode.updateOne(
      { _id: parent._id, revision: parent.revision },
      {
        $set: { [`scenes.${index}`]: next },
        $inc: { revision: 1 },
        $push: { history: { $each: [{ ...snapshot, savedAt: new Date() }], $slice: -30 } }
      }
    );
    if (!saved.modifiedCount)
      fail(
        'The episode changed while saving. Your scene draft is retained; try again after refreshing its status.',
        409
      );
    res.json({
      scene: { ...next, editToken: sceneEditToken(next) },
      episodeRevision: parent.revision + 1,
      message:
        (rebased ? 'Your edits were combined with compatible saved changes. ' : '') +
        'Scene saved. Images and videos start only when you choose their Generate buttons. Existing takes are retained.'
    });
  });
  router.post('/shot/image', async (req, res) => {
    const target = validatedTarget(req.body.target);
    if (target.scope !== 'clip') fail('Choose one shot to generate.');
    const context = await workflowContext();
    const { parent, scene, clip } = context.locate({ ...target, scope: 'clip' as const });
    if (parent.revision !== revision(req.body.parentRevision))
      fail('The episode changed. Refresh and review the saved image prompt.', 409);
    const prompts = clipPrompts(scene, clip, context.assets, parent);
    const prompt = prompts.image;
    const imageReferences = imageReferenceSelection({
      prompts,
      referenceIds: clip.production?.referenceMediaIds ?? [],
      workflow: workflowEnabled()
    });
    if (
      req.body.imageReferenceIds !== undefined &&
      JSON.stringify(req.body.imageReferenceIds) !== JSON.stringify(imageReferences.selected)
    )
      fail('The attached images changed. Review the updated attachments before generating.', 409);
    if (req.body.prompt !== prompt)
      fail('The image prompt changed. Save and review it before generating.', 409);
    const requestId = text(req.body.requestId, 'Image request ID', 100, true);
    const previous = await Job.findOne({ requestId }).lean();
    if (previous) {
      if (
        previous.kind !== 'image' ||
        previous.target?.episodeId !== target.recordId ||
        previous.target.sceneId !== scene.id ||
        previous.target.clipId !== clip.id
      )
        fail('That request ID belongs to another render.', 409);
      return res
        .status(202)
        .json({ jobId: String(previous._id), message: 'This image request is already saved.' });
    }
    const active = context.jobs.find(
      (job) =>
        job.kind === 'image' &&
        job.target?.episodeId === String(parent._id) &&
        job.target.sceneId === scene.id &&
        job.target.clipId === clip.id &&
        ['queued', 'preparing', 'submitting', 'rendering', 'importing', 'uncertain'].includes(
          job.status
        )
    );
    if (active)
      fail(
        'An image request already exists for this shot. Review its result or provider history before requesting another.',
        409
      );
    const job = await req.app.locals.assistant.production.queue({
      kind: 'image',
      requestId,
      target: { episodeId: String(parent._id), sceneId: scene.id, clipId: clip.id },
      instructions: '',
      referenceIds: clip.production?.referenceMediaIds ?? []
    });
    res.status(202).json({
      jobId: String(job._id),
      message: 'One image queued. Review the resulting image here before video generation.'
    });
  });
  router.post('/shot/dialogue', async (req, res) => {
    if (!workflowEnabled()) fail('Enable the approval workflow first.', 409);
    const target = validatedTarget(req.body.target);
    if (target.scope !== 'clip') fail('Choose the shot for this dialogue.');
    const context = await workflowContext();
    const { parent, scene, clip } = context.locate({ ...target, scope: 'clip' as const });
    if (parent.revision !== revision(req.body.parentRevision))
      fail('The episode changed. Refresh before choosing dialogue.', 409);
    const mediaId = id(req.body.mediaId);
    if (!clip.dialogueTakeIds?.map(String).includes(mediaId))
      fail('Choose a dialogue take belonging to this shot.', 409);
    await assertMediaAccess([mediaId]);
    if (!context.media.some((m) => String(m._id) === mediaId && m.kind === 'audio'))
      fail('The dialogue audio is missing.', 409);
    const si = parent.scenes.findIndex((s) => s.id === scene.id);
    const ci = scene.clips.findIndex((c) => c.id === clip.id);
    const snapshot = { ...parent };
    delete snapshot.history;
    const saved = await StudioEpisode.updateOne(
      { _id: parent._id, revision: parent.revision },
      {
        $set: { [`scenes.${si}.clips.${ci}.selectedDialogueId`]: mediaId },
        $inc: { revision: 1 },
        $push: { history: { $each: [{ ...snapshot, savedAt: new Date() }], $slice: -30 } }
      }
    );
    if (!saved.modifiedCount)
      fail('The episode changed while saving dialogue. Refresh and try again.', 409);
    res.json({ episode: await StudioEpisode.findById(parent._id).lean() });
  });
  router.post('/shot/dialogue/generate', async (req, res) => {
    const target = validatedTarget(req.body.target);
    if (target.scope !== 'clip') fail('Choose one shot for dialogue generation.');
    const { parent, scene, clip } = (await workflowContext()).locate({
      ...target,
      scope: 'clip' as const
    });
    if (
      parent.revision !== revision(req.body.parentRevision) ||
      req.body.dialogue !== clip.dialogue
    )
      fail('The dialogue changed. Save and review its exact text before generating.', 409);
    const active = await Job.findOne({
      kind: 'dialogue',
      'target.episodeId': String(parent._id),
      'target.sceneId': scene.id,
      'target.clipId': clip.id,
      status: { $in: ['queued', 'preparing', 'submitting', 'rendering', 'importing', 'uncertain'] }
    }).lean();
    if (active)
      return res.status(202).json({
        jobId: String(active._id),
        message: 'This dialogue request is already in progress.'
      });
    const job = await req.app.locals.assistant.production.queue({
      kind: 'dialogue',
      requestId: text(req.body.requestId, 'Dialogue request ID', 100, true),
      target: { episodeId: String(parent._id), sceneId: scene.id, clipId: clip.id },
      instructions: ''
    });
    res.status(202).json({
      jobId: String(job._id),
      message: 'One dialogue performance queued. Review it here when ready.'
    });
  });
  // One explicit owner action reviews composition and playback together. It
  // retains the two versioned audit records without requiring separate screens.
  router.post('/shot/approve', async (req, res) => {
    if (!workflowEnabled()) fail('Enable the approval workflow first.', 409);
    const target = validatedTarget(req.body.target);
    if (target.scope !== 'clip') fail('Choose one shot to approve.');
    let context = await workflowContext();
    const { scene, clip } = context.locate({ ...target, scope: 'clip' as const });
    // Other shots and completed jobs can advance the episode revision. The
    // submitted prompt and this shot's review fingerprints below are the
    // generation contract, rather than that shared counter.
    revision(req.body.parentRevision);
    if (
      req.body.generate === true &&
      req.body.prompt !==
        productionVideoPrompt(scene, clip, '', { assets: context.assets, media: context.media })
    )
      fail('The video prompt changed. Save and review it before generating.', 409);
    await assertNoPendingRevision({
      episodeId: target.recordId,
      sceneId: scene.id,
      clipId: clip.id
    });
    const sceneTarget = { ...target, scope: 'scene' as const, clipId: undefined };
    if (context.evaluate(sceneTarget, 'sound-plan').status !== 'approved')
      fail("Approve this scene's sound plan before generating its video.", 409);
    const working = context.jobs.find(
      (job) =>
        job.kind === 'video' &&
        job.target?.episodeId === target.recordId &&
        job.target.sceneId === scene.id &&
        job.target.clipId === clip.id &&
        ['queued', 'preparing', 'submitting', 'rendering', 'importing', 'uncertain'].includes(
          job.status
        )
    );
    if (working) {
      if (
        working.status !== 'uncertain' &&
        working.target.sceneId === scene.id &&
        working.target.clipId === clip.id
      )
        return res.json({
          status: 'working',
          jobId: String(working._id),
          message: 'This video is already queued or being generated.'
        });
      fail(
        'This shot has a video submission with an unknown outcome. Check its provider history before requesting another take.',
        409
      );
    }
    if (
      req.body.generate !== true &&
      clip.takeIds?.some((id) =>
        context.media.some((m) => String(m._id) === String(id) && m.kind === 'video')
      )
    )
      fail(
        'Review the existing take or prepare a video revision before generating a replacement.',
        409
      );
    if (clip.dialogue?.trim() && clip.selectedDialogueId) {
      const seconds = await dialogueDuration(clip.selectedDialogueId, mediaDirectory, {
        refresh: true
      });
      const timing = animaticTimingIssue(clip, seconds);
      if (timing) fail(timing.message, 409);
    }
    for (const stage of ['storyboard', 'animatic']) {
      const row = context.evaluate(target, stage);
      const expected = req.body.reviews?.[stage];
      if (
        !expected ||
        expected.approvalFingerprint !== row.approvalFingerprint ||
        (row.status !== 'approved' && expected.reviewRevision !== row.reviewRevision)
      )
        fail(
          'This shot review changed. Refresh and review the saved image and dialogue again.',
          409
        );
    }
    let finalRow, finalReview;
    for (const stage of ['storyboard', 'animatic']) {
      context = await workflowContext();
      const row = context.evaluate(target, stage);
      if (row.approvalFingerprint !== req.body.reviews[stage].approvalFingerprint)
        fail('The shot changed during approval. Refresh and review it again.', 409);
      if (row.status === 'approved') {
        finalRow = row;
        finalReview = { revision: row.reviewRevision };
        continue;
      }
      if (!row.canApprove)
        fail(row.blockers.join(' ') || "Complete this shot's prerequisites first.", 409);
      const old = await StudioReview.findOne({ targetKey: row.key }).lean();
      try {
        finalReview = await StudioReview.findOneAndUpdate(
          { targetKey: row.key, revision: row.reviewRevision },
          {
            $set: {
              target,
              stage,
              state: 'approved',
              fingerprint: row.fingerprint,
              approvalFingerprint: row.approvalFingerprint,
              contentFingerprint: row.approvalFingerprint,
              feedback: '',
              reviewedAt: new Date()
            },
            $inc: { revision: 1 },
            $push: {
              history: {
                $each: old
                  ? [
                      {
                        state: old.state,
                        fingerprint: old.fingerprint,
                        approvalFingerprint: old.approvalFingerprint,
                        contentFingerprint: old.contentFingerprint,
                        feedback: old.feedback,
                        reviewedAt: old.reviewedAt
                      }
                    ]
                  : [],
                $slice: -50
              }
            }
          },
          { upsert: !old, returnDocument: 'after' }
        ).lean();
      } catch (caughtError) {
        const error = toError(caughtError);
        if (toError(error).code === 11000)
          fail('Another tab changed this shot review. Refresh before continuing.', 409);
        throw error;
      }
      if (!finalReview) fail('Another tab changed this shot review.', 409);
      finalRow = row;
    }
    if (req.body.generate === true) {
      const latest = await workflowContext();
      const current = latest.locate({ ...target, scope: 'clip' as const });
      if (
        latest.evaluate(sceneTarget, 'sound-plan').status !== 'approved' ||
        ['storyboard', 'animatic'].some(
          (stage) =>
            latest.evaluate(target, stage).approvalFingerprint !==
            req.body.reviews[stage].approvalFingerprint
        ) ||
        req.body.prompt !==
          productionVideoPrompt(current.scene, current.clip, '', {
            assets: latest.assets,
            media: latest.media
          })
      )
        fail(
          'This shot changed while preparing its video. Refresh and review its current prompt before generating.',
          409
        );
      const proposal = await proposeVideoRevision({
        requestId: 'manual-video-' + text(req.body.requestId, 'Video request ID', 100, true),
        target: { episodeId: target.recordId, sceneId: scene.id, clipId: clip.id }
      });
      const job = await req.app.locals.assistant.production.approveRevision(String(proposal._id), {
        generate: true
      });
      res.status(202).json({
        approved: true,
        jobId: String(job._id),
        message:
          'One video queued from the saved prompt. Existing takes are retained for comparison.'
      });
      return;
    }
    const actions = await req.app.locals.assistant.automation.afterApproval(target, {
      stage: 'animatic',
      fingerprint: finalRow.fingerprint,
      reviewRevision: finalReview.revision
    });
    const progress = await req.app.locals.assistant.automation.progress(target);
    res.json({
      approved: true,
      automation: actions[0] ?? null,
      status: actions.length ? 'queued' : progress.state,
      message: actions.length
        ? 'Shot approved. This video is queued for preparation; review its result in this shot card.'
        : 'Shot approval saved. ' + progress.message
    });
  });
  router.post('/animatic/prepare', async (req, res) => {
    if (!workflowEnabled()) fail('Enable the production approval workflow first.', 409);
    const target = validatedTarget(req.body.target);
    if (!['clip', 'scene'].includes(target.scope))
      fail('Choose a shot or scene for timing repair.');
    const { parent, scene } = (await workflowContext()).locate(target);
    if (parent.revision !== revision(req.body.parentRevision))
      fail('The episode changed. Refresh before preparing timing.', 409);
    const proposal = await prepareAnimaticTiming({
      episodeId: String(parent._id),
      sceneId: scene.id,
      clipIds: target.clipId ? [target.clipId] : undefined,
      mediaDirectory
    });
    if (!proposal) fail('No selected dialogue needs splitting or retiming.');
    if (!proposal.timingRepair)
      return res.json({
        pendingDraft: String(proposal._id),
        message:
          'A scene revision draft is already waiting above. Apply or dismiss that draft before preparing a separate timing revision.'
      });
    res.json({
      timingRepair: String(proposal._id),
      message:
        'Timing revision draft ready above. Review and apply it; the animatic has not been approved and no media job has started.'
    });
  });
  router.post('/video/import', async (req, res) => {
    if (!workflowEnabled()) fail('Enable the native 1080p production workflow first.', 409);
    const target = validatedTarget(req.body.target);
    if (target.scope !== 'clip') fail('Choose the clip for this video.');
    const context = await workflowContext(),
      { parent, scene, clip } = context.locate({ ...target, scope: 'clip' as const });
    if (parent.revision !== revision(req.body.parentRevision))
      fail(
        'The episode changed. Refresh before linking the uploaded video; its file is retained.',
        409
      );
    const mediaId = id(req.body.mediaId);
    await assertMediaAccess([mediaId]);
    const file = context.media.find((m) => String(m._id) === mediaId);
    if (file?.kind !== 'video' || file.soundMix)
      fail('Choose an original native 1080p video with its soundtrack.');
    if (
      file.nativeAudio &&
      (file.nativeAudio.episodeId !== String(parent._id) ||
        file.nativeAudio.sceneId !== scene.id ||
        file.nativeAudio.clipId !== clip.id)
    )
      fail('This video already belongs to another clip.');
    const { verified, reasons } = inspectNativeVideo(await probeMedia(mediaId), clip.duration);
    if (reasons.length) fail(reasons.join(' ') + ' The file was retained but not linked.');
    await StudioMedia.updateOne(
      { _id: mediaId },
      {
        $set: {
          videoVerification: verified,
          videoReview: {
            ...file.videoReview,
            state:
              file.videoReview?.state === 'approved' ||
              (String(clip.selectedTakeId) === mediaId &&
                context.evaluate(target, 'visual').status === 'approved')
                ? 'approved'
                : 'pending',
            episodeId: String(parent._id),
            sceneId: scene.id,
            clipId: clip.id
          },
          nativeAudio: {
            ...file.nativeAudio,
            policy: nativeAudioPolicy,
            episodeId: String(parent._id),
            sceneId: scene.id,
            clipId: clip.id,
            source: 'owner-import'
          }
        }
      }
    );
    const si = parent.scenes.findIndex((s) => s.id === scene.id),
      ci = scene.clips.findIndex((c) => c.id === clip.id),
      snapshot = { ...parent, history: undefined };
    if (!clip.takeIds.map(String).includes(mediaId)) {
      const changed = await StudioEpisode.updateOne(
        { _id: parent._id, revision: parent.revision },
        {
          $addToSet: { [`scenes.${si}.clips.${ci}.takeIds`]: mediaId },
          $inc: { revision: 1 },
          $push: { history: { $each: [{ ...snapshot, savedAt: new Date() }], $slice: -30 } }
        }
      );
      if (!changed.modifiedCount)
        fail('The episode changed while importing. Refresh; the uploaded video is retained.', 409);
    }
    res.json({
      episode: await StudioEpisode.findById(parent._id).lean(),
      media: mediaView(await StudioMedia.findById(mediaId).lean()),
      message:
        '1080p video imported and verified. Review this take before approving it; your previous selection is unchanged.'
    });
  });
  router.post('/review', async (req, res) => {
    if (!workflowEnabled()) fail('Enable the approval workflow for this project first.', 409);
    object(req.body);
    const target = validatedTarget(req.body.target);
    const stage = text(req.body.stage, 'Review stage', 150, true);
    let context = await workflowContext();
    let current = context.evaluate(target, stage);
    const sameSoundPlan =
      target.scope === 'scene' &&
      stage === 'sound-plan' &&
      (current.fingerprint === req.body.fingerprint ||
        (current.approvalFingerprint &&
          current.approvalFingerprint === req.body.approvalFingerprint));
    if (
      current.reviewRevision !== revision(req.body.reviewRevision) ||
      (!sameSoundPlan &&
        (current.parentRevision !== revision(req.body.parentRevision) ||
          current.fingerprint !== req.body.fingerprint))
    )
      fail('This review changed. Refresh and review the saved version.', 409);
    if (!['approve', 'request-changes', 'unapprove'].includes(req.body.action))
      fail('Choose a review action.');
    const feedback = text(
      req.body.feedback ?? '',
      'Review feedback',
      4000,
      req.body.action === 'request-changes'
    );
    if (req.body.musicMediaId !== undefined) {
      if (target.scope !== 'scene' || stage !== 'music' || req.body.action !== 'approve')
        fail('A music choice can only accompany music approval.');
      const { parent, scene } = context.locate(target);
      const cue = context.musicCues.find(
        (c) => String(c.episodeId) === String(parent._id) && c.sceneId === scene.id && c.enabled
      );
      const mediaId = id(req.body.musicMediaId);
      const option = cue?.candidates.find((c) => c.mediaIds.map(String).includes(mediaId));
      if (!option?.qc?.passed)
        fail('Choose a music take with enough audible material for this scene.');
      if (!musicCandidateCurrent(parent, scene, cue, option, context.musicJobs))
        fail('This music take belongs to an earlier brief or scene timing.', 409);
      if (context.evaluate(target, 'music-plan').status !== 'approved')
        fail('Approve the current music brief first.', 409);
      await assertMediaAccess([mediaId]);
      const inspected = await probeMedia(mediaId);
      if (
        !inspected.streams.some((s) => s.codec_type === 'audio') ||
        Math.abs(Number(inspected.format?.duration) - option.qc.targetSeconds) > 0.1
      )
        fail('The prepared music file no longer matches the scene duration.');
      if (String(cue.selectedMediaId) !== mediaId) {
        const changed = await StudioMusicCue.updateOne(
          { _id: cue._id, revision: cue.revision },
          { $set: { selectedMediaId: mediaId }, $inc: { revision: 1 } }
        );
        if (!changed.modifiedCount) fail('The music take changed. Refresh before approving.', 409);
        context = await workflowContext();
        current = context.evaluate(target, stage);
      }
    }
    if (
      req.body.takeId !== undefined ||
      (target.scope === 'clip' && stage === 'visual' && req.body.action === 'approve')
    ) {
      if (target.scope !== 'clip' || stage !== 'visual' || req.body.action !== 'approve')
        fail('A video choice can only accompany picture and performance approval.');
      const { parent, scene, clip } = context.locate(target);
      const takeId = text(
        req.body.takeId ?? clip.production?.visualTakeId ?? '',
        'Video take',
        24,
        true
      );
      const media = context.media.find((m) => String(m._id) === takeId);
      if (!clip.takeIds.map(String).includes(takeId) || media?.kind !== 'video' || media.soundMix)
        fail('Choose an original video take belonging to this clip.');
      const prerequisites = [
        context.evaluate(target, 'animatic'),
        context.evaluate(
          { scope: 'scene' as const, recordId: String(parent._id), sceneId: scene.id },
          'sound-plan'
        )
      ];
      if (prerequisites.some((r) => r.status !== 'approved'))
        fail(
          "Complete this clip's prerequisites before picture approval: " +
            prerequisites
              .filter((r) => r.status !== 'approved')
              .map((r) => r.title)
              .join(', ') +
            '.',
          409
        );
      const native = hasNativeAudio(media);
      const repair =
        native &&
        (req.body.audioRepair === true ||
          (req.body.takeId === undefined && clip.production?.audioRepairTakeId === takeId));
      if (native) {
        if (
          media.nativeAudio.episodeId !== String(parent._id) ||
          media.nativeAudio.sceneId !== scene.id ||
          media.nativeAudio.clipId !== clip.id
        )
          fail('This native soundtrack belongs to another clip.');
        const probe = await probeMedia(takeId);
        {
          const { verified, reasons } = inspectNativeVideo(probe, clip.duration, {
            requireAudio: !repair
          });
          if (reasons.length) fail(reasons.join(' '));
          await StudioMedia.updateOne({ _id: takeId }, { $set: { videoVerification: verified } });
        }
      }
      if (
        String(clip.production?.visualTakeId) !== takeId ||
        (native &&
          (String(clip.selectedTakeId) !== takeId || repair || clip.production?.audioRepairTakeId))
      ) {
        const sceneIndex = parent.scenes.findIndex((s) => s.id === scene.id);
        const clipIndex = scene.clips.findIndex((c) => c.id === clip.id);
        const snapshot = { ...parent };
        delete snapshot.history;
        const expectedReviewRevision = current.reviewRevision;
        const result = await StudioEpisode.updateOne(
          { _id: parent._id, revision: current.parentRevision },
          {
            $set: {
              [`scenes.${sceneIndex}.clips.${clipIndex}.production.visualTakeId`]: takeId,
              ...(native
                ? {
                    [`scenes.${sceneIndex}.clips.${clipIndex}.production.audioRepairTakeId`]: repair
                      ? takeId
                      : null,
                    [`scenes.${sceneIndex}.clips.${clipIndex}.selectedTakeId`]: repair
                      ? null
                      : takeId
                  }
                : {})
            },
            $inc: { revision: 1 },
            $push: { history: { $each: [{ ...snapshot, savedAt: new Date() }], $slice: -30 } }
          }
        );
        if (!result.modifiedCount)
          fail('The episode changed. Refresh before approving this take.', 409);
        context = await workflowContext();
        current = context.evaluate(target, stage);
        if (
          current.parentRevision !== parent.revision + 1 ||
          current.reviewRevision !== expectedReviewRevision
        )
          fail('This picture review changed. Refresh before approving it.', 409);
      }
    }
    if (req.body.action === 'approve' && ['episode', 'scene'].includes(target.scope)) {
      const { parent } = context.locate(target);
      const proposals = await Proposal.find({
        episodeId: String(parent._id),
        status: 'pending'
      }).lean();
      if (proposals.some((proposal) => proposalBlocksReview(proposal, stage, parent, target)))
        fail(
          'A revised draft is pending. Apply or dismiss it before approving the saved version.',
          409
        );
    }
    // Verification is an explicit owner decision on individually selected ranges,
    // collected alongside the research instead of hidden in a separate editor.
    if (req.body.verifiedSourceIds !== undefined) {
      const ids = req.body.verifiedSourceIds;
      const { parent } = context.locate(target);
      if (
        req.body.action !== 'approve' ||
        target.scope !== 'episode' ||
        stage !== 'source' ||
        !Array.isArray(ids) ||
        !ids.length ||
        new Set(ids).size !== ids.length ||
        ids.some(
          (id) => typeof id !== 'string' || !parent.sourceReferences.some((r) => r.id === id)
        )
      )
        fail('Select the source ranges you personally reviewed.');
      const snapshot = { ...parent };
      const expectedParentRevision = current.parentRevision + 1;
      const expectedReviewRevision = current.reviewRevision;
      delete snapshot.history;
      const saved = await StudioEpisode.updateOne(
        { _id: parent._id, revision: current.parentRevision },
        {
          $set: {
            sourceReferences: parent.sourceReferences.map((r) =>
              ids.includes(r.id) ? { ...r, status: 'verified' } : r
            )
          },
          $inc: { revision: 1 },
          $push: { history: { $each: [{ ...snapshot, savedAt: new Date() }], $slice: -30 } }
        }
      );
      if (!saved.modifiedCount)
        fail('The episode changed. Refresh before verifying its source.', 409);
      context = await workflowContext();
      current = context.evaluate(target, stage);
      if (
        current.parentRevision !== expectedParentRevision ||
        current.reviewRevision !== expectedReviewRevision
      )
        fail('This source review changed. Refresh before approving it.', 409);
    }
    if (req.body.action === 'approve' && stage === 'animatic') {
      const { parent, scene, clip: selectedClip } = context.locate(target);
      const issues = [];
      for (const clip of (target.scope === 'clip' ? [selectedClip] : scene.clips).filter((c) =>
        c.dialogue?.trim()
      )) {
        if (!clip.selectedDialogueId) continue;
        const duration = await dialogueDuration(clip.selectedDialogueId, mediaDirectory, {
          refresh: true
        });
        const issue = animaticTimingIssue(clip, duration);
        if (issue) issues.push(issue);
      }
      if (issues.length) {
        const proposal = await prepareAnimaticTiming({
          episodeId: String(parent._id),
          sceneId: scene.id,
          clipIds: issues.map((issue) => issue.clipId),
          mediaDirectory
        });
        if (!proposal.timingRepair)
          return res.json({
            pendingDraft: String(proposal._id),
            approved: false,
            message:
              'A scene revision draft is already waiting above. The animatic has not been approved. Apply or dismiss that draft before preparing a separate timing revision.'
          });
        return res.json({
          timingRepair: String(proposal._id),
          approved: false,
          message:
            'The selected dialogue exceeds its shot duration or the 15-second audio-reference limit. A split or retimed shot draft is ready above. Apply the revision and review the resulting performances before approving the animatic.'
        });
      }
    }
    if (req.body.action === 'approve' && !current.canApprove)
      fail(current.blockers.join(' ') || 'This stage is not ready for approval.', 409);
    const old = await StudioReview.findOne({ targetKey: current.key }).lean();
    const fields = {
      target,
      stage,
      state:
        req.body.action === 'approve'
          ? 'approved'
          : req.body.action === 'request-changes'
            ? 'changes-requested'
            : 'draft',
      fingerprint: current.fingerprint,
      approvalFingerprint:
        req.body.action === 'approve' ? (current.approvalFingerprint ?? null) : null,
      contentFingerprint: current.approvalFingerprint ?? null,
      clipApprovalFingerprints:
        req.body.action === 'approve' &&
        target.scope === 'scene' &&
        ['storyboard', 'animatic'].includes(stage)
          ? Object.fromEntries(
              context
                .locate(target)
                .scene.clips.map((c) => [
                  c.id,
                  context.evaluate({ ...target, scope: 'clip' as const, clipId: c.id }, stage)
                    .approvalFingerprint
                ])
            )
          : null,
      feedback,
      reviewedAt: new Date()
    };
    let review;
    try {
      review = await StudioReview.findOneAndUpdate(
        { targetKey: current.key, revision: current.reviewRevision },
        {
          $set: fields,
          $inc: { revision: 1 },
          $push: {
            history: {
              $each: old
                ? [
                    {
                      state: old.state,
                      fingerprint: old.fingerprint,
                      approvalFingerprint: old.approvalFingerprint,
                      contentFingerprint: old.contentFingerprint,
                      clipApprovalFingerprints: old.clipApprovalFingerprints,
                      feedback: old.feedback,
                      reviewedAt: old.reviewedAt
                    }
                  ]
                : [],
              $slice: -50
            }
          }
        },
        { upsert: !old, returnDocument: 'after' }
      ).lean();
    } catch (caughtError) {
      const e = toError(caughtError);
      if (e.code === 11000)
        fail('Another tab changed this review. Refresh before continuing.', 409);
      throw e;
    }
    if (!review) fail('Another tab changed this review.', 409);
    let timingDraft;
    if (
      req.body.action === 'request-changes' &&
      stage === 'animatic' &&
      ['clip', 'scene'].includes(target.scope)
    ) {
      timingDraft = await prepareAnimaticTiming({
        episodeId: target.recordId,
        sceneId: target.sceneId,
        clipIds: target.clipId ? [target.clipId] : undefined,
        mediaDirectory
      });
      if (!timingDraft?.timingRepair) timingDraft = null;
    }
    if (target.scope === 'clip' && stage === 'visual' && req.body.action === 'approve') {
      const { clip } = context.locate(target);
      await StudioMedia.updateOne(
        { _id: clip.production.visualTakeId },
        {
          $set: {
            videoReview: {
              state: 'approved',
              episodeId: target.recordId,
              sceneId: target.sceneId,
              clipId: target.clipId,
              reviewedAt: new Date()
            }
          }
        }
      );
    }
    await finalizeReviewedPackage(target);
    const actions =
      req.body.action === 'approve'
        ? await req.app.locals.assistant.automation.afterApproval(target, {
            stage,
            fingerprint: current.fingerprint,
            reviewRevision: review.revision
          })
        : [];
    res.json({
      review,
      ...(req.body.action === 'request-changes'
        ? {
            receipt: {
              action: 'request-changes',
              savedAt: review.reviewedAt,
              feedback: review.feedback,
              message: timingDraft
                ? 'Change request saved. A timing revision draft is ready for review; no render was started.'
                : 'Change request saved. No automatic revision or render was started.'
            }
          }
        : {}),
      automation: actions[0] ?? null,
      ...(timingDraft
        ? {
            timingRepair: String(timingDraft._id),
            message:
              'Timing revision draft ready above. Review and apply it before approving the animatic.'
          }
        : {}),
      progress: await req.app.locals.assistant.automation.progress(target)
    });
  });
  router.post('/retry', async (req, res) => {
    if (!workflowEnabled()) fail('Enable the approval workflow first.', 409);
    const target = validatedTarget(req.body.target);
    const { parent } = (await workflowContext()).locate(target);
    if (parent.revision !== revision(req.body.parentRevision))
      fail('This record changed. Refresh before retrying.', 409);
    const automation = req.app.locals.assistant.automation;
    if (!(await automation.plan(target, { retryFailed: true })).length)
      fail('No safely retryable submission is ready. Review the existing jobs and approvals.', 409);
    res.json({
      automation: await automation.schedule(target, {
        retryFailed: true,
        requestId: text(req.body.requestId, 'Retry request ID', 100, true)
      })
    });
  });
  router.post('/advance', async (req, res) => {
    if (!workflowEnabled()) fail('Enable the approval workflow first.', 409);
    const target = validatedTarget(req.body.target);
    const context = await workflowContext();
    const { parent } = context.locate(target);
    if (parent.revision !== revision(req.body.parentRevision))
      fail('This record changed. Refresh before starting the next step.', 409);
    const automation = req.app.locals.assistant.automation;
    if (!(await automation.plan(target)).length)
      fail(
        'No automatic step is ready. Review the prerequisites or existing production jobs.',
        409
      );
    res.json({ automation: await automation.schedule(target, { manual: randomUUID() }) });
  });
  router.get('/policy', (_req, res) =>
    res.json({ enabled: workflowEnabled(), project: activeProject()?.name })
  );
  return router;
}
