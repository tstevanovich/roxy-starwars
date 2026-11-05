import mongoose from 'mongoose';

import {
  imageGenerationDefaults,
  noVideoUpscale,
  videoGenerationDefaults
} from '../../../shared/production-defaults.ts';
import { projectKey, projectScope } from '../project-context.ts';

const { Schema } = mongoose;
const options = { timestamps: true, versionKey: false } as const;
function scoped<const T extends mongoose.SchemaDefinition>(definition: T) {
  const schema = new Schema<
    mongoose.InferRawDocType<T> & { projectKey?: string; createdAt?: Date; updatedAt?: Date }
  >(definition, options);
  schema.plugin(projectScope);
  return schema;
}
export const StudioProject = mongoose.model(
  'StudioProject',
  new Schema(
    {
      key: { type: String, unique: true },
      name: String,
      era: String,
      classStory: String,
      cinematicOnly: Boolean,
      faithfulAdaptation: Boolean,
      referenceLayout: String,
      workflowVersion: { type: Number, default: 0 },
      videoWorkflow: { type: String, default: 'native-1080p' },
      musicWorkflowEnabled: { type: Boolean, default: false },
      brief: String
    },
    options
  )
);
const candidate = new Schema(
  {
    id: String,
    title: String,
    description: String,
    mediaIds: [{ type: Schema.Types.ObjectId, ref: 'StudioMedia' }],
    voiceId: String,
    generatedVoiceId: String,
    voiceDescription: String,
    voiceModel: String,
    continuitySources: [Schema.Types.Mixed],
    archived: { type: Boolean, default: false }
  },
  { _id: false }
);

export const StudioAsset = mongoose.model(
  'StudioAsset',
  scoped({
    seedKey: { type: String, unique: true, sparse: true },
    name: String,
    kind: String,
    aliases: [String],
    sheetLayout: String,
    identitySourceMediaIds: [{ type: Schema.Types.ObjectId, ref: 'StudioMedia' }],
    brief: String,
    notes: String,
    production: { type: Schema.Types.Mixed, default: () => ({}) },
    scope: { type: String, enum: ['reusable', 'episode'], default: 'reusable' },
    episodeId: { type: Schema.Types.ObjectId, ref: 'StudioEpisode', default: null },
    sceneId: { type: String, default: null },
    clipId: { type: String, default: null },
    reviewStatus: { type: String, enum: ['development', 'pending-choice'], default: null },
    archived: { type: Boolean, default: false },
    relatedAssetId: { type: Schema.Types.ObjectId, ref: 'StudioAsset', default: null },
    referenceRevision: Number,
    candidates: [candidate],
    characterSheets: [
      new Schema(
        {
          id: String,
          title: String,
          mediaId: { type: Schema.Types.ObjectId, ref: 'StudioMedia' },
          views: [String],
          sourceCandidateId: String,
          sourceFinalizedAt: Date,
          approvedAt: { type: Date, default: null }
        },
        { _id: false }
      )
    ],
    finalChoice: { type: Schema.Types.Mixed, default: null },
    revision: { type: Number, default: 0 },
    history: [Schema.Types.Mixed]
  })
);

export const StudioMedia = mongoose.model(
  'StudioMedia',
  new Schema(
    {
      filename: String,
      originalName: String,
      mime: String,
      kind: String,
      bytes: Number,
      durationSeconds: Number,
      sha256: String,
      providerReference: Schema.Types.Mixed,
      providerUpload: Schema.Types.Mixed,
      projectKey: { type: String, default: projectKey, index: true },
      productionJobId: { type: String, index: true, sparse: true },
      voiceDesign: Schema.Types.Mixed,
      soundMix: Schema.Types.Mixed,
      nativeAudio: Schema.Types.Mixed,
      musicCue: Schema.Types.Mixed,
      videoVerification: Schema.Types.Mixed,
      videoReview: Schema.Types.Mixed,
      sourceFrame: Schema.Types.Mixed,
      sourceVideo: Schema.Types.Mixed,
      crc32: Number
    },
    options
  )
);

