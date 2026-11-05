import { createHash } from 'node:crypto';

import type { InferSchemaType } from 'mongoose';

import { hasNativeAudio } from '../../shared/audio-policy.ts';
import { characterPackageLayout } from '../../shared/character-package.ts';
import { continuityInput, shotContinuity } from '../../shared/shot-continuity.ts';
import type * as Studio from '../../shared/types.ts';
import { motionInput } from '../../shared/video-readiness.ts';
import { animaticTimingIssue } from './animatic-timing-rules.ts';
import { Job } from './assistant/models.ts';
import {
  StudioAsset,
  StudioEpisode,
  StudioMedia,
  StudioMusicCue,
  StudioReview
} from './models/Studio.ts';
import { musicCandidateCurrent, musicJobCurrent, musicState } from './music-state.ts';
import { activeProject } from './project-context.ts';
import { approvalHash, clipApprovalInputs } from './review-continuity.ts';
import { ambiguousSceneLocation } from './shot-setting.ts';
import { soundPlanReviewInput } from './sound-plan-review.ts';
import { fail, id } from './studio-validation.ts';
import { deliveryMediaId } from './video-policy.ts';
type AssetRow = Studio.PartialRecord<InferSchemaType<typeof StudioAsset.schema>> & {
  _id?: Studio.RecordId;
};
type EpisodeRow = Studio.PartialRecord<InferSchemaType<typeof StudioEpisode.schema>> & {
  _id?: Studio.RecordId;
};
type MediaRow = Studio.PartialRecord<InferSchemaType<typeof StudioMedia.schema>> & {
  _id?: Studio.RecordId;
};
type ReviewRecord = Studio.PartialRecord<InferSchemaType<typeof StudioReview.schema>> & {
  _id?: Studio.RecordId;
};
type JobRow = Studio.PartialRecord<InferSchemaType<typeof Job.schema>> & {
  _id?: Studio.RecordId;
};
type MusicCueRow = Studio.PartialRecord<InferSchemaType<typeof StudioMusicCue.schema>> & {
  _id?: Studio.RecordId;
};
type SceneRow = NonNullable<EpisodeRow['scenes']>[number];
type ClipRow = NonNullable<SceneRow['clips']>[number];
interface WorkflowInput {
  assets: AssetRow[];
  episodes: EpisodeRow[];
  media: MediaRow[];
  reviews: ReviewRecord[];
  jobs?: JobRow[];
  musicCues?: MusicCueRow[];
  musicJobs?: JobRow[];
}
type WorkflowLocation =
  | {
      scope: 'asset';
      parent: AssetRow;
      scene: undefined;
      clip: undefined;
    }
  | {
      scope: 'episode';
      parent: EpisodeRow;
      scene: undefined;
      clip: undefined;
    }
  | {
      scope: 'scene';
      parent: EpisodeRow;
      scene: SceneRow;
      clip: undefined;
    }
  | {
      scope: 'clip';
      parent: EpisodeRow;
      scene: SceneRow;
      clip: ClipRow;
    };
type ReviewEvaluation = Omit<Studio.ReviewRow, 'savedAt'> & {
  savedAt: Date | null;
};
export const workflowEnabled = () => activeProject()?.workflowVersion === 1;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const strings = (values: readonly unknown[] = []) => values.map(String);
const chosen = (asset: Studio.AssetInput) =>
  Boolean(asset?.finalChoice && asset.reviewStatus !== 'pending-choice' && !asset.archived);
