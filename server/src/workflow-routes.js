import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Router } from 'express';

import { hasNativeAudio } from '../../shared/audio-policy.js';
import { nativeAudioPolicy } from '../../shared/audio-policy.js';
import {
  proposalApplication,
  proposalBlocksReview,
  proposalReviewStages
} from '../../shared/production-proposals.js';
import { Proposal } from './assistant/models.js';
import {
  StudioAutomation,
  StudioEpisode,
  StudioMedia,
  StudioMusicCue,
  StudioProject,
  StudioReview
} from './models/Studio.js';
import { musicState } from './music-state.js';
import { validatedTarget, workflowContext, workflowEnabled } from './production-workflow.js';
import { activeProject, projectKey } from './project-context.js';
import { assertMediaAccess, legacyProfile } from './projects.js';
import { validateMixedSelection } from './sound-design.js';
import { sourceEvidence } from './source-evidence.js';
import { mediaView } from './studio-media.js';
import { upscaleForSelection } from './studio-upscale.js';
import { fail, id, object, revision, text } from './studio-validation.js';
import { inspectUpscale } from './upscale-validation.js';
import { inspectNativeVideo, nativeVideoWorkflow, videoReviewStages } from './video-policy.js';
import { finalizeReviewedPackage } from './workflow-automation.js';

