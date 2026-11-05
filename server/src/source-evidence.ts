import { StudioSourceEvidence } from './models/Studio.ts';

// Evidence supplements an approved source; it does not change or grant approval.
// Do not reuse a packet after the owner changes its URL or time range.
export async function sourceEvidence(episode) {
  if (!episode) return [];
  const packets = await StudioSourceEvidence.find({ episodeId: String(episode._id) }).lean();
  return packets.filter((packet) =>
    episode.sourceReferences?.some(
      (ref) =>
        ref.id === packet.sourceId &&
        ref.url === packet.sourceUrl &&
        ref.startSeconds === packet.startSeconds &&
        ref.endSeconds === packet.endSeconds
    )
  );
}
