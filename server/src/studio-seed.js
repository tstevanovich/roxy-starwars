import {
  imageGenerationDefaults,
  noVideoUpscale,
  videoGenerationDefaults
} from '../../shared/production-defaults.js';
import { StudioAsset, StudioSettings } from './models/Studio.js';
import { legacyProjectKey, projectKey } from './project-context.js';

const choice = (id, title, description) => ({ id, title, description, mediaIds: [] });
const seeds = [
  {
    seedKey: 'roxy',
    name: 'Roxy Kane',
    kind: 'character',
    brief:
      'Confident, seductive, funny, and motivated by credits. A talented pilot and skilled pistol marksman. Preserve the face, hair, and proportions from her supplied character sheet.',
    candidates: [
      choice(
        'roxy-reference',
        'Original character reference',
        'Import Roxy’s supplied character sheet here. This is her identity reference; episode outfits are separate assets.'
      )
    ]
  },
  {
    seedKey: 'fortune',
    name: 'False Fortune',
    kind: 'ship',
    aliases: ['the Fortune'],
    brief:
      'Roxy’s home, smuggling ship, and recurring production set. Approve an exterior before establishing a consistent interior layout.',
    candidates: [
      choice(
        'fortune-freighter',
        'The underestimated freighter',
        'A compact, weathered working freighter. An asymmetric cockpit, repaired hull panels, and discreet upgrades hide surprising speed. Warm, lived-in interiors.'
      ),
      choice(
        'fortune-courier',
        'The modified courier',
        'A slim former courier with a long central hull, side-mounted engines, and an expanded cargo module. Fast and practical, with narrow connecting corridors.'
      ),
      choice(
        'fortune-hauler',
        'The lucky salvage hauler',
        'A squat industrial hauler with a forward cockpit, broad boarding ramp, and modular cargo bays. Its ungainly silhouette conceals clever smuggling compartments.'
      )
    ]
  },
  {
    seedKey: 'al',
    name: 'AL-1B',
    kind: 'droid',
    aliases: ['AL'],
    brief:
      'Male copilot, mechanic, and AI assistant. Funny and genuinely capable. His practical design must support cockpit controls and ship repairs.',
    candidates: [
      choice(
        'al-service',
        'The long-suffering service droid',
        'A lean, articulated service droid with dexterous hands, an expressive optical visor, and a retractable tool kit. Dry observations and excellent comic timing.'
      ),
      choice(
        'al-industrial',
        'The patched industrial mechanic',
        'A sturdy mechanic droid with worn cream plating, exposed service joints, and a compact tool arm. A competent realist who keeps a running tally of Roxy’s repair bills.'
      ),
      choice(
        'al-navigator',
        'The repurposed navigator',
        'A narrow torso, compact head, articulated arms, and a folding lower chassis suited to a copilot station. Precise, observant, and quietly unimpressed by dangerous plans.'
      )
    ]
  },
  {
    seedKey: 'blaster',
    name: 'Roxy’s pistol',
    kind: 'prop',
    brief:
      'One recognizable blaster pistol and matching holster. Keep dimensions, finish, handedness, and drawn/holstered state consistent.',
    candidates: [
      choice(
        'pistol-practical',
        'The working smuggler’s sidearm',
        'A compact, worn blaster with a dark finish, practical grip, and a recognizable silhouette. Design a matching holster after approving the weapon.'
      )
    ]
  },
  {
    seedKey: 'roxy-voice',
    name: 'Roxy’s voice',
    kind: 'voice',
    brief:
      'ElevenLabs. American English, a lower female register, confident, conversational, and teasing. Approve an audition and retain its voice ID.',
    candidates: [
      choice(
        'roxy-voice-warm',
        'Warm confidence',
        'An adult woman with a warm lower register, natural American pronunciation, relaxed confidence, and an amused edge. Leave room for tension and quick wit.'
      )
    ]
  },
  {
    seedKey: 'al-voice',
    name: 'AL’s voice',
    kind: 'voice',
    brief:
      'ElevenLabs. A male voice with clear delivery and comic timing. Accent and processing remain open.',
    candidates: [
      choice(
        'al-voice-dry',
        'Dry and observant',
        'A clear male performance with precise timing and restrained sarcasm. Start with a clean master recording before choosing light droid processing.'
      )
    ]
  },
  ...['Cockpit', 'Cargo hold', 'Engineering', 'Quarters', 'Boarding ramp'].map((name, i) => ({
    seedKey: `set-${i}`,
    name: `Fortune · ${name}`,
    kind: 'environment',
    brief: `A reusable ${name.toLowerCase()} set aboard False Fortune. Finalize the ship design and layout before approving this environment.`,
    candidates: []
  })),
  {
    seedKey: 'wardrobe-01',
    name: 'Episode 01 wardrobe',
    kind: 'wardrobe',
    brief:
      'A distinctive smuggler outfit with cleavage and visible midriff. Keep the approved outfit consistent throughout the episode.',
    candidates: []
  }
];

export async function seedStudio() {
  if (projectKey() !== legacyProjectKey) return;
  await StudioAsset.bulkWrite(
    seeds.map((asset) => ({
      updateOne: {
        filter: { seedKey: asset.seedKey },
        update: {
          $setOnInsert: {
            aliases: [],
            notes: '',
            revision: 0,
            history: [],
            finalChoice: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...asset
          }
        },
        upsert: true,
        timestamps: false
      }
    }))
  );
  await StudioSettings.updateOne(
    { key: 'series' },
    {
      $setOnInsert: {
        key: 'series',
        era: 'Imperial era',
        targetSeconds: 600,
        vlogPercent: 33,
        monthlyCredits: 106000,
        imageGeneration: structuredClone(imageGenerationDefaults),
        videoGeneration: structuredClone(videoGenerationDefaults),
        videoUpscale: structuredClone(noVideoUpscale),
        revision: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes:
          'Humor, action, flirtation, strong dialogue, and coherent smuggling adventures. Roxy addresses the audience for roughly one-third of the runtime. Clip lengths follow the scene. Sound effects and ambience; no generated music. Final assembly and music in CapCut. Every character, droid, and prop uses a reusable reference sheet. Characters and droids establish front, three-quarter, side, rear and face views. Props establish both sides, top, rear and detail views, adding front and three-quarter views when useful. Approve sheets before reuse; keep episode outfits separate from character identity.'
      }
    },
    { upsert: true, timestamps: false }
  );
}
