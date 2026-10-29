import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { promisify } from 'node:util';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import {
  captureTimes,
  createSourceCapture,
  registerSourceVideo,
  sourceTime,
  youtubeSource
} from '../src/assistant/source-capture.js';
import {
  StudioAsset,
  StudioEpisode,
  StudioMedia,
  StudioProject,
  StudioReview,
  StudioSourceEvidence
} from '../src/models/Studio.js';
import { withProject } from '../src/projects.js';
import { saveGeneratedMedia } from '../src/studio-media.js';

const execute = promisify(execFile),
  key = 'source-capture-test';
let directory, mongo, episode, bytes;
before(
  async () => {
    directory = await mkdtemp(join(tmpdir(), 'roxy-capture-test-'));
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri('source_capture'));
    await execute(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=640x360:rate=10:duration=4',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        join(directory, 'fixture.mp4')
      ],
      { windowsHide: true }
    );
    bytes = await readFile(join(directory, 'fixture.mp4'));
  },
  { timeout: 180000 }
);
beforeEach(async () => {
  for (const Model of [
    StudioAsset,
    StudioEpisode,
    StudioMedia,
    StudioProject,
    StudioReview,
    StudioSourceEvidence
  ])
    await Model.deleteMany({});
  await StudioProject.create({ key });
  await StudioProject.create({ key: 'other-source-project' });
  await withProject(key, async () => {
    episode = (
      await StudioEpisode.create({
        title: 'Gameplay',
        production: { sourceNotes: 'Keep approved research', outline: 'Keep approved outline' },
        sourceReferences: [
          {
            id: 'trials',
            title: 'Initial Trials',
            url: 'https://www.youtube.com/watch?v=ojIORTFv7WU',
            startSeconds: 1000,
            endSeconds: 1100,
            status: 'verified'
          }
        ],
        scenes: []
      })
    ).toObject();
    (
      await saveGeneratedMedia(directory, bytes, 'local-gameplay.mp4', {
        sourceVideo: {
          episodeId: String(episode._id),
          sourceId: 'trials',
          sourceUrl: episode.sourceReferences[0].url,
          startSeconds: 1036.5,
          endSeconds: 1040.5,
          alignment: 'owner-registered'
        }
      })
    ).toObject();
  });
});
after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true });
});
const args = () => ({
  episodeId: String(episode._id),
  sourceId: 'trials',
  timestamp: '17:18',
  nearbySeconds: 1
});

test('timestamp parsing and bounded sampling reject ambiguous, excessive or unsafe inputs', () => {
  assert.equal(sourceTime('17:18'), 1038);
  assert.equal(sourceTime('01:17:18.250'), 4638.25);
  assert.deepEqual(captureTimes({ timestamp: '17:18', nearbySeconds: 1 }), [1037, 1038, 1039]);
  assert.deepEqual(
    captureTimes({ startTime: '17:18', endTime: '17:22', intervalSeconds: 2 }),
    [1038, 1040, 1042]
  );
  for (const t of ['17:61', '-1', '../file', NaN, null]) assert.throws(() => sourceTime(t));
  assert.throws(() => captureTimes({ timestamp: 10, timestamps: [10] }));
  assert.throws(() => captureTimes({ startTime: 0, endTime: 12, intervalSeconds: 1 }));
  assert.throws(() => captureTimes({ timestamps: [0, 13] }));
  assert.equal(
    youtubeSource('https://youtu.be/ojIORTFv7WU?t=1000'),
    'https://www.youtube.com/watch?v=ojIORTFv7WU'
  );
  for (const url of [
    'http://youtube.com/watch?v=ojIORTFv7WU',
    'https://127.0.0.1/watch?v=ojIORTFv7WU',
    'https://youtube.com.evil.test/watch?v=ojIORTFv7WU',
    'https://user:secret@youtube.com/watch?v=ojIORTFv7WU',
    'file:///tmp/source'
  ])
    assert.throws(() => youtubeSource(url));
});
test('saved source seeks the original timeline, saves full frames and crops, reuses cache and preserves approvals', async () =>
  withProject(key, async () => {
    const original = JSON.parse(JSON.stringify(await StudioEpisode.findById(episode._id).lean()));
    await StudioReview.create({
      targetKey: 'unchanged',
      state: 'approved',
      fingerprint: 'keep-this',
      target: { scope: 'episode', recordId: String(episode._id) }
    });
    const reviews = JSON.parse(JSON.stringify(await StudioReview.find().lean()));
    const service = createSourceCapture({
      mediaDirectory: directory,
      downloadVideo: () => {
        throw new Error('Cached footage must not download');
      }
    });
    const result = await service.capture(args());
    assert.equal(result.info.cacheReused, true);
    assert.equal(result.info.frames.length, 3);
    assert.equal(result.images.filter((i) => i.type === 'input_image').length, 6);
    for (const frame of result.info.frames) {
      assert.ok(Math.abs(frame.sourceSeconds - frame.requestedSeconds) < 0.11);
      assert.equal(frame.videoSeconds, frame.requestedSeconds - 1036.5);
      const crop = await StudioMedia.findById(frame.subtitleCropMediaId).lean();
      const probe = JSON.parse(
        (
          await execute(
            'ffprobe',
            [
              '-v',
              'error',
              '-show_entries',
              'stream=width,height',
              '-of',
              'json',
              join(directory, crop.filename)
            ],
            { windowsHide: true }
          )
        ).stdout
      );
      assert.equal(probe.streams[0].height, 162);
    }
    const count = await StudioMedia.countDocuments(),
      again = await service.capture(args());
    assert.equal(await StudioMedia.countDocuments(), count);
    assert.deepEqual(
      again.info.frames.map((f) => f.mediaId),
      result.info.frames.map((f) => f.mediaId)
    );
    assert.equal((await StudioSourceEvidence.findOne().lean()).frames.length, 3);
    assert.deepEqual(
      JSON.parse(JSON.stringify(await StudioEpisode.findById(episode._id).lean())),
      original
    );
    assert.deepEqual(JSON.parse(JSON.stringify(await StudioReview.find().lean())), reviews);
    const lost = await StudioMedia.findById(result.info.frames[0].mediaId).lean();
    await unlink(join(directory, lost.filename));
    const repaired = await service.capture(args());
    assert.notEqual(repaired.info.frames[0].mediaId, result.info.frames[0].mediaId);
    assert.equal((await StudioSourceEvidence.findOne().lean()).frames.length, 3);
    assert.equal(
      (await StudioSourceEvidence.findOne().lean()).frames.find((f) => f.requestedSeconds === 1037)
        .mediaId,
      repaired.info.frames[0].mediaId
    );
  }));
