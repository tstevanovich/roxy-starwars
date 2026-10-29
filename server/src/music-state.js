import { createHash } from 'node:crypto';

import { sceneSeconds } from '../../shared/scene-music.js';

export function musicState(episode, scene, cue) {
  const seconds = sceneSeconds(scene);
  const input = {
    episodeId: String(episode._id),
    sceneId: scene.id,
    prompt: cue?.prompt,
    model: cue?.model,
    bufferSeconds: cue?.bufferSeconds,
    shots: scene.clips.map((c) => ({ id: c.id, title: c.title, duration: c.duration }))
  };
  return {
    fingerprint: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    targetSeconds: seconds,
    generatedSeconds: seconds + Number(cue?.bufferSeconds ?? 5)
  };
}
