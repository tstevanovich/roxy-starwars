import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { toError } from '../../../shared/errors.ts';
import {
  StudioAsset,
  StudioEpisode,
  StudioMedia,
  StudioProject,
  StudioReview,
  StudioSourceEvidence
} from '../models/Studio.ts';
import { withProject } from '../projects.ts';
import { saveGeneratedMedia } from '../studio-media.ts';
import {
  captureTimes,
  createSourceCapture,
  registerSourceVideo,
  runSourceCommand,
  sourceTime,
  youtubeSource
} from './source-capture.ts';

const execute = promisify(execFile),
  key = 'source-capture-test';
let directory: string, mongo: MongoMemoryServer, episode, bytes;

describe('source transport and unavailable evidence', () => {
  let captureModule: typeof import('./source-capture.ts'),
    savedEpisode,
    files,
    packet,
    manifest,
    fileSize,
    mediaRecord,
    update,
    executeFile,
    fs,
    models,
    nativeExec;
  const eid = '111111111111111111111111',
    mid = '222222222222222222222222';
  const q = (value) => ({
    lean: async () => value,
    sort: () => ({ lean: async () => value }),
    then: (resolve) => Promise.resolve(value).then(resolve)
  });
  beforeAll(async () => {
    vi.resetModules();
    fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    nativeExec = vi.fn();
    vi.doMock('node:child_process', () => ({ execFile: nativeExec }));
    vi.doMock('node:fs/promises', () => ({
      ...fs,
      mkdtemp: vi.fn(fs.mkdtemp),
      rm: vi.fn(fs.rm),
      readFile: vi.fn(async (path) =>
        String(path).endsWith('yt-dlp-reference-tool.json')
          ? JSON.stringify(manifest)
          : Buffer.from('fixture')
      ),
      access: vi.fn(async () => {}),
      stat: vi.fn(async () => ({ size: fileSize }))
    }));
    models = {
      StudioEpisode: { findById: vi.fn(() => q(savedEpisode)) },
      StudioMedia: {
        find: vi.fn(() => q(files)),
        findById: vi.fn(() => q(mediaRecord)),
        findOne: vi.fn(() => q(null)),
        updateOne: vi.fn(),
        findOneAndUpdate: vi.fn(() => q(mediaRecord))
      },
      StudioSourceEvidence: {
        findOne: vi.fn(() => q(null)),
        findOneAndUpdate: vi.fn(),
        updateOne: vi.fn(async () => update)
      }
    };
    vi.doMock('../models/Studio.ts', () => models);
    vi.doMock('../projects.ts', () => ({ assertMediaAccess: async () => {} }));
    vi.doMock('../source-evidence.ts', () => ({
      sourceEvidence: async () => (packet ? [packet] : [])
    }));
    vi.doMock('../studio-media.ts', () => ({
      saveGeneratedMedia: vi.fn(async (_dir, _bytes, name, extra) => ({
        _id: mid,
        filename: name,
        mime: 'image/png',
        sha256: 'hash',
        ...extra,
        toObject() {
          return { ...this };
        }
      }))
    }));
    captureModule = await import('./source-capture.ts');
  });
  beforeEach(() => {
    savedEpisode = {
      _id: eid,
      sourceReferences: [
        {
          id: 'source',
          title: 'Source',
          url: 'https://www.youtube.com/watch?v=ojIORTFv7WU',
          startSeconds: 0,
          endSeconds: 10
        }
      ]
    };
    files = [];
    packet = null;
    fileSize = 100;
    update = { matchedCount: 1 };
    mediaRecord = { _id: mid, filename: 'source.mp4', kind: 'video' };
    manifest = {
      path: 'yt-dlp-fixture.exe',
      sha256: createHash('sha256').update('fixture').digest('hex')
    };
    executeFile = vi.fn(async (_binary, args) => ({
      stdout: args.includes('json')
        ? JSON.stringify({
            format: { duration: 1.5 },
            streams: [{ codec_type: 'video', width: 640, height: 360 }]
          })
        : '',
      stderr: ''
    }));
  });
  afterAll(() => {
    for (const name of [
      'node:child_process',
      'node:fs/promises',
      '../models/Studio.ts',
      '../projects.ts',
      '../source-evidence.ts',
      '../studio-media.ts'
    ])
      vi.doUnmock(name);
    vi.resetModules();
  });
  const args = () => ({
    episodeId: eid,
    sourceId: 'source',
    timestamp: 1,
    includeSubtitleCrop: false
  });
  const client = (options = {}) =>
    captureModule.createSourceCapture({ mediaDirectory: directory, executeFile, ...options });
  test('verified downloader is invoked once for concurrent requests and its output is registered as evidence', async () => {
    const instance = client();
    const [a, b] = await Promise.all([instance.capture(args()), instance.capture(args())]);
    expect(a.info.frames).toEqual(b.info.frames);
    expect(a.info.frames).toHaveLength(1);
    expect(
      executeFile.mock.calls.filter(([binary]) => binary.endsWith('yt-dlp-fixture.exe'))
    ).toHaveLength(1);
  });
  test('downloader verification and execution fail closed without inventing frames', async () => {
    manifest.path = 'wrong.exe';
    await expect(client().capture(args())).rejects.toThrow('failed its verification');
    manifest.path = 'yt-dlp-fixture.exe';
    manifest.sha256 = 'wrong';
    await expect(client().capture(args())).rejects.toThrow('failed its verification');
    manifest.sha256 = createHash('sha256').update('fixture').digest('hex');
    executeFile.mockRejectedValueOnce(new Error('Downloader failed'));
    await expect(client().capture(args())).rejects.toThrow('YouTube could not supply');
    await expect(
      client({ downloadVideo: async () => 'C:/outside/source.mp4' }).capture(args())
    ).rejects.toThrow('invalid file');
    fileSize = 251 * 1024 * 1024;
    await expect(client().capture(args())).rejects.toThrow('file limit');
    fileSize = 100;
    executeFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '{"format":{"duration":90},"streams":[]}', stderr: '' });
    await expect(client().capture(args())).rejects.toThrow('could not be aligned');
  });
  test('legacy evidence can supply a video mapping and corrupt paths never escape the media directory', async () => {
    packet = { sourceId: 'source', videoMediaId: mid, startSeconds: 0, endSeconds: 10 };
    executeFile.mockImplementation(async (_binary, args) => ({
      stdout: args.includes('json')
        ? '{"format":{"duration":10},"streams":[{"codec_type":"video","width":640,"height":360}]}'
        : '',
      stderr: ''
    }));
    expect((await client().capture(args())).info.cacheReused).toBe(true);
    mediaRecord.filename = '../outside';
    executeFile.mockRejectedValueOnce(new Error('Cannot download'));
    await expect(client().capture(args())).rejects.toThrow('could not supply');
    mediaRecord = null;
    executeFile.mockImplementation(async (_binary, args) => ({
      stdout: args.includes('json')
        ? '{"format":{"duration":1.5},"streams":[{"codec_type":"video","width":640,"height":360}]}'
        : '',
      stderr: ''
    }));
    expect((await client().capture(args())).info.cacheReused).toBe(false);
  });
  test('decoded frames and evidence writes cannot move beyond the saved source range', async () => {
    executeFile.mockImplementation(async (_binary, args) => ({
      stdout: args.includes('json')
        ? '{"format":{"duration":1.5},"streams":[{"codec_type":"video","width":640,"height":360}]}'
        : '',
      stderr: 'pts_time:10'
    }));
    await expect(client().capture(args())).rejects.toThrow('beyond this source range');
    executeFile.mockImplementation(async (_binary, args) => ({
      stdout: args.includes('json')
        ? '{"format":{"duration":1.5},"streams":[{"codec_type":"video","width":640,"height":360}]}'
        : '',
      stderr: ''
    }));
    update = { matchedCount: 0 };
    await expect(client().capture(args())).rejects.toThrow('evidence changed while saving');
  });
  test('a missing cached subtitle crop is rebuilt from its saved frame', async () => {
    models.StudioMedia.findOne.mockImplementation((filter) =>
      q(
        filter['sourceFrame.view'] === 'subtitle-crop'
          ? { _id: mid, filename: '../missing' }
          : { _id: mid, filename: 'frame.png', sourceFrame: { sourceSeconds: 1 } }
      )
    );
    try {
      const result = await client().capture({ ...args(), includeSubtitleCrop: true });
      expect(result.info.frames[0].subtitleCropMediaId).toBe(mid);
    } finally {
      models.StudioMedia.findOne.mockImplementation(() => q(null));
    }
  });
  test('capture enforces its response image budget and supports open-ended source ranges', async () => {
    const tempFs = await import('node:fs/promises');
    vi.mocked(tempFs.readFile).mockResolvedValueOnce(Buffer.alloc(13 * 1024 * 1024) as never);
    models.StudioMedia.findOne.mockImplementation((filter) =>
      q(
        filter['sourceFrame.view'] === 'full'
          ? { _id: mid, filename: 'frame.png', sourceFrame: { sourceSeconds: 1 } }
          : null
      )
    );
    try {
      files = [
        { ...mediaRecord, sourceVideo: { sourceId: 'source', startSeconds: 0, endSeconds: 1.5 } }
      ];
      const result = await client().capture(args());
      expect(result.images).toEqual([]);
    } finally {
      models.StudioMedia.findOne.mockImplementation(() => q(null));
    }
    delete savedEpisode.sourceReferences[0].endSeconds;
    files = [];
    expect((await client().capture(args())).info.frames).toHaveLength(1);
    await captureModule.registerSourceVideo(
      { episodeId: eid, sourceId: 'source', mediaId: mid, originalStartTime: 0 },
      { mediaDirectory: directory, executeFile }
    );
    delete savedEpisode.sourceReferences;
    await expect(client().capture(args())).rejects.toThrow('Choose one saved source');
  });
  test('source registration rejects missing sources, generated media, invalid paths, durations and nonoverlapping copies', async () => {
    const fields = { episodeId: eid, sourceId: 'source', mediaId: mid, originalStartTime: 0 };
    const register = (extra = {}) =>
      captureModule.registerSourceVideo(
        { ...fields, ...extra },
        { mediaDirectory: directory, executeFile }
      );
    await expect(register({ sourceId: 'missing' })).rejects.toThrow('Save the source');
    mediaRecord.kind = 'audio';
    await expect(register()).rejects.toThrow('uploaded gameplay');
    mediaRecord.kind = 'video';
    mediaRecord.filename = '../outside';
    await expect(register()).rejects.toThrow('Invalid stored source path');
    mediaRecord.filename = 'source.mp4';
    for (const duration of [0, 'unknown', 86401]) {
      executeFile.mockResolvedValueOnce({
        stdout: JSON.stringify({ format: { duration }, streams: [{ codec_type: 'video' }] })
      });
      await expect(register()).rejects.toThrow('known duration');
    }
    await expect(register({ originalStartTime: 10 })).rejects.toThrow('does not overlap');
    savedEpisode.sourceReferences[0].startSeconds = 5;
    await expect(register()).rejects.toThrow('does not overlap');
  });
  test('cancelled child processes reject even if the command exits without an error', async () => {
    const kill = vi.fn();
    nativeExec.mockImplementation((_file, _args, _options, callback) => ({
      kill: (signal) => {
        kill(signal);
        queueMicrotask(() => callback(null, '', ''));
      }
    }));
    await expect(
      captureModule.runSourceCommand('fixture', [], { signal: AbortSignal.abort() })
    ).rejects.toThrow('cancelled or timed out');
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });
  test('temporary-directory failures and unexpected directories never cause an unsafe cleanup', async () => {
    const tempFs = await import('node:fs/promises');
    vi.mocked(tempFs.mkdtemp).mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(client().capture(args())).rejects.toThrow('Source-frame capture failed');
    vi.mocked(tempFs.mkdtemp).mockResolvedValueOnce('C:/outside-studio-test/missing');
    await client().capture(args());
    expect(tempFs.rm).not.toHaveBeenCalledWith('C:/outside-studio-test/missing', expect.anything());
  });
});
test('source timestamps and sampling reject invalid ranges before acquiring media', async () => {
  expect(() => sourceTime('25:00:00')).toThrow('24 hours');
  for (const nearbySeconds of [0.5, -1, 3])
    expect(() => captureTimes({ timestamp: 5, nearbySeconds })).toThrow('Nearby sampling');
  for (const timestamps of [null, [], Array(7).fill(1)])
    expect(() => captureTimes({ timestamps })).toThrow('one and six');
  for (const args of [
    { startTime: 2, endTime: 1 },
    { startTime: 0, endTime: 13 },
    { startTime: 0, endTime: 1, intervalSeconds: '1' },
    { startTime: 0, endTime: 1, intervalSeconds: Infinity },
    { startTime: 0, endTime: 1, intervalSeconds: 0.1 },
    { startTime: 0, endTime: 1, intervalSeconds: 13 }
  ])
    expect(() => captureTimes(args)).toThrow('range');
  expect(captureTimes({ timestamp: 5 })).toEqual([5]);
  expect(captureTimes({ startTime: 0, endTime: 1 })).toEqual([0, 1]);
  for (const url of [
    'invalid',
    'https://youtube.com/shorts/ojIORTFv7WU',
    'https://example.org/watch?v=ojIORTFv7WU'
  ])
    expect(() => youtubeSource(url)).toThrow();
  await expect(runSourceCommand(process.execPath, ['-e', 'process.exit(2)'])).rejects.toThrow();
  await expect(
    runSourceCommand(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 50 })
  ).rejects.toThrow();
  await expect(
    runSourceCommand(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], {
      signal: AbortSignal.abort()
    })
  ).rejects.toThrow();
});
beforeAll(async () => {
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
}, 180000);
beforeEach(async () => {
  for (const Model of [
    StudioAsset,
    StudioEpisode,
    StudioMedia,
    StudioProject,
    StudioReview,
    StudioSourceEvidence
  ])
    await Model.deleteMany();
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
afterAll(async () => {
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
      target: { scope: 'episode' as const, recordId: String(episode._id) }
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
      (error) =>
        toError(error).status === 502 && !toError(error).message.includes('private downloader')
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
