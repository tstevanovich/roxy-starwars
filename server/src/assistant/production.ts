interface ProductionSnapshot {
  fingerprint?: string;
  imageIds?: string[];
  dialogueId?: string;
  characterReferences?: Studio.VideoReference[];
  [key: string]: unknown;
}
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nativeAudioPolicy } from '../../../shared/audio-policy.ts';
import { toError } from '../../../shared/errors.ts';
import { imageReferenceItems, imageReferenceSelection } from '../../../shared/image-references.ts';
import { videoGenerationDefaults } from '../../../shared/production-defaults.ts';
import { proposalApplication } from '../../../shared/production-proposals.ts';
import { withImageReferencePrompt } from '../../../shared/reference-prompt.ts';
import { cleanRenderPrompt } from '../../../shared/render-prompt.ts';
import { shotAssetIds } from '../../../shared/shot-references.ts';
import type * as Studio from '../../../shared/types.ts';
import { videoCharacterReferences } from '../../../shared/video-cast.ts';
import { dialogueDuration } from '../animatic-timing.ts';
import { animaticTimingIssue } from '../animatic-timing-rules.ts';
import { packageImagePrompt, visualImageDirections } from '../asset-image-prompts.ts';
import { StudioAsset, StudioEpisode, StudioMedia } from '../models/Studio.ts';
import { imageWorkflow, shotWorkflow, workflowEnabled } from '../production-workflow.ts';
import { activeProject, legacyProjectKey, projectEra } from '../project-context.ts';
import { assertMediaAccess, withProject } from '../projects.ts';
import { approvedSoundPlan } from '../sound-design.ts';
import { saveGeneratedMedia } from '../studio-media.ts';
import { clipPrompts, productionVideoPrompt } from '../studio-prompts.ts';
import { fail, id, sceneFingerprint, text } from '../studio-validation.ts';
import { dialogueCast } from './dialogue.ts';
import { Job, Proposal, SourceGrant } from './models.ts';
import { createMusicProduction } from './music-production.ts';
import { createReferenceStorage } from './reference-storage.ts';
import { applyVideoRevision, assertNoPendingRevision } from './render-revisions.ts';
import { createSoundProduction } from './sound-production.ts';
import { createVoiceProduction } from './voice-production.ts';

