import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { StudioMedia } from '../models/Studio.ts';
import { assertMediaAccess } from '../projects.ts';
import { fail, id } from '../studio-validation.ts';

const hosted = (address) => {
  try {
    const url = new URL(address);
    return url.protocol === 'https:' && url.hostname === 'cdn.openart.ai';
  } catch {
    return false;
  }
};
// The studio is a headless MCP client. Transfer registered studio files through the
// provider's documented signed-upload flow, then wait for acceptance before quoting/rendering.
export function createReferenceStorage({ openart, store, mediaDirectory, fetcher = fetch }) {
  const transfers = new Map();
  async function transfer(mediaId, purpose) {
    await assertMediaAccess([id(mediaId)]);
    const media = await StudioMedia.findById(mediaId).lean();
    if (!media) fail('A required reference was deleted. Choose a replacement.');
    if (media.providerReference?.id && hosted(media.providerReference.url))
      return { ...media.providerReference, type: media.kind, label: media.originalName };
    if (basename(media.filename) !== media.filename) fail('Invalid reference path.');
    let bytes;
    try {
      bytes = await readFile(join(mediaDirectory, media.filename));
    } catch {
      fail('A reference file is missing on disk. Restore or replace it before rendering.');
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (media.sha256 && sha256 !== media.sha256)
      fail(
        'A reference file changed on disk. Import and review its current version before rendering.'
      );
    const projectId = (await store.read()).openart?.projectId;
    let upload = media.providerUpload;
    if (!upload || upload.sha256 !== sha256 || upload.projectId !== projectId) {
      const signed = await openart.call('openart_upload_sign', {
        mediaType: media.kind,
        filename: media.originalName,
        size: bytes.length,
        contentType: media.mime,
        label: media.originalName,
        purpose,
        projectId
      });
      if (!signed.uploadId || !hosted(signed.accessURL))
        fail('OpenArt did not provide a valid reference upload destination.', 502);
      let destination;
      try {
        destination = new URL(signed.signURL);
      } catch {
        fail('OpenArt did not provide a valid upload URL.', 502);
      }
      if (destination.protocol !== 'https:' || destination.username || destination.password)
        fail('OpenArt did not provide a secure upload URL.', 502);
      let response;
      try {
        response = await fetcher(destination.href, {
          method: 'PUT',
          headers: { 'Content-Type': signed.contentType ?? media.mime },
          body: bytes,
          redirect: 'error',
          signal: AbortSignal.timeout(60000)
        });
      } catch {
        fail(
          'Reference transfer to OpenArt failed; no render was submitted. Retry after checking the connection.',
          502
        );
      }
      if (!response.ok)
        fail(
          `OpenArt reference transfer was rejected (${response.status}); no render was submitted.`,
          502
        );
      upload = {
        uploadId: signed.uploadId,
        accessURL: signed.accessURL,
        sha256,
        projectId,
        uploadedAt: new Date()
      };
      const saved = await StudioMedia.updateOne(
        { _id: media._id, sha256: media.sha256 },
        { $set: { providerUpload: upload } }
      );
      if (!saved.matchedCount) fail('The reference was removed or changed during transfer.');
    }
    const accepted = await openart.call('openart_upload_metadata_get', {
      mediaType: media.kind,
      mediaUrl: upload.accessURL,
      uploadId: upload.uploadId,
      label: media.originalName
    });
    const reference = accepted.visualReference;
    if (!reference?.id || reference.type !== media.kind || !hosted(reference.url))
      fail(
        'OpenArt has not accepted the reference yet; no render was submitted. Retry this step after acceptance.',
        502
      );
    const saved = await StudioMedia.updateOne(
      { _id: media._id, sha256: media.sha256 },
      {
        $set: { providerReference: reference },
        $unset: { providerUpload: 1 }
      }
    );
    if (!saved.matchedCount) fail('The reference was removed or changed during verification.');
    return reference;
  }
  async function reference(mediaId, purpose = 'create-image') {
    await assertMediaAccess([id(mediaId)]);
    const key = mediaId + ':' + purpose;
    if (transfers.has(key)) return transfers.get(key);
    const pending = transfer(mediaId, purpose);
    transfers.set(key, pending);
    try {
      return await pending;
    } finally {
      transfers.delete(key);
    }
  }
  return { reference };
}
