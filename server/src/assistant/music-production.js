import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { musicModel, musicPrompt } from '../../../shared/scene-music.js';
import { StudioAutomation, StudioEpisode, StudioMedia, StudioMusicCue } from '../models/Studio.js';
import { musicState } from '../music-state.js';
import { requireWorkflow, workflowContext, workflowEnabled } from '../production-workflow.js';
import { assertMediaAccess } from '../projects.js';
import { saveGeneratedMedia } from '../studio-media.js';
import { rejectMedia } from '../studio-reject-media.js';
import { fail, id, number, object, revision, text } from '../studio-validation.js';
import { Job } from './models.js';

export function audibleWindow(log, duration) {
  const ranges = [];
  let start = null;
  for (const m of log.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    if (m[1] === 'start') start = Number(m[2]);
    else if (start !== null) {
      ranges.push([start, Number(m[2])]);
      start = null;
    }
  }
  if (start !== null) ranges.push([start, duration]);
  const leading = ranges.find((r) => r[0] <= 0.05)?.[1] ?? 0;
  const trailing = duration - (ranges.findLast((r) => r[1] >= duration - 0.05)?.[0] ?? duration);
  return {
    leadingSeconds: leading,
    trailingSeconds: trailing,
    audibleSeconds: Math.max(0, duration - leading - trailing)
  };
}
const snapshot = (cue) => {
  const value = { ...cue };
  delete value.history;
  return value;
};
export function createMusicProduction({
  mediaDirectory,
  fetcher = fetch,
  executeFile = promisify(execFile)
}) {
  async function target(args) {
    const episode = await StudioEpisode.findById(id(args.episodeId)).lean();
    const scene = episode?.scenes.find((s) => s.id === args.sceneId);
    if (!scene) fail('Choose a saved scene.', 404);
    const cue = await StudioMusicCue.findOne({ episodeId: episode._id, sceneId: scene.id }).lean();
    return { episode, scene, cue };
  }
  async function plan(args) {
    object(args);
    const { episode, scene, cue } = await target(args);
    if (
      cue &&
      (await Job.exists({
        kind: 'music',
        'payload.cueId': String(cue._id),
        status: { $in: ['queued', 'preparing', 'submitting', 'importing', 'uncertain'] }
      }))
    )
      fail(
        'Wait for the active music job or resolve its uncertain submission before revising this brief.',
        409
      );
    const bufferSeconds = number(args.bufferSeconds ?? 5, 'Music buffer', 0, 5);
    const prompt = text(
      args.prompt ?? musicPrompt(scene, bufferSeconds),
      'Complete music prompt',
      4100,
      true
    );
    const enabled = args.enabled !== false;
    let saved;
    if (cue) {
      saved = await StudioMusicCue.findOneAndUpdate(
        { _id: cue._id, revision: revision(args.cueRevision) },
        {
          $set: { prompt, bufferSeconds, enabled, model: musicModel },
          $inc: { revision: 1 },
          $push: { history: { $each: [snapshot(cue)], $slice: -30 } }
        },
        { returnDocument: 'after' }
      ).lean();
      if (!saved) fail('The music plan changed. Refresh before saving.', 409);
    } else {
      try {
        saved = (
          await StudioMusicCue.create({
            episodeId: episode._id,
            sceneId: scene.id,
            prompt,
            bufferSeconds,
            enabled,
            model: musicModel
          })
        ).toObject();
      } catch (error) {
        if (error.code === 11000) fail('A music plan already exists. Refresh before saving.', 409);
        throw error;
      }
    }
    return { cue: saved, ...musicState(episode, scene, saved) };
  }
  async function queue(args) {
    const requestId = text(args.requestId, 'Music request ID', 140, true);
    const existing = await Job.findOne({ requestId }).lean();
    if (existing) return { job: existing };
    if (!process.env.ELEVENLABS_API_KEY) fail('Configure the server ElevenLabs API key first.');
    if (!workflowEnabled()) fail('Enable the production approval workflow first.', 409);
    const { episode, scene, cue } = await target(args);
    if (!cue?.enabled) fail('Enable and approve the scene music brief first.', 409);
    await requireWorkflow(
      { scope: 'scene', recordId: String(episode._id), sceneId: scene.id },
      'music-plan'
    );
    const state = musicState(episode, scene, cue);
    if (state.generatedSeconds > 600) fail('Split music cues longer than ten minutes.');
    if (
      await Job.exists({
        kind: 'music',
        'payload.cueId': String(cue._id),
        status: { $in: ['queued', 'preparing', 'submitting', 'importing', 'uncertain'] }
      })
    )
      fail(
        'Music generation is already active or uncertain. Review its job before starting another.',
        409
      );
    let job;
    try {
      job = await Job.create({
        kind: 'music',
        requestId,
        title: `Music · ${scene.title}`,
        target: { episodeId: String(episode._id), sceneId: scene.id },
        status: 'queued',
        payload: { cueId: String(cue._id), prompt: cue.prompt, model: cue.model, ...state },
        snapshot: { fingerprint: state.fingerprint },
        quote: {
          currency: 'elevenlabs-credits',
          estimatedCredits: Math.ceil((state.generatedSeconds * 900) / 60),
          outputs: 1,
          estimatedRatePerMinute: 900,
          source:
            'Owner-reported 900 credits per minute; API pricing may differ. This is not a provider quote.'
        }
      });
    } catch (error) {
      if (error.code === 11000)
        fail(
          'A music request already exists or is active. Refresh its status before requesting another.',
          409
        );
      throw error;
    }
    return { job: job.toObject() };
  }
  async function current(job) {
    const state = await target(job.target);
    if (
      !state.cue?.enabled ||
      musicState(state.episode, state.scene, state.cue).fingerprint !== job.snapshot.fingerprint
    )
      fail(
        'The music brief or scene timing changed. Review the current brief before generating again.',
        409
      );
    await requireWorkflow(
      { scope: 'scene', recordId: job.target.episodeId, sceneId: job.target.sceneId },
      'music-plan'
    );
    return state;
  }
  const path = (file) => {
    if (basename(file.filename) !== file.filename) fail('Invalid audio path.');
    return join(mediaDirectory, file.filename);
  };
  async function prepare(raw, job) {
    const probe = JSON.parse(
      (
        await executeFile(
          process.env.FFPROBE_PATH || 'ffprobe',
          [
            '-v',
            'error',
            '-show_entries',
            'format=duration:stream=codec_type',
            '-of',
            'json',
            path(raw)
          ],
          { windowsHide: true, timeout: 30000, maxBuffer: 100000 }
        )
      ).stdout
    );
    const duration = Number(probe.format?.duration);
    if (!Number.isFinite(duration) || !probe.streams.some((s) => s.codec_type === 'audio'))
      fail('The music file has no readable audio.');
    const analysis = await executeFile(
      process.env.FFMPEG_PATH || 'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-i',
        path(raw),
        '-af',
        'silencedetect=noise=-60dB:d=0.15',
        '-f',
        'null',
        '-'
      ],
      { windowsHide: true, timeout: 120000, maxBuffer: 2000000 }
    );
    const qc = {
      ...audibleWindow(analysis.stderr, duration),
      originalSeconds: duration,
      targetSeconds: job.payload.targetSeconds,
      passed: false,
      preparedSeconds: null
    };
    if (qc.audibleSeconds + 0.03 < qc.targetSeconds) return { file: raw, qc };
    const temporary = await mkdtemp(join(tmpdir(), 'roxy-music-'));
    try {
      const output = join(temporary, 'prepared.wav');
      const filter = `atrim=start=${qc.leadingSeconds}:duration=${qc.targetSeconds},asetpts=PTS-STARTPTS,afade=t=out:st=${Math.max(0, qc.targetSeconds - 0.8)}:d=0.8`;
      await executeFile(
        process.env.FFMPEG_PATH || 'ffmpeg',
        [
          '-y',
          '-v',
          'error',
          '-nostdin',
          '-i',
          path(raw),
          '-af',
          filter,
          '-ar',
          '44100',
          '-ac',
          '2',
          '-c:a',
          'pcm_s16le',
          output
        ],
        { windowsHide: true, timeout: 120000, maxBuffer: 1000000 }
      );
      const file = (
        await saveGeneratedMedia(
          mediaDirectory,
          await readFile(output),
          `music-${job._id}-${qc.targetSeconds}s.wav`,
          {
            productionJobId: String(job._id) + '-prepared',
            musicCue: {
              episodeId: job.target.episodeId,
              sceneId: job.target.sceneId,
              cueId: job.payload.cueId,
              sourceMediaId: String(raw._id),
              fingerprint: job.snapshot.fingerprint
            }
          }
        )
      ).toObject();
      qc.passed = true;
      qc.preparedSeconds = qc.targetSeconds;
      return { file, qc };
    } finally {
      if (dirname(resolve(temporary)) === resolve(tmpdir()))
        await rm(temporary, { recursive: true, force: true });
    }
  }
  async function processJob(job) {
    try {
      if (job.status === 'queued') {
        const claim = await Job.updateOne(
          { _id: job._id, status: 'queued' },
          { $set: { status: 'preparing' } }
        );
        if (!claim.modifiedCount) return;
        await current(job);
        await Job.updateOne(
          { _id: job._id },
          {
            $set: {
              status: 'submitting',
              settings: {
                model: job.payload.model,
                musicLengthMs: Math.round(job.payload.generatedSeconds * 1000),
                outputs: 1,
                instrumental: true
              }
            }
          }
        );
        const response = await fetcher(
          'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128',
          {
            method: 'POST',
            headers: {
              'xi-api-key': process.env.ELEVENLABS_API_KEY,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              model_id: job.payload.model,
              prompt: job.payload.prompt,
              music_length_ms: Math.round(job.payload.generatedSeconds * 1000),
              force_instrumental: true
            }),
            signal: AbortSignal.timeout(300000)
          }
        );
        if (!response.ok)
          throw Object.assign(
            new Error(
              `ElevenLabs music failed (${response.status}). Check Music permission, subscription and credits; no automatic retry was made.`
            ),
            { status: 502, rejected: response.status < 500 }
          );
        const cost = Number(response.headers.get('character-cost'));
        await Job.updateOne(
          { _id: job._id },
          {
            $set: {
              receipt: {
                songId: response.headers.get('song-id'),
                creditsCharged:
                  response.headers.has('character-cost') && Number.isFinite(cost) ? cost : null
              }
            }
          }
        );
        const chunks = [];
        let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > 50 * 1024 * 1024) fail('Generated music exceeded the file limit.');
          chunks.push(chunk);
        }
        const raw = await saveGeneratedMedia(
          mediaDirectory,
          Buffer.concat(chunks),
          `music-original-${job._id}.mp3`,
          {
            productionJobId: String(job._id),
            musicCue: {
              cueId: job.payload.cueId,
              episodeId: job.target.episodeId,
              sceneId: job.target.sceneId,
              role: 'original'
            }
          }
        );
        await Job.updateOne(
          { _id: job._id },
          { $set: { status: 'importing', resultMediaIds: [String(raw._id)] } }
        );
      } else if (job.status !== 'importing') return;
      const latest = await Job.findById(job._id).lean();
      const raw = await StudioMedia.findById(latest.resultMediaIds[0]).lean();
      const state = await current(latest);
      const existing = state.cue.candidates.find((c) => c.id === 'music-' + job._id);
      let result = existing;
      if (!existing) {
        const prepared = await prepare(raw, latest);
        result = {
          id: 'music-' + job._id,
          mediaIds: [String(prepared.file._id)],
          sourceMediaId: String(raw._id),
          fingerprint: job.snapshot.fingerprint,
          prompt: job.payload.prompt,
          qc: prepared.qc,
          createdAt: new Date()
        };
        const fresh = await current(latest);
        const linked = await StudioMusicCue.updateOne(
          { _id: fresh.cue._id, revision: fresh.cue.revision },
          {
            $push: { candidates: result, history: { $each: [snapshot(fresh.cue)], $slice: -30 } },
            $inc: { revision: 1 }
          }
        );
        if (!linked.modifiedCount)
          fail(
            'The music record changed. Audio is retained in Media library; refresh before continuing.',
            409
          );
      }
      await Job.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'ready',
            resultMediaIds: [...new Set([...result.mediaIds, result.sourceMediaId])],
            error: result.qc.passed
              ? null
              : `Only ${result.qc.audibleSeconds.toFixed(2)} seconds of usable music for a ${result.qc.targetSeconds}-second scene. No paid retry was made.`
          }
        }
      );
    } catch (error) {
      const latest = await Job.findById(job._id).lean();
      await Job.updateOne(
        { _id: job._id },
        {
          $set: {
            status: latest?.status === 'submitting' && !error.rejected ? 'uncertain' : 'failed',
            error: error.status
              ? error.message
              : 'Music processing failed. Check the provider history and saved audio before retrying.'
          }
        }
      );
    }
  }
  async function reject(args) {
    const { cue } = await target(args);
    if (!cue || cue.revision !== revision(args.cueRevision))
      fail('The music record changed. Refresh before rejecting.', 409);
    const option = cue.candidates.find((c) => c.id === args.candidateId);
    if (!option) fail('Music take not found.', 404);
    await assertMediaAccess([...option.mediaIds, option.sourceMediaId]);
    await rejectMedia(mediaDirectory, String(option.mediaIds[0]), {
      musicCueId: String(cue._id),
      revision: cue.revision,
      candidateId: option.id
    });
    if (
      String(option.sourceMediaId) !== String(option.mediaIds[0]) &&
      (await StudioMedia.exists({ _id: option.sourceMediaId }))
    )
      await rejectMedia(mediaDirectory, String(option.sourceMediaId));
    return {
      deletedMediaIds: [...new Set([...option.mediaIds, option.sourceMediaId])],
      cue: await StudioMusicCue.findById(cue._id).lean()
    };
  }
  async function status(args) {
    const { episode, scene, cue } = await target(args);
    const ctx = await workflowContext();
    const t = { scope: 'scene', recordId: String(episode._id), sceneId: scene.id };
    return {
      cue,
      keyConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
      automation: await StudioAutomation.find({
        'target.recordId': String(episode._id),
        'target.sceneId': scene.id,
        'trigger.stage': 'music-plan'
      })
        .sort({ createdAt: -1 })
        .limit(3)
        .select('status error')
        .lean(),
      defaults: { prompt: musicPrompt(scene), bufferSeconds: 5, model: musicModel },
      ...musicState(episode, scene, cue ?? { bufferSeconds: 5 }),
      planReview: ctx.evaluate(t, 'music-plan'),
      takeReview: ctx.evaluate(t, 'music'),
      jobs: await Job.find({
        kind: 'music',
        'target.episodeId': String(episode._id),
        'target.sceneId': scene.id
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .select('status error title quote receipt.creditsCharged resultMediaIds createdAt')
        .lean()
    };
  }
  return { plan, queue, processJob, reject, status };
}
