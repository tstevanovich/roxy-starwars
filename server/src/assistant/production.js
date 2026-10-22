import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { StudioAsset, StudioEpisode, StudioMedia } from '../models/Studio.js';
import { hashToken, readOwner } from '../owner.js';
import { approvedSoundPlan } from '../sound-design.js';
import { saveGeneratedMedia } from '../studio-media.js';
import { clipPrompts, productionVideoPrompt } from '../studio-prompts.js';
import { fail, id, sceneFingerprint, text } from '../studio-validation.js';
import { Job, SourceGrant } from './models.js';
import { referenceSharing } from './reference-sharing.js';
import { createSoundProduction } from './sound-production.js';

export const defaultMediaDirectory = fileURLToPath(
  new URL('../../../.data/media/', import.meta.url)
);
const productionDirectory = fileURLToPath(new URL('../../../.data/production/', import.meta.url));
const stable = (value) => JSON.stringify(value);
const digest = (value) => createHash('sha256').update(stable(value)).digest('hex');
export function speakerVoice(clip, assets) {
  const match = clip.dialogue?.match(/^\s*([^:]+):\s*([\s\S]+)$/);
  if (!match || /\n\s*[A-Z][A-Z -]+:/.test(match[2]))
    fail('Dialogue generation requires one speaker per clip.');
  const speaker = match[1].trim().toLowerCase();
  if (!/^[a-z][a-z0-9 '-]{0,79}$/.test(speaker))
    fail('Use the finalized character’s speaker name.');
  const firstName = /^(al|al-1b)$/.test(speaker) ? 'al' : speaker.split(' ')[0];
  const namePattern = new RegExp('\\b' + firstName + '\\b', 'i');
  const voice = assets.find(
    (a) =>
      a.kind === 'voice' &&
      !a.archived &&
      a.finalChoice?.voiceId &&
      [a.name, ...(a.aliases ?? [])].some((name) => namePattern.test(name))
  );
  if (!voice || voice.finalChoice.voiceModel !== 'eleven_v3')
    fail('Finalize this speaker’s Eleven v3 voice first.');
  return { voice, spokenText: match[2].replace(/\bAL\b/g, 'Al') };
}
export async function renderTarget(target, kind) {
  const assets = await StudioAsset.find({ archived: { $ne: true } }).lean();
  if (target.episodeId) {
    const episode = await StudioEpisode.findById(id(target.episodeId)).lean();
    const scene = episode?.scenes.find((s) => s.id === target.sceneId);
    const clip = scene?.clips.find((c) => c.id === target.clipId);
    if (!clip) fail('Choose an existing episode, scene and clip.');
    if (!scene.approval || scene.approval.fingerprint !== sceneFingerprint(scene, assets))
      fail('Approve the current scene script before requesting production assets.');
    const linked = assets.filter((a) => scene.assetIds.map(String).includes(String(a._id)));
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
    const prompts = clipPrompts(scene, clip, assets);
    const snapshot = {
      fingerprint: sceneFingerprint(scene, assets),
      imageIds,
      dialogueId: clip.selectedDialogueId ? String(clip.selectedDialogueId) : null
    };
    const speaker = kind === 'dialogue' ? speakerVoice(clip, assets) : null;
    if (speaker) snapshot.voice = speaker.voice.finalChoice;
    return { episode, scene, clip, shot, assets, prompts, snapshot, speaker };
  }
  if (kind !== 'image') fail('Choose a clip for video or dialogue generation.');
  const asset = assets.find((a) => String(a._id) === id(target.assetId));
  if (!asset) fail('Choose an existing creative-library asset.');
  if (['voice', 'sound'].includes(asset.kind)) fail('Choose a visual asset for image generation.');
  return { asset, assets, snapshot: { revision: asset.revision, finalChoice: asset.finalChoice } };
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
  async function walk(directory, depth = 0) {
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
  ownerPath,
  remotePath,
  fetcher = fetch
}) {
  const sound = createSoundProduction({ mediaDirectory, fetcher });
  async function reference(mediaId, job) {
    const media = await StudioMedia.findById(id(mediaId)).lean();
    if (!media) fail('A required reference was deleted. Choose a replacement.');
    const known = media.providerReference ?? (await referenceIndex()).get(media.sha256);
    if (known) return { type: media.kind, id: known.id, url: known.url, label: media.originalName };
    const secrets = await store.read();
    const sharing = await referenceSharing({
      redirectUrl: secrets.openart?.redirectUrl,
      remotePath
    });
    if (!sharing.ready) fail(sharing.message);
    const origin = sharing.origin;
    const token = randomBytes(32).toString('base64url');
    const owner = await readOwner(ownerPath);
    if (!owner?.version) fail('Set up the studio owner before sharing references.');
    await SourceGrant.create({
      tokenHash: hashToken(token),
      mediaId: String(media._id),
      ownerVersion: owner?.version,
      expires: new Date(Date.now() + 3600000),
      jobId: String(job._id)
    });
    return {
      type: media.kind,
      id: String(media._id),
      url: origin + '/api/assistant/source/' + token,
      label: media.originalName
    };
  }
  function videoPrompt(state, instructions) {
    const prompt = productionVideoPrompt(state.scene, state.clip, instructions);
    if (prompt.length > 4500)
      fail(
        `Video prompt is ${prompt.length} characters; Wan allows 4500. Shorten the clip directions or requested changes before rendering. No directions were truncated.`
      );
    return prompt;
  }
  async function queue({
    chatId,
    runId,
    requestId,
    kind,
    target,
    instructions = '',
    referenceIds = []
  }) {
    if (!['image', 'video', 'dialogue'].includes(kind)) fail('Choose image, video or dialogue.');
    text(instructions, 'Render instructions', 6000);
    if (!Array.isArray(referenceIds) || referenceIds.length > 12)
      fail('Choose at most 12 saved references.');
    referenceIds.forEach(id);
    const previous = await Job.findOne({ requestId }).lean();
    if (previous) return previous;
    const state = await renderTarget(target, kind);
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
        kind,
        target,
        instructions,
        referenceIds,
        title: `${kind === 'dialogue' ? 'Dialogue' : kind === 'image' ? 'Image' : 'Video'} · ${state.clip?.title ?? state.asset.name}`,
        snapshot: state.snapshot,
        status: 'queued'
      })
    ).toObject();
  }
  async function build(job) {
    const state = await renderTarget(job.target, job.kind);
    if (digest(state.snapshot) !== digest(job.snapshot))
      fail(
        'Creative choices changed after this request. Request a new render using the latest approvals.'
      );
    if (job.kind === 'dialogue') return { state };
    let refs = [...job.referenceIds];
    if (job.kind === 'video')
      refs = [
        ...state.snapshot.imageIds,
        ...(state.snapshot.dialogueId ? [state.snapshot.dialogueId] : [])
      ];
    else
      refs = [
        ...new Set([
          ...refs,
          ...(state.prompts?.referenceMediaIds ??
            state.asset.finalChoice?.mediaIds?.map(String) ??
            [])
        ])
      ];
    if (refs.length > 16)
      fail('Too many image references; select fewer references for this request.');
    let prompt =
      job.kind === 'video'
        ? videoPrompt(state, job.instructions)
        : (state.prompts?.[job.kind] ??
          `Star Wars universe, Imperial era. Photorealistic live-action reference. ${state.asset.name}: ${state.asset.brief}. ${state.asset.notes ?? ''}`);
    if (
      job.kind === 'image' &&
      ['character', 'droid', 'prop', 'wardrobe'].includes(state.asset?.kind)
    )
      prompt +=
        '\nCreate a coherent multiview reference sheet: front, three-quarter, side, rear and face/detail close-up. Consistent design across every view. No labels, text or captions. Natural skin or realistic mechanical materials.';
    if (job.kind !== 'video') prompt += '\nREQUESTED CHANGES: ' + job.instructions;
    const visualReferences = await Promise.all(refs.map((mid) => reference(mid, job)));
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
      resolution: '480p',
      duration: state.clip.duration,
      mode: 'standard',
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
      params: { ...params, startFrame: visualReferences[0] }
    };
  }
  async function download(url) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      !(parsed.hostname === 'cdn.openart.ai' || parsed.hostname.endsWith('.openart.ai'))
    )
      fail('OpenArt returned an unexpected download host. The job needs review.');
    const response = await fetcher(url, { signal: AbortSignal.timeout(120000), redirect: 'error' });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 250 * 1024 * 1024)
      fail('OpenArt media could not be downloaded.');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 250 * 1024 * 1024) fail('Generated media exceeds the 250 MB limit.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function attach(job, media) {
    // Compare again after generation. A new approval or rejection must not receive a stale take.
    const state = await renderTarget(job.target, job.kind);
    if (digest(state.snapshot) !== digest(job.snapshot))
      fail(
        'The render finished after its source choices changed. It is saved in Media library; request a fresh take.'
      );
    if (job.kind === 'image') {
      let asset = state.asset ?? state.shot;
      if (!asset)
        asset = (
          await StudioAsset.create({
            name: `${state.scene.title} · ${state.clip.title}`,
            kind: 'environment',
            scope: 'episode',
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
        mediaIds: [media._id]
      };
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
    const { voice, spokenText } = state.speaker;
    const settings = {
      voiceId: voice.finalChoice.voiceId,
      model_id: 'eleven_v3',
      text: spokenText,
      voice_settings: { stability: 0.5 },
      seed: 42020,
      apply_text_normalization: 'on'
    };
    await Job.updateOne(
      { _id: job._id },
      {
        $set: {
          settings: { voiceId: settings.voiceId, model: settings.model_id },
          status: 'submitting'
        }
      }
    );
    const response = await fetcher(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(settings.voiceId)}?output_format=mp3_44100_192`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model_id: settings.model_id,
          text: settings.text,
          voice_settings: settings.voice_settings,
          seed: settings.seed,
          apply_text_normalization: settings.apply_text_normalization
        }),
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
    await Job.updateOne({ _id: job._id }, { $set: { resultMediaIds: [String(media._id)] } });
    await attach(job, media);
    await Job.updateOne({ _id: job._id }, { $set: { status: 'ready' } });
  }
  async function processJob(job) {
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
        // Confirm the tunnel serves the exact expiring files before spending provider credits.
        const references =
          params.visualReferences ?? (params.startFrame ? [params.startFrame] : []);
        await Promise.all(
          references
            .filter((ref) => new URL(ref.url).pathname.startsWith('/api/assistant/source/'))
            .map(async (ref) => {
              try {
                const response = await fetcher(ref.url, {
                  method: 'HEAD',
                  redirect: 'error',
                  signal: AbortSignal.timeout(15000)
                });
                if (
                  !response.ok ||
                  !response.headers.get('content-type')?.startsWith(ref.type + '/')
                )
                  throw new Error('Reference is not reachable');
              } catch {
                fail(
                  'The secure studio reference URL could not be reached. Check the remote tunnel; no render was submitted.'
                );
              }
            })
        );
        await openart.call('openart_model_form_get', { model, mode });
        const quote = await openart.call('openart_model_cost', { model, mode, params });
        if (!quote.items?.length || quote.items.some((item) => item.affordable === false))
          fail('OpenArt cannot fund this render. Check your OpenArt credit balance.');
        // No automatic retry beyond this boundary: provider might have accepted a request whose response was lost.
        const current = await renderTarget(job.target, job.kind);
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
        if (receipt.status === 'FAILED' || receipt.status === 'CANCELLED')
          fail(
            'OpenArt render ' +
              receipt.status.toLowerCase() +
              ': ' +
              (receipt.error ?? 'Check provider history.')
          );
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
    } catch (error) {
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
            status: current?.status === 'submitting' ? 'uncertain' : 'failed',
            error: error.status
              ? error.message.slice(0, 1500)
              : 'Provider connection failed. Check Connections and the provider history before retrying.'
          }
        }
      );
    }
  }
  return { queue, processJob, build, sound };
}