export const defaultMediaDirectory = fileURLToPath(
  new URL('../../../.data/media/', import.meta.url)
);
const productionDirectory = fileURLToPath(new URL('../../../.data/production/', import.meta.url));
const stable = (value) => JSON.stringify(value);
const digest = (value) => createHash('sha256').update(stable(value)).digest('hex');
export async function renderTarget(target, kind: string, revisionProposalId?) {
  const assets = await StudioAsset.find({ archived: { $ne: true } }).lean();
  if (target.episodeId) {
    if (kind === 'video') await assertNoPendingRevision(target, revisionProposalId);
    const episode = await StudioEpisode.findById(id(target.episodeId)).lean();
    const scene = episode?.scenes.find((s) => s.id === target.sceneId);
    const clip = scene?.clips.find((c) => c.id === target.clipId);
    if (!clip) fail('Choose an existing episode, scene and clip.');
    if (
      activeProject()?.faithfulAdaptation &&
      !episode.sourceReferences?.some(
        (ref) => ref.status === 'verified' && scene.sourceReferenceIds?.includes(ref.id)
      )
    )
      fail('Review and verify the linked source chapter before requesting production assets.');
    if (
      !workflowEnabled() &&
      (!scene.approval || scene.approval.fingerprint !== sceneFingerprint(scene, assets))
    )
      fail('Approve the current scene script before requesting production assets.');
    const linked = assets.filter((a) =>
      shotAssetIds(scene, clip, assets).map(String).includes(String(a._id))
    );
    if (linked.some((a) => !a.finalChoice || a.reviewStatus === 'pending-choice'))
      fail('Finalize the scene’s linked references first.');
    const shot = assets.find(
      (a) =>
        String(a.episodeId) === String(episode._id) &&
        a.sceneId === scene.id &&
        a.clipId === clip.id
    );
    const imageIds = shot?.finalChoice?.mediaIds?.map(String) ?? [];
    if (kind === 'video' && shot?.reviewStatus === 'pending-choice')
      fail('Review the pending shot image choice before generating video.');
    if (
      kind === 'video' &&
      (await Job.exists({
        kind: { $in: ['image', 'dialogue'] },
        'target.episodeId': target.episodeId,
        'target.sceneId': target.sceneId,
        'target.clipId': target.clipId,
        status: {
          $in: ['queued', 'preparing', 'submitting', 'rendering', 'importing', 'uncertain']
        }
      }))
    )
      fail('Wait for the requested image or dialogue, then approve it before generating video.');
    if (kind === 'video' && imageIds.length !== 1)
      fail('Approve one shot image for this clip before generating video.');
    if (kind === 'video' && clip.dialogue?.trim() && !clip.selectedDialogueId)
      fail('Choose the ElevenLabs dialogue performance before generating video.');
    if (kind === 'video') approvedSoundPlan(scene, assets);
    const videoMedia =
      kind === 'video' ? await StudioMedia.find().select('_id kind sha256').lean() : [];
    const characterReferences =
      kind === 'video' ? videoCharacterReferences(scene, clip, assets, videoMedia) : [];
    if (
      kind === 'video' &&
      clip.dialogue?.trim() &&
      clip.production?.videoReferenceMediaIds !== undefined &&
      characterReferences.length !== clip.production.videoReferenceMediaIds.length
    )
      fail(
        'A selected video identity reference is no longer approved or available. Remove it or choose a current reference in this shot.'
      );
    const prompts = clipPrompts(scene, clip, assets, episode);
    if (kind === 'image' && prompts.continuity.errors.length)
      fail(prompts.continuity.errors.join(' '), 409);
    const snapshot: ProductionSnapshot = {
      ...(kind === 'image' || kind === 'video'
        ? {
            renderPrompt:
              kind === 'video'
                ? productionVideoPrompt(scene, clip, '', { characterReferences })
                : prompts.image
          }
        : {}),
      ...(workflowEnabled() ? { workflow: await shotWorkflow(episode, scene, kind, clip) } : {}),
      fingerprint: sceneFingerprint(scene, assets),
      imageIds,
      ...(characterReferences.length
        ? {
            characterReferences: characterReferences.map((reference) => ({
              ...reference,
              sha: videoMedia.find((file) => String(file._id) === reference.mediaId)?.sha256
            }))
          }
        : {}),
      dialogueId: clip.selectedDialogueId ? String(clip.selectedDialogueId) : null
    };
    if (kind === 'image' && prompts.continuity.sources.length)
      snapshot.continuity = {
        sources: prompts.continuity.sources,
        notes: prompts.continuity.notes
      };
    if (kind === 'video') {
      snapshot.audioPolicy = nativeAudioPolicy;
      if (episode.videoPass?.id) snapshot.videoPassId = episode.videoPass.id;
    }
    const speaker = kind === 'dialogue' ? dialogueCast(clip, assets) : null;
    if (speaker) snapshot.voices = speaker.voices;
    return { episode, scene, clip, shot, assets, prompts, snapshot, speaker };
  }
  if (kind !== 'image') fail('Choose a clip for video or dialogue generation.');
  const asset = assets.find((a) => String(a._id) === id(target.assetId));
  if (!asset) fail('Choose an existing creative-library asset.');
  if (['voice', 'sound'].includes(asset.kind)) fail('Choose a visual asset for image generation.');
  const workflow = await imageWorkflow(asset, target.packageItemId);
  return {
    asset,
    assets,
    snapshot: (target.packageItemId
      ? {
          workflow,
          item: asset.production.items.find((item) => item.id === target.packageItemId),
          identitySourceMediaIds: asset.identitySourceMediaIds,
          sourceMediaIds: asset.production.sourceMediaIds
        }
      : {
          revision: asset.revision,
          finalChoice: asset.finalChoice,
          ...(workflow ? { workflow } : {})
        }) as ProductionSnapshot
  };
}

// Read provenance only for a media hash that is still in the live library. Rejected files are never restored.
let legacyReferences;
async function referenceIndex() {
  if (legacyReferences) return legacyReferences;
  const index = new Map();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    const ref = value.reference ?? value.visualReference;
    if (value.sha256 && ref?.url?.startsWith('https://cdn.openart.ai/') && ref.id)
      index.set(value.sha256, ref);
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  }
  async function walk(directory: string, depth = 0) {
    if (depth > 7) return;
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory()) await walk(join(directory, entry.name), depth + 1);
      else if (entry.name.endsWith('manifest.json')) {
        try {
          visit(JSON.parse(await readFile(join(directory, entry.name), 'utf8')));
        } catch {
          /* Older, partial manifests are not authoritative. */
        }
      }
    }
  }
  await walk(productionDirectory);
  legacyReferences = index;
  return index;
}

