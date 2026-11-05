import { improveVideoLipSyncPrompt } from '../../shared/dialogue-video-prompt.ts';
import {
  compactShotImageReferences,
  imageReferenceItems,
  imageReferenceSelection
} from '../../shared/image-references.ts';
import { taggedVideoReferences, withImageReferencePrompt } from '../../shared/reference-prompt.ts';
import { cleanRenderPrompt } from '../../shared/render-prompt.ts';
import { shotContinuity } from '../../shared/shot-continuity.ts';
import { shotAssetIds } from '../../shared/shot-references.ts';
import {
  joinVideoPrompt,
  startOnlyVideoPrompt,
  videoTransitionPrompt
} from '../../shared/shot-transitions.ts';
import type * as Studio from '../../shared/types.ts';
import { videoCharacterReferences, withVideoCastPrompt } from '../../shared/video-cast.ts';
import { withVideoSoundPrompt } from '../../shared/video-sound-prompt.ts';
import { approvedCharacterSheets } from './character-sheets.ts';
import { activeProject, projectEra } from './project-context.ts';
import { shotLocation, shotPhysics } from './shot-setting.ts';
import { alPronunciation, spokenDialogue } from './studio-pronunciation.ts';

const universe = () =>
  `UNIVERSE AND ERA: Star Wars universe, ${projectEra()}. Photorealistic live-action cinema: worn industrial surfaces, practical machinery, tactile controls and believable materials. Approved references define the characters, ship and sets; preserve their designs. Include only the cast and vehicles specified for this shot.`;

// The approved shot image carries the designs. Keep the exact shot directions, not the library's prose.
export function productionVideoPrompt(
  scene: Studio.SceneInput,
  clip: Studio.ClipInput,
  instructions = '',
  {
    includeTransition = true,
    assets = [],
    media,
    characterReferences
  }: {
    includeTransition?: boolean;
    assets?: Studio.AssetInput[];
    media?: Studio.MediaInput[];
    characterReferences?: Pick<Studio.VideoReference, 'names' | 'imageNumber'>[];
  } = {}
) {
  const references = characterReferences ?? videoCharacterReferences(scene, clip, assets, media);
  const base = startOnlyVideoPrompt(
    scene,
    clip,
    productionVideoBasePrompt(scene, clip, instructions)
  );
  const prompt = cleanRenderPrompt(
    joinVideoPrompt(
      withVideoCastPrompt(
        withVideoSoundPrompt(improveVideoLipSyncPrompt(base, clip.dialogue ?? ''), scene, clip),
        references
      ),
      includeTransition ? videoTransitionPrompt(scene, clip, base) : ''
    )
  );
  return includeTransition ? taggedVideoReferences(prompt) : prompt;
}

function productionVideoBasePrompt(
  scene: Studio.SceneInput,
  clip: Studio.ClipInput,
  instructions = ''
) {
  if (clip.production?.videoPrompt?.trim())
    return (
      clip.production.videoPrompt + (instructions ? `\nREQUESTED CHANGES: ${instructions}` : '')
    );
  const prompt = [
    `Star Wars universe, ${projectEra()}. Photorealistic live-action cinema. ${clip.dialogue?.trim() ? 'Use Image 1 as the composition reference.' : 'Animate the supplied start frame.'} Preserve cast identities, wardrobe, props, ship/set geometry, positions and eyelines. No extra cast. No conventional cars or wheeled vehicles.`,
    `SHOT: ${clip.title || scene.title}. ${clip.duration} seconds. ${scene.style === 'vlog' ? 'Natural audience-facing vlog performance.' : 'Cinematic interaction; motivated eyelines toward scene partners.'}`,
    `LOCATION: ${shotLocation(scene, clip)}`,
    shotPhysics(clip) ? `PHYSICAL CONTINUITY: ${shotPhysics(clip)}` : '',
    `ACTION: ${clip.production?.allowedMotion || clip.action}`,
    `DIALOGUE: ${spokenDialogue(clip.dialogue) || 'No spoken dialogue.'}`,
    /\b(?:AL|Al)\b/.test(clip.dialogue ?? '') ? `PRONUNCIATION: ${alPronunciation}` : '',
    `CAMERA: ${clip.camera || 'Stable, deliberate framing motivated by the action.'}`,
    clip.production?.startState ? `START STATE: ${clip.production.startState}` : '',
    clip.production?.allowedMotion ? `ALLOWED MOTION: ${clip.production.allowedMotion}` : '',
    clip.production?.beats ? `TIMED ACTION: ${clip.production.beats}` : '',
    clip.production?.endState ? `END STATE AT CUT: ${clip.production.endState}` : '',
    'STAGING: Follow only this shot’s action. Preserve the set, lighting and uninvolved cast. Do not add departures, camera moves, a scene reset or the next shot’s action.',
    clip.production?.passCondition ? `PASS CONDITIONS: ${clip.production.passCondition}` : '',
    `AUDIO: Generate location ambience and action sounds with the picture. ${clip.dialogue?.trim() ? 'Use Audio 1 for the specified dialogue; keep speech clear above effects.' : 'No speech or voices.'} No music, score, singing or musical bed.`,
    instructions ? `REQUESTED CHANGES: ${instructions}` : ''
  ]
    .filter(Boolean)
    .join('\n');
  return prompt;
}

