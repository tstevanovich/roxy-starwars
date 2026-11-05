import type * as Studio from '../../shared/types.ts';
// A shot image is one composition. Its saved prompt and exact attachments
// belong to that shot; timing, other media routes and siblings stay intact.
export function shotImageRevisionScene(scene: Studio.SceneInput, clipId: string, item) {
  const clip = scene.clips.find((clip) => clip.id === clipId);
  if (!clip || !item.imagePrompt?.trim())
    throw new Error('Choose an existing shot and a complete image prompt.');
  const references = item.imageReferenceMediaIds ?? item.referenceMediaIds ?? item.sourceMediaIds;
  return {
    ...scene,
    clips: scene.clips.map((saved) =>
      saved.id === clipId
        ? {
            ...saved,
            production: {
              ...saved.production,
              imagePrompt: item.imagePrompt,
              ...(references !== undefined
                ? { imageReferenceMediaIds: [...new Set(references.map(String))] }
                : {})
            }
          }
        : saved
    )
  };
}
