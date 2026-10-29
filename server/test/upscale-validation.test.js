import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inspectUpscale } from '../src/upscale-validation.js';

const probe = (width = 2560, height = 1440, duration = 12.028, audio = true) => ({
  streams: [{ codec_type: 'video', width, height }, ...(audio ? [{ codec_type: 'audio' }] : [])],
  format: { duration: String(duration) }
});
test('1440p accepts the exact target and two-pixel rounding from 854-wide source video', () => {
  for (const width of [2560, 2562]) {
    const result = inspectUpscale(probe(width), 12);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.verified.width, width);
    assert.equal(result.verified.audio, true);
  }
});
test('resolution, missing audio and duration failures report their actual causes separately', () => {
  assert.match(inspectUpscale(probe(854, 480), 12).reasons.join(' '), /854 × 480/);
  assert.match(
    inspectUpscale(probe(2560, 1440, 12, false), 12).reasons.join(' '),
    /no audio track/
  );
  assert.match(
    inspectUpscale(probe(2560, 1440, 7.03), 12).reasons.join(' '),
    /7.030 seconds.*12 seconds/
  );
  assert.equal(inspectUpscale(probe(2600), 12).reasons.length, 1);
  assert.equal(inspectUpscale({ streams: [], format: {} }, 12).reasons.length, 3);
});