test('source range and project boundaries fail before access to network or another workspace', async () => {
  let calls = 0;
  const service = createSourceCapture({
    mediaDirectory: directory,
    downloadVideo: () => {
      calls++;
      throw new Error('Should not download');
    }
  });
  await withProject(key, () =>
    assert.rejects(
      () => service.capture({ ...args(), timestamp: '19:00', nearbySeconds: 0 }),
      /saved source reference/
    )
  );
  await withProject('other-source-project', () =>
    assert.rejects(() => service.capture(args()), /Episode not found/)
  );
  assert.equal(calls, 0);
});
test('a short retrieved segment becomes a reusable mapped source; access failures invent no frames', async () =>
  withProject(key, async () => {
    await StudioMedia.deleteMany({});
    let calls = 0;
    const service = createSourceCapture({
      mediaDirectory: directory,
      downloadVideo: async ({ directory: temp }) => {
        calls++;
        const output = join(temp, 'source.mp4');
        await copyFile(join(directory, 'fixture.mp4'), output);
        return output;
      }
    });
    const result = await service.capture(args());
    assert.equal(calls, 1);
    assert.equal(result.info.cacheReused, false);
    assert.equal(result.info.frames.length, 3);
    await service.capture(args());
    assert.equal(calls, 1);
    const denied = createSourceCapture({
      mediaDirectory: directory,
      downloadVideo: () => {
        throw new Error('private downloader diagnostics');
      }
    });
    await assert.rejects(
      () => denied.capture({ ...args(), timestamp: '17:30', nearbySeconds: 0 }),
      (error) => error.status === 502 && !error.message.includes('private downloader')
    );
  }));
test('a source edited during capture cannot acquire evidence from the old reference', async () =>
  withProject(key, async () => {
    await StudioMedia.deleteMany({});
    const service = createSourceCapture({
      mediaDirectory: directory,
      downloadVideo: async ({ directory: temp }) => {
        await StudioEpisode.updateOne(
          { _id: episode._id },
          { $set: { 'sourceReferences.0.url': 'https://www.youtube.com/watch?v=abcdefghijk' } }
        );
        const output = join(temp, 'source.mp4');
        await copyFile(join(directory, 'fixture.mp4'), output);
        return output;
      }
    });
    await assert.rejects(() => service.capture(args()), /source reference changed/i);
    assert.equal(await StudioSourceEvidence.countDocuments(), 0);
  }));
test('owner-registered local copies map full or trimmed footage without changing episode approval state', async () =>
  withProject(key, async () => {
    const original = JSON.parse(JSON.stringify(await StudioEpisode.findById(episode._id).lean()));
    const file = await saveGeneratedMedia(directory, bytes, 'uploaded-source.mp4');
    const saved = await registerSourceVideo(
      {
        episodeId: String(episode._id),
        sourceId: 'trials',
        mediaId: String(file._id),
        originalStartTime: '17:16.500'
      },
      { mediaDirectory: directory }
    );
    assert.equal(saved.sourceVideo.startSeconds, 1036.5);
    assert.equal(saved.sourceVideo.endSeconds, 1040.5);
    await assert.rejects(
      () =>
        registerSourceVideo(
          {
            episodeId: String(episode._id),
            sourceId: 'trials',
            mediaId: String(file._id),
            originalStartTime: '17:17'
          },
          { mediaDirectory: directory }
        ),
      /different source mapping/
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(await StudioEpisode.findById(episode._id).lean())),
      original
    );
  }));
