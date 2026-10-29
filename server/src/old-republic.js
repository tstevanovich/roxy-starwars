import { characterPackageItems, characterPackageLayout } from '../../shared/character-package.js';
import {
  imageGenerationDefaults,
  noVideoUpscale,
  videoGenerationDefaults
} from '../../shared/production-defaults.js';
import { StudioAsset, StudioEpisode, StudioProject, StudioSettings } from './models/Studio.js';
import { settingsKey, withoutProject } from './project-context.js';
import { withProject } from './projects.js';

export const inquisitorKey = 'old-republic-sith-inquisitor';
export const inquisitorBrief = `Roxy Kane: The Old Republic - Sith Inquisitor. Star Wars universe, Old Republic era, SWTOR Sith Empire. This is a separate continuity from the Imperial-era smuggler series. Roxy takes the player-character role. Faithfully adapt the supplied source video's events, decisions, order and consequences. Source: https://www.youtube.com/watch?v=ojIORTFv7WU by Gamer's Little Playground. Episode 1 covers Initial Sith Trials, source chapter 16:47.160 to 34:03.639. No opening crawl. Begin directly with Arrival at Korriban (15:31-16:47.160), before Initial Sith Trials. Chapter metadata is verified; dialogue choices and exact scene coverage are not yet reviewed. Do not invent decisions or present an unreviewed outline as faithful. Entirely cinematic: zero vlogs, direct audience dialogue or first-person commentary. Aim around 10 minutes, but let meaningful story beats determine boundaries; clips 2-30 seconds. Adult Roxy preserves her approved face, hair and proportions from the explicit identity reference. New independent voice: adult female British/Imperial accent, defiant survivor, controlled intensity, clear diction, dry biting humor and restrained anger; Eleven v3, audition before finalizing. Each episode wardrobe must be grounded in the actual gameplay source. Episode 1 opens in the red starting acolyte outfit shown by the owner. Do not carry the smuggler series revealing-outfit rules into this faithful adaptation or invent a neutral identity costume. Extract and review source frames before proposing clothing. If required details cannot be verified, ask the owner BEFORE spending generation credits. The original portrait establishes face and hair, not episode clothing. Character references follow the supplied production workflow: master portrait, full-body front/three-quarter/profile/rear turnaround with heads visible, expressions, exact costume reference, written identity and separate useful view images. One character and one outfit per turnaround. No labels/text. Every distinct weapon gets a prop sheet with both sides, top, rear and close details; exact training blade and later weapons must match the source, with equipment changes at the recorded story points. Do not carry over False Fortune, Al, the smuggler pistol, relationships or original voice. GPT Image 2.5 Sunburst 2K/high for images, Wan 3.0 Standard 1080p/16:9 for video. Approve script/sound plan, references/images, dialogue, videos and finished sound mixes through the existing workflow. Video soundtracks contain effects, ambience and dialogue only. Separate original ElevenLabs music cues require music-brief approval before generation and individual take approval afterward. CapCut final editing uses the exported music track.`;
export async function initializeInquisitor() {
  await StudioProject.updateOne(
    { key: inquisitorKey },
    {
      $setOnInsert: {
        key: inquisitorKey,
        name: 'The Old Republic / Sith Inquisitor',
        era: 'Old Republic era - Sith Empire (SWTOR)',
        classStory: 'Sith Inquisitor',
        cinematicOnly: true,
        musicWorkflowEnabled: true,
        faithfulAdaptation: true,
        referenceLayout: characterPackageLayout,
        brief: inquisitorBrief
      }
    },
    { upsert: true }
  );
  const original = await withoutProject(() => StudioAsset.findOne({ seedKey: 'roxy' }).lean());
  const identity = (original?.finalChoice?.mediaIds ?? []).map(String);
  return withProject(inquisitorKey, async () => {
    await StudioSettings.updateOne(
      { key: settingsKey() },
      {
        $setOnInsert: {
          key: settingsKey(),
          era: 'Old Republic era - Sith Empire (SWTOR)',
          targetSeconds: 600,
          vlogPercent: 0,
          monthlyCredits: 106000,
          imageGeneration: imageGenerationDefaults,
          videoGeneration: videoGenerationDefaults,
          videoUpscale: noVideoUpscale,
          notes: inquisitorBrief,
          revision: 0
        }
      },
      { upsert: true }
    );
    let episode = await StudioEpisode.findOne({ title: 'Episode 01 - Initial Sith Trials' }).lean();
    if (!episode)
      episode = (
        await StudioEpisode.create({
          title: 'Episode 01 - Initial Sith Trials',
          synopsis:
            'A faithful, fully cinematic adaptation of the Initial Sith Trials chapter on Korriban. Source timings are indexed; choices and scene coverage await review.',
          premise:
            'Use the supplied gameplay as the source of truth. Preserve its decisions and consequences. Draft the scene breakdown only after reviewing the chapter. Condense repetitive travel/combat while retaining meaningful story beats.',
          notes:
            'Working target: approximately 10 minutes from 17 minutes 16 seconds of source. Begin directly with Arrival at Korriban; no opening crawl. New British defiant-survivor voice and Episode 1 acolyte outfit require individual review. No vlog dialogue. No music in generated clips.',
          sourceReferences: [
            {
              id: 'initial-trials',
              title: "Gamer's Little Playground - Sith Inquisitor: Legacies of Old",
              url: 'https://www.youtube.com/watch?v=ojIORTFv7WU',
              chapter: 'Initial Sith trials',
              startSeconds: 1007.16,
              endSeconds: 2043.639,
              status: 'unreviewed',
              notes:
                'Chapter boundaries verified from YouTube metadata on 2026-10-22. Actual dialogue choices, weapon design, cast and scene-by-scene events have not yet been reviewed.'
            },
            {
              id: 'arrival-korriban',
              title: 'Arrival at Korriban reference',
              url: 'https://www.youtube.com/watch?v=ojIORTFv7WU',
              chapter: 'Arrival at Korriban',
              startSeconds: 931,
              endSeconds: 1007.16,
              status: 'unreviewed',
              notes: 'Review the arrival cutscene before Initial Sith Trials. No opening crawl.'
            }
          ],
          decisions: [],
          scenes: []
        })
      ).toObject();
    const seeds = [
      {
        seedKey: 'or-si-roxy',
        name: 'Roxy Kane - Sith Inquisitor identity',
        kind: 'character',
        sheetLayout: characterPackageLayout,
        production: {
          managed: true,
          sourceMode: 'footage',
          sourceUrl: 'https://www.youtube.com/watch?v=ojIORTFv7WU',
          sourceNotes: 'Review the opening red outfit against the supplied footage.',
          sourceMediaIds: [],
          items: characterPackageItems()
        },
        identitySourceMediaIds: identity,
        brief:
          'Adult Roxy as the Sith Inquisitor protagonist. Preserve the approved portrait likeness, dark hair, proportions and skin texture. Defiant survivor at the beginning of the Korriban trials. Production package: a neutral three-quarter master portrait; front, three-quarter, profile and rear complete full-body turnaround with heads visible; expressions, costume, written identity and separate useful view images. Match the reviewed red starting outfit from the source footage; do not invent an interim identity costume. Confirm missing clothing details with the owner before generating.',
        notes:
          'Identity references below establish likeness only. Their smuggler outfit, weapon and backstory are not part of this storyline.'
      },
      {
        seedKey: 'or-si-roxy-voice',
        name: 'Roxy - British defiant survivor voice',
        kind: 'voice',
        aliases: ['Roxy', 'Roxy Kane'],
        brief:
          'New independent adult female British/Imperial voice. Controlled intensity, crisp diction, dry biting sarcasm, anger beneath restraint, clear emotional range. Survival and ambition rather than an established aristocrat. Audition with Eleven v3; preserve the chosen voice ID and settings.',
        notes:
          'Separate from the original series voice. Pending auditions; do not finalize a voice without listening.'
      },
      {
        seedKey: 'or-si-ep01-wardrobe',
        name: 'Roxy - Episode 01 acolyte wardrobe',
        kind: 'wardrobe',
        sheetLayout: characterPackageLayout,
        scope: 'episode',
        episodeId: episode._id,
        identitySourceMediaIds: identity,
        brief:
          'Episode 1 opening outfit must follow the Initial Sith Trials gameplay reference. Observed clothing: red wrap-style short-sleeved outer tunic, red edge trim, darker patterned lapel/collar, grey underlayer with longer sleeves, black trousers and a broad segmented belt. Confirm boots, rear construction and any uncertain details from source frames or with the owner before spending generation credits. Preserve Roxy portrait likeness and proportions. Costume references and complete full-body front, three-quarter, profile and rear views must follow the production package workflow. Heads and feet are visible in full-body views. No text, invented cutouts, weapons or holsters.',
        notes:
          'Source reference required before generation. Do not substitute a generic acolyte costume or apply the smuggler wardrobe rules. Ask the owner to resolve unverified details. Each later episode needs a source-grounded outfit and its own review.'
      },
      {
        seedKey: 'or-si-training-blade',
        name: 'Korriban training blade - source reference needed',
        kind: 'prop',
        brief:
          'Starting training weapon for Roxy on Korriban. Confirm the precise physical blade or staff shown in the source chapter before generating. Then create a text-free prop sheet showing both sides, top, rear, grip and blade details with consistent scale and wear.',
        notes:
          'No invented lightsaber design or premature equipment upgrade. Exact design awaits footage review.'
      },
      {
        seedKey: 'or-si-korriban',
        name: 'Korriban - initial trials environments',
        kind: 'environment',
        brief:
          'Photorealistic Star Wars Old Republic Korriban. Establish only the locations actually visible in the Initial Sith Trials source chapter. Preserve their layout, architecture, surfaces and lighting when adapting gameplay into live-action visuals.',
        notes:
          'Collect source frames and identify sets before rendering; do not assume all Korriban locations appear in Episode 1.'
      }
    ];
    for (const asset of seeds)
      await StudioAsset.updateOne(
        { seedKey: asset.seedKey },
        {
          $setOnInsert: {
            scope: 'reusable',
            aliases: [],
            notes: '',
            candidates: [],
            characterSheets: [],
            finalChoice: null,
            reviewStatus: 'development',
            revision: 0,
            ...asset
          }
        },
        { upsert: true }
      );
    return { project: await StudioProject.findOne({ key: inquisitorKey }).lean(), episode };
  });
}