export function reviewKey(target: Studio.ReviewTarget, stage: string) {
  return hash({
    scope: target.scope,
    recordId: String(target.recordId),
    sceneId: target.sceneId ?? '',
    clipId: target.clipId ?? '',
    stage
  });
}
export async function workflowContext() {
  const [assets, episodes, media, reviews, jobs, musicCues, musicJobs] = await Promise.all([
    StudioAsset.find().lean(),
    StudioEpisode.find().lean(),
    StudioMedia.find().lean(),
    StudioReview.find().lean(),
    Job.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .select(
        'kind title target status error quote receipt.creditsCharged createdAt resultAssetId resultMediaIds snapshot.transition snapshot.imageIds snapshot.characterReferences settings.mode'
      )
      .lean(),
    StudioMusicCue.find().lean(),
    Job.find({ kind: 'music', status: 'ready' })
      .select(
        'kind status target payload.cueId payload.prompt payload.model payload.targetSeconds payload.generatedSeconds snapshot.fingerprint resultMediaIds'
      )
      .lean()
  ]);
  return evaluateWorkflow({ assets, episodes, media, reviews, jobs, musicCues, musicJobs });
}
export function evaluateWorkflow(
  { assets, episodes, media, reviews, jobs = [], musicCues = [], musicJobs = [] }: WorkflowInput,
  { retainApprovals = true, legacySoundPlanDependencies = false } = {}
) {
  const mediaMap = new Map(media.map((m) => [String(m._id), m]));
  const reviewMap = new Map(reviews.map((r) => [r.targetKey, r]));
  const cache = new Map<string, ReviewEvaluation>();
  const files = (ids = []) =>
    strings(ids).map((mid) => ({
      id: mid,
      sha: mediaMap.get(mid)?.sha256,
      exists: mediaMap.has(mid)
    }));
  const file = (mid, kind: string) => Boolean(mid && mediaMap.get(String(mid))?.kind === kind);
  // A completed receipt proves the legacy brief's generation inputs. Retaining
  // a take additionally requires the original approval of its audio bytes/QC.
  function retainedMusicApproval(stage: string, episode, scene: Studio.SceneInput, cue) {
    const target = targetFor('scene', episode._id, scene.id);
    const plan = reviewMap.get(reviewKey(target, 'music-plan'));
    const take = reviewMap.get(reviewKey(target, 'music'));
    // The caller has already validated the enabled cue, current selection/QC,
    // approved review and its prerequisites. Bind that exact selected take.
    if (stage === 'music-plan')
      return musicJobs.some((job) => musicJobCurrent(episode, scene, cue, job));
    const selected = cue.selectedMediaId;
    const option = cue.candidates.find((candidate) =>
      candidate.mediaIds.map(String).includes(String(selected))
    );
    const approved = approvalHash({
      stage: 'music',
      input: {
        enabled: cue.enabled,
        brief: option.fingerprint,
        selected,
        files: files([selected]),
        qc: option.qc
      },
      dependencies: [
        { key: plan.targetKey, fingerprint: plan.approvalFingerprint ?? plan.fingerprint }
      ]
    });
    return approved === take.approvalFingerprint || approved === take.contentFingerprint;
  }
  function locate<const T extends Studio.ReviewTarget>(
    target: T
  ): Studio.ReviewTarget['scope'] extends T['scope']
    ? {
        scope: T['scope'];
        parent: AssetRow & EpisodeRow;
        scene: SceneRow;
        clip: ClipRow;
      }
    : Extract<
        WorkflowLocation,
        {
          scope: T['scope'];
        }
      >;
  function locate(target: Studio.ReviewTarget): {
    scope: Studio.ReviewTarget['scope'];
    parent: AssetRow & EpisodeRow;
    scene: SceneRow;
    clip: ClipRow;
  };
  function locate(target: Studio.ReviewTarget): WorkflowLocation {
    if (target.scope === 'asset') {
      const parent = assets.find((r) => String(r._id) === String(target.recordId));
      if (!parent) fail('Workflow record not found.', 404);
      return { scope: 'asset' as const, parent, scene: undefined, clip: undefined };
    }
    const parent = episodes.find((r) => String(r._id) === String(target.recordId));
    if (!parent) fail('Workflow record not found.', 404);
    if (target.scope === 'episode')
      return { scope: 'episode' as const, parent, scene: undefined, clip: undefined };
    const scene = parent.scenes?.find((s) => s.id === target.sceneId);
    if (!scene) fail('Workflow scene not found.', 404);
    if (target.scope === 'scene')
      return { scope: 'scene' as const, parent, scene, clip: undefined };
    const clip = scene.clips?.find((c) => c.id === target.clipId);
    if (!clip) fail('Workflow clip not found.', 404);
    return { scope: 'clip' as const, parent, scene, clip };
  }
  const targetFor = <S extends Studio.ReviewTarget['scope']>(
    scope: S,
    recordId: Studio.RecordId,
    sceneId?: string | null,
    clipId?: string | null
  ): Studio.ReviewTarget & {
    scope: S;
  } => ({
    scope,
    recordId: String(recordId),
    ...(sceneId ? { sceneId } : {}),
    ...(clipId ? { clipId } : {})
  });
  function evaluate(target: Studio.ReviewTarget, stage: string): ReviewEvaluation {
    const key = reviewKey(target, stage);
    const cached = cache.get(key);
    if (cached) return cached;
    const { scope, parent, scene, clip } = locate(target);
    let input,
      title,
      valid = true,
      coveredByScene = false;
    const deps: ReviewEvaluation[] = [],
      reasons: string[] = [],
      timingIssues: Studio.TimingIssue[] = [];
    const checkTiming = (c: Studio.ClipInput) => {
      const issue = animaticTimingIssue(
        c,
        mediaMap.get(String(c.selectedDialogueId))?.durationSeconds
      );
      if (issue) {
        timingIssues.push(issue);
        need(false, issue.message);
      }
    };
    const depend = (t: Studio.ReviewTarget, s: string) => {
      const result = evaluate(t, s);
      deps.push(result);
      return result;
    };
    const episodeTarget = targetFor('episode', parent._id);
    const sceneTarget = targetFor('scene', parent._id, scene?.id);
    const need = (condition: unknown, reason: string) => {
      if (!condition) {
        valid = false;
        reasons.push(reason);
      }
    };
    if (scope === 'asset') {
      const p: Studio.ProductionSettings = parent.production ?? {};
      if (stage === 'source') {
        title = 'Source evidence';
        input = {
          sourceMode: p.sourceMode ?? 'footage',
          notes: p.sourceNotes,
          url: p.sourceUrl,
          files: files(p.sourceMediaIds)
        };
        need(
          Boolean(p.sourceNotes?.trim()),
          'Describe the source evidence or the original design decision.'
        );
        need(
          p.sourceMode === 'original' || Boolean(p.sourceUrl || p.sourceMediaIds?.length),
          'Attach source frames or a source URL.'
        );
        need(
          (p.sourceMediaIds ?? []).every((mid) => file(mid, 'image')),
          'Replace missing source images.'
        );
      } else if (stage === 'brief') {
        title = 'Creative brief';
        depend(target, 'source');
        input = {
          name: parent.name,
          kind: parent.kind,
          brief: parent.brief,
          layout: parent.sheetLayout,
          identity: files(parent.identitySourceMediaIds)
        };
        need(Boolean(parent.brief?.trim()), 'Write the creative brief before approval.');
      } else if (stage.startsWith('reference-plan:')) {
        const item = p.items?.find((entry) => entry.id === stage.slice(15));
        if (!item || !item.requiresPlanApproval)
          fail('Reference revision directions not found.', 404);
        title = item.title + ' revision directions';
        depend(target, 'brief');
        input = {
          id: item.id,
          notes: item.notes,
          ...(item.imagePrompt ? { imagePrompt: item.imagePrompt } : {}),
          ...(item.referenceMediaIds?.length ? { referenceMediaIds: item.referenceMediaIds } : {}),
          ...(item.imageReferenceMediaIds !== undefined
            ? { imageReferenceMediaIds: item.imageReferenceMediaIds }
            : {})
        };
        need(
          Boolean(item.imagePrompt?.trim() || item.notes?.trim()),
          'Write the revised image directions.'
        );
      } else if (stage.startsWith('reference:')) {
        const item = p.items?.find((entry) => entry.id === stage.slice(10));
        if (!item) fail('Reference package item not found.', 404);
        title = item.title;
        depend(target, 'brief');
        if (item.requiresPlanApproval) depend(target, 'reference-plan:' + item.id);
        if (parent.sheetLayout === characterPackageLayout && item.id !== 'master-portrait')
          depend(target, 'reference:master-portrait');
        input = { ...item, files: files(item.mediaId ? [item.mediaId] : []) };
        need(
          item.type === 'notes'
            ? Boolean(item.notes?.trim())
            : file(item.mediaId, item.type === 'audio' ? 'audio' : 'image'),
          'Attach the individual reference or write the pronunciation notes.'
        );
        need(!item.mediaId || mediaMap.has(String(item.mediaId)), 'The reference file is missing.');
        if (item.requiresPlanApproval)
          need(
            Boolean(item.mediaId) && item.mediaId !== item.revisionSourceMediaId,
            'Generate and review the replacement image; the previous image is for comparison only.'
          );
        if (parent.sheetLayout === characterPackageLayout && item.id === 'body-turnaround')
          need(
            chosen(parent) && strings(parent.finalChoice.mediaIds).includes(String(item.mediaId)),
            'Finalize this body turnaround in the asset image choices. Other package items are reviewed separately.'
          );
      } else fail('Unknown asset review stage.');
    } else if (scope === 'episode') {
      if (stage === 'source') {
        title = 'Source research';
        input = {
          references: parent.sourceReferences,
          decisions: parent.decisions,
          sourceNotes: parent.production?.sourceNotes
        };
        need(
          activeProject()?.faithfulAdaptation
            ? parent.sourceReferences?.some((r) => r.status === 'verified')
            : Boolean(parent.production?.sourceNotes?.trim()),
          activeProject()?.faithfulAdaptation
            ? 'Review and verify the relevant gameplay source before approval.'
            : 'Write the source research or original story direction.'
        );
      } else if (stage === 'outline') {
        title = 'Episode outline';
        depend(target, 'source');
        input = {
          title: parent.title,
          synopsis: parent.synopsis,
          premise: parent.premise,
          outline: parent.production?.outline,
          outlineNeedsRevision: parent.production?.outlineNeedsRevision
        };
        need(
          Boolean(parent.production?.outline?.trim() || parent.premise?.trim()),
          'Write the episode outline.'
        );
        need(
          !parent.production?.outlineNeedsRevision,
          'Revise the outline for the updated source scope. The replacement outline queues after research approval.'
        );
      } else if (stage === 'export') {
        title = 'CapCut package readiness';
        need(parent.scenes.length > 0, 'Add the episode scenes.');
        for (const s of parent.scenes)
          for (const c of s.clips) {
            depend(targetFor('clip', parent._id, s.id, c.id), 'visual');
            {
              const output = mediaMap.get(String(deliveryMediaId(c, media)));
              need(
                output?.videoVerification?.height >= 1080 && output.videoVerification.audio,
                'Approve a native 1080p video with sound, or retain a previously approved high-resolution delivery file.'
              );
              need(
                file(c.selectedTakeId, 'video'),
                'Approve a finished video soundtrack before export.'
              );
            }
          }
        for (const cue of musicCues.filter(
          (m) => m.enabled && String(m.episodeId) === String(parent._id)
        ))
          depend(targetFor('scene', parent._id, cue.sceneId), 'music');
        need(
          parent.scenes.every((s) => s.clips.length),
          'Every scene needs at least one shot.'
        );
        input = {
          scenes: parent.scenes.map((s) => ({
            id: s.id,
            clips: s.clips.map((c) => ({
              id: c.id,
              selected: c.selectedTakeId,
              upscale: c.production?.upscaleMediaId
            }))
          }))
        };
      } else fail('Unknown episode review stage.');
    } else if (scope === 'scene') {
      const linked = assets.filter((a) => strings(scene.assetIds).includes(String(a._id)));
      const shots = scene.clips.map((c) => ({
        clip: c,
        image: assets.find(
          (a) =>
            !a.archived &&
            String(a.episodeId) === String(parent._id) &&
            a.sceneId === scene.id &&
            a.clipId === c.id
        )
      }));
      if (stage === 'script') {
        title = 'Scene script';
        depend(episodeTarget, 'outline');
        input = {
          title: scene.title,
          style: scene.style,
          location: scene.location,
          script: scene.script,
          sourceIds: scene.sourceReferenceIds,
          sourceNotes: scene.sourceNotes,
          dialogue: scene.clips.map((c) => ({ id: c.id, dialogue: c.dialogue }))
        };
        need(Boolean(scene.script?.trim()), 'Write the scene script.');
        need(
          !activeProject()?.faithfulAdaptation ||
            (scene.sourceReferenceIds?.length &&
              scene.sourceReferenceIds.every((sid) =>
                parent.sourceReferences?.some((r) => r.id === sid && r.status === 'verified')
              )),
          'Link this scene to its reviewed gameplay source.'
        );
      } else if (stage === 'references') {
        title = 'Production references';
        depend(sceneTarget, 'script');
        const visual = linked.filter((a) => a.kind !== 'sound' && !a.clipId);
        input = visual.map((a) => ({
          id: String(a._id),
          choice: a.finalChoice,
          items: a.production?.items
        }));
        need(
          visual.length > 0,
          'Link the characters, costumes, props, sets and voices needed by this scene.'
        );
        for (const a of visual) {
          need(chosen(a), `Finalize ${a.name}.`);
          if (a.production?.managed) depend(targetFor('asset', a._id), 'brief');
          for (const item of a.production?.items?.filter((i) => i.required) ?? [])
            depend(targetFor('asset', a._id), 'reference:' + item.id);
        }
      } else if (stage === 'shot-plan') {
        title = 'Shot plan';
        depend(sceneTarget, 'script');
        input = scene.clips.map((c) => ({
          id: c.id,
          title: c.title,
          duration: c.duration,
          action: c.action,
          dialogue: c.dialogue,
          camera: c.camera,
          sound: c.soundEffects,
          plan: {
            ...continuityInput(c.production),
            ...motionInput(c.production),
            ...(c.production?.location ||
            c.production?.environment ||
            c.production?.physicalConstraints
              ? {
                  location: c.production.location,
                  environment: c.production.environment,
                  physicalConstraints: c.production.physicalConstraints
                }
              : {}),
            framing: c.production?.framing,
            mode: c.production?.mode,
            beats: c.production?.beats,
            passCondition: c.production?.passCondition,
            referenceMediaIds: c.production?.referenceMediaIds
          }
        }));
        need(scene.clips.length > 0, 'Plan at least one shot.');
        for (const c of scene.clips) {
          const continuity = shotContinuity(parent, scene, c, assets);
          need(!continuity.invalidSources.length, continuity.invalidSources.join(' '));
          need(
            !ambiguousSceneLocation(scene) ||
              Boolean(c.production?.location?.trim() && c.production?.environment),
            `Specify ${c.title}'s own location and physical environment; this scene spans orbit and the surface.`
          );
          const approvedIds = linked
            .flatMap((a) => [
              ...(a.finalChoice?.mediaIds ?? []),
              ...(a.production?.items ?? [])
                .filter((i) => i.required && i.type === 'image' && i.mediaId)
                .map((i) => i.mediaId)
            ])
            .map(String);
          need(
            (c.production?.referenceMediaIds ?? []).every(
              (mid) => approvedIds.includes(String(mid)) && file(mid, 'image')
            ),
            `Choose ${c.title}'s reference images from its linked designs and required package views.`
          );
          need(
            Boolean(c.action?.trim() && c.camera?.trim() && c.production?.passCondition?.trim()),
            `Complete action, camera and pass conditions for ${c.title}.`
          );
          need(
            c.production?.mode === (c.dialogue?.trim() ? 'voice-reference' : 'image2video'),
            `Choose the supported generation mode for ${c.title}. Dialogue uses voice-reference mode; silent shots use image-to-video.`
          );
        }
      } else if (stage === 'storyboard' || stage === 'animatic') {
        title = stage === 'storyboard' ? 'Storyboard continuity' : 'Timed animatic';
        depend(sceneTarget, stage === 'storyboard' ? 'shot-plan' : 'storyboard');
        depend(sceneTarget, 'references');
        input = shots.map(({ clip: c, image }) => ({
          id: c.id,
          duration: c.duration,
          image: image?.finalChoice,
          imageFiles: files(image?.finalChoice?.mediaIds),
          ...(stage === 'animatic'
            ? {
                dialogue: c.selectedDialogueId,
                audio: files(c.selectedDialogueId ? [c.selectedDialogueId] : [])
              }
            : {})
        }));
        for (const { clip: c, image } of shots) {
          need(
            chosen(image) &&
              image.finalChoice.mediaIds?.length === 1 &&
              file(image.finalChoice.mediaIds[0], 'image'),
            `Approve one composition for ${c.title}.`
          );
          if (stage === 'animatic' && c.dialogue?.trim()) {
            need(
              file(c.selectedDialogueId, 'audio'),
              `Choose the dialogue performance for ${c.title}.`
            );
            checkTiming(c);
          }
        }
      } else if (stage === 'sound-plan') {
        title = 'Sound plan';
        depend(sceneTarget, 'shot-plan');
        input = soundPlanReviewInput(scene, { legacy: legacySoundPlanDependencies });
        need(
          scene.soundPlan?.layers?.length > 0,
          'Plan ambience and effects before generating video.'
        );
      } else if (stage === 'music-plan' || stage === 'music') {
        const cue = musicCues.find(
          (c) => String(c.episodeId) === String(parent._id) && c.sceneId === scene.id
        );
        const state = musicState(parent, scene, cue);
        title = stage === 'music-plan' ? 'Background music brief' : 'Background music take';
        input = { enabled: cue?.enabled, brief: state.fingerprint };
        need(cue?.enabled, 'Enable a separate background-music cue for this scene.');
        if (stage === 'music-plan') {
          need(Boolean(cue?.prompt?.trim()), 'Write or prepare the complete music prompt.');
          need(
            cue?.bufferSeconds >= 0 && cue.bufferSeconds <= 5,
            'Music padding must be between zero and five seconds.'
          );
          need(
            state.generatedSeconds >= 3 && state.generatedSeconds <= 600,
            'Split music cues longer than ten minutes.'
          );
        } else {
          depend(sceneTarget, 'music-plan');
          const option = cue?.candidates.find((c) =>
            c.mediaIds?.map(String).includes(String(cue.selectedMediaId))
          );
          input.selected = cue?.selectedMediaId;
          input.files = files(cue?.selectedMediaId ? [cue.selectedMediaId] : []);
          input.qc = option?.qc;
          need(
            file(cue?.selectedMediaId, 'audio') &&
              musicCandidateCurrent(parent, scene, cue, option, musicJobs),
            'Choose a current music take for this scene.'
          );
          need(
            option?.qc?.passed === true &&
              Math.abs((option.qc.preparedSeconds ?? 0) - state.targetSeconds) < 0.1,
            'The music must contain enough audible material to cover the scene. Review the silence check.'
          );
        }
      } else fail('Unknown scene review stage.');
    } else {
      const continuity = shotContinuity(parent, scene, clip, assets, media);
      const shotImage = assets.find(
        (a) =>
          !a.archived &&
          String(a.episodeId) === String(parent._id) &&
          a.sceneId === scene.id &&
          a.clipId === clip.id
      );
      const anchors = shotImage?.finalChoice?.continuitySources;
      if (clip.production?.continuityMode === 'explicit' || anchors?.length) {
        for (const error of continuity.errors) need(false, error);
        if (anchors?.length)
          need(
            JSON.stringify(anchors.map((s) => [s.sceneId, s.clipId, s.mediaId])) ===
              JSON.stringify(continuity.sources.map((s) => [s.sceneId, s.clipId, s.mediaId])),
            'The approved continuity source images changed. Review a new composition against the current source shots.'
          );
      }
      if (stage === 'storyboard' || stage === 'animatic') {
        title = stage === 'storyboard' ? 'Storyboard continuity' : 'Timed animatic';
        const image = assets.find(
          (a) =>
            !a.archived &&
            String(a.episodeId) === String(parent._id) &&
            a.sceneId === scene.id &&
            a.clipId === clip.id
        );
        // The owner reviews this shot's plan with its image and timed preview.
        // Editing another shot must not require a new scene-wide plan approval.
        if (stage === 'storyboard') depend(sceneTarget, 'references');
        else depend(target, 'storyboard');
        input = {
          clip: {
            id: clip.id,
            title: clip.title,
            duration: clip.duration,
            action: clip.action,
            dialogue: clip.dialogue,
            camera: clip.camera,
            plan: {
              ...continuityInput(clip.production),
              ...motionInput(clip.production),
              location: clip.production?.location,
              environment: clip.production?.environment,
              physicalConstraints: clip.production?.physicalConstraints,
              mode: clip.production?.mode,
              framing: clip.production?.framing,
              beats: clip.production?.beats,
              passCondition: clip.production?.passCondition,
              referenceMediaIds: clip.production?.referenceMediaIds
            }
          },
          image: image?.finalChoice,
          imageFiles: files(image?.finalChoice?.mediaIds),
          ...(stage === 'animatic'
            ? {
                dialogue: clip.selectedDialogueId,
                audio: files(clip.selectedDialogueId ? [clip.selectedDialogueId] : [])
              }
            : {})
        };
        need(
          chosen(image) &&
            image.finalChoice.mediaIds?.length === 1 &&
            file(image.finalChoice.mediaIds[0], 'image'),
          `Approve one composition for ${clip.title}.`
        );
        if (stage === 'animatic' && clip.dialogue?.trim()) {
          need(
            file(clip.selectedDialogueId, 'audio'),
            `Choose the dialogue performance for ${clip.title}.`
          );
          checkTiming(clip);
        }
        // A current whole-scene review already covers this clip. Independent
        // clip reviews remain usable when a different shot is unfinished.
        coveredByScene = evaluate(sceneTarget, stage).status === 'approved';
      } else if (stage === 'visual') {
        const take = mediaMap.get(String(clip.production?.visualTakeId));
        title = hasNativeAudio(take)
          ? 'Video picture, performance and sound'
          : 'Video picture and performance';
        depend(target, 'animatic');
        need(evaluate(sceneTarget, 'sound-plan').status === 'approved', 'Approve Sound plan.');
        input = {
          takeId: clip.production?.visualTakeId,
          files: files(clip.production?.visualTakeId ? [clip.production.visualTakeId] : []),
          plan: clip.production?.passCondition,
          dialogue: clip.selectedDialogueId
        };
        if (hasNativeAudio(take)) input.nativeAudio = take.nativeAudio;
        if (hasNativeAudio(take) && clip.production?.audioRepairTakeId === String(take._id)) {
          input.audioRepair = true;
          title = 'Video picture and performance (sound repair requested)';
        }
        need(
          strings(clip.takeIds).includes(String(clip.production?.visualTakeId)) &&
            file(clip.production?.visualTakeId, 'video') &&
            !mediaMap.get(String(clip.production?.visualTakeId))?.soundMix,
          'Choose an original video take for visual review.'
        );
      } else fail('Unknown clip review stage.');
    }
    const fingerprint = hash({
      stage,
      input,
      dependencies: deps.map((d) => ({
        key: d.key,
        fingerprint: d.fingerprint,
        revision: d.reviewRevision,
        status: d.status
      }))
    });
    const review = reviewMap.get(key);
    const scoped =
      scope === 'clip'
        ? clipApprovalInputs({ episode: parent, scene, clip, assets, media }, stage)
        : null;
    const sceneScoped =
      scope === 'scene' &&
      [
        'script',
        'references',
        'shot-plan',
        'sound-plan',
        'storyboard',
        'animatic',
        'music-plan',
        'music'
      ].includes(stage);
    const approvalFingerprint = scoped
      ? approvalHash(scoped.input)
      : sceneScoped
        ? approvalHash({
            stage,
            input,
            dependencies: deps
              .filter(
                (d) =>
                  !(stage === 'script' && d.target.scope === 'episode' && d.stage === 'outline') &&
                  !(
                    stage === 'sound-plan' &&
                    !legacySoundPlanDependencies &&
                    d.stage === 'shot-plan'
                  )
              )
              .map((d) => ({ key: d.key, fingerprint: d.approvalFingerprint ?? d.fingerprint })),
            ...(stage === 'script'
              ? {
                  sourceReferences: (parent.sourceReferences ?? []).filter((ref) =>
                    scene.sourceReferenceIds?.includes(ref.id)
                  ),
                  decisions: (parent.decisions ?? []).filter((decision) =>
                    scene.sourceReferenceIds?.includes(decision.sourceId)
                  )
                }
              : {})
          })
        : null;
    const batch =
      scoped && ['storyboard', 'animatic'].includes(stage)
        ? reviewMap.get(reviewKey(sceneTarget, stage))
        : null;
    const batchCovers =
      batch?.state === 'approved' &&
      batch.clipApprovalFingerprints?.[clip.id] === approvalFingerprint &&
      !(
        review &&
        review.state !== 'approved' &&
        new Date(review.reviewedAt) >= new Date(batch.reviewedAt)
      );
    let retained = false;
    if (
      retainApprovals &&
      scope === 'scene' &&
      ['music-plan', 'music'].includes(stage) &&
      review?.state === 'approved' &&
      valid &&
      deps.every((d) => d.status === 'approved')
    ) {
      const cue = musicCues.find(
        (cue) => String(cue.episodeId) === String(parent._id) && cue.sceneId === scene.id
      );
      retained = retainedMusicApproval(stage, parent, scene, cue);
    }
    if (
      retainApprovals &&
      sceneScoped &&
      review?.state === 'approved' &&
      review.approvalFingerprint === approvalFingerprint
    )
      retained =
        valid &&
        deps.every(
          (d) =>
            (stage === 'script' && d.target.scope === 'episode' && d.stage === 'outline') ||
            (stage === 'sound-plan' && d.stage === 'shot-plan') ||
            d.status === 'approved'
        );
    if (
      retainApprovals &&
      scoped &&
      ((review?.state === 'approved' && review.approvalFingerprint === approvalFingerprint) ||
        batchCovers)
    ) {
      const refsReady = scoped.references.every(
        (a) =>
          chosen(a) &&
          (!a.production?.managed ||
            (evaluate(targetFor('asset', a._id), 'brief').status === 'approved' &&
              (a.production?.items ?? [])
                .filter((i) => i.required)
                .every(
                  (i) =>
                    evaluate(targetFor('asset', a._id), 'reference:' + i.id).status === 'approved'
                )))
      );
      const imageReady =
        chosen(scoped.image) &&
        scoped.image.finalChoice.mediaIds?.length === 1 &&
        file(scoped.image.finalChoice.mediaIds[0], 'image');
      retained =
        refsReady &&
        imageReady &&
        (stage === 'storyboard' ||
          (stage === 'animatic' &&
            !timingIssues.length &&
            evaluate(target, 'storyboard').status === 'approved' &&
            (!clip.dialogue?.trim() || file(clip.selectedDialogueId, 'audio'))) ||
          (stage === 'visual' &&
            evaluate(target, 'animatic').status === 'approved' &&
            strings(clip.takeIds).includes(String(clip.production?.visualTakeId)) &&
            file(clip.production?.visualTakeId, 'video')));
    }
    const blocked = deps.filter((d) => d.status !== 'approved');
    const automatic =
      stage === 'references' ||
      (scope === 'asset' &&
        parent.sheetLayout === characterPackageLayout &&
        stage === 'reference:body-turnaround');
    const current = review?.fingerprint === fingerprint;
    const feedbackCurrent =
      current ||
      Boolean(review?.contentFingerprint && review.contentFingerprint === approvalFingerprint);
    const covered = coveredByScene && !(feedbackCurrent && review?.state !== 'approved');
    const status = retained
      ? 'approved'
      : automatic
        ? valid && !blocked.length
          ? 'approved'
          : 'blocked'
        : ((review?.state === 'approved' && current) || covered) && valid && !blocked.length
          ? 'approved'
          : review?.state === 'approved'
            ? 'needs-review'
            : feedbackCurrent && review?.state === 'changes-requested'
              ? 'needs-changes'
              : blocked.length
                ? 'blocked'
                : !valid
                  ? 'draft'
                  : 'pending-review';
    const result: ReviewEvaluation = {
      key,
      target,
      stage,
      title,
      fingerprint,
      status,
      reviewRevision: review?.revision ?? 0,
      parentRevision: parent.revision ?? 0,
      feedback: review?.feedback ?? '',
      lastAction: review
        ? review.state === 'changes-requested'
          ? 'request-changes'
          : review.state === 'approved'
            ? 'approve'
            : 'unapprove'
        : null,
      savedAt: review?.reviewedAt ?? null,
      feedbackIsCurrent: feedbackCurrent,
      ...(approvalFingerprint ? { approvalFingerprint } : {}),
      ...(retained && (!current || !valid || blocked.length) ? { retainedApproval: true } : {}),
      canApprove: valid && !blocked.length && !automatic,
      automatic,
      ...(timingIssues.length ? { timingIssues } : {}),
      prerequisites: [
        ...new Map(
          [
            ...blocked,
            ...(scoped && stage === 'visual'
              ? ['sound-plan']
                  .map((s) => evaluate(sceneTarget, s))
                  .filter((r) => r.status !== 'approved')
              : [])
          ].map((d) => [d.key, d])
        ).values()
      ].map((d) => ({
        key: d.key,
        target: d.target,
        stage: d.stage,
        title: d.title,
        status: d.status
      })),
      ...(covered ? { coveredByScene: true } : {}),
      blockers: retained ? [] : [...reasons, ...blocked.map((d) => `Approve ${d.title}.`)]
    };
    cache.set(key, result);
    return result;
  }
  return { assets, episodes, media, jobs, musicCues, musicJobs, locate, evaluate, targetFor };
}
export async function requireWorkflow(target, stage: string) {
  if (!workflowEnabled()) return null;
  const context = await workflowContext();
  const result = context.evaluate(target, stage);
  if (result.status !== 'approved')
    fail(`${result.title} needs approval. ${result.blockers.join(' ')}`, 409);
  return result.approvalFingerprint ?? result.fingerprint;
}
export async function imageWorkflow(asset: Studio.AssetInput, packageItemId) {
  if (!workflowEnabled()) return null;
  const target = { scope: 'asset' as const, recordId: String(asset._id) };
  let token = await requireWorkflow(target, 'brief');
  if (packageItemId && !asset.production?.items?.some((item) => item.id === packageItemId))
    fail('Reference package item not found.');
  if (asset.production?.items?.find((item) => item.id === packageItemId)?.requiresPlanApproval)
    token = hash([token, await requireWorkflow(target, 'reference-plan:' + packageItemId)]);
  const item = asset.production?.items?.find((entry) => entry.id === packageItemId);
  const selectedReferences = item?.imageReferenceMediaIds ?? item?.referenceMediaIds ?? [];
  if (selectedReferences.length) {
    const hashes = [];
    for (const mid of selectedReferences) {
      const reference = asset.production.items.find(
        (entry) => entry.mediaId === mid && entry.id !== item.id && entry.type === 'image'
      );
      if (!reference && item.imageReferenceMediaIds === undefined)
        fail('Choose approved images from other items in this production package.', 409);
      if (reference) hashes.push(await requireWorkflow(target, 'reference:' + reference.id));
    }
    token = hash([token, hashes]);
  }
  if (
    packageItemId &&
    asset.production.items.find((item) => item.id === packageItemId).type !== 'image'
  )
    fail(
      'Generate image package items here; import audio or write pronunciation notes separately.'
    );
  if (
    packageItemId &&
    ['character', 'droid'].includes(asset.kind) &&
    asset.sheetLayout === characterPackageLayout &&
    packageItemId !== 'master-portrait' &&
    (item?.imageReferenceMediaIds === undefined ||
      item.imageReferenceMediaIds.includes(
        String(asset.production.items.find((entry) => entry.id === 'master-portrait')?.mediaId)
      ))
  )
    return hash([token, await requireWorkflow(target, 'reference:master-portrait')]);
  return token;
}
export async function shotWorkflow(
  episode,
  scene: Studio.SceneInput,
  kind: string,
  clip: Studio.ClipInput
) {
  if (!workflowEnabled()) return null;
  await requireWorkflow({ scope: 'episode' as const, recordId: String(episode._id) }, 'outline');
  const target = { scope: 'scene' as const, recordId: String(episode._id), sceneId: scene.id };
  const stage = kind === 'video' ? 'animatic' : kind === 'image' ? 'references' : 'script';
  return hash([
    await requireWorkflow(
      kind === 'video' ? { ...target, scope: 'clip' as const, clipId: clip.id } : target,
      stage
    ),
    await requireWorkflow(target, kind === 'video' ? 'sound-plan' : 'shot-plan')
  ]);
}
export function validatedTarget(value: unknown): Studio.ReviewTarget {
  if (!value || typeof value !== 'object') fail('Choose a workflow record.');
  const input = value as Record<string, unknown>;
  const scope = input.scope;
  if (scope !== 'asset' && scope !== 'episode' && scope !== 'scene' && scope !== 'clip')
    fail('Choose a workflow record.');
  const target: Studio.ReviewTarget = { scope, recordId: id(input.recordId) };
  for (const name of ['sceneId', 'clipId'] as const) {
    const item = input[name];
    if (item) {
      if (typeof item !== 'string' || !/^[\w-]{1,100}$/.test(item))
        fail('Invalid workflow item ID.');
      target[name] = item;
    }
  }
  return target;
}
