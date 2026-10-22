import mongoose from 'mongoose';

import {
  imageGenerationDefaults,
  videoUpscaleDefaults
} from '../../../shared/production-defaults.js';

const { Schema } = mongoose;
const options = { timestamps: true, versionKey: false };
const candidate = new Schema(
  {
    id: String,
    title: String,
    description: String,
    mediaIds: [{ type: Schema.Types.ObjectId, ref: 'StudioMedia' }],
    voiceId: String,
    voiceModel: String,
    archived: { type: Boolean, default: false }
  },
  { _id: false }
);

export const StudioAsset = mongoose.model(
  'StudioAsset',
  new Schema(
    {
      seedKey: { type: String, unique: true, sparse: true },
      name: String,
      kind: String,
      aliases: [String],
      brief: String,
      notes: String,
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
    },
    options
  )
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
      sha256: String,
      providerReference: Schema.Types.Mixed,
      productionJobId: { type: String, index: true, sparse: true },
      soundMix: Schema.Types.Mixed,
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
    assetIds: [{ type: Schema.Types.ObjectId, ref: 'StudioAsset' }],
    clips: [clip],
    approval: { type: Schema.Types.Mixed, default: null },
    soundPlan: { type: Schema.Types.Mixed, default: null }
  },
  { _id: false }
);
export const StudioEpisode = mongoose.model(
  'StudioEpisode',
  new Schema(
    {
      title: String,
      synopsis: { type: String, default: '' },
      premise: String,
      notes: String,
      scenes: [scene],
      revision: { type: Number, default: 0 },
      history: [Schema.Types.Mixed]
    },
    options
  )
);

export const StudioSettings = mongoose.model(
  'StudioSettings',
  new Schema(
    {
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
        default: () => structuredClone(videoUpscaleDefaults)
      },
      notes: String,
      revision: { type: Number, default: 0 }
    },
    options
  )
);
