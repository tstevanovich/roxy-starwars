import assert from 'node:assert/strict';

import { test } from 'vitest';

import { deliveryMediaId, inspectNativeVideo, videoReviewStages } from './video-policy.ts';

const verified = { width: 1920, height: 1080, duration: 5, audio: true };
const clip = {
  selectedTakeId: 'original',
  production: { upscaleMediaId: 'saved-high-resolution', upscaleSourceTakeId: 'original' }
};

test('video reviews use native picture approval without an upscale stage', () => {
  assert.deepEqual(videoReviewStages(), ['storyboard', 'animatic', 'visual']);
});

test('native verified video is delivered directly while an existing historical delivery remains readable', () => {
  const before = structuredClone(clip);
  assert.equal(
    deliveryMediaId(clip, [{ _id: 'original', videoVerification: verified }]),
    'original'
  );
  assert.equal(deliveryMediaId(clip, [{ _id: 'original' }]), 'saved-high-resolution');
  assert.deepEqual(clip, before);
  assert.equal(deliveryMediaId({ ...clip, selectedTakeId: 'replacement' }, []), 'replacement');
  assert.equal(deliveryMediaId({ selectedTakeId: 'original' }, []), 'original');
});

test('native imports require 1080p, matching duration and audio; picture repair can accept missing audio', () => {
  const probe = {
    streams: [{ codec_type: 'video', width: 1920, height: 1080 }, { codec_type: 'audio' }],
    format: { duration: '5' }
  };
  assert.deepEqual(inspectNativeVideo(probe, 5), { verified, reasons: [] });
  const silent = { ...probe, streams: [probe.streams[0]] };
  assert.match(inspectNativeVideo(silent, 5).reasons.join(' '), /soundtrack/);
  assert.deepEqual(inspectNativeVideo(silent, 5, { requireAudio: false }).reasons, []);
  const low = { ...probe, streams: [{ codec_type: 'video', width: 854, height: 480 }] };
  assert.match(inspectNativeVideo(low, 9).reasons.join(' '), /1920.*1080.*soundtrack.*9-second/);
  assert.equal(inspectNativeVideo({}, 5).reasons.length, 3);
});
