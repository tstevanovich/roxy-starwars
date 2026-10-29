import { randomUUID } from 'node:crypto';

import { nativeAudioPolicy } from '../../shared/audio-policy.js';
import { Job } from './assistant/models.js';
import { StudioEpisode } from './models/Studio.js';
import { fail } from './studio-validation.js';

// Preserve the complete previous record in history; never delete media or approve inputs.
export async function restartVideoPass(episodeId, revision) {
  const episode = await StudioEpisode.findById(episodeId).lean();
  if (!episode || episode.revision !== revision)
    fail('Refresh the episode before restarting.', 409);
  if (
    await Job.exists({
      'target.episodeId': String(episodeId),
      status: {
        $in: ['queued', 'preparing', 'submitting', 'rendering', 'importing', 'uncertain']
      }
    })
  )
    fail('Resolve unfinished episode jobs before restarting its videos.', 409);
  const snapshot = { ...episode };
  delete snapshot.history;
  const scenes = episode.scenes.map((scene) => ({
    ...scene,
    clips: scene.clips.map((clip) => ({
      ...clip,
      takeIds: [],
      selectedTakeId: null,
      soundLegacyTakeId: null,
      upscale: null,
      production: {
        ...clip.production,
        audioRepairTakeId: null,
        visualTakeId: null,
        upscaleMediaId: null,
        upscaleSourceTakeId: null,
        cleanDialogueMediaId: null
      }
    }))
  }));
  const saved = await StudioEpisode.findOneAndUpdate(
    { _id: episodeId, revision },
    {
      $set: {
        scenes,
        videoPass: {
          id: randomUUID(),
          policy: nativeAudioPolicy,
          requestedAt: new Date().toISOString(),
          previousRevision: revision
        }
      },
      $inc: { revision: 1 },
      $push: { history: { $each: [{ ...snapshot, savedAt: new Date() }], $slice: -30 } }
    },
    { returnDocument: 'after' }
  ).lean();
  if (!saved) fail('The episode changed before restarting; no files were deleted.', 409);
  return saved;
}
