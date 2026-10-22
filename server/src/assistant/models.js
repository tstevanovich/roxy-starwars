import mongoose from 'mongoose';

const { Schema } = mongoose;
const options = { timestamps: true, versionKey: false };
export const Chat = mongoose.model(
  'StudioChat',
  new Schema(
    {
      title: String,
      context: Schema.Types.Mixed,
      activeRun: { type: String, default: null }
    },
    options
  )
);
export const Message = mongoose.model(
  'StudioChatMessage',
  new Schema(
    {
      chatId: { type: Schema.Types.ObjectId, index: true },
      role: String,
      text: String,
      mediaIds: [String],
      runId: String,
      requestId: { type: String, unique: true, sparse: true }
    },
    options
  )
);
export const Run = mongoose.model(
  'StudioChatRun',
  new Schema(
    {
      chatId: Schema.Types.ObjectId,
      status: { type: String, index: true },
      error: String,
      usage: Schema.Types.Mixed,
      provider: String,
      profileId: String,
      model: String,
      preview: String,
      providerErrorCode: String
    },
    options
  )
);
export const Job = mongoose.model(
  'StudioProductionJob',
  new Schema(
    {
      chatId: Schema.Types.ObjectId,
      runId: String,
      requestId: { type: String, unique: true },
      kind: String,
      title: String,
      target: Schema.Types.Mixed,
      instructions: String,
      referenceIds: [String],
      snapshot: Schema.Types.Mixed,
      settings: Schema.Types.Mixed,
      status: { type: String, index: true },
      historyId: String,
      quote: Schema.Types.Mixed,
      nextPollAt: Date,
      error: String,
      resultMediaIds: [String],
      resultAssetId: String,
      receipt: Schema.Types.Mixed,
      payload: Schema.Types.Mixed
    },
    options
  )
);
export const Proposal = mongoose.model(
  'StudioStoryProposal',
  new Schema(
    {
      chatId: Schema.Types.ObjectId,
      title: String,
      text: String,
      episodeId: String,
      baseRevision: Number,
      scene: Schema.Types.Mixed,
      status: { type: String, default: 'pending' }
    },
    options
  )
);
export const SourceGrant = mongoose.model(
  'StudioSourceGrant',
  new Schema(
    {
      tokenHash: { type: String, unique: true },
      mediaId: String,
      ownerVersion: String,
      expires: { type: Date, expires: 0 },
      jobId: String
    },
    options
  )
);
