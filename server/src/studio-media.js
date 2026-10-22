import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import express from 'express';

import { StudioMedia } from './models/Studio.js';
import { rejectMedia } from './studio-reject-media.js';
import { fail, id } from './studio-validation.js';

const formats = {
  '.png': [
    'image/png',
    'image',
    (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ],
  '.jpg': ['image/jpeg', 'image', (b) => b[0] === 255 && b[1] === 216 && b[2] === 255],
  '.jpeg': ['image/jpeg', 'image', (b) => b[0] === 255 && b[1] === 216 && b[2] === 255],
  '.webp': [
    'image/webp',
    'image',
    (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
  ],
  '.gif': ['image/gif', 'image', (b) => /^GIF8[79]a$/.test(b.toString('ascii', 0, 6))],
  '.mp4': ['video/mp4', 'video', (b) => b.toString('ascii', 4, 8) === 'ftyp'],
  '.webm': ['video/webm', 'video', (b) => b.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))],
  '.mp3': [
    'audio/mpeg',
    'audio',
    (b) => b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 255 && (b[1] & 224) === 224)
  ],
  '.wav': [
    'audio/wav',
    'audio',
    (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE'
  ],
  '.m4a': ['audio/mp4', 'audio', (b) => b.toString('ascii', 4, 8) === 'ftyp'],
  '.ogg': ['audio/ogg', 'audio', (b) => b.toString('ascii', 0, 4) === 'OggS']
};
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let n = 0; n < 8; n++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  return value >>> 0;
});
export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function mediaView(media) {
  const record = { ...media };
  delete record.filename;
  delete record.providerReference;
  return { ...record, url: `/api/studio/media/${media._id}` };
}
export async function saveGeneratedMedia(directory, buffer, originalName, extra = {}) {
  const format = formats[extname(originalName).toLowerCase()];
  if (
    !format ||
    !Buffer.isBuffer(buffer) ||
    buffer.length < 12 ||
    buffer.length > 250 * 1024 * 1024 ||
    !format[2](buffer)
  )
    fail('The generated file is not a supported media file.');
  const filename = `${randomUUID()}${extname(originalName).toLowerCase()}`;
  await mkdir(directory, { recursive: true });
  const target = join(directory, filename);
  await writeFile(target, buffer, { flag: 'wx' });
  try {
    return await StudioMedia.create({
      ...extra,
      filename,
      originalName,
      mime: format[0],
      kind: format[1],
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      crc32: crc32(buffer)
    });
  } catch (error) {
    await unlink(target);
    throw error;
  }
}
export function mediaRouter(directory) {
  const router = express.Router();
  router.delete('/:id', express.json({ limit: '16kb' }), async (req, res) => {
    res.json(await rejectMedia(directory, req.params.id, req.body ?? {}));
  });
  // The bounded raw parser handles chunked uploads and rejects oversized bodies before saving.
  router.post('/', express.raw({ type: () => true, limit: '250mb' }), async (req, res) => {
    let originalName;
    try {
      originalName = decodeURIComponent(req.get('X-File-Name') ?? '');
    } catch {
      fail('Invalid filename.');
    }
    if (
      !originalName ||
      originalName.length > 240 ||
      /[/\\]/.test(originalName) ||
      [...originalName].some((c) => c.charCodeAt(0) < 32)
    )
      fail('Choose a valid local filename.');
    const format = formats[extname(originalName).toLowerCase()];
    if (!format) fail('Supported files: PNG, JPG, WebP, GIF, MP4, WebM, MP3, WAV, M4A, and OGG.');
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length < 12 || !format[2](buffer))
      fail('The file content does not match its extension.');
    const filename = `${randomUUID()}${extname(originalName).toLowerCase()}`;
    await mkdir(directory, { recursive: true });
    const target = join(directory, filename);
    await writeFile(target, buffer, { flag: 'wx' });
    try {
      const media = await StudioMedia.create({
        filename,
        originalName,
        mime: format[0],
        kind: format[1],
        bytes: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        crc32: crc32(buffer)
      });
      res.status(201).json({ media: mediaView(media.toObject()) });
    } catch (error) {
      await unlink(target);
      throw error;
    }
  });
  router.get('/:id', async (req, res, next) => {
    const media = await StudioMedia.findById(id(req.params.id)).lean();
    if (!media) fail('Media not found.', 404);
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.query.download === '1') res.attachment(media.originalName);
    res.type(media.mime);
    res.sendFile(
      media.filename,
      { root: directory, acceptRanges: true, dotfiles: 'deny' },
      (error) => {
        if (error && !res.headersSent) {
          if (error.code === 'ENOENT')
            return res
              .status(404)
              .json({ message: 'The local media file is missing. Restore it from your backup.' });
          next(error);
        }
      }
    );
  });
  return router;
}