export function workflowRouter(mediaDirectory) {
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
  router.post('/upscale/import', async (req, res) => {
    if (nativeVideoWorkflow())
      fail(
        'This project uses native 1080p videos. Import a native video take instead of an upscale.',
        409
      );
    if (!workflowEnabled()) fail('Enable the production approval workflow first.', 409);
    object(req.body);
    const target = validatedTarget(req.body.target);
    if (target.scope !== 'clip') fail('Choose the clip for this upscale.');
    const context = await workflowContext();
    const { parent, scene, clip } = context.locate(target);
    if (parent.revision !== revision(req.body.parentRevision))
      fail(
        'The episode changed. Refresh before importing the upscale; your uploaded file is retained.',
        409
      );
    if (!clip.selectedTakeId || String(clip.selectedTakeId) !== id(req.body.sourceTakeId))
      fail('This upscale must belong to the currently approved video take.', 409);
    if (context.evaluate(target, 'visual').status !== 'approved')
      fail('Approve this clip’s picture and sound before importing its upscale.', 409);
    await validateMixedSelection(parent, scene, clip);
    const mediaId = id(req.body.mediaId);
    await assertMediaAccess([mediaId]);
    const file = context.media.find((m) => String(m._id) === mediaId);
    if (file?.kind !== 'video') fail('Choose a video file for the upscale.');
    if (mediaId === String(clip.selectedTakeId))
      fail('Import the upscaled file, not the original take.');
    const probe = await probeMedia(mediaId);
    const { verified, reasons } = inspectUpscale(probe, clip.duration);
    if (reasons.length)
      fail(
        reasons.join(' ') +
          ' The upload is retained in the media library; it was not linked to this clip.'
      );
    const si = parent.scenes.findIndex((s) => s.id === scene.id);
    const ci = scene.clips.findIndex((c) => c.id === clip.id);
    const snapshot = { ...parent };
    delete snapshot.history;
    const importedAt = new Date().toISOString();
    const result = await StudioEpisode.updateOne(
      { _id: parent._id, revision: parent.revision },
      {
        $set: {
          [`scenes.${si}.clips.${ci}.production.upscaleMediaId`]: mediaId,
          [`scenes.${si}.clips.${ci}.production.upscaleSourceTakeId`]: String(clip.selectedTakeId),
          [`scenes.${si}.clips.${ci}.upscale`]: {
            ...upscaleForSelection(clip, clip),
            sourceTakeId: String(clip.selectedTakeId),
            status: 'imported',
            resultMediaId: mediaId,
            importedAt,
            verified,
            message: 'Upscale saved locally. Review and approve its 1440p quality.'
          }
        },
        $inc: { revision: 1 },
        $push: { history: { $each: [{ ...snapshot, savedAt: new Date() }], $slice: -30 } }
      }
    );
    if (!result.modifiedCount)
      fail(
        'The episode changed while linking the upscale. Refresh and try again; the uploaded file is retained.',
        409
      );
    res.json({ episode: await StudioEpisode.findById(parent._id).lean(), importedAt, mediaId });
  });
  router.post('/board', async (req, res) => {
    const context = await workflowContext();
    const target = validatedTarget(req.body.target);
    const { parent } = context.locate(target);
    let groups;
    if (target.scope === 'asset') {
      groups = [{ title: 'Source and creative brief', target, stages: ['source', 'brief'] }];
      if (parent.production?.items?.length)
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
          target: { scope: 'episode', recordId: target.recordId },
          stages: ['source', 'outline']
        }
      ];
      for (const scene of parent.scenes) {
        const sceneTarget = { scope: 'scene', recordId: target.recordId, sceneId: scene.id };
        groups.push({
          title: scene.title,
          target: sceneTarget,
          stages: ['script', 'references', 'shot-plan', 'sound-plan']
        });
        for (const clip of scene.clips)
          groups.push({
            title: scene.title + ' / ' + clip.title,
            target: { ...sceneTarget, scope: 'clip', clipId: clip.id },
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
      groups.push({
        title: 'Episode delivery',
        target: { scope: 'episode', recordId: target.recordId },
        stages: ['export']
      });
    }
    res.json({
      record: { ...parent, history: undefined },
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
      progress: await req.app.locals.assistant.automation.progress(target),
      automation: await StudioAutomation.find({
        'target.scope': target.scope,
        'target.recordId': target.recordId,
        ...(target.sceneId ? { 'target.sceneId': target.sceneId } : {})
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('status error jobIds createdAt')
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
  router.post('/video/import', async (req, res) => {
    if (!workflowEnabled() || !nativeVideoWorkflow())
      fail('Enable the native 1080p production workflow first.', 409);
    const target = validatedTarget(req.body.target);
    if (target.scope !== 'clip') fail('Choose the clip for this video.');
    const context = await workflowContext(),
      { parent, scene, clip } = context.locate(target);
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
    if (
      current.parentRevision !== revision(req.body.parentRevision) ||
      current.reviewRevision !== revision(req.body.reviewRevision) ||
      current.fingerprint !== req.body.fingerprint
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
      if (option.fingerprint !== musicState(parent, scene, cue).fingerprint)
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
          { scope: 'scene', recordId: String(parent._id), sceneId: scene.id },
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
        if (nativeVideoWorkflow()) {
          const { verified, reasons } = inspectNativeVideo(probe, clip.duration);
          if (reasons.length) fail(reasons.join(' '));
          await StudioMedia.updateOne({ _id: takeId }, { $set: { videoVerification: verified } });
        }
        if (
          (!repair && !probe.streams.some((s) => s.codec_type === 'audio')) ||
          !probe.streams.some((s) => s.codec_type === 'video') ||
          !Number.isFinite(Number(probe.format?.duration)) ||
          Math.abs(Number(probe.format.duration) - clip.duration) > 1
        )
          fail(
            'This take needs a readable soundtrack matching its picture duration. Use sound repair if audio is missing.'
          );
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
                      : takeId,
                    [`scenes.${sceneIndex}.clips.${clipIndex}.upscale`]: upscaleForSelection(
                      { ...clip, selectedTakeId: repair ? null : takeId },
                      clip
                    )
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
    if (req.body.action === 'approve' && !current.canApprove)
      fail(current.blockers.join(' ') || 'This stage is not ready for approval.', 409);
    if (req.body.action === 'approve' && stage === 'animatic') {
      const { scene, clip: selectedClip } = context.locate(target);
      for (const clip of (target.scope === 'clip' ? [selectedClip] : scene.clips).filter((c) =>
        c.dialogue?.trim()
      )) {
        const probe = await probeMedia(clip.selectedDialogueId),
          duration = Number(probe.format?.duration);
        if (!Number.isFinite(duration) || duration > clip.duration + 0.1 || duration > 15.1)
          fail(
            `The selected dialogue for ${clip.title} exceeds its shot duration or Wan's 15-second audio-reference limit. Split or retime the shot before approving the animatic.`
          );
      }
    }
    if (req.body.action === 'approve' && stage === 'upscale') {
      const { parent, scene, clip } = context.locate(target);
      await validateMixedSelection(parent, scene, clip);
      const probe = await probeMedia(clip.production.upscaleMediaId);
      const { reasons } = inspectUpscale(probe, clip.duration);
      if (reasons.length) fail(reasons.join(' '));
    }
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
      clipApprovalFingerprints:
        req.body.action === 'approve' &&
        target.scope === 'scene' &&
        ['storyboard', 'animatic'].includes(stage)
          ? Object.fromEntries(
              context
                .locate(target)
                .scene.clips.map((c) => [
                  c.id,
                  context.evaluate({ ...target, scope: 'clip', clipId: c.id }, stage)
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
    } catch (e) {
      if (e.code === 11000)
        fail('Another tab changed this review. Refresh before continuing.', 409);
      throw e;
    }
    if (!review) fail('Another tab changed this review.', 409);
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
              message: 'Change request saved. No automatic revision or render was started.'
            }
          }
        : {}),
      automation: actions[0] ?? null,
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
