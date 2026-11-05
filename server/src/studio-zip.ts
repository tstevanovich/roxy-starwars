import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { crc32 } from './studio-media.ts';

// Standard uncompressed ZIP, streamed from immutable local originals; no extra package required.
export async function sendZip(res, directory: string, files, manifest) {
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2));
  const entries = [
    {
      name: 'manifest.json',
      bytes: manifestBuffer.length,
      crc32: crc32(manifestBuffer),
      buffer: manifestBuffer
    },
    ...files.map((file) => ({
      ...file,
      name: `media/${file._id}-${file.originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    }))
  ];
  let total = 0;
  for (const file of entries) {
    total += file.bytes + Buffer.byteLength(file.name) * 2 + 76;
    if (!file.buffer && (await stat(join(directory, file.filename))).size !== file.bytes)
      throw new Error('A source media file changed; restore it before exporting.');
  }
  if (total > 0xffffffff)
    throw Object.assign(
      new Error('This package exceeds the 4 GB export limit. Export a smaller episode.'),
      { status: 400 }
    );
  async function* zip() {
    let offset = 0;
    const central = [];
    for (const file of entries) {
      const name = Buffer.from(file.name);
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0x800, 6);
      header.writeUInt16LE(0x21, 12);
      header.writeUInt32LE(file.crc32, 14);
      header.writeUInt32LE(file.bytes, 18);
      header.writeUInt32LE(file.bytes, 22);
      header.writeUInt16LE(name.length, 26);
      const index = Buffer.alloc(46);
      index.writeUInt32LE(0x02014b50);
      index.writeUInt16LE(20, 4);
      index.writeUInt16LE(20, 6);
      index.writeUInt16LE(0x800, 8);
      index.writeUInt16LE(0x21, 14);
      index.writeUInt32LE(file.crc32, 16);
      index.writeUInt32LE(file.bytes, 20);
      index.writeUInt32LE(file.bytes, 24);
      index.writeUInt16LE(name.length, 28);
      index.writeUInt32LE(offset, 42);
      central.push(index, name);
      yield header;
      yield name;
      if (file.buffer) yield file.buffer;
      else for await (const chunk of createReadStream(join(directory, file.filename))) yield chunk;
      offset += header.length + name.length + file.bytes;
    }
    const centralBuffer = Buffer.concat(central);
    yield centralBuffer;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuffer.length, 12);
    end.writeUInt32LE(offset, 16);
    yield end;
  }
  res.attachment('roxy-capcut-package.zip');
  res.type('application/zip');
  await pipeline(Readable.from(zip()), res);
}
