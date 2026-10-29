import { createHash } from 'node:crypto';

import { hasNativeAudio } from '../../shared/audio-policy.js';
import { characterPackageLayout } from '../../shared/character-package.js';
import { proposalApplication } from '../../shared/production-proposals.js';
import { musicModel, musicPrompt } from '../../shared/scene-music.js';
import { shotContinuity } from '../../shared/shot-continuity.js';
import { Job, Proposal, Run } from './assistant/models.js';
import {
  StudioAsset,
  StudioAutomation,
  StudioEpisode,
  StudioMedia,
  StudioMusicCue,
  StudioProject
} from './models/Studio.js';
import { musicState } from './music-state.js';
import { workflowContext, workflowEnabled } from './production-workflow.js';
import { activeProject, projectKey } from './project-context.js';
import { withProject } from './projects.js';
import { mixState } from './sound-design.js';
import { fail } from './studio-validation.js';
import { videoReviewStages } from './video-policy.js';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const equalTarget = (a, b) =>
  ['assetId', 'packageItemId', 'episodeId', 'sceneId', 'clipId'].every(
    (field) => (a?.[field] ?? '') === (b?.[field] ?? '')
  );
export function workflowAssetStatus(asset, context) {
  const target = { scope: 'asset', recordId: String(asset._id) };
  const rows = [
    'source',
    'brief',
    ...(asset.production.items ?? []).flatMap((i) => [
      ...(i.requiresPlanApproval ? ['reference-plan:' + i.id] : []),
      'reference:' + i.id
    ])
  ].map((stage) => context.evaluate(target, stage));
  if (rows.some((r) => ['pending-review', 'needs-review', 'needs-changes'].includes(r.status)))
    return 'pending-choice';
  if (asset.finalChoice && rows.every((r) => r.status === 'approved')) return 'finalized';
  if (
    asset.candidates?.some(
      (c) => !c.archived && c.mediaIds?.length && c.id !== asset.finalChoice?.id
    )
  )
    return 'pending-choice';
  return 'development';
}

