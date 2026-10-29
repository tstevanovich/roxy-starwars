import { shotContinuity } from '../../shared/shot-continuity.js';
import { shotLocation, shotPhysics } from '../../shared/shot-setting.js';
import { approvedCharacterSheets } from './character-sheets.js';
import { activeProject, projectEra } from './project-context.js';
import { alPronunciation, spokenDialogue } from './studio-pronunciation.js';

const universe = () =>
  `UNIVERSE AND ERA: Star Wars universe, ${projectEra()}. Photorealistic live-action cinema: worn industrial surfaces, practical machinery, tactile controls and believable materials. Approved references define the characters, ship and sets; preserve their designs. Include only the cast and vehicles specified for this shot.`;

// The approved shot image carries the designs. Keep the exact shot directions, not the library's prose.
export function productionVideoPrompt(scene, clip, instructions = '') {
  return [
    `Star Wars universe, ${projectEra()}. Photorealistic live-action cinema. ${clip.dialogue?.trim() ? 'Use the approved scene image as the composition reference.' : 'Animate the exact approved starting image.'} Preserve its identities, wardrobe, props, ship/set geometry, cast positions and eyelines. Include only specified cast. Preserve the specified parked/moving ship state. No conventional cars or wheeled vehicles.`,
    `SHOT: ${clip.title || scene.title}. ${clip.duration} seconds. ${scene.style === 'vlog' ? 'Natural audience-facing vlog performance.' : 'Cinematic interaction; motivated eyelines toward scene partners.'}`,
    `LOCATION: ${shotLocation(scene, clip)}`,
    shotPhysics(clip) ? `PHYSICAL CONTINUITY: ${shotPhysics(clip)}` : '',
    `ACTION: ${clip.action}`,
    `DIALOGUE: ${spokenDialogue(clip.dialogue) || 'No spoken dialogue.'}`,
    /\b(?:AL|Al)\b/.test(clip.dialogue ?? '') ? `PRONUNCIATION: ${alPronunciation}` : '',
    `CAMERA: ${clip.camera || 'Stable, deliberate framing motivated by the action.'}`,
    clip.production?.beats ? `TIMED ACTION: ${clip.production.beats}` : '',
    clip.production?.passCondition ? `PASS CONDITIONS: ${clip.production.passCondition}` : '',
    `AUDIO: Generate synchronized sound effects and continuous location ambience with the picture. ${clip.dialogue?.trim() ? 'Use the selected voice reference for only the specified dialogue; keep speech clear above effects.' : 'No speech or voices.'} No music, score, singing, soundtrack or musical bed. ${nativeSoundDirections(scene, clip)}`,
    instructions ? `REQUESTED CHANGES: ${instructions}` : '',
    'FINAL AUDIO RULE: No background music, score, soundtrack, singing or musical bed. Sound effects, ambience and specified dialogue only. Music is added later in CapCut.'
  ]
    .filter(Boolean)
    .join('\n');
}

function nativeSoundDirections(scene, clip) {
  const cues = (scene.soundPlan?.layers ?? [])
    .filter((layer) => !layer.clipId || layer.clipId === clip.id)
    .map(
      (layer) =>
        `[${layer.start ?? 0}s${layer.type === 'effect' ? `, ${layer.duration}s` : ', continuous'}] ${layer.description}`
    );
  return [clip.soundEffects?.replace(/(?:later |separate )?sound pass\s*:/gi, ''), ...cues]
    .filter(Boolean)
    .join(' ');
}

