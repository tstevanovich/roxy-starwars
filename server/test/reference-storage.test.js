import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { createReferenceStorage } from '../src/assistant/reference-storage.js';
import { StudioMedia } from '../src/models/Studio.js';
import { mediaView, saveGeneratedMedia } from '../src/studio-media.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
  'base64'
);
let directory, mongo, media, calls, uploads, metadataFailure, putBehavior;
const store = { read: async () => ({ openart: { projectId: 'project' } }) };
const signed = {
  uploadId: 'upload',
  signURL: 'https://storage.example.test/file?secret=private',
  accessURL: 'https://cdn.openart.ai/refs/test.png',
  contentType: 'image/png'
};
const openart = {
  call: async (name, args) => {
    calls.push({ name, args });
    if (name === 'openart_upload_sign') return signed;
    if (name === 'openart_upload_metadata_get') {
      if (metadataFailure)
        throw Object.assign(new Error('Reference is pending acceptance.'), { status: 502 });
      return {
        visualReference: {
          id: 'verified',
          type: 'image',
          url: signed.accessURL,
          metadata: { width: 1, height: 1 }
        }
      };
    }
    throw new Error('Unexpected provider call');
  }
};
function storage() {
  return createReferenceStorage({
    openart,
    store,
    mediaDirectory: directory,
    fetcher: async (url, options) => {
      ++uploads;
      assert.equal(options.method, 'PUT');
      assert.deepEqual(options.body, png);
      assert.deepEqual(options.headers, { 'Content-Type': 'image/png' });
      return putBehavior ? putBehavior(url) : new Response(null, { status: 200 });
    }
  });
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'roxy-reference-storage-'));
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('reference-storage'));
});
beforeEach(async () => {
  await StudioMedia.deleteMany({});
  calls = [];
  uploads = 0;
  metadataFailure = false;
  putBehavior = null;
  media = await saveGeneratedMedia(directory, png, 'reference.png');
});
after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true });
});

test('concurrent reference requests transfer once, wait for acceptance and cache the verified provider reference', async () => {
  const client = storage();
  const refs = await Promise.all([
    client.reference(String(media._id)),
    client.reference(String(media._id))
  ]);
  assert.equal(uploads, 1);
  assert.ok(refs.every((r) => r.id === 'verified'));
  assert.deepEqual(
    calls.map((c) => c.name),
    ['openart_upload_sign', 'openart_upload_metadata_get']
  );
  assert.equal(calls[0].args.size, png.length);
  await storage().reference(String(media._id));
  assert.equal(uploads, 1);
  const saved = await StudioMedia.findById(media._id).lean();
  assert.equal(saved.providerUpload, undefined);
  assert.equal(mediaView(saved).providerReference, undefined);
});

test('pending acceptance survives restart and resumes verification without uploading again', async () => {
  metadataFailure = true;
  await assert.rejects(storage().reference(String(media._id)), /pending acceptance/);
  const pending = await StudioMedia.findById(media._id).lean();
  assert.ok(pending.providerUpload);
  assert.equal(pending.providerUpload.signURL, undefined);
  assert.equal(mediaView(pending).providerUpload, undefined);
  metadataFailure = false;
  await storage().reference(String(media._id));
  assert.equal(uploads, 1);
  assert.equal(calls.filter((c) => c.name === 'openart_upload_sign').length, 1);
});

test('an explicit upload denial stops before metadata verification, quoting or generation', async () => {
  putBehavior = async () => new Response(null, { status: 403 });
  await assert.rejects(storage().reference(String(media._id)), /rejected \(403\); no render/);
  assert.deepEqual(
    calls.map((c) => c.name),
    ['openart_upload_sign']
  );
  assert.equal((await StudioMedia.findById(media._id).lean()).providerReference, undefined);
});

test('references deleted during transfer are not restored or sent for generation', async () => {
  putBehavior = async () => {
    await StudioMedia.deleteOne({ _id: media._id });
    return new Response(null, { status: 200 });
  };
  await assert.rejects(storage().reference(String(media._id)), /removed or changed/);
  assert.equal(await StudioMedia.countDocuments(), 0);
  assert.equal(calls.length, 1);
});

test('changed local bytes fail before transfer and network errors do not expose signed URLs', async () => {
  await writeFile(join(directory, media.filename), Buffer.from('changed file'));
  await assert.rejects(storage().reference(String(media._id)), /changed on disk/);
  assert.equal(calls.length, 0);
  await writeFile(join(directory, media.filename), png);
  putBehavior = async () => {
    throw new Error(signed.signURL);
  };
  await assert.rejects(
    storage().reference(String(media._id)),
    (e) => /no render was submitted/.test(e.message) && !e.message.includes('secret=private')
  );
});