// These are only mechanical steps. The planner never approves a result or writes a story decision.
export function createWorkflowAutomation(production, { queueStory } = {}) {
  async function plan(target, { retryFailed = false } = {}) {
    if (!workflowEnabled()) return [];
    const context = await workflowContext();
    const { parent, scene, clip } = context.locate(target);
    let pendingVideoRevisions = [];
    if (target.scope !== 'asset') {
      const drafts = await Proposal.find({
        episodeId: String(parent._id),
        status: 'pending',
        ...(target.sceneId
          ? {
              $or: [
                { 'scene.id': target.sceneId },
                { 'render.target.sceneId': target.sceneId },
                { scene: { $exists: false }, render: { $exists: false } }
              ]
            }
          : {})
      }).lean();
      if (drafts.some((draft) => !draft.render && proposalApplication(draft, parent).canApply))
        return [];
      pendingVideoRevisions = drafts.filter((draft) => draft.render);
    }
    const requests = [];
    const approved = (stage) => context.evaluate(target, stage).status === 'approved';
    if (target.scope === 'episode' && !retryFailed) {
      const stage = approved('outline') ? 'outline' : approved('source') ? 'source' : null;
      const kind =
        stage === 'outline' && !parent.scenes.length
          ? 'story-scene'
          : stage === 'source' &&
              (parent.production?.outlineNeedsRevision ||
                (!parent.production?.outline?.trim() && !parent.premise?.trim()))
            ? 'story-outline'
            : null;
      if (!kind) {
        const steps = (
          await Promise.all(
            parent.scenes.map((s) =>
              plan({ scope: 'scene', recordId: String(parent._id), sceneId: s.id })
            )
          )
        ).flat();
        let videoAdded = false;
        return steps.filter((step) => {
          if (step.kind !== 'video') return true;
          if (videoAdded) return false;
          videoAdded = true;
          return true;
        });
      }
      if (
        await Proposal.exists({
          episodeId: String(parent._id),
          status: 'pending',
          baseRevision: parent.revision
        })
      )
        return [];
      const fingerprint = context.evaluate(target, stage).fingerprint;
      const requestId =
        'workflow-story-' +
        digest({ project: projectKey(), target, kind, fingerprint, revision: parent.revision });
      if (await Run.exists({ workflowKey: requestId })) return [];
      return [
        {
          kind,
          requestId,
          target: { episodeId: String(parent._id) },
          draft: {
            kind,
            stage,
            fingerprint,
            episodeId: String(parent._id),
            revision: parent.revision
          }
        }
      ];
    }
    if (
      target.scope === 'scene' &&
      !retryFailed &&
      approved('script') &&
      approved('references') &&
      ((context.evaluate(target, 'shot-plan').status !== 'approved' &&
        !context.evaluate(target, 'shot-plan').canApprove) ||
        !scene.soundPlan?.layers?.length)
    ) {
      // Prepare missing plans, never replace a reviewable plan or grant approval.
      if (
        await Proposal.exists({
          episodeId: String(parent._id),
          status: 'pending',
          baseRevision: parent.revision
        })
      )
        return [];
      const fingerprint = context.evaluate(target, 'script').fingerprint;
      const references = context.evaluate(target, 'references').fingerprint;
      const kind = 'story-scene-plan';
      const requestId =
        'workflow-story-' +
        digest({
          project: projectKey(),
          target,
          kind,
          fingerprint,
          references,
          revision: parent.revision
        });
      if (await Run.exists({ workflowKey: requestId })) return [];
      return [
        {
          kind,
          requestId,
          target: { episodeId: String(parent._id), sceneId: scene.id },
          draft: {
            kind,
            stage: 'script',
            fingerprint,
            references,
            sceneId: scene.id,
            episodeId: String(parent._id),
            revision: parent.revision
          }
        }
      ];
    }
    function add(kind, renderTarget, stages, instructions = '', referenceIds = []) {
      const continuity =
        kind === 'image' && renderTarget.clipId
          ? shotContinuity(
              parent,
              scene,
              scene.clips.find((c) => c.id === renderTarget.clipId),
              context.assets,
              context.media
            )
          : null;
      const requestId =
        'workflow-' +
        digest({
          project: projectKey(),
          kind,
          target: renderTarget,
          ...(continuity?.sources.length ? { continuity: continuity.sources } : {}),
          ...(kind === 'video'
            ? { audioPolicy: 'wan-native-effects-v1', videoPassId: parent.videoPass?.id }
            : {}),
          gates: stages.map((gate) =>
            typeof gate === 'string'
              ? context.evaluate(target, gate).fingerprint
              : context.evaluate(gate.target, gate.stage).fingerprint
          )
        });
      requests.push({ requestId, kind, target: renderTarget, instructions, referenceIds });
    }
    if (
      target.scope === 'asset' &&
      approved('brief') &&
      !['voice', 'sound'].includes(parent.kind)
    ) {
      const isCharacter =
        parent.sheetLayout === characterPackageLayout &&
        ['character', 'droid'].includes(parent.kind);
      for (const item of parent.production?.items ?? []) {
        if (item.type !== 'image') continue;
        if (item.requiresPlanApproval && !approved('reference-plan:' + item.id)) continue;
        if (item.mediaId && (!item.requiresPlanApproval || approved('reference:' + item.id)))
          continue;
        const stages = ['brief'];
        if (item.requiresPlanApproval) stages.push('reference-plan:' + item.id);
        if (isCharacter && item.id !== 'master-portrait') {
          if (!approved('reference:master-portrait')) continue;
          stages.push('reference:master-portrait');
        }
        let referencesReady = true;
        for (const mid of item.referenceMediaIds ?? []) {
          const reference = parent.production.items.find(
            (i) => i.mediaId === mid && i.id !== item.id && i.type === 'image'
          );
          if (!reference || !approved('reference:' + reference.id)) {
            referencesReady = false;
            break;
          }
          stages.push('reference:' + reference.id);
        }
        if (!referencesReady) continue;
        add('image', { assetId: String(parent._id), packageItemId: item.id }, stages);
      }
    }
    if (target.scope === 'scene' && approved('shot-plan') && approved('references')) {
      for (const clip of scene.clips) {
        const renderTarget = { episodeId: String(parent._id), sceneId: scene.id, clipId: clip.id };
        const shot = context.assets.find(
          (a) =>
            !a.archived &&
            String(a.episodeId) === String(parent._id) &&
            a.sceneId === scene.id &&
            a.clipId === clip.id
        );
        if (
          !shot?.finalChoice &&
          !shot?.candidates?.some((c) => !c.archived && c.mediaIds?.length) &&
          !shotContinuity(parent, scene, clip, context.assets, context.media).errors.length
        )
          add(
            'image',
            renderTarget,
            ['shot-plan', 'references'],
            '',
            clip.production?.referenceMediaIds ?? []
          );
        if (clip.dialogue?.trim() && !clip.selectedDialogueId && !clip.dialogueTakeIds?.length)
          add('dialogue', renderTarget, ['script', 'shot-plan']);
      }
    }
    if (target.scope === 'scene' && approved('music-plan')) {
      const cue = context.musicCues.find(
        (c) => String(c.episodeId) === String(parent._id) && c.sceneId === scene.id && c.enabled
      );
      if (cue) {
        const fingerprint = context.evaluate(target, 'music-plan').fingerprint;
        const requestId =
          'workflow-music-' + digest({ project: projectKey(), target, fingerprint });
        const state = musicState(parent, scene, cue);
        if (!cue.candidates.some((c) => c.fingerprint === state.fingerprint))
          requests.push({
            kind: 'music',
            musicFingerprint: state.fingerprint,
            requestId,
            target: { episodeId: String(parent._id), sceneId: scene.id },
            args: { episodeId: String(parent._id), sceneId: scene.id, requestId }
          });
      }
    }
    if (['scene', 'clip'].includes(target.scope)) {
      const sceneTarget = { scope: 'scene', recordId: String(parent._id), sceneId: scene.id };
      const clipTarget = (c) => ({ ...sceneTarget, scope: 'clip', clipId: c.id });
      const reviewWaiting = parent.scenes.some((s) =>
        s.clips.some(
          (c) =>
            !(s.id === scene.id && c.id === target.clipId) &&
            c.takeIds?.some((mid) =>
              context.media.some((m) => String(m._id) === String(mid) && m.kind === 'video')
            ) &&
            context.evaluate(
              { scope: 'clip', recordId: String(parent._id), sceneId: s.id, clipId: c.id },
              'visual'
            ).status !== 'approved'
        )
      );
      const inFlight = await Job.exists({
        kind: 'video',
        'target.episodeId': String(parent._id),
        status: {
          $in: ['queued', 'preparing', 'submitting', 'rendering', 'importing', 'uncertain']
        }
      });
      if (
        !reviewWaiting &&
        !inFlight &&
        context.evaluate(sceneTarget, 'sound-plan').status === 'approved'
      ) {
        for (const candidate of scene.clips) {
          if (target.scope === 'clip' && candidate.id !== clip.id) continue;
          if (
            pendingVideoRevisions.some(
              (p) => p.render.target.clipId === candidate.id && p.render.target.sceneId === scene.id
            )
          )
            continue;
          if (candidate.takeIds?.length || candidate.production?.visualTakeId) continue;
          if (context.evaluate(clipTarget(candidate), 'animatic').status !== 'approved') continue;
          add('video', { episodeId: String(parent._id), sceneId: scene.id, clipId: candidate.id }, [
            { target: clipTarget(candidate), stage: 'animatic' },
            { target: sceneTarget, stage: 'sound-plan' }
          ]);
          break;
        }
      }
    }
    if (
      target.scope === 'clip' &&
      approved('visual') &&
      (!hasNativeAudio(
        context.media.find((m) => String(m._id) === String(clip.production?.visualTakeId))
      ) ||
        clip.production?.audioRepairTakeId === clip.production?.visualTakeId) &&
      context.evaluate(
        { scope: 'scene', recordId: target.recordId, sceneId: target.sceneId },
        'sound-plan'
      ).status === 'approved'
    ) {
      try {
        const state = await mixState(parent, scene, clip, clip.production.visualTakeId);
        const cached = await StudioMedia.exists({
          'soundMix.fingerprint': state.fingerprint,
          _id: { $in: clip.takeIds }
        });
        if (!cached)
          requests.push({
            requestId:
              'workflow-' +
              digest({ project: projectKey(), kind: 'mix', fingerprint: state.fingerprint }),
            kind: 'mix',
            target: { episodeId: String(parent._id), sceneId: scene.id, clipId: clip.id },
            args: {
              episodeId: String(parent._id),
              sceneId: scene.id,
              clipId: clip.id,
              revision: parent.revision,
              sourceTakeId: clip.production.visualTakeId
            }
          });
      } catch (e) {
        if (!e.status) throw e;
      }
    }
    const jobs = await Job.find()
      .sort({ createdAt: -1, _id: -1 })
      .select('requestId kind target status historyId snapshot.fingerprint')
      .lean();
    return requests.flatMap((r) => {
      const matching = jobs.filter((j) => j.kind === r.kind && equalTarget(j.target, r.target));
      if (
        r.kind === 'music' &&
        matching.some((j) => j.snapshot?.fingerprint === r.musicFingerprint)
      )
        return [];
      if (
        matching.some((j) =>
          ['queued', 'preparing', 'submitting', 'rendering', 'importing', 'uncertain'].includes(
            j.status
          )
        )
      )
        return [];
      if (retryFailed) {
        if (r.kind === 'music') return [];
        const failed = matching[0];
        if (failed?.status !== 'failed' || failed.historyId) return [];
        return [
          {
            ...r,
            requestId:
              'workflow-retry-' + digest({ base: r.requestId, failed: String(failed._id) }),
            retryOf: String(failed._id)
          }
        ];
      }
      return jobs.some((j) => j.requestId === r.requestId) ? [] : [r];
    });
  }
  async function progress(target) {
    const retrySteps = await plan(target, { retryFailed: true });
    const nextSteps = await plan(target);
    const context = await workflowContext();
    const { parent } = context.locate(target);
    if (['episode', 'scene'].includes(target.scope)) {
      const proposals = await Proposal.find({
        episodeId: String(parent._id),
        status: 'pending',
        ...(target.sceneId
          ? {
              $or: [
                { 'scene.id': target.sceneId },
                { 'render.target.sceneId': target.sceneId },
                { scene: { $exists: false }, render: { $exists: false } }
              ]
            }
          : {})
      })
        .sort({ createdAt: -1 })
        .lean();
      const proposal = proposals.find((draft) => proposalApplication(draft, parent).canApply);
      if (proposal)
        return {
          state: 'review',
          retrySteps,
          nextSteps,
          chatId: String(proposal.chatId),
          proposalId: String(proposal._id),
          message: proposal.render
            ? `Video revision ready for your review: ${proposal.title}. Review the directions, then choose Approve revision & generate video. No render is queued before that approval.`
            : `Draft ready for your review: ${proposal.title}. Review and apply the proposed revision on this board or in production chat, then approve its saved stage.`
        };
      const runs = await Run.find({
        'workflowDraft.episodeId': String(parent._id),
        'workflowDraft.revision': parent.revision,
        ...(target.sceneId ? { 'workflowDraft.sceneId': target.sceneId } : {})
      })
        .sort({ createdAt: -1 })
        .limit(1)
        .lean();
      const run = runs[0];
      if (run && ['preparing', 'queued', 'running', 'failed', 'completed'].includes(run.status)) {
        return {
          state:
            run.status === 'failed' ? 'blocked' : run.status === 'completed' ? 'review' : 'working',
          retrySteps,
          nextSteps,
          chatId: String(run.chatId),
          message:
            run.status === 'failed'
              ? `Story drafting needs attention: ${run.error}`
              : run.status === 'completed'
                ? 'Review the story assistant response in production chat before continuing.'
                : run.workflowDraft.kind === 'story-scene-plan'
                  ? 'The shot and sound plans are being prepared from your approved script and designs through your ChatGPT plan. The draft will appear here for review. Your existing approvals remain saved.'
                  : 'The next story draft is queued or being written through your ChatGPT plan. It will wait for your review; no media generation has started.'
        };
      }
    }
    const history = context.jobs.filter((j) =>
      target.scope === 'asset'
        ? j.target?.assetId === String(parent._id)
        : j.target?.episodeId === String(parent._id) &&
          (!target.sceneId || j.target.sceneId === target.sceneId) &&
          (!target.clipId || j.target.clipId === target.clipId)
    );
    const latest = new Map();
    for (const job of history) {
      const key =
        job.kind +
        ['assetId', 'packageItemId', 'episodeId', 'sceneId', 'clipId']
          .map((k) => job.target?.[k] ?? '')
          .join(':');
      if (!latest.has(key)) latest.set(key, job);
    }
    const jobs = [...latest.values()];
    const working = jobs.filter((j) =>
      ['queued', 'preparing', 'submitting', 'rendering', 'importing'].includes(j.status)
    );
    if (retrySteps.length)
      return {
        state: 'blocked',
        retrySteps,
        nextSteps,
        message: `${retrySteps.length} reference or production request${retrySteps.length === 1 ? ' has' : 's have'} failed. Your approvals are saved. The missing results block the next step; retry the failed requests after resolving their cause.`
      };
    if (working.length)
      return {
        state: 'working',
        retrySteps,
        nextSteps,
        message: `${working.length} production job${working.length === 1 ? ' is' : 's are'} in progress. Results will appear here for review.`
      };
    const revisionReview =
      target.scope === 'asset' && !jobs.some((j) => j.status === 'uncertain')
        ? (parent.production?.items ?? [])
            .filter((i) => i.requiresPlanApproval)
            .map((i) => context.evaluate(target, 'reference-plan:' + i.id))
            .find((row) => row.canApprove && row.status !== 'approved')
        : null;
    if (revisionReview)
      return {
        state: 'review',
        retrySteps,
        nextSteps,
        review: {
          target: revisionReview.target,
          stage: revisionReview.stage,
          title: revisionReview.title
        },
        message: `Revised directions are ready for your review: ${revisionReview.title}. Approving them queues one replacement; the earlier failed request is retained in history.`
      };
    if (jobs.some((j) => ['failed', 'uncertain'].includes(j.status)))
      return {
        state: 'blocked',
        retrySteps,
        nextSteps,
        message: jobs.some((j) => j.status === 'uncertain')
          ? 'A submission has an unknown outcome. Your approvals are saved. Check its OpenArt history before requesting a replacement.'
          : 'A production job failed. Your approvals are saved. Review its job details before requesting a replacement.'
      };
    if (nextSteps.length)
      return {
        state: 'ready',
        retrySteps,
        nextSteps,
        message: 'The next production step is ready to start.'
      };
    const stages =
      target.scope === 'asset'
        ? [
            'source',
            'brief',
            ...(parent.production?.items ?? []).flatMap((i) => [
              ...(i.requiresPlanApproval ? ['reference-plan:' + i.id] : []),
              'reference:' + i.id
            ])
          ]
        : target.scope === 'episode'
          ? ['source', 'outline']
          : target.scope === 'scene'
            ? ['script', 'references', 'shot-plan', 'sound-plan']
            : videoReviewStages();
    const rows = stages.map((s) => context.evaluate(target, s));
    if (target.scope === 'episode' && rows.every((r) => r.status === 'approved'))
      for (const scene of parent.scenes)
        for (const stage of ['script', 'references', 'shot-plan', 'sound-plan'])
          rows.push(
            context.evaluate(
              { scope: 'scene', recordId: String(parent._id), sceneId: scene.id },
              stage
            )
          );
    if (['episode', 'scene'].includes(target.scope))
      for (const s of parent.scenes.filter((s) => !target.sceneId || s.id === target.sceneId))
        for (const c of s.clips)
          for (const stage of videoReviewStages())
            rows.push(
              context.evaluate(
                { scope: 'clip', recordId: String(parent._id), sceneId: s.id, clipId: c.id },
                stage
              )
            );
    for (const cue of context.musicCues.filter(
      (c) =>
        c.enabled &&
        String(c.episodeId) === String(parent._id) &&
        (!target.sceneId || target.sceneId === c.sceneId)
    ))
      for (const stage of ['music-plan', 'music'])
        rows.push(
          context.evaluate(
            { scope: 'scene', recordId: String(parent._id), sceneId: cue.sceneId },
            stage
          )
        );
    if (target.scope === 'episode' && rows.every((r) => r.status === 'approved'))
      rows.push(context.evaluate(target, 'export'));
    const first = rows.find((r) => r.status !== 'approved');
    if (['episode', 'scene'].includes(target.scope) && first)
      return {
        state: 'review',
        retrySteps,
        nextSteps,
        review: { target: first.target, stage: first.stage, title: first.title },
        message: `Next step: ${first.target.sceneId ? parent.scenes.find((s) => s.id === first.target.sceneId)?.title + ' / ' : ''}${first.title}.${first.blockers.length ? ' ' + first.blockers.join(' ') : ' Review and approve the saved draft below.'} Your existing approvals remain saved.`
      };
    const review = rows.find((r) => r.canApprove && r.status !== 'approved');
    if (review)
      return {
        state: 'review',
        retrySteps,
        nextSteps,
        review: { target: review.target, stage: review.stage, title: review.title },
        message: `Ready for your review: ${review.title}.`
      };
    if (target.scope === 'asset' && rows.length && rows.every((r) => r.status === 'approved'))
      return {
        state: 'complete',
        retrySteps,
        nextSteps,
        message:
          'This reference package is approved. Linked scenes will start their next supported step when their remaining prerequisites are approved.'
      };
    if (target.scope === 'asset' && first)
      return {
        state: 'blocked',
        retrySteps,
        nextSteps,
        review: { target: first.target, stage: first.stage, title: first.title },
        message: `Preparation needed: ${first.title}. ${first.blockers.join(' ')} No render is eligible yet. Complete the source evidence and reference package fields, or ask production chat to prepare them for review.`
      };
    if (['episode', 'scene'].includes(target.scope)) {
      const waitingPictures = parent.scenes
        .filter((s) => !target.sceneId || s.id === target.sceneId)
        .flatMap((s) =>
          s.clips.filter(
            (c) =>
              c.takeIds?.some((id) =>
                context.media.some((m) => String(m._id) === String(id) && m.kind === 'video')
              ) &&
              context.evaluate(
                { scope: 'clip', recordId: String(parent._id), sceneId: s.id, clipId: c.id },
                'visual'
              ).status !== 'approved'
          )
        );
      if (waitingPictures.length)
        return {
          state: 'review',
          retrySteps,
          nextSteps,
          message: `${waitingPictures.length} video clip${waitingPictures.length === 1 ? ' is' : 's are'} waiting for picture and performance review. Players and rejection controls are at the top of this episode. Choose a picture take in its clip and approve it on this board before the next automatic video is submitted.`
        };
    }
    return {
      state: 'waiting',
      retrySteps,
      nextSteps,
      message:
        'Waiting for the remaining source, planning or reference approvals shown below. No new render has been started.'
    };
  }
  async function schedule(target, trigger) {
    if (!workflowEnabled() || !['asset', 'episode', 'scene', 'clip'].includes(target.scope))
      return null;
    const key = digest({ project: projectKey(), target, trigger });
    return StudioAutomation.findOneAndUpdate(
      { key },
      {
        $setOnInsert: { target, trigger, status: 'queued', jobIds: [], error: '' }
      },
      { upsert: true, returnDocument: 'after' }
    ).lean();
  }
  async function processNext() {
    const action = await StudioAutomation.findOneAndUpdate(
      {
        $or: [{ status: 'queued' }, { status: 'running', leaseUntil: { $lt: new Date() } }]
      },
      { $set: { status: 'running', leaseUntil: new Date(Date.now() + 60000) } },
      { sort: { createdAt: 1 }, returnDocument: 'after' }
    ).lean();
    if (!action) return;
    await withProject(action.projectKey, async () => {
      try {
        const context = await workflowContext();
        if (action.trigger.stage) {
          const row = context.evaluate(action.target, action.trigger.stage);
          if (row.status !== 'approved' || row.fingerprint !== action.trigger.fingerprint)
            fail(
              'The approved inputs changed. Review the current version before starting production.'
            );
        }
        for (const item of await plan(action.target, {
          retryFailed: action.trigger.retryFailed === true
        })) {
          if (item.kind.startsWith('story-')) {
            if (!queueStory)
              fail('Story drafting is unavailable. Open production chat to continue.');
            await queueStory(item);
            continue;
          }
          let job;
          try {
            job =
              item.kind === 'music'
                ? (await production.music.queue(item.args)).job
                : item.kind === 'mix'
                  ? (await production.sound.queueMix({ ...item.args, requestId: item.requestId }))
                      .job
                  : await production.queue(item);
          } catch (e) {
            if (e.code !== 11000) throw e;
            job = await Job.findOne({ requestId: item.requestId }).lean();
            if (!job) throw e;
          }
          if (!job) continue;
          await StudioAutomation.updateOne(
            { _id: action._id },
            { $addToSet: { jobIds: String(job._id) } }
          );
        }
        await StudioAutomation.updateOne(
          { _id: action._id },
          { $set: { status: 'complete', error: '' } }
        );
        await StudioAutomation.updateMany(
          {
            _id: { $ne: action._id },
            status: 'failed',
            'target.scope': action.target.scope,
            'target.recordId': action.target.recordId,
            'target.sceneId': action.target.sceneId ?? { $exists: false },
            createdAt: { $lte: action.createdAt }
          },
          { $set: { status: 'superseded' } }
        );
      } catch (e) {
        await StudioAutomation.updateOne(
          { _id: action._id },
          {
            $set: {
              status: 'failed',
              error: e.status
                ? e.message
                : 'The next step could not be queued. Check connections and retry the step.'
            }
          }
        );
      }
    });
  }
  async function afterApproval(target, trigger) {
    if (
      activeProject()?.musicWorkflowEnabled &&
      target.scope === 'clip' &&
      trigger.stage === 'visual'
    ) {
      const context = await workflowContext(),
        { parent, scene } = context.locate(target);
      const t = { scope: 'scene', recordId: String(parent._id), sceneId: scene.id };
      if (
        scene.clips.length &&
        scene.clips.every(
          (c) =>
            context.evaluate({ ...t, scope: 'clip', clipId: c.id }, 'visual').status === 'approved'
        )
      )
        await StudioMusicCue.updateOne(
          { episodeId: parent._id, sceneId: scene.id },
          {
            $setOnInsert: {
              enabled: true,
              prompt: musicPrompt(scene),
              bufferSeconds: 5,
              model: musicModel
            }
          },
          { upsert: true }
        );
    }
    const actions = [];
    const targets = [target];
    if (target.scope === 'asset') {
      const context = await workflowContext();
      const image = context.assets.find((a) => String(a._id) === target.recordId && a.clipId);
      for (const episode of context.episodes)
        for (const scene of episode.scenes)
          if (
            scene.assetIds.map(String).includes(target.recordId) ||
            (image && String(image.episodeId) === String(episode._id))
          )
            targets.push({ scope: 'scene', recordId: String(episode._id), sceneId: scene.id });
    }
    if (target.scope === 'clip' && trigger.stage === 'visual')
      targets.push({ scope: 'scene', recordId: target.recordId, sceneId: target.sceneId });
    for (const next of targets)
      if ((await plan(next)).length)
        actions.push(
          await schedule(next, next === target ? trigger : { dependencyApproved: target, trigger })
        );
    return actions;
  }
  async function reconcilePlanning() {
    // Recover a missed handoff after deployment/restart. This only queues restricted
    // planning drafts; it cannot approve anything or start a paid media render.
    const projects = await StudioProject.find({ workflowVersion: 1 }).lean();
    for (const project of projects)
      await withProject(project.key, async () => {
        for (const episode of await StudioEpisode.find().lean())
          for (const scene of episode.scenes) {
            const target = { scope: 'scene', recordId: String(episode._id), sceneId: scene.id };
            for (const item of await plan(target))
              if (item.kind === 'story-scene-plan')
                await schedule(target, { planningRecovery: item.requestId });
          }
      });
  }
  return { plan, progress, schedule, afterApproval, processNext, reconcilePlanning };
}