export function clipPrompts(scene, clip, assets, episode) {
  const continuity = shotContinuity(episode, scene, clip, assets);
  const linked = assets.filter((asset) => scene.assetIds.map(String).includes(String(asset._id)));
  const pronunciation = /\b(?:AL|Al)\b/.test(
    [scene.script, clip.dialogue, ...linked.map((asset) => asset.name)].join('\n')
  )
    ? `\nPRONUNCIATION (direction only): ${alPronunciation}`
    : '';
  const linkedReferenceIds = [
    ...new Set(
      linked
        .filter((asset) => !['voice', 'sound'].includes(asset.kind))
        .flatMap((asset) => [
          ...(asset.finalChoice?.mediaIds ?? []),
          ...approvedCharacterSheets(asset).map((sheet) => sheet.mediaId),
          ...(activeProject()?.workflowVersion === 1 ? (asset.production?.items ?? []) : [])
            .filter((item) => item.required && item.type === 'image' && item.mediaId)
            .map((item) => item.mediaId)
        ])
        .map(String)
    )
  ];
  const referenceMediaIds =
    activeProject()?.workflowVersion === 1 && clip.production?.referenceMediaIds?.length
      ? clip.production.referenceMediaIds
          .map(String)
          .filter((mid) => linkedReferenceIds.includes(mid))
      : linkedReferenceIds;
  // Reference images and selected dialogue carry the approved design/performance.
  // Candidate descriptions contain review history and model-comparison prose,
  // which can be stale and are not instructions for this shot.
  const visibleReferences =
    activeProject()?.workflowVersion === 1 && clip.production?.referenceMediaIds?.length
      ? linked.filter(
          (asset) =>
            !['voice', 'sound'].includes(asset.kind) &&
            [
              ...(asset.finalChoice?.mediaIds ?? []),
              ...(asset.production?.items ?? []).map((i) => i.mediaId)
            ].some((id) => referenceMediaIds.includes(String(id)))
        )
      : linked;
  const references = visibleReferences
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
  const image = `${universe()}\nCreate one photorealistic cinematic still.\nREFERENCES: ${references || 'No characters or sets linked yet.'}\nFRAME: ${clip.title || scene.title}. ${clip.action}\nLOCATION: ${shotLocation(scene, clip)}\nPHYSICAL CONTINUITY: ${shotPhysics(clip) || 'Preserve the specified setting and physical state.'}\nCAMERA AND LIGHT: ${clip.camera || 'Natural, motivated lighting and coherent perspective.'}\nCONTINUITY: Preserve approved identity, outfit, ship layout, and weapon state. Natural skin and believable physical materials.\nDeliver a 16:9 scene image at 2K. Do not add captions or interface graphics.`;
  const video = `${universe()}\nREFERENCES: ${references || 'No characters or sets linked yet.'}\nSHOT: ${clip.title || scene.title}. ${scene.style === 'vlog' ? 'Roxy addresses the audience naturally, with motivated direct camera eye contact.' : 'Cinematic interaction; motivated eyelines toward scene partners.'} ${clip.duration} seconds.\nLOCATION: ${shotLocation(scene, clip)}\nPHYSICAL CONTINUITY: ${shotPhysics(clip) || 'Preserve the specified setting and physical state.'}\nACTION: ${clip.action}\nDIALOGUE: ${spokenDialogue(clip.dialogue) || 'No spoken dialogue in this clip.'}${pronunciation}\nCAMERA: ${clip.camera || 'Stable, deliberate camera movement motivated by the action.'}\nCONTINUITY: Preserve identity, approved outfits, set geography, weapon handling, and physical contact.\nAUDIO: ${clip.soundEffects || 'Appropriate synchronized scene effects and natural environment ambience.'} Dialogue and sound effects must be audible. No music, score, soundtrack, or musical bed.`;
  return {
    image: image + (continuity.directions ? '\n' + continuity.directions : ''),
    video,
    imageGeneration: structuredClone(imageGenerationDefaults),
    referenceMediaIds: [...new Set([...continuity.mediaIds, ...referenceMediaIds])],
    continuity,
    dialogueMediaId: clip.selectedDialogueId ? String(clip.selectedDialogueId) : null,
    videoWithinLimit: video.length <= 4500
  };
}
import { imageGenerationDefaults } from '../../shared/production-defaults.js';