export function createProduction({
  openart,
  store,
  mediaDirectory = defaultMediaDirectory,
  fetcher = fetch
}) {
  const sound = createSoundProduction({ mediaDirectory, fetcher });
  const music = createMusicProduction({ mediaDirectory, fetcher });
  const references = createReferenceStorage({ openart, store, mediaDirectory, fetcher });
  const voices = createVoiceProduction({ mediaDirectory, fetcher });
  async function reference(mediaId, job) {
    await assertMediaAccess([mediaId]);
    const media = await StudioMedia.findById(id(mediaId)).lean();
    if (!media) fail('A required reference was deleted. Choose a replacement.');
    const known = media.providerReference ?? (await referenceIndex()).get(media.sha256);
    if (known?.id && /^https:\/\/cdn\.openart\.ai\//.test(known.url))
      return { ...known, type: media.kind, label: media.originalName };
    return references.reference(mediaId, job.kind === 'video' ? 'create-video' : 'create-image');
  }
  function videoPrompt(state, instructions: string) {
    const prompt = productionVideoPrompt(state.scene, state.clip, instructions, {
      characterReferences: state.snapshot.characterReferences ?? []
    });
    if (prompt.length > 4500)
      fail(
        `Video prompt is ${prompt.length} characters; Wan allows 4500. Shorten the clip directions or requested changes before rendering. No directions were truncated.`
      );
    return prompt;
  }
  async function queue({
    chatId = undefined,
    runId = undefined,
    requestId,
    retryOf = undefined,
    revisionProposalId = undefined,
    kind,
    target,
    speaker = undefined,
    instructions = '',
    referenceIds = []
  }) {
    if (kind === 'voice') return voices.queue({ target, speaker, requestId, chatId });
    if (!['image', 'video', 'dialogue'].includes(kind)) fail('Choose image, video or dialogue.');
    text(instructions, 'Render instructions', 6000);
    if (!Array.isArray(referenceIds) || referenceIds.length > 12)
      fail('Choose at most 12 saved references.');
    referenceIds.forEach(id);
    const previous = await Job.findOne({ requestId }).lean();
    if (previous) return previous;
    const state = await renderTarget(target, kind, revisionProposalId);
    if (kind === 'video' && state.clip.dialogue?.trim()) {
      const issue = animaticTimingIssue(
        state.clip,
        await dialogueDuration(state.clip.selectedDialogueId, mediaDirectory, { refresh: true })
      );
      if (issue) fail(issue.message + ' Review the timing revision before generating video.', 409);
    }
    if (kind === 'video')
      await validateRevision({ target, instructions, referenceIds, revisionProposalId }, state);
    if (kind === 'video') videoPrompt(state, instructions);
    const secrets = await store.read();
    if (kind !== 'dialogue' && !secrets.openart?.tokens)
      fail('Connect OpenArt in Production chat → Connections first.');
    if (kind === 'dialogue' && !process.env.ELEVENLABS_API_KEY)
      fail('The server’s ElevenLabs API key is not configured.');
    if (kind === 'video' && !state.clip.dialogue?.trim() && instructions.length > 3000)
      fail('Keep video directions under 3000 characters.');
    return (
      await Job.create({
        chatId,
        runId,
        requestId,
        ...(retryOf ? { retryOf } : {}),
        ...(revisionProposalId ? { revisionProposalId } : {}),
        kind,
        target,
        instructions,
        referenceIds,
        title: `${kind === 'dialogue' ? 'Dialogue' : kind === 'image' ? 'Image' : 'Video'} · ${state.clip?.title ?? state.asset.name}${target.packageItemId ? ' · ' + state.asset.production.items.find((i) => i.id === target.packageItemId).title : ''}`,
        snapshot: state.snapshot,
        status: 'queued'
      })
    ).toObject();
  }
  async function build(job): Promise<{
    state: Awaited<ReturnType<typeof renderTarget>>;
    model?: string;
    mode?: string;
    params?: {
      prompt?: string;
      visualReferences?: Record<string, unknown>[];
      startFrame?: Record<string, unknown>;
      endFrame?: Record<string, unknown>;
      [key: string]: unknown;
    };
  }> {
    const state = await renderTarget(job.target, job.kind, job.revisionProposalId);
    if (job.kind === 'video' && state.clip.dialogue?.trim()) {
      const issue = animaticTimingIssue(
        state.clip,
        await dialogueDuration(state.clip.selectedDialogueId, mediaDirectory, { refresh: true })
      );
      if (issue) fail(issue.message + ' Review the timing revision before generating video.', 409);
    }
    if (job.kind === 'video') await validateRevision(job, state);
    if (digest(state.snapshot) !== digest(job.snapshot))
      fail(
        'Creative choices changed after this request. Request a new render using the latest approvals.'
      );
    if (job.kind === 'dialogue') return { state };
    let refs = [...job.referenceIds];
    if (job.kind === 'video')
      refs = [
        ...state.snapshot.imageIds,
        ...(state.snapshot.characterReferences?.map((reference) => reference.mediaId) ?? []),
        ...(state.snapshot.dialogueId ? [state.snapshot.dialogueId] : [])
      ];
    else {
      const selection = imageReferenceSelection({
        asset: state.asset,
        prompts: state.prompts,
        packageItemId: job.target.packageItemId,
        referenceIds: refs,
        workflow: workflowEnabled()
      });
      refs = selection.selected;
      if (selection.omitted.length)
        await Job.updateOne(
          { _id: job._id },
          { $set: { 'payload.referenceSelection': selection } }
        );
    }
    if (
      job.kind === 'image' &&
      (await StudioMedia.exists({ _id: { $in: refs }, kind: { $ne: 'image' } }))
    )
      fail('Image generation accepts image references only. Choose the approved image views.');
    let prompt =
      job.kind === 'video'
        ? videoPrompt(state, job.instructions)
        : job.target.packageItemId
          ? ''
          : (state.prompts?.[job.kind] ??
            `Star Wars universe, ${projectEra()}. Photorealistic live-action reference. ${state.asset.name}: ${visualImageDirections(state.asset.brief)} ${visualImageDirections(state.asset.notes)}`);
    if (
      job.kind === 'image' &&
      ['character', 'droid', 'prop', 'wardrobe'].includes(state.asset?.kind) &&
      !job.target.packageItemId
    )
      prompt +=
        state.asset.kind === 'prop'
          ? '\nCreate a coherent multiview PROP SHEET: both sides, top, rear, grip and blade/emitter details with consistent scale. Consistent design across views. No labels, text or captions.'
          : '\nCreate a production BODY TURNAROUND: the same single character in complete front, three-quarter, side profile and rear full-body views, heads and feet visible in every view. One character and one outfit, consistent face, hair, proportions, clothing and materials. Neutral standing poses, hands visible, plain light-gray background and even lighting. No inset portraits, readable text, labels or scenery. Clothing must follow the reviewed source or an explicitly approved wardrobe brief; never invent an interim costume.';
    if (
      job.kind !== 'video' &&
      !job.target.packageItemId &&
      !state.clip?.production?.imagePrompt &&
      job.instructions?.trim()
    )
      prompt += '\nREQUESTED CHANGES: ' + job.instructions;
    if (
      job.kind === 'image' &&
      !job.target.packageItemId &&
      workflowEnabled() &&
      state.asset?.production?.sourceNotes
    )
      prompt += '\nVISUAL DETAILS: ' + visualImageDirections(state.asset.production.sourceNotes);
    if (job.target.packageItemId) {
      const item = state.asset.production.items.find((i) => i.id === job.target.packageItemId);
      if (
        item.imagePrompt?.trim() &&
        job.instructions?.trim() &&
        job.instructions.trim() !== item.imagePrompt.trim()
      )
        fail(
          'Revise and approve the saved image prompt before adding different render instructions.',
          409
        );
      prompt = packageImagePrompt(state.asset, item, {
        era: projectEra(),
        instructions: job.instructions,
        assets: state.assets,
        workflow: workflowEnabled()
      });
    }
    prompt = cleanRenderPrompt(prompt);
    const imageItems =
      job.kind === 'image'
        ? imageReferenceItems(refs, { assets: state.assets, continuity: state.prompts?.continuity })
        : [];
    if (job.kind === 'image') prompt = withImageReferencePrompt(prompt, imageItems);
    let visualReferences = await Promise.all(refs.map((mid) => reference(mid, job)));
    if (job.kind === 'image')
      visualReferences = visualReferences.map((ref, index) => ({
        ...ref,
        // OpenArt adds the @ prefix to attachment labels in its editor.
        label: `image${index + 1} - ${imageItems[index].subject || imageItems[index].role}`
      }));
    if (job.kind === 'video') {
      let imageIndex = 0;
      visualReferences = visualReferences.map((ref) => ({
        ...ref,
        label:
          ref.type === 'image'
            ? `Image${++imageIndex} - ${imageIndex === 1 ? 'START reference' : 'IDENTITY: ' + (state.snapshot.characterReferences?.find((reference) => reference.imageNumber === imageIndex)?.names.join(' / ') ?? 'character')}`
            : ref.type === 'audio'
              ? 'Audio1 - approved dialogue voice reference'
              : ref.label
      }));
    }
    if (job.kind === 'image')
      return {
        state,
        model: 'gpt-image-2-5-sunburst',
        mode: visualReferences.length ? 'image2image' : 'text2image',
        params: {
          prompt,
          imageCount: 1,
          resolutionTier: '2k',
          quality: 'high',
          aspectRatio: '16:9',
          variant: 'sunburst',
          outputFormat: 'png',
          autoEnhancePrompt: false,
          lockAspectRatio: true,
          ...(visualReferences.length ? { visualReferences } : {})
        }
      };
    const hasDialogue = Boolean(state.clip.dialogue?.trim());
    const params = {
      prompt,
      videoCount: 1,
      resolution: videoGenerationDefaults.resolution,
      duration: state.clip.duration,
      mode: videoGenerationDefaults.quality,
      audio: true,
      promptExtend: false
    };
    if (hasDialogue) {
      const audio = visualReferences.find((r) => r.type === 'audio');
      if (!audio) fail('The approved dialogue recording is missing.');
      return {
        state,
        model: 'wan3-0',
        mode: 'element2video',
        params: {
          ...params,
          aspectRatio: '16:9',
          creationMode: 'element',
          autoEnhancePrompt: false,
          visualReferences: visualReferences.map((r) =>
            r.type === 'audio' ? { ...r, audioRole: 'voice_reference' } : r
          )
        }
      };
    }
    return {
      state,
      model: 'wan3-0',
      mode: 'image2video',
      params: {
        ...params,
        startFrame: visualReferences[0]
      }
    };
  }
  async function download(url: string) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      !(parsed.hostname === 'cdn.openart.ai' || parsed.hostname.endsWith('.openart.ai'))
    )
      fail('OpenArt returned an unexpected download host. The job needs review.');
    const response = await fetcher(url, { signal: AbortSignal.timeout(120000), redirect: 'error' });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 250 * 1024 * 1024)
      fail('OpenArt media could not be downloaded.');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 250 * 1024 * 1024) fail('Generated media exceeds the 250 MB limit.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function attach(job, media: Studio.MediaInput) {
    // Compare again after generation. A new approval or rejection must not receive a stale take.
    const state = await renderTarget(job.target, job.kind);
    if (digest(state.snapshot) !== digest(job.snapshot))
      fail(
        'The render finished after its source choices changed. It is saved in Media library; request a fresh take.'
      );
    if (job.kind === 'image') {
      let asset = state.asset ?? state.shot;
      if (job.target.packageItemId) {
        const items = asset.production.items.map((item) =>
          item.id === job.target.packageItemId ? { ...item, mediaId: String(media._id) } : item
        );
        const result = await StudioAsset.updateOne(
          { _id: asset._id, revision: asset.revision },
          { $set: { 'production.items': items }, $inc: { revision: 1 } }
        );
        if (!result.modifiedCount)
          fail('Reference package changed. Image retained in Media library.');
        if (job.target.packageItemId === 'body-turnaround')
          await StudioAsset.updateOne(
            { _id: asset._id },
            {
              $push: {
                candidates: {
                  id: `chat-${job._id}`,
                  title: 'Production body turnaround - front, three-quarter, profile, rear',
                  description:
                    'Complete full body including head and feet in every view. Review the other package items individually.',
                  mediaIds: [media._id],
                  archived: false
                }
              },
              $set: { reviewStatus: 'pending-choice' }
            }
          );
        await Job.updateOne({ _id: job._id }, { $set: { resultAssetId: String(asset._id) } });
        return;
      }
      if (!asset)
        asset = (
          await StudioAsset.create({
            name: `${state.scene.title} · ${state.clip.title}`,
            kind: 'environment',
            scope: 'episode' as const,
            episodeId: state.episode._id,
            sceneId: state.scene.id,
            clipId: state.clip.id,
            brief: state.clip.action,
            candidates: [],
            reviewStatus: 'pending-choice',
            revision: 0,
            referenceRevision: 0,
            history: []
          })
        ).toObject();
      const option = {
        id: 'chat-' + job._id,
        title: job.title,
        description: job.instructions,
        mediaIds: [media._id],
        continuitySources: undefined
      };
      if (state.prompts?.continuity?.sources.length)
        option.continuitySources = state.prompts.continuity.sources;
      if (asset.candidates?.some((c) => c.id === option.id)) {
        await Job.updateOne({ _id: job._id }, { $set: { resultAssetId: String(asset._id) } });
        return;
      }
      const old = { ...asset };
      delete old.history;
      const updated = await StudioAsset.findOneAndUpdate(
        { _id: asset._id, revision: asset.revision },
        {
          $push: {
            candidates: option,
            history: { $each: [{ ...old, savedAt: new Date() }], $slice: -30 }
          },
          $set: { reviewStatus: 'pending-choice' },
          $inc: { revision: 1 }
        }
      );
      if (!updated)
        fail('Asset changed while attaching the result. The image is saved in Media library.');
      // Existing finalized choice stays authoritative until the owner chooses its replacement.
      await Job.updateOne({ _id: job._id }, { $set: { resultAssetId: String(asset._id) } });
    } else {
      const field = job.kind === 'video' ? 'takeIds' : 'dialogueTakeIds';
      const sceneIndex = state.episode.scenes.findIndex((s) => s.id === state.scene.id);
      const clipIndex = state.scene.clips.findIndex((c) => c.id === state.clip.id);
      const old = { ...state.episode };
      delete old.history;
      const result = await StudioEpisode.updateOne(
        { _id: state.episode._id, revision: state.episode.revision },
        {
          $addToSet: { [`scenes.${sceneIndex}.clips.${clipIndex}.${field}`]: media._id },
          $inc: { revision: 1 },
          $push: { history: { $each: [{ ...old, savedAt: new Date() }], $slice: -30 } }
        }
      );
      if (!result.modifiedCount)
        fail('Episode changed while attaching the take. It is saved in Media library.');
    }
  }
  async function importResult(job, resource) {
    let media = await StudioMedia.findOne({ productionJobId: String(job._id) });
    if (!media) {
      const extension =
        job.kind === 'image'
          ? extname(new URL(resource.url).pathname).toLowerCase() || '.png'
          : '.mp4';
      media = await saveGeneratedMedia(
        mediaDirectory,
        await download(resource.url),
        `chat-${job._id}${extension}`,
        {
          productionJobId: String(job._id),
          ...(job.kind === 'video' && job.snapshot?.audioPolicy === nativeAudioPolicy
            ? {
                nativeAudio: { policy: nativeAudioPolicy, ...job.target },
                videoReview: { state: 'pending', ...job.target }
              }
            : {}),
          providerReference: {
            id: resource.id,
            type: job.kind,
            url: resource.url,
            label: job.title
          }
        }
      );
    }
    await Job.updateOne({ _id: job._id }, { $set: { resultMediaIds: [String(media._id)] } });
    await attach(job, media);
    await Job.updateOne({ _id: job._id }, { $set: { status: 'ready', error: null } });
    await SourceGrant.deleteMany({ jobId: String(job._id) });
  }
  async function dialogue(job, state) {
    const { inputs } = state.speaker;
    const multiple = new Set(inputs.map((input) => input.voice_id)).size > 1;
    const settings = {
      voiceId: inputs[0].voice_id,
      model_id: 'eleven_v3',
      text: inputs.map((input) => input.text).join('\n'),
      voice_settings: { stability: 0.5 },
      seed: 42020,
      apply_text_normalization: 'on'
    };
    await Job.updateOne(
      { _id: job._id },
      {
        $set: {
          settings: { voiceId: settings.voiceId, model: settings.model_id, inputs },
          status: 'submitting'
        }
      }
    );
    const response = await fetcher(
      multiple
        ? 'https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_192'
        : `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(settings.voiceId)}?output_format=mp3_44100_192`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify(
          multiple
            ? {
                inputs,
                model_id: settings.model_id,
                seed: settings.seed,
                apply_text_normalization: 'on'
              }
            : {
                model_id: settings.model_id,
                text: settings.text,
                voice_settings: settings.voice_settings,
                seed: settings.seed,
                apply_text_normalization: settings.apply_text_normalization
              }
        ),
        signal: AbortSignal.timeout(120000)
      }
    );
    if (!response.ok)
      fail(
        `ElevenLabs request failed (${response.status}). Check key permissions and credits.`,
        502
      );
    const buffer = Buffer.from(await response.arrayBuffer());
    const media = await saveGeneratedMedia(mediaDirectory, buffer, `dialogue-${job._id}.mp3`, {
      productionJobId: String(job._id)
    });
    await dialogueDuration(media._id, mediaDirectory, { refresh: true });
    await Job.updateOne({ _id: job._id }, { $set: { resultMediaIds: [String(media._id)] } });
    await attach(job, media);
    await Job.updateOne({ _id: job._id }, { $set: { status: 'ready' } });
  }
  async function processJob(job) {
    if (job.kind === 'voice') {
      if (job.status === 'importing')
        return withProject(job.projectKey, () => voices.importPreviews(job));
      return voices.processJob(job);
    }
    return withProject(job.projectKey ?? legacyProjectKey, () => processJobInProject(job));
  }
  async function processJobInProject(job) {
    if (job.kind === 'music') return music.processJob(job);
    if (['sound', 'mix'].includes(job.kind)) return sound.processJob(job);
    try {
      if (job.status === 'queued') {
        const claimed = await Job.findOneAndUpdate(
          { _id: job._id, status: 'queued' },
          { $set: { status: 'preparing' } }
        );
        if (!claimed) return;
        const request = await build(job);
        if (job.kind === 'dialogue') {
          await dialogue(job, request.state);
          return;
        }
        const { model, mode, params } = request;
        // References must be accepted into provider storage before any quote or generation.
        const references =
          params.visualReferences ?? [params.startFrame, params.endFrame].filter(Boolean);
        if (references.some((ref) => !/^https:\/\/cdn\.openart\.ai\//.test(String(ref.url))))
          fail('A reference has not been accepted into OpenArt storage; no render was submitted.');
        await openart.call('openart_model_form_get', { model, mode });
        const quote = await openart.call('openart_model_cost', { model, mode, params });
        if (!quote.items?.length || quote.items.some((item) => item.affordable === false))
          fail('OpenArt cannot fund this render. Check your OpenArt credit balance.');
        // No automatic retry beyond this boundary: provider might have accepted a request whose response was lost.
        const current = await renderTarget(job.target, job.kind, job.revisionProposalId);
        if (job.kind === 'video') await validateRevision(job, current);
        if (digest(current.snapshot) !== digest(job.snapshot))
          fail(
            'Creative choices changed during preparation. Request a new render using the latest approvals.'
          );
        await Job.updateOne(
          { _id: job._id },
          { $set: { quote, settings: { model, mode, params }, status: 'submitting' } }
        );
        const receipt = await openart.call(
          job.kind === 'image' ? 'openart_generate_image' : 'openart_generate_video',
          {
            model,
            mode,
            params,
            projectId: (await store.read()).openart?.projectId
          }
        );
        if (!receipt.historyId)
          fail(
            'OpenArt did not return a tracking ID. Check your OpenArt history before requesting another render.'
          );
        await Job.updateOne(
          { _id: job._id },
          {
            $set: {
              historyId: receipt.historyId,
              receipt,
              status: 'rendering',
              nextPollAt: new Date(Date.now() + Math.max(5, receipt.pollAfterSeconds ?? 10) * 1000)
            }
          }
        );
      } else if (job.status === 'importing') {
        const resource = job.receipt?.resources?.find((r) => r.url && r.mediaType === job.kind);
        if (!resource) fail('The completed render has no saved resource. Check OpenArt history.');
        await importResult(job, resource);
      } else if (job.status === 'rendering') {
        const receipt = await openart.call('openart_creation_get', { historyId: job.historyId });
        if (receipt.status === 'FAILED' || receipt.status === 'CANCELLED') {
          await Job.updateOne({ _id: job._id }, { $set: { receipt } });
          fail(
            'OpenArt render ' +
              receipt.status.toLowerCase() +
              ': ' +
              (receipt.error ?? 'Check provider history.')
          );
        }
        await Job.updateOne(
          { _id: job._id },
          {
            $set: {
              receipt,
              nextPollAt: new Date(Date.now() + Math.max(5, receipt.pollAfterSeconds ?? 10) * 1000)
            }
          }
        );
        if (receipt.status === 'COMPLETED') {
          if (receipt.warning) fail(receipt.warning);
          const resource = receipt.resources?.find((r) => r.url && r.mediaType === job.kind);
          if (!resource) fail('OpenArt finished without the expected media. Check its history.');
          await Job.updateOne({ _id: job._id }, { $set: { status: 'importing' } });
          await importResult(job, resource);
        }
      }
    } catch (caughtError) {
      const error = toError(caughtError);
      const current = await Job.findById(job._id).lean();
      if (current?.status === 'rendering' && (!error.status || error.status === 502)) {
        await Job.updateOne(
          { _id: job._id },
          {
            $set: {
              nextPollAt: new Date(Date.now() + 30000),
              error:
                'Status check delayed. Reconnect OpenArt if needed; this render will be checked again without resubmission.'
            }
          }
        );
        return;
      }
      await Job.updateOne(
        { _id: job._id },
        {
          $set: {
            status:
              current?.status === 'submitting' && !error.providerRejection ? 'uncertain' : 'failed',
            ...(error.providerRejection ? { receipt: error.providerRejection } : {}),
            error: error.status
              ? error.message.slice(0, 1500)
              : 'Provider connection failed. Check Connections and the provider history before retrying.'
          }
        }
      );
    }
  }
  async function validateRevision(job, state) {
    if (!job.revisionProposalId) {
      if (workflowEnabled() && (job.instructions?.trim() || state.clip.takeIds?.length))
        fail('Approve the video revision directions before requesting a replacement render.', 409);
      return;
    }
    const proposal = await Proposal.findById(id(job.revisionProposalId)).lean();
    if (
      !proposal?.render?.approvedAt ||
      !['approving', 'applied'].includes(proposal.status) ||
      digest(proposal.render.target) !== digest(job.target) ||
      proposal.render.instructions !== job.instructions ||
      digest(proposal.render.referenceIds ?? []) !== digest(job.referenceIds) ||
      digest(proposal.render.approvedSnapshot) !== digest(state.snapshot)
    )
      fail(
        'The video revision approval is missing or its inputs changed. Review a current revision before rendering.',
        409
      );
  }
  function approveRevision(
    proposalId: string,
    options: { generate: true }
  ): Promise<Awaited<ReturnType<typeof queue>>>;
  function approveRevision(
    proposalId: string,
    options?: { generate?: false }
  ): ReturnType<typeof applyVideoRevision>;
  function approveRevision(
    proposalId: string,
    options: { generate: boolean }
  ): Promise<Awaited<ReturnType<typeof queue>> | Awaited<ReturnType<typeof applyVideoRevision>>>;
  async function approveRevision(
    proposalId: string,
    { generate = false }: { generate?: boolean } = {}
  ) {
    if (!generate) return applyVideoRevision(proposalId);
    const proposal = await Proposal.findById(id(proposalId)).lean();
    if (!proposal?.render) fail('Video revision not found.', 404);
    const requestId = `approved-video-revision-${proposal._id}`;
    const existing = await Job.findOne({ requestId }).lean();
    if (existing) return existing;
    if (proposal.status !== 'pending') fail('This video revision is no longer pending.', 409);
    if (proposal.render.resolution !== videoGenerationDefaults.resolution)
      fail(
        'This video revision uses older output settings. Prepare a fresh native 1080p revision before generating.',
        409
      );
    const episode = await StudioEpisode.findById(proposal.episodeId).lean();
    const application = proposalApplication(proposal, episode);
    if (!application.canApply) fail(application.reason, 409);
    const state = await renderTarget(proposal.render.target, 'video', String(proposal._id));
    videoPrompt(state, proposal.render.instructions);
    const claimed = await Proposal.updateOne(
      { _id: proposal._id, status: 'pending', updatedAt: proposal.updatedAt },
      {
        $set: {
          status: 'approving',
          'render.approvedAt': new Date(),
          'render.approvedSnapshot': state.snapshot
        }
      }
    );
    if (!claimed.modifiedCount) fail('This revision changed or is already being approved.', 409);
    try {
      const job = await queue({
        chatId: proposal.chatId,
        requestId,
        kind: 'video',
        target: proposal.render.target,
        instructions: proposal.render.instructions,
        referenceIds: proposal.render.referenceIds,
        revisionProposalId: String(proposal._id)
      });
      await Proposal.updateOne(
        { _id: proposal._id, status: 'approving' },
        {
          $set: { status: 'applied', 'render.jobId': String(job._id) }
        }
      );
      return job;
    } catch (error) {
      if (!(await Job.exists({ requestId })))
        await Proposal.updateOne(
          { _id: proposal._id, status: 'approving' },
          {
            $set: { status: 'pending' },
            $unset: { 'render.approvedAt': '', 'render.approvedSnapshot': '' }
          }
        );
      throw error;
    }
  }
  return { queue, processJob, build, sound, music, voices, approveRevision };
}
