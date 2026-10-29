import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import { StudioAsset, StudioEpisode, StudioMedia } from '../models/Studio.js';
import { requireWorkflow, workflowEnabled } from '../production-workflow.js';
import { approvedSoundPlan, mixState } from '../sound-design.js';
import { mediaView, saveGeneratedMedia } from '../studio-media.js';
import {
  episodeView,
  fail,
  id,
  revision,
  soundPlanFingerprint,
  text
} from '../studio-validation.js';
import { Job } from './models.js';

const execute = promisify(execFile);
async function updateEpisode(old, scenes) {
  const snapshot = { ...old };
  delete snapshot.history;
  const next = await StudioEpisode.findOneAndUpdate(
    { _id: old._id, revision: old.revision },
    {
      $set: { scenes },
      $inc: { revision: 1 },
      $push: { history: { $each: [snapshot], $slice: -30 } }
    },
    { returnDocument: 'after' }
  ).lean();
  if (!next) fail('Episode changed. Your saved work is retained; refresh before retrying.', 409);
  return next;
}
export function createSoundProduction({ mediaDirectory, fetcher = fetch, executeFile = execute }) {
  const path = (media) => {
    if (basename(media.filename) !== media.filename) fail('Invalid media path.');
    return join(mediaDirectory, media.filename);
  };
  async function target(args) {
    const episode = await StudioEpisode.findById(id(args.episodeId)).lean();
    const scene = episode?.scenes.find((s) => s.id === args.sceneId);
    if (!scene) fail('Choose a saved scene.');
    if (workflowEnabled())
      await requireWorkflow(
        { scope: 'scene', recordId: String(episode._id), sceneId: scene.id },
        'sound-plan'
      );
    const assets = await StudioAsset.find().lean();
    approvedSoundPlan(scene, assets);
    return { episode, scene, assets };
  }
  async function linkSound(args, mediaId) {
    const imported = mediaId ? await StudioMedia.findById(id(mediaId)).lean() : null;
    if (mediaId && imported?.kind !== 'audio') fail('Choose a saved audio file.');
    const { episode, scene, assets } = await target(args);
    if (episode.revision !== revision(args.revision))
      fail('Save or refresh the episode before creating a sound.', 409);
    const originalEpisode = { ...episode, scenes: JSON.parse(JSON.stringify(episode.scenes)) };
    const layer = scene.soundPlan.layers.find((l) => l.id === args.layerId);
    if (!layer) fail('Sound layer not found.');
    const needsLink = !layer.assetId;
    let asset = layer.assetId ? await StudioAsset.findById(layer.assetId).lean() : null;
    if (
      asset &&
      (asset.kind !== 'sound' ||
        (asset.scope === 'episode' && String(asset.episodeId) !== String(episode._id)))
    )
      fail('Choose a sound asset from this episode.');
    if (!asset) {
      asset = (
        await StudioAsset.create({
          name: layer.title,
          kind: 'sound',
          scope: args.scope === 'episode' ? 'episode' : 'reusable',
          episodeId: args.scope === 'episode' ? episode._id : null,
          brief: layer.description,
          notes: 'Sound effects and ambience only. No music or intelligible speech.',
          candidates: [],
          reviewStatus: 'development'
        })
      ).toObject();
      layer.assetId = String(asset._id);
    }
    if (mediaId) {
      const media = imported;
      const candidate = {
        id: randomUUID(),
        title: layer.title,
        description: layer.description,
        mediaIds: [media._id]
      };
      const changed = await StudioAsset.findOneAndUpdate(
        { _id: asset._id, revision: asset.revision },
        {
          $push: { candidates: candidate },
          $set: { reviewStatus: 'pending-choice' },
          $inc: { revision: 1 }
        },
        { returnDocument: 'after' }
      ).lean();
      if (!changed) fail('Sound changed; refresh before importing.', 409);
      asset = changed;
    }
    const next = needsLink ? await updateEpisode(originalEpisode, episode.scenes) : episode;
    return {
      episode: episodeView(next, assets),
      scene: next.scenes.find((s) => s.id === scene.id),
      asset,
      layer
    };
  }
  async function queueSound(args) {
    const requestId = text(args.requestId, 'Request ID', 100, true);
    const existing = await Job.findOne({ requestId }).lean();
    if (existing) return { job: existing };
    if (!process.env.ELEVENLABS_API_KEY)
      fail('Configure the server ElevenLabs key before generating effects.');
    const linked = await linkSound(args);
    const { episode, scene, asset, layer } = linked;
    if (
      await Job.exists({
        kind: 'sound',
        'payload.assetId': String(asset._id),
        status: { $in: ['queued', 'preparing', 'submitting', 'importing', 'uncertain'] }
      })
    )
      fail('This sound has unfinished work. Review its job before generating another version.');
    const job = (
      await Job.create({
        kind: 'sound',
        requestId,
        chatId: args.chatId,
        runId: args.runId,
        target: { episodeId: String(episode._id), sceneId: scene.id },
        title: `Sound · ${layer.title}`,
        status: 'queued',
        payload: {
          assetId: String(asset._id),
          layerId: layer.id,
          duration: layer.duration,
          loop: layer.loop,
          prompt: layer.description
        },
        snapshot: {
          assetRevision: asset.revision,
          plan: soundPlanFingerprint(scene, await StudioAsset.find().lean())
        },
        quote: { currency: 'elevenlabs-credits', estimatedCredits: Math.ceil(layer.duration * 40) }
      })
    ).toObject();
    return { episode, asset, job };
  }
  async function queueMix(args) {
    const requestId = text(args.requestId, 'Request ID', 100, true);
    const existing = await Job.findOne({ requestId }).lean();
    if (existing) return { job: existing };
    const { episode, scene } = await target(args);
    if (episode.revision !== revision(args.revision))
      fail('Save or refresh the episode before mixing.', 409);
    const clip = scene.clips.find((c) => c.id === args.clipId);
    if (!clip) fail('Choose a saved clip.');
    const state = await mixState(episode, scene, clip, id(args.sourceTakeId));
    const cached = await StudioMedia.findOne({ 'soundMix.fingerprint': state.fingerprint }).lean();
    if (cached && clip.takeIds.map(String).includes(String(cached._id)))
      return {
        media: mediaView(cached),
        episode: episodeView(episode, await StudioAsset.find().lean())
      };
    if (
      await Job.exists({
        kind: 'mix',
        'snapshot.fingerprint': state.fingerprint,
        status: { $in: ['queued', 'preparing', 'importing'] }
      })
    )
      fail('This sound mix is already being prepared.');
    const job = (
      await Job.create({
        kind: 'mix',
        requestId,
        chatId: args.chatId,
        runId: args.runId,
        target: { episodeId: String(episode._id), sceneId: scene.id, clipId: clip.id },
        title: `Sound mix · ${clip.title}`,
        status: 'queued',
        payload: { sourceTakeId: String(state.source._id) },
        snapshot: { fingerprint: state.fingerprint },
        quote: { currency: 'local', estimatedCredits: 0 }
      })
    ).toObject();
    return { job };
  }
  async function inspect(media) {
    const result = await executeFile(
      process.env.FFPROBE_PATH || 'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,width,height:format=duration',
        '-of',
        'json',
        path(media)
      ],
      { windowsHide: true, timeout: 15000, maxBuffer: 65536 }
    );
    return JSON.parse(result.stdout);
  }
  async function mix(job) {
    const { episode, scene } = await target(job.target);
    const clip = scene.clips.find((c) => c.id === job.target.clipId);
    if (!clip) fail('Clip was removed.');
    const state = await mixState(episode, scene, clip, job.payload.sourceTakeId);
    if (state.fingerprint !== job.snapshot.fingerprint)
      fail('Sound choices changed. Request a new mix; no credits were spent.');
    let video = await StudioMedia.findOne({ productionJobId: String(job._id) }).lean();
    let stem = await StudioMedia.findOne({ productionJobId: String(job._id) + ':stem' }).lean();
    if (!video) {
      const probe = await inspect(state.source);
      const duration = Number(probe.format?.duration);
      if (!Number.isFinite(duration) || Math.abs(duration - clip.duration) > 0.75)
        fail('Source video duration does not match this clip.');
      const hasDialogue = Boolean(state.cleanDialogue);
      if (hasDialogue) {
        const dialogueProbe = await inspect(state.cleanDialogue);
        if (
          !dialogueProbe.streams.some((s) => s.codec_type === 'audio') ||
          Math.abs(Number(dialogueProbe.format?.duration) - duration) > 0.15
        )
          fail(
            'The clean dialogue stem must match the video duration, including silence, to preserve synchronization.'
          );
      }
      const directory = await mkdtemp(join(tmpdir(), 'roxy-sound-mix-'));
      try {
        const filters = [];
        const inputs = [];
        const labels = [];
        const offset = scene.clips
          .slice(
            0,
            scene.clips.findIndex((c) => c.id === clip.id)
          )
          .reduce((n, c) => n + c.duration, 0);
        for (const [index, { layer, media }] of state.layers.entries()) {
          if (layer.loop) inputs.push('-stream_loop', '-1');
          inputs.push('-i', path(media));
          const audioProbe = await inspect(media);
          const audioDuration = Number(audioProbe.format?.duration);
          if (
            !audioProbe.streams.some((s) => s.codec_type === 'audio') ||
            !Number.isFinite(audioDuration) ||
            audioDuration <= 0
          )
            fail(`The audio for ${layer.title} cannot be read.`);
          const rawStart =
            layer.sourceStart +
            (layer.type === 'ambience' && layer.loop && !layer.clipId ? offset : 0);
          const start = layer.loop ? rawStart % audioDuration : rawStart;
          const length = layer.type === 'ambience' ? duration - layer.start : layer.duration;
          if (!layer.loop && start + length > audioDuration + 0.08)
            fail(
              `The audio for ${layer.title} is too short. Enable looping, choose a longer source or adjust the trim.`
            );
          const label = 's' + index;
          labels.push('[' + label + ']');
          filters.push(
            `[${index}:a]atrim=start=${start}:duration=${length},asetpts=PTS-STARTPTS${layer.lowpassHz ? ',lowpass=f=' + layer.lowpassHz : ''},volume=${layer.gainDb}dB,afade=t=in:st=0:d=0.03,afade=t=out:st=${Math.max(0, length - 0.08)}:d=0.08,adelay=${Math.round(layer.start * 1000)}:all=1,apad,atrim=duration=${duration}[${label}]`
          );
        }
        filters.push(
          `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,alimiter=limit=0.95:level=0:latency=1[effects]`
        );
        const stemPath = join(directory, 'effects.wav'),
          videoPath = join(directory, 'mixed.mp4');
        await executeFile(
          process.env.FFMPEG_PATH || 'ffmpeg',
          [
            '-y',
            '-v',
            'error',
            ...inputs,
            '-filter_complex',
            filters.join(';'),
            '-map',
            '[effects]',
            '-t',
            String(duration),
            '-ar',
            '48000',
            '-ac',
            '2',
            '-c:a',
            'pcm_s16le',
            stemPath
          ],
          { windowsHide: true, timeout: 120000, maxBuffer: 100000 }
        );
        const base = hasDialogue
          ? `[2:a]volume=${scene.soundPlan.dialogueGainDb ?? 0}dB[dialogue]`
          : `anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[dialogue]`;
        await executeFile(
          process.env.FFMPEG_PATH || 'ffmpeg',
          [
            '-y',
            '-v',
            'error',
            '-i',
            path(state.source),
            '-i',
            stemPath,
            ...(hasDialogue ? ['-i', path(state.cleanDialogue)] : []),
            '-filter_complex',
            `${base};[dialogue][1:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95:level=0:latency=1[mix]`,
            '-map',
            '0:v:0',
            '-map',
            '[mix]',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-t',
            String(duration),
            '-movflags',
            '+faststart',
            videoPath
          ],
          { windowsHide: true, timeout: 120000, maxBuffer: 100000 }
        );
        stem =
          stem ??
          (
            await saveGeneratedMedia(
              mediaDirectory,
              await readFile(stemPath),
              `sound-effects-${job._id}.wav`,
              { productionJobId: String(job._id) + ':stem' }
            )
          ).toObject();
        video = (
          await saveGeneratedMedia(
            mediaDirectory,
            await readFile(videoPath),
            `mixed-${job._id}.mp4`,
            {
              productionJobId: String(job._id),
              videoVerification: state.source.videoVerification
                ? { ...state.source.videoVerification, audio: true }
                : undefined,
              soundMix: {
                audioPolicy: 'isolated-dialogue-and-approved-effects-v1',
                cleanDialogueMediaId: state.cleanDialogue ? String(state.cleanDialogue._id) : null,
                sourceTakeId: String(state.source._id),
                stemMediaId: String(stem._id),
                episodeId: String(episode._id),
                sceneId: scene.id,
                clipId: clip.id,
                fingerprint: state.fingerprint,
                inputFingerprint: state.inputFingerprint,
                createdAt: new Date().toISOString()
              }
            }
          )
        ).toObject();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    await Job.updateOne(
      { _id: job._id },
      { $set: { status: 'importing', resultMediaIds: [String(video._id)] } }
    );
    const latest = await StudioEpisode.findById(episode._id).lean();
    const current = latest.scenes.find((s) => s.id === scene.id);
    const currentClip = current?.clips.find((c) => c.id === clip.id);
    if (
      !currentClip ||
      (await mixState(latest, current, currentClip, job.payload.sourceTakeId)).fingerprint !==
        state.fingerprint
    )
      fail(
        'Sound choices changed while mixing. The files remain in Media library; create a current mix.'
      );
    if (!currentClip.takeIds.map(String).includes(String(video._id))) {
      const before = { ...latest, scenes: JSON.parse(JSON.stringify(latest.scenes)) };
      currentClip.takeIds.push(video._id);
      await updateEpisode(before, latest.scenes);
    }
    await Job.updateOne({ _id: job._id }, { $set: { status: 'ready', error: null } });
  }
  async function generate(job) {
    const { scene, assets } = await target(job.target);
    const asset = await StudioAsset.findById(job.payload.assetId).lean();
    if (!asset) fail('Sound asset was removed.');
    let media = await StudioMedia.findOne({ productionJobId: String(job._id) }).lean();
    if (!media) {
      if (
        asset.revision !== job.snapshot.assetRevision ||
        soundPlanFingerprint(scene, assets) !== job.snapshot.plan
      )
        fail('The sound plan or sound changed. Request a fresh effect after review.');
      await Job.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'submitting',
            settings: {
              model: 'eleven_text_to_sound_v2',
              duration: job.payload.duration,
              loop: job.payload.loop
            }
          }
        }
      );
      const response = await fetcher(
        'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128',
        {
          method: 'POST',
          headers: {
            'xi-api-key': process.env.ELEVENLABS_API_KEY,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            text:
              job.payload.prompt +
              '\nSound effects and environmental ambience only. No intelligible speech, singing, music or score.',
            model_id: 'eleven_text_to_sound_v2',
            duration_seconds: job.payload.duration,
            loop: job.payload.loop,
            prompt_influence: 0.7
          }),
          signal: AbortSignal.timeout(120000)
        }
      );
      if (!response.ok)
        throw Object.assign(
          new Error(
            `ElevenLabs sound generation failed (${response.status}). Check permissions and credits.`
          ),
          { status: 502, rejected: true }
        );
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 16 * 1024 * 1024) fail('Sound effect exceeds the file limit.');
        chunks.push(chunk);
      }
      media = (
        await saveGeneratedMedia(mediaDirectory, Buffer.concat(chunks), `effect-${job._id}.mp3`, {
          productionJobId: String(job._id)
        })
      ).toObject();
      const actual = Number(response.headers.get('character-cost'));
      await Job.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'importing',
            resultMediaIds: [String(media._id)],
            receipt: {
              creditsCharged:
                response.headers.has('character-cost') && Number.isFinite(actual) ? actual : null
            }
          }
        }
      );
    }
    const latest = await target(job.target);
    if (soundPlanFingerprint(latest.scene, latest.assets) !== job.snapshot.plan)
      fail(
        'Sound plan changed during generation. The audio is retained in Media library for review.'
      );
    if (!asset.candidates.some((c) => c.id === 'sound-' + job._id)) {
      const candidate = {
        id: 'sound-' + job._id,
        title: asset.name,
        description: job.payload.prompt,
        mediaIds: [media._id]
      };
      const saved = await StudioAsset.updateOne(
        { _id: asset._id, revision: job.snapshot.assetRevision },
        {
          $push: { candidates: candidate },
          $set: { reviewStatus: 'pending-choice' },
          $inc: { revision: 1 }
        }
      );
      if (!saved.modifiedCount)
        fail('The sound changed during generation. Its audio is saved in Media library.');
    }
    await Job.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'ready',
          resultMediaIds: [String(media._id)],
          resultAssetId: String(asset._id),
          error: null
        }
      }
    );
  }
  async function processJob(job) {
    try {
      if (job.status === 'queued') {
        const claimed = await Job.updateOne(
          { _id: job._id, status: 'queued' },
          { $set: { status: 'preparing' } }
        );
        if (!claimed.modifiedCount) return;
      } else if (job.status !== 'importing') return;
      if (job.kind === 'mix') await mix(job);
      else await generate(job);
    } catch (error) {
      const current = await Job.findById(job._id).lean();
      await Job.updateOne(
        { _id: job._id },
        {
          $set: {
            status: current?.status === 'submitting' && !error.rejected ? 'uncertain' : 'failed',
            error: error.status
              ? error.message
              : 'Sound processing failed. Check FFmpeg, the saved source files, or provider history before retrying.'
          }
        }
      );
    }
  }
  return { queueSound, queueMix, importSound: (args) => linkSound(args, args.mediaId), processJob };
}