export function clipPrompts(
  scene: Studio.SceneInput,
  clip: Studio.ClipInput,
  assets: Studio.AssetInput[],
  episode?
) {
  const continuity = shotContinuity(episode, scene, clip, assets);
  const linked = assets.filter((asset) =>
    shotAssetIds(scene, clip, assets).map(String).includes(String(asset._id))
  );
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
      : /@image\d+\b/i.test(clip.production?.imagePrompt ?? '') &&
          clip.production?.imageReferenceMediaIds === undefined
        ? linkedReferenceIds
        : compactShotImageReferences(scene, clip, linked);
  const exactImageReferences = clip.production?.imageReferenceMediaIds;
  // Reference images and selected dialogue carry the approved design/performance.
  // Candidate descriptions contain review history and model-comparison prose,
  // which can be stale and are not instructions for this shot.
  const visibleReferences = Array.isArray(exactImageReferences)
    ? assets.filter(
        (asset) =>
          !asset.archived &&
          imageReferenceItems(exactImageReferences, { assets }).some(
            (reference) => reference.assetId === String(asset._id)
          )
      )
    : activeProject()?.workflowVersion === 1 && clip.production?.referenceMediaIds?.length
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
    .filter((asset) => !['voice', 'sound'].includes(asset.kind))
    .map((asset) => {
      const status = asset.finalChoice ? 'Preserve the pictured design.' : asset.brief;
      const sheets = approvedCharacterSheets(asset)
        .map(
          (sheet) =>
            `\nApproved ${asset.kind === 'prop' ? 'prop' : 'character'} sheet: ${sheet.title} (${sheet.views.join(', ')}). Preserve the same design across angles.`
        )
        .join('');
      return `${asset.name}: ${status}${sheets}`;
    })
    .join('\n');
  const image = `${universe()}\nCreate one photorealistic cinematic still.\nFRAME: ${clip.title || scene.title}. ${clip.action}\nLOCATION: ${shotLocation(scene, clip)}\nPHYSICAL CONTINUITY: ${shotPhysics(clip) || 'Preserve the specified setting and physical state.'}\nCAMERA AND LIGHT: ${clip.camera || 'Natural, motivated lighting and coherent perspective.'}\nCONTINUITY: Preserve approved identity, outfit, ship layout, and weapon state. Natural skin and believable physical materials.\nDeliver a 16:9 scene image at 2K. Do not add captions or interface graphics.`;
  const video = `${universe()}\nREFERENCES: ${references || 'No characters or sets linked yet.'}\nSHOT: ${clip.title || scene.title}. ${scene.style === 'vlog' ? 'Roxy addresses the audience naturally, with motivated direct camera eye contact.' : 'Cinematic interaction; motivated eyelines toward scene partners.'} ${clip.duration} seconds.\nLOCATION: ${shotLocation(scene, clip)}\nPHYSICAL CONTINUITY: ${shotPhysics(clip) || 'Preserve the specified setting and physical state.'}\nACTION: ${clip.action}\nDIALOGUE: ${spokenDialogue(clip.dialogue) || 'No spoken dialogue in this clip.'}${pronunciation}\nCAMERA: ${clip.camera || 'Stable, deliberate camera movement motivated by the action.'}\nCONTINUITY: Preserve identity, approved outfits, set geography, weapon handling, and physical contact.\nAUDIO: ${clip.soundEffects || 'Appropriate synchronized scene effects and natural environment ambience.'} Dialogue and sound effects must be audible. No music, score, soundtrack, or musical bed.`;
  const continuityDirections = Array.isArray(exactImageReferences)
    ? continuity.notes
    : continuity.directions;
  const imageBase = cleanRenderPrompt(
    clip.production?.imagePrompt?.trim() ||
      image + (continuityDirections ? '\n' + continuityDirections : '')
  );
  const orderedReferences = [...new Set([...continuity.mediaIds, ...referenceMediaIds])];
  const selection = imageReferenceSelection({
    prompts: {
      continuity,
      referenceMediaIds: orderedReferences,
      imageReferenceMediaIds: exactImageReferences
    },
    referenceIds: clip.production?.referenceMediaIds ?? []
  });
  return {
    ...(Array.isArray(exactImageReferences)
      ? { imageReferenceMediaIds: exactImageReferences }
      : {}),
    imageBase,
    image: withImageReferencePrompt(
      imageBase,
      imageReferenceItems(selection.selected, { assets, continuity })
    ),
    video: cleanRenderPrompt(
      withVideoSoundPrompt(improveVideoLipSyncPrompt(video, clip.dialogue ?? ''), scene, clip)
    ),
    imageGeneration: structuredClone(imageGenerationDefaults),
    referenceMediaIds: orderedReferences,
    continuity,
    dialogueMediaId: clip.selectedDialogueId ? String(clip.selectedDialogueId) : null,
    videoWithinLimit:
      cleanRenderPrompt(
        withVideoSoundPrompt(improveVideoLipSyncPrompt(video, clip.dialogue ?? ''), scene, clip)
      ).length <= 4500
  };
}
import { imageGenerationDefaults } from '../../shared/production-defaults.ts';