export async function finalizeReviewedPackage(target) {
  if (target.scope !== 'asset') return;
  const context = await workflowContext();
  const { parent } = context.locate(target);
  if (['character', 'droid'].includes(parent.kind)) return;
  const items = (parent.production?.items ?? []).filter((i) => i.required);
  const images = items.filter((i) => i.type === 'image');
  if (!images.length) return;
  const approved = ['source', 'brief', ...items.map((i) => 'reference:' + i.id)].every(
    (stage) => context.evaluate(target, stage).status === 'approved'
  );
  if (!approved) {
    if (parent.finalChoice?.id?.startsWith('package-'))
      await StudioAsset.updateOne(
        { _id: parent._id, revision: parent.revision },
        {
          $set: { finalChoice: null, reviewStatus: 'development' },
          $inc: { revision: 1 }
        }
      );
    return;
  }
  const mediaIds = images.map((i) => String(i.mediaId));
  if (
    (await StudioMedia.countDocuments({ _id: { $in: mediaIds }, kind: 'image' })) !==
    new Set(mediaIds).size
  )
    return;
  const id = 'package-' + digest(mediaIds);
  if (parent.finalChoice?.id === id) return;
  await StudioAsset.updateOne(
    { _id: parent._id, revision: parent.revision },
    {
      $set: {
        finalChoice: { id, title: 'Approved reference package', mediaIds, finalizedAt: new Date() },
        reviewStatus: null
      },
      $inc: { revision: 1 }
    }
  );
}
