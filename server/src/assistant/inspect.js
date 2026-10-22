import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { StudioEpisode, StudioMedia } from '../models/Studio.js';
import { fail, id } from '../studio-validation.js';

const execute = promisify(execFile);
export async function inspectMedia(mediaId, { mediaDirectory }) {
  const media = await StudioMedia.findById(id(mediaId)).lean();
  if (!media) fail('Media no longer exists.');
  if (basename(media.filename) !== media.filename) fail('Invalid media path.');
  const path = join(mediaDirectory, media.filename);
  const info = { mediaId, name: media.originalName, kind: media.kind, bytes: media.bytes };
  if (media.kind === 'image') {
    if (media.bytes > 12 * 1024 * 1024)
      fail('This image exceeds the assistant’s 12 MB inspection limit.');
    return {
      info,
      images: [
        {
          type: 'input_image',
          image_url: `data:${media.mime};base64,${(await readFile(path)).toString('base64')}`,
          detail: 'high'
        }
      ]
    };
  }
  if (media.kind === 'audio') {
    const episodes = await StudioEpisode.find({ 'scenes.clips.dialogueTakeIds': media._id }).lean();
    const savedDialogue = episodes.flatMap((e) =>
      e.scenes.flatMap((s) =>
        s.clips
          .filter((c) => c.dialogueTakeIds?.map(String).includes(mediaId))
          .map((c) => ({ episode: e.title, scene: s.title, clip: c.title, script: c.dialogue }))
      )
    );
    return {
      info: {
        ...info,
        savedDialogue,
        limitation:
          'Metadata and saved script text only, not a transcription. Audio was not heard or analyzed. Do not judge pronunciation, voice identity, effects or music from this information. Ask for the owner’s listening feedback.'
      }
    };
  }
  if (media.kind !== 'video') fail('This file cannot be inspected.');
  let directory;
  try {
    const probe = await execute(
      process.env.FFPROBE_PATH || 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path],
      { windowsHide: true, timeout: 15000, maxBuffer: 65536 }
    );
    const duration = Number(JSON.parse(probe.stdout).format.duration);
    if (!(duration > 0 && duration <= 600)) fail('Inspect video clips up to ten minutes long.');
    directory = await mkdtemp(join(tmpdir(), 'roxy-chat-frames-'));
    const images = [];
    const times = [0, duration / 2, Math.max(0, duration - 0.3)];
    for (let index = 0; index < times.length; index++) {
      const frame = join(directory, `${index}.jpg`);
      await execute(
        process.env.FFMPEG_PATH || 'ffmpeg',
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-ss',
          String(times[index]),
          '-i',
          path,
          '-frames:v',
          '1',
          '-vf',
          'scale=960:-2',
          '-q:v',
          '3',
          frame
        ],
        { windowsHide: true, timeout: 20000, maxBuffer: 65536 }
      );
      images.push({
        type: 'input_image',
        image_url: `data:image/jpeg;base64,${(await readFile(frame)).toString('base64')}`,
        detail: 'high'
      });
    }
    return {
      info: {
        ...info,
        duration,
        frameTimes: times,
        limitation:
          'Three sampled still frames only. Audio and motion between frames were not evaluated.'
      },
      images
    };
  } catch (error) {
    if (error.status) throw error;
    fail(
      'Video frames could not be read. Install FFmpeg/FFprobe on the studio PC or attach still frames.'
    );
  } finally {
    if (directory && dirname(resolve(directory)) === resolve(tmpdir()))
      await rm(directory, { recursive: true, force: true });
  }
}