const clip = new Schema(
  {
    id: String,
    title: String,
    duration: Number,
    action: String,
    dialogue: String,
    camera: String,
    soundEffects: String,
    production: { type: Schema.Types.Mixed, default: () => ({}) },
    dialogueTakeIds: [{ type: Schema.Types.ObjectId, ref: 'StudioMedia' }],
    selectedDialogueId: { type: Schema.Types.ObjectId, ref: 'StudioMedia', default: null },
    takeIds: [{ type: Schema.Types.ObjectId, ref: 'StudioMedia' }],
    selectedTakeId: { type: Schema.Types.ObjectId, ref: 'StudioMedia', default: null },
    soundLegacyTakeId: { type: Schema.Types.ObjectId, ref: 'StudioMedia', default: null },
    upscale: { type: Schema.Types.Mixed, default: null }
  },
  { _id: false }
);
const scene = new Schema(
  {
    id: String,
    title: String,
    style: String,
    location: String,
    script: String,
    production: { type: Schema.Types.Mixed, default: () => ({}) },
    sourceReferenceIds: [String],
    sourceNotes: String,
    sourceEvidenceHash: String,
    assetIds: [{ type: Schema.Types.ObjectId, ref: 'StudioAsset' }],
    clips: [clip],
    approval: { type: Schema.Types.Mixed, default: null },
    soundPlan: { type: Schema.Types.Mixed, default: null }
  },
  { _id: false }
);
export const StudioEpisode = mongoose.model(
  'StudioEpisode',
  scoped({
    title: String,
    synopsis: { type: String, default: '' },
    premise: String,
    videoPass: Schema.Types.Mixed,
    production: { type: Schema.Types.Mixed, default: () => ({}) },
    sourceReferences: { type: [Schema.Types.Mixed], default: [] },
    decisions: { type: [Schema.Types.Mixed], default: [] },
    notes: String,
    scenes: [scene],
    researchNotes: { type: [Schema.Types.Mixed], default: [] },
    revision: { type: Number, default: 0 },
    history: [Schema.Types.Mixed]
  })
);

const reviewSchema = scoped({
  targetKey: String,
  target: Schema.Types.Mixed,
  stage: String,
  state: String,
  fingerprint: String,
  approvalFingerprint: String,
  contentFingerprint: String,
  clipApprovalFingerprints: Schema.Types.Mixed,
  feedback: String,
  revision: { type: Number, default: 0 },
  reviewedAt: Date,
  history: [Schema.Types.Mixed]
});
reviewSchema.index({ projectKey: 1, targetKey: 1 }, { unique: true });
export const StudioReview = mongoose.model('StudioReview', reviewSchema);

const musicCueSchema = scoped({
  episodeId: { type: Schema.Types.ObjectId, index: true },
  sceneId: String,
  enabled: { type: Boolean, default: true },
  prompt: String,
  model: { type: String, default: 'music_v2_5' },
  bufferSeconds: { type: Number, default: 5 },
  revision: { type: Number, default: 0 },
  selectedMediaId: { type: Schema.Types.ObjectId, default: null },
  candidates: { type: [Schema.Types.Mixed], default: [] },
  history: [Schema.Types.Mixed]
});
musicCueSchema.index({ projectKey: 1, episodeId: 1, sceneId: 1 }, { unique: true });
export const StudioMusicCue = mongoose.model('StudioMusicCue', musicCueSchema);

const automationSchema = scoped({
  key: { type: String, unique: true },
  target: Schema.Types.Mixed,
  trigger: Schema.Types.Mixed,
  status: { type: String, default: 'queued', index: true },
  jobIds: [String],
  failures: [Schema.Types.Mixed],
  error: String,
  leaseUntil: Date
});
export const StudioAutomation = mongoose.model('StudioAutomation', automationSchema);

const sourceEvidenceSchema = scoped({
  episodeId: { type: String, index: true },
  sourceId: String,
  sourceUrl: String,
  startSeconds: Number,
  endSeconds: Number,
  title: String,
  observations: String,
  limitations: String,
  videoMediaId: String,
  videoSegments: { type: [Schema.Types.Mixed], default: [] },
  frames: [{ type: Schema.Types.Mixed }],
  captions: [{ type: Schema.Types.Mixed }]
});
sourceEvidenceSchema.index({ projectKey: 1, episodeId: 1, sourceId: 1 }, { unique: true });
export const StudioSourceEvidence = mongoose.model('StudioSourceEvidence', sourceEvidenceSchema);

export const StudioSettings = mongoose.model(
  'StudioSettings',
  scoped({
    key: { type: String, unique: true },
    era: String,
    targetSeconds: Number,
    vlogPercent: Number,
    monthlyCredits: Number,
    imageGeneration: {
      type: Schema.Types.Mixed,
      default: () => structuredClone(imageGenerationDefaults)
    },
    videoUpscale: {
      type: Schema.Types.Mixed,
      default: () => structuredClone(noVideoUpscale)
    },
    videoGeneration: {
      type: Schema.Types.Mixed,
      default: () => structuredClone(videoGenerationDefaults)
    },
    notes: String,
    revision: { type: Number, default: 0 }
  })
);
