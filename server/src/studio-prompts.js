import { approvedCharacterSheets } from './character-sheets.js';
import { alPronunciation, spokenDialogue } from './studio-pronunciation.js';

const universe =
  'UNIVERSE AND ERA: Star Wars universe, Imperial era. Photorealistic live-action cinema: worn industrial surfaces, practical machinery, tactile controls and believable materials. Approved references define the characters, ship and sets; preserve their designs. Include only the cast and vehicles specified for this shot.';

// The approved shot image carries the designs. Keep the exact shot directions, not the library's prose.
export function productionVideoPrompt(scene, clip, instructions = '') {
  return [
    'Star Wars universe, Imperial era. Photorealistic live-action cinema. Animate the exact approved image; preserve its identities, wardrobe, props, ship/set geometry, cast positions and eyelines. Include only specified cast. Preserve the specified parked/moving ship state. No conventional cars or wheeled vehicles.',
    `SHOT: ${clip.title || scene.title}. ${clip.duration} seconds. ${scene.style === 'vlog' ? 'Natural audience-facing vlog performance.' : 'Cinematic interaction; motivated eyelines toward scene partners.'}`,
    `LOCATION: ${scene.location}`,
    `ACTION: ${clip.action}`,
    `DIALOGUE: ${spokenDialogue(clip.dialogue) || 'No spoken dialogue.'}`,
    /\b(?:AL|Al)\b/.test(clip.dialogue ?? '') ? `PRONUNCIATION: ${alPronunciation}` : '',
    `CAMERA: ${clip.camera || 'Stable, deliberate framing motivated by the action.'}`,
    `AUDIO: ${clip.soundEffects || 'Synchronized scene effects and natural ambience.'} Audible dialogue and effects. No music, score, soundtrack or musical bed.`,
    instructions ? `REQUESTED CHANGES: ${instructions}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export function clipPrompts(scene, clip, assets) {
  const linked = assets.filter((asset) => scene.assetIds.map(String).includes(String(asset._id)));
  const pronunciation = /\b(?:AL|Al)\b/.test(
    [scene.script, clip.dialogue, ...linked.map((asset) => asset.name)].join('\n')
  )
    ? `\nPRONUNCIATION (direction only): ${alPronunciation}`
    : '';
  const referenceMediaIds = [
    ...new Set(
      linked
        .flatMap((asset) => [
          ...(asset.finalChoice?.mediaIds ?? []),
          ...approvedCharacterSheets(asset).map((sheet) => sheet.mediaId)
        ])
        .map(String)
    )
  ];
  // Reference images and selected dialogue carry the approved design/performance.
  // Candidate descriptions contain review history and model-comparison prose,
  // which can be stale and are not instructions for this shot.
  const references = linked
    .map((asset) => {
      const status = asset.finalChoice
        ? asset.kind === 'voice'
          ? 'Finalized voice; use the selected dialogue recording.'
          : 'Finalized visual reference; preserve the pictured design.'
        : `${asset.brief} [Reference not finalized]`;
      const sheets = approvedCharacterSheets(asset)
        .map(
          (sheet) =>
            `\nApproved ${asset.kind === 'prop' ? 'prop' : 'character'} sheet: ${sheet.title} (${sheet.views.join(', ')}). Preserve the same design across angles.`
        )
        .join('');
      return `${asset.name}: ${status}${sheets}`;
    })
    .join('\n');
  const image = `${universe}\nCreate one photorealistic cinematic still.\nREFERENCES: ${references || 'No characters or sets linked yet.'}\nFRAME: ${scene.title}. ${clip.action}\nLOCATION: ${scene.location}\nCAMERA AND LIGHT: ${clip.camera || 'Natural, motivated lighting and coherent perspective.'}\nCONTINUITY: Preserve approved identity, outfit, ship layout, and weapon state. Natural skin and believable physical materials.\nDeliver a 16:9 scene image at 2K. Do not add captions or interface graphics.`;
  const video = `${universe}\nREFERENCES: ${references || 'No characters or sets linked yet.'}\nSHOT: ${scene.title}. ${scene.style === 'vlog' ? 'Roxy addresses the audience naturally, with motivated direct camera eye contact.' : 'Cinematic interaction; motivated eyelines toward scene partners.'} ${clip.duration} seconds.\nLOCATION: ${scene.location}\nACTION: ${clip.action}\nDIALOGUE: ${spokenDialogue(clip.dialogue) || 'No spoken dialogue in this clip.'}${pronunciation}\nCAMERA: ${clip.camera || 'Stable, deliberate camera movement motivated by the action.'}\nCONTINUITY: Preserve identity, approved outfits, set geography, weapon handling, and physical contact.\nAUDIO: ${clip.soundEffects || 'Appropriate synchronized scene effects and natural environment ambience.'} Dialogue and sound effects must be audible. No music, score, soundtrack, or musical bed.`;
  return {
    image,
    video,
    imageGeneration: structuredClone(imageGenerationDefaults),
    referenceMediaIds,
    dialogueMediaId: clip.selectedDialogueId ? String(clip.selectedDialogueId) : null,
    videoWithinLimit: video.length <= 4500
  };
}
import { imageGenerationDefaults } from '../../shared/production-defaults.js';
