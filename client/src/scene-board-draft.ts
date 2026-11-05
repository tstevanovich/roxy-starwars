import type * as Studio from '../../shared/types.ts';
// Compare only fields that the scene-board save route accepts. Review receipts,
// generated takes and the edit token can change without creating local edits.
export function sceneDraftMatches(draft, saved) {
  if (!draft || !saved) return false;
  const inputs = (scene: Studio.Scene) => ({
    title: scene.title,
    location: scene.location,
    script: scene.script,
    clips: (scene.clips ?? []).map((clip: Studio.Clip) => ({
      id: clip.id,
      title: clip.title,
      duration: clip.duration,
      action: clip.action,
      dialogue: clip.dialogue,
      camera: clip.camera,
      soundEffects: clip.soundEffects,
      production: {
        imagePrompt: clip.production?.imagePrompt || '',
        videoPrompt: clip.production?.videoPrompt || '',
        videoTransitionPrompt: clip.production?.videoTransitionPrompt || '',
        imageReferenceMediaIds: clip.production?.imageReferenceMediaIds,
        videoReferenceMediaIds: clip.production?.videoReferenceMediaIds,
        videoEndFrame: clip.production?.videoEndFrame
      }
    }))
  });
  return JSON.stringify(inputs(draft)) === JSON.stringify(inputs(saved));
}
