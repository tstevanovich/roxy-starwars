import { createHash } from 'node:crypto';

export function sceneEditToken(scene) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        title: scene.title,
        location: scene.location,
        script: scene.script,
        clips: scene.clips.map((clip) => ({
          id: clip.id,
          title: clip.title,
          duration: clip.duration,
          action: clip.action,
          dialogue: clip.dialogue,
          camera: clip.camera,
          soundEffects: clip.soundEffects,
          imagePrompt: clip.production?.imagePrompt || '',
          ...(clip.production?.imageReferenceMediaIds !== undefined
            ? { imageReferenceMediaIds: clip.production.imageReferenceMediaIds }
            : {}),
          videoPrompt: clip.production?.videoPrompt || '',
          ...(clip.production?.videoEndFrame
            ? { videoEndFrame: clip.production.videoEndFrame }
            : {}),
          ...(clip.production?.videoTransitionPrompt
            ? { videoTransitionPrompt: clip.production.videoTransitionPrompt }
            : {})
        }))
      })
    )
    .digest('hex');
}
