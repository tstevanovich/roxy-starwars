export function soundPlanReviewInput(scene, { legacy = false } = {}) {
  const plan = scene.soundPlan && {
    ...scene.soundPlan,
    layers: scene.soundPlan.layers?.map(({ assetId: _assetId, ...layer }) => layer)
  };
  if (plan) delete plan.approval;
  const shots = scene.clips.map((clip) => ({
    id: clip.id,
    duration: clip.duration,
    sound: clip.soundEffects
  }));
  const fullBed = (layer) =>
    layer.type === 'ambience' &&
    layer.loop === true &&
    (layer.start ?? 0) === 0 &&
    (!layer.assetId || (layer.sourceStart ?? 0) === 0) &&
    layer.duration >=
      (layer.clipId
        ? scene.clips.find((clip) => clip.id === layer.clipId)?.duration
        : scene.clips.reduce((sum, clip) => sum + clip.duration, 0)) -
        0.1;
  if (
    legacy ||
    !plan?.layers?.length ||
    !scene.soundPlan.layers.every(fullBed) ||
    scene.clips.some(
      (clip) => !scene.soundPlan.layers.some((layer) => !layer.clipId || layer.clipId === clip.id)
    )
  )
    return { plan, shots };
  const beds = [];
  for (const clip of scene.clips) {
    const layers = plan.layers
      .filter((layer) => !layer.clipId || layer.clipId === clip.id)
      .map(
        ({
          id: _id,
          clipId: _clipId,
          duration: _duration,
          start: _start,
          sourceStart: _sourceStart,
          ...directions
        }) => directions
      );
    const bed = { sound: clip.soundEffects ?? '', layers };
    if (JSON.stringify(beds.at(-1)) !== JSON.stringify(bed)) beds.push(bed);
  }
  const directions = { ...plan };
  delete directions.layers;
  return { continuousAmbience: true, plan: directions, beds };
}
