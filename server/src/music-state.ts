import { createHash } from 'node:crypto';

import { sceneSeconds } from '../../shared/scene-music.ts';
import type * as Studio from '../../shared/types.ts';

export function musicState(episode, scene: Studio.SceneInput, cue) {
  const seconds = sceneSeconds(scene);
  const input = {
    episodeId: String(episode._id),
    sceneId: scene.id,
    prompt: cue?.prompt,
    model: cue?.model,
    bufferSeconds: cue?.bufferSeconds,
    targetSeconds: seconds
  };
  return {
    fingerprint: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    targetSeconds: seconds,
    generatedSeconds: seconds + Number(cue?.bufferSeconds ?? 5)
  };
}

// Older cues included shot labels in their fingerprint. The immutable job
// receipt proves their actual generation inputs without rewriting that history.
export function musicJobCurrent(episode, scene: Studio.SceneInput, cue, job) {
  const state = musicState(episode, scene, cue);
  return Boolean(
    job?.kind === 'music' &&
    job.status === 'ready' &&
    String(job.payload?.cueId) === String(cue._id) &&
    job.payload.prompt === cue.prompt &&
    job.payload.model === cue.model &&
    job.payload.targetSeconds === state.targetSeconds &&
    job.payload.generatedSeconds === state.generatedSeconds
  );
}

export function musicCandidateCurrent(episode, scene: Studio.SceneInput, cue, option, jobs = []) {
  if (!option) return false;
  const state = musicState(episode, scene, cue);
  if (option.fingerprint === state.fingerprint) return true;
  return jobs.some(
    (job) =>
      musicJobCurrent(episode, scene, cue, job) &&
      job.snapshot?.fingerprint === option.fingerprint &&
      option.prompt === cue.prompt &&
      option.mediaIds?.length > 0 &&
      option.mediaIds?.every((id) => job.resultMediaIds?.map(String).includes(String(id)))
  );
}
