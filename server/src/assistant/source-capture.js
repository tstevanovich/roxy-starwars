import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { StudioEpisode, StudioMedia, StudioSourceEvidence } from '../models/Studio.js';
import { projectKey } from '../project-context.js';
import { assertMediaAccess } from '../projects.js';
import { sourceEvidence } from '../source-evidence.js';
import { saveGeneratedMedia } from '../studio-media.js';
import { fail, id, object } from '../studio-validation.js';

const toolRoot = fileURLToPath(new URL('../../../.data/tools/', import.meta.url));
// A cancelled download also stops the FFmpeg child launched by yt-dlp.
export function runSourceCommand(file, args, { timeout = 30000, signal, ...options } = {}) {
  return new Promise((resolve, reject) => {
    let stopped = false,
      timer;
    const stop = () => {
      stopped = true;
      if (process.platform === 'win32' && child.pid)
        execFile(
          'taskkill',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true },
          () => {}
        );
      else child.kill('SIGKILL');
    };
    const child = execFile(
      file,
      args,
      { ...options, windowsHide: true },
      (error, stdout, stderr) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        if (error || stopped)
          reject(error ?? new Error('Source capture was cancelled or timed out.'));
        else resolve({ stdout, stderr });
      }
    );
    timer = setTimeout(stop, timeout);
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
  });
}
export function sourceTime(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400)
    return value;
  if (typeof value !== 'string' || !/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(value))
    fail('Use original-video seconds or a timestamp such as 17:18 or 01:17:18.250.');
  const parts = value.split(':').map(Number);
  if (parts.slice(1).some((n) => n >= 60)) fail('Timestamp minutes and seconds must be below 60.');
  const result = parts.reduce((n, p) => n * 60 + p, 0);
  if (result > 86400) fail('Source timestamp exceeds 24 hours.');
  return result;
}
export function captureTimes(args) {
  const modes = [
    args.timestamp !== undefined,
    args.timestamps !== undefined,
    args.startTime !== undefined || args.endTime !== undefined
  ].filter(Boolean).length;
  if (modes !== 1) fail('Choose one timestamp, a timestamps list, or a start/end range.');
  let times;
  if (args.timestamp !== undefined) {
    const t = sourceTime(args.timestamp),
      nearby = args.nearbySeconds ?? 0;
    if (!Number.isInteger(nearby) || nearby < 0 || nearby > 2)
      fail('Nearby sampling must be 0, 1 or 2 seconds.');
    times = Array.from({ length: nearby * 2 + 1 }, (_, i) => t + i - nearby);
  } else if (args.timestamps !== undefined) {
    if (!Array.isArray(args.timestamps) || !args.timestamps.length || args.timestamps.length > 6)
      fail('Capture between one and six timestamps per request.');
    times = args.timestamps.map(sourceTime);
  } else {
    const start = sourceTime(args.startTime),
      end = sourceTime(args.endTime),
      step = args.intervalSeconds ?? 1;
    if (
      end < start ||
      end - start > 12 ||
      typeof step !== 'number' ||
      !Number.isFinite(step) ||
      step < 0.25 ||
      step > 12
    )
      fail('Use a range of at most 12 seconds with an interval between 0.25 and 12 seconds.');
    times = [];
    for (let t = start; t <= end + 0.00001; t += step) {
      times.push(Number(t.toFixed(3)));
      if (times.length > 6)
        fail(
          'This range creates more than six frames. Increase the interval or shorten the range.'
        );
    }
  }
  times = [...new Set(times)].sort((a, b) => a - b);
  if (times.some((t) => t < 0) || times.at(-1) - times[0] > 12)
    fail('Capture timestamps within a single 12-second window.');
  return times;
}
export function youtubeSource(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    fail('This source needs a saved video copy or a YouTube URL.');
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port)
    fail('Use a normal HTTPS YouTube source URL.');
  const videoId =
    u.hostname === 'youtu.be'
      ? u.pathname.slice(1)
      : ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(u.hostname) &&
          u.pathname === '/watch'
        ? u.searchParams.get('v')
        : null;
  if (!/^[\w-]{11}$/.test(videoId ?? ''))
    fail('This source needs a saved video copy or a supported YouTube watch URL.');
  return 'https://www.youtube.com/watch?v=' + videoId;
}
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createSourceCapture({
  mediaDirectory,
  executeFile = runSourceCommand,
  downloadVideo,
  signal
} = {}) {
  const locks = new Map();
  const storedPath = (file) => {
    if (!file || basename(file.filename) !== file.filename)
      fail('The saved source file is missing or has an invalid path.', 409);
    return join(mediaDirectory, file.filename);
  };
  const probe = async (file) =>
    JSON.parse(
      (
        await executeFile(
          process.env.FFPROBE_PATH || 'ffprobe',
          [
            '-v',
            'error',
            '-show_entries',
            'format=duration:stream=codec_type,width,height',
            '-of',
            'json',
            storedPath(file)
          ],
          { windowsHide: true, timeout: 30000, maxBuffer: 100000, signal }
        )
      ).stdout
    );
  async function fetchVideo({ source, start, end, directory }) {
    const url = youtubeSource(source.url);
    const manifest = JSON.parse(
      await readFile(join(toolRoot, 'yt-dlp-reference-tool.json'), 'utf8')
    );
    const binary = resolve(toolRoot, basename(manifest.path));
    if (
      dirname(binary) !== resolve(toolRoot) ||
      !/^yt-dlp[\w.-]*\.exe$/.test(basename(binary)) ||
      createHash('sha256')
        .update(await readFile(binary))
        .digest('hex') !== manifest.sha256
    )
      fail(
        'The installed source-video downloader failed its verification. Repair the studio downloader before capturing YouTube frames.',
        503
      );
    const output = join(directory, 'source.%(ext)s');
    try {
      await executeFile(
        binary,
        [
          '--ignore-config',
          '--no-playlist',
          '--no-progress',
          '--no-warnings',
          '--no-cache-dir',
          '--js-runtimes',
          'node:' + process.execPath,
          '--socket-timeout',
          '15',
          '--retries',
          '0',
          '--extractor-retries',
          '0',
          '--max-filesize',
          '200M',
          '--download-sections',
          `*${start}-${end}`,
          '--force-keyframes-at-cuts',
          '-f',
          'bv[height<=1080][ext=mp4]/b[height<=1080][ext=mp4]',
          '--remux-video',
          'mp4',
          '-o',
          output,
          url
        ],
        { windowsHide: true, timeout: 120000, maxBuffer: 2000000, signal }
      );
      return join(directory, 'source.mp4');
    } catch (cause) {
      throw Object.assign(
        new Error(
          'The saved source does not cover this timestamp and YouTube could not supply the requested segment. No frame was invented. Retry source access or attach a source-video copy to this source reference.'
        ),
        { status: 502, cause }
      );
    }
  }
  async function capture(args) {
    object(args);
    const episode = await StudioEpisode.findById(id(args.episodeId)).lean();
    if (!episode) fail('Episode not found.', 404);
    const times = captureTimes(args),
      matches = (episode.sourceReferences ?? []).filter(
        (r) =>
          (!args.sourceId || r.id === args.sourceId) &&
          times.every((t) => t >= r.startSeconds && (r.endSeconds == null || t < r.endSeconds))
      );
    if (matches.length !== 1)
      fail(
        'Choose one saved source reference covering every requested original-video timestamp. Use its sourceId when ranges overlap.'
      );
    const source = matches[0],
      key = hash({
        project: projectKey(),
        episodeId: String(episode._id),
        source,
        times,
        crop: args.includeSubtitleCrop !== false
      });
    if (locks.has(key)) return locks.get(key);
    const work = perform(episode, source, times, args.includeSubtitleCrop !== false);
    locks.set(key, work);
    try {
      return await work;
    } finally {
      locks.delete(key);
    }
  }
  async function perform(episode, source, times, crop) {
    const eid = String(episode._id),
      packets = await sourceEvidence(episode),
      packet = packets.find((p) => p.sourceId === source.id);
    const clipRecords = await StudioMedia.find({
      kind: 'video',
      'sourceVideo.episodeId': eid,
      'sourceVideo.sourceUrl': source.url
    }).lean();
    const options = clipRecords.map((file) => ({
      file,
      start: file.sourceVideo.startSeconds,
      end: file.sourceVideo.endSeconds
    }));
    if (packet?.videoMediaId) {
      const file = await StudioMedia.findById(packet.videoMediaId).lean();
      if (file)
        options.push({
          file,
          start: packet.videoStartSeconds ?? packet.startSeconds,
          end: packet.endSeconds,
          legacy: true
        });
    }
    let chosen;
    for (const option of options.filter((o) => times[0] >= o.start && times.at(-1) < o.end)) {
      try {
        await assertMediaAccess([String(option.file._id)]);
        await access(storedPath(option.file));
        const info = await probe(option.file),
          video = info.streams?.find((s) => s.codec_type === 'video');
        if (
          video &&
          Number(info.format.duration) >= times.at(-1) - option.start &&
          Math.abs(Number(info.format.duration) - (option.end - option.start)) < 1
        ) {
          chosen = { ...option, width: video.width, height: video.height };
          break;
        }
      } catch {
        /* Missing or unmapped cached sources cannot supply evidence. */
      }
    }
    let directory;
    const cacheReused = Boolean(chosen);
    try {
      directory = await mkdtemp(join(tmpdir(), 'roxy-source-capture-'));
      if (!chosen) {
        const start = Math.max(source.startSeconds, times[0] - 0.5),
          end = Math.min(source.endSeconds ?? 86400, times.at(-1) + 1);
        const path = await (downloadVideo ?? fetchVideo)({ source, start, end, directory, signal });
        if (dirname(resolve(path)) !== resolve(directory))
          fail('The source downloader returned an invalid file.');
        if ((await stat(path)).size > 250 * 1024 * 1024)
          fail('Source segment exceeds the studio file limit.');
        const file = await saveGeneratedMedia(
          mediaDirectory,
          await readFile(path),
          `SOURCE-${source.id}-${start}s-${end}s.mp4`
        );
        const info = await probe(file),
          video = info.streams?.find((s) => s.codec_type === 'video');
        if (
          !video ||
          !Number.isFinite(Number(info.format?.duration)) ||
          Math.abs(Number(info.format.duration) - (end - start)) > 1
        )
          fail(
            'The downloaded segment could not be aligned to the source timeline. It was retained for inspection, but no timestamped evidence was registered.',
            502
          );
        await StudioMedia.updateOne(
          { _id: file._id },
          {
            $set: {
              sourceVideo: {
                episodeId: eid,
                sourceId: source.id,
                sourceUrl: source.url,
                startSeconds: start,
                endSeconds: end,
                alignment: 'verified-section'
              }
            }
          }
        );
        chosen = { file: file.toObject(), start, end, width: video.width, height: video.height };
      }
      const frames = [],
        images = [];
      let imageBytes = 0;
      for (const time of times) {
        const captureKey = hash({
          sourceUrl: source.url,
          sourceId: source.id,
          start: source.startSeconds,
          end: source.endSeconds,
          time,
          videoSha: chosen.file.sha256,
          crop
        });
        let file = await StudioMedia.findOne({
          'sourceFrame.captureKey': captureKey,
          'sourceFrame.view': 'full'
        })
          .sort({ createdAt: -1 })
          .lean();
        let cropFile = await StudioMedia.findOne({
          'sourceFrame.captureKey': captureKey,
          'sourceFrame.view': 'subtitle-crop'
        })
          .sort({ createdAt: -1 })
          .lean();
        let actual = time;
        if (file) {
          try {
            await access(storedPath(file));
            actual = file.sourceFrame.sourceSeconds;
          } catch {
            file = null;
          }
        }
        if (!file) {
          const output = join(directory, `frame-${frames.length}.png`);
          const result = await executeFile(
            process.env.FFMPEG_PATH || 'ffmpeg',
            [
              '-y',
              '-nostdin',
              '-hide_banner',
              '-loglevel',
              'info',
              '-ss',
              String(time - chosen.start),
              '-i',
              storedPath(chosen.file),
              '-frames:v',
              '1',
              '-vf',
              'showinfo',
              output
            ],
            { windowsHide: true, timeout: 30000, maxBuffer: 2000000, signal }
          );
          const offset = Number(result.stderr.match(/pts_time:([\d.e+-]+)/)?.[1] ?? 0);
          actual = Number((time + offset).toFixed(6));
          if (source.endSeconds !== null && actual >= source.endSeconds)
            fail(
              'The requested time rounds beyond this source range. Capture a slightly earlier frame.'
            );
          const provenance = {
            captureKey,
            episodeId: eid,
            sourceId: source.id,
            sourceUrl: source.url,
            sourceStartSeconds: chosen.start,
            sourceVideoMediaId: String(chosen.file._id),
            requestedSeconds: time,
            sourceSeconds: actual,
            videoSeconds: time - chosen.start,
            width: chosen.width,
            height: chosen.height,
            view: 'full'
          };
          file = (
            await saveGeneratedMedia(
              mediaDirectory,
              await readFile(output),
              `SOURCE-FRAME-${source.id}-${time}s.png`,
              { sourceFrame: provenance }
            )
          ).toObject();
        }
        if (crop) {
          if (cropFile) {
            try {
              await access(storedPath(cropFile));
            } catch {
              cropFile = null;
            }
          }
          if (!cropFile) {
            const output = join(directory, `subtitle-${frames.length}.png`);
            await executeFile(
              process.env.FFMPEG_PATH || 'ffmpeg',
              [
                '-y',
                '-nostdin',
                '-v',
                'error',
                '-i',
                storedPath(file),
                '-frames:v',
                '1',
                '-vf',
                'crop=iw:floor(ih*0.45):0:ih-floor(ih*0.45)',
                output
              ],
              { windowsHide: true, timeout: 30000, maxBuffer: 100000, signal }
            );
            cropFile = (
              await saveGeneratedMedia(
                mediaDirectory,
                await readFile(output),
                `SOURCE-SUBTITLE-${source.id}-${time}s.png`,
                {
                  sourceFrame: {
                    ...file.sourceFrame,
                    view: 'subtitle-crop',
                    fullFrameMediaId: String(file._id)
                  }
                }
              )
            ).toObject();
          }
        }
        frames.push({
          captureKey,
          mediaId: String(file._id),
          subtitleCropMediaId: cropFile ? String(cropFile._id) : null,
          sourceSeconds: actual,
          requestedSeconds: time,
          videoSeconds: time - chosen.start,
          videoMediaId: String(chosen.file._id),
          overview: false,
          captured: true,
          width: chosen.width,
          height: chosen.height
        });
        for (const [record, view] of [
          [file, 'full frame'],
          [cropFile, 'lower-frame subtitle crop']
        ].filter(([record]) => record)) {
          const bytes = await readFile(storedPath(record));
          if (imageBytes + bytes.length > 12 * 1024 * 1024) continue;
          imageBytes += bytes.length;
          images.push(
            {
              type: 'input_text',
              text: `Original video timestamp requested: ${time}s; decoded frame timestamp: ${actual}s. ${view}; saved media ID ${record._id}. Read visible text only; subtitle crop may include UI choices, not necessarily spoken dialogue.`
            },
            {
              type: 'input_image',
              image_url: `data:${record.mime};base64,${bytes.toString('base64')}`,
              detail: 'high'
            }
          );
        }
      }
      const fresh = await StudioEpisode.findById(episode._id).lean();
      if (
        !fresh?.sourceReferences?.some(
          (r) =>
            r.id === source.id &&
            r.url === source.url &&
            r.startSeconds === source.startSeconds &&
            r.endSeconds === source.endSeconds
        )
      )
        fail(
          'The source reference changed during capture. Images were retained, but not attached to the changed source. Capture again against its current range.',
          409
        );
      const existing = await StudioSourceEvidence.findOne({
        episodeId: eid,
        sourceId: source.id
      }).lean();
      const same =
        existing &&
        existing.sourceUrl === source.url &&
        existing.startSeconds === source.startSeconds &&
        existing.endSeconds === source.endSeconds;
      const fields = {
        sourceUrl: source.url,
        startSeconds: source.startSeconds,
        endSeconds: source.endSeconds
      };
      if (!same)
        Object.assign(fields, {
          title: source.title + ' — captured source frames',
          observations:
            'Actual saved source-video frames at the listed timestamps. Read visible subtitles and dialogue choices from these images; no transcript or selected decision is inferred by capture.',
          limitations:
            'Frames show visible text only. Audio has not been transcribed. Frame timestamps may round to the next decoded frame. A subtitle crop can contain dialogue-wheel choices; distinguish these from spoken subtitles.',
          frames: [],
          videoSegments: [],
          captions: [],
          videoMediaId: null
        });
      const segment = {
        videoMediaId: String(chosen.file._id),
        startSeconds: chosen.start,
        endSeconds: chosen.end,
        width: chosen.width,
        height: chosen.height
      };
      if (!same) {
        await StudioSourceEvidence.findOneAndUpdate(
          { episodeId: eid, sourceId: source.id },
          { $set: fields },
          { upsert: true, returnDocument: 'after' }
        );
      }
      const binding = {
        episodeId: eid,
        sourceId: source.id,
        sourceUrl: fields.sourceUrl,
        startSeconds: fields.startSeconds,
        endSeconds: fields.endSeconds
      };
      for (const frame of frames) {
        const changed = await StudioSourceEvidence.updateOne(
          { ...binding, 'frames.captureKey': frame.captureKey },
          { $set: { 'frames.$': frame } }
        );
        if (!changed.matchedCount)
          await StudioSourceEvidence.updateOne(
            { ...binding, frames: { $not: { $elemMatch: { captureKey: frame.captureKey } } } },
            { $push: { frames: frame } }
          );
      }
      const saved = await StudioSourceEvidence.updateOne(
        {
          episodeId: eid,
          sourceId: source.id,
          sourceUrl: fields.sourceUrl,
          startSeconds: fields.startSeconds,
          endSeconds: fields.endSeconds
        },
        { $addToSet: { videoSegments: segment } }
      );
      if (!saved.matchedCount)
        fail(
          'The source evidence changed while saving. Files were retained; retry against the current source.',
          409
        );
      return {
        info: {
          episodeId: eid,
          sourceId: source.id,
          sourceUrl: source.url,
          frames,
          width: chosen.width,
          height: chosen.height,
          cacheReused,
          limitation:
            'Actual captured source frames, not AI images. Read visible words; no speech transcription or story choice verification is implied. Saved images can be inspected again with inspect_media. Research captures do not alter approvals.'
        },
        images
      };
    } catch (error) {
      if (error.status) throw error;
      fail(
        'Source-frame capture failed. Check the saved source video and FFmpeg/downloader on the studio PC. No frame was invented.',
        502
      );
    } finally {
      if (directory && dirname(resolve(directory)) === resolve(tmpdir()))
        await rm(directory, { recursive: true, force: true });
    }
  }
  return { capture };
}
export async function registerSourceVideo(
  args,
  { mediaDirectory, executeFile = runSourceCommand } = {}
) {
  object(args);
  const episode = await StudioEpisode.findById(id(args.episodeId)).lean(),
    source = episode?.sourceReferences?.find((r) => r.id === args.sourceId);
  if (!source) fail('Save the source reference before attaching its video.', 409);
  const mediaId = id(args.mediaId);
  await assertMediaAccess([mediaId]);
  const file = await StudioMedia.findById(mediaId).lean();
  if (file?.kind !== 'video' || file.productionJobId || file.nativeAudio || file.soundMix)
    fail('Choose an uploaded gameplay source video, separate from generated production takes.');
  if (basename(file.filename) !== file.filename) fail('Invalid stored source path.');
  const start = sourceTime(args.originalStartTime);
  const info = JSON.parse(
    (
      await executeFile(
        process.env.FFPROBE_PATH || 'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration:stream=codec_type,width,height',
          '-of',
          'json',
          join(mediaDirectory, file.filename)
        ],
        { windowsHide: true, timeout: 30000, maxBuffer: 100000 }
      )
    ).stdout
  );
  const duration = Number(info.format?.duration);
  if (
    !info.streams?.some((s) => s.codec_type === 'video') ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    start + duration > 86400
  )
    fail('Choose a readable source video with a known duration.');
  if (start >= (source.endSeconds ?? 86400) || start + duration <= source.startSeconds)
    fail(
      'This copy does not overlap the saved source range. Check the original timestamp of its first frame.'
    );
  const sourceVideo = {
    episodeId: String(episode._id),
    sourceId: source.id,
    sourceUrl: source.url,
    startSeconds: start,
    endSeconds: start + duration,
    alignment: 'owner-registered'
  };
  if (
    file.sourceVideo &&
    (file.sourceVideo.sourceUrl !== source.url ||
      file.sourceVideo.episodeId !== String(episode._id) ||
      file.sourceVideo.startSeconds !== start)
  )
    fail(
      'This copy already has a different source mapping. Upload a separate copy to preserve its existing evidence.',
      409
    );
  return StudioMedia.findOneAndUpdate(
    { _id: mediaId },
    { $set: { sourceVideo } },
    { returnDocument: 'after' }
  ).lean();
}
