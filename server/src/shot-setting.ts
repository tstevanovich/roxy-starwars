import type * as Studio from '../../shared/types.ts';

export function shotLocation(scene: Studio.SceneInput, clip: Studio.ClipInput) {
  return clip.production?.location?.trim() || scene.location;
}

export function shotPhysics(clip: Studio.ClipInput) {
  const environment = clip.production?.environment;
  const rules =
    environment === 'space-exterior'
      ? 'Exterior in orbital vacuum. Only the specified spacecraft, stars and distant planetary bodies are visible. No landing platform, ground plane, road, cars, wheeled vehicles, exposed people, weather, smoke drifting upward or atmospheric flight. Ships maintain coherent trajectories and scale. Do not reveal a hangar or foreground set, descend to the surface, or transition into another shot.'
      : environment === 'surface-exterior'
        ? 'Exterior on the planetary surface, with local gravity. The ground and landing infrastructure are attached to the terrain. Preserve the specified flying, landing or parked state. Star Wars vehicles only; no conventional cars, tyres, road traffic or modern Earth infrastructure. Do not transition to orbit.'
        : environment === 'interior'
          ? 'Inside the specified ship or structure. Preserve its floor, gravity, layout, occupied stations and specified parked or moving state. Windows show only the specified exterior; no conventional cars or road traffic.'
          : '';
  return [rules, clip.production?.physicalConstraints].filter(Boolean).join(' ');
}

export function ambiguousSceneLocation(scene: Studio.SceneInput) {
  return (
    /\b(?:orbit|space)\b/i.test(scene.location ?? '') &&
    /\b(?:surface|landing platform|spaceport|canyon)\b/i.test(scene.location)
  );
}
