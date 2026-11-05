import mongoose from 'mongoose';

import { projectScope } from '../project-context.ts';

const { Schema } = mongoose;
const options = { timestamps: true, versionKey: false } as const;
function scoped<const T extends mongoose.SchemaDefinition>(definition: T) {
  const schema = new Schema<
    mongoose.InferRawDocType<T> & { projectKey?: string; createdAt?: Date; updatedAt?: Date }
  >(definition, options);
  schema.plugin(projectScope);
  return schema;
}
export const Chat = mongoose.model(
  'StudioChat',
  scoped({
    title: String,
    context: Schema.Types.Mixed,
    activeRun: { type: String, default: null },
    workflowKey: { type: String, unique: true, sparse: true }
  })
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
      providerErrorCode: String,
      workflowKey: { type: String, unique: true, sparse: true },
      workflowDraft: Schema.Types.Mixed
    },
    options
  )
);
const jobSchema = scoped({
  chatId: Schema.Types.ObjectId,
  runId: String,
  requestId: { type: String, unique: true },
  retryOf: String,
  revisionProposalId: String,
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
});
jobSchema.index(
  { projectKey: 1, 'payload.cueId': 1 },
  {
    unique: true,
    partialFilterExpression: {
      kind: 'music',
      status: { $in: ['queued', 'preparing', 'submitting', 'importing', 'uncertain'] }
    }
  }
);
export const Job = mongoose.model('StudioProductionJob', jobSchema);
export const Proposal = mongoose.model(
  'StudioStoryProposal',
  scoped({
    chatId: Schema.Types.ObjectId,
    title: String,
    text: String,
    episodeId: String,
    assetId: String,
    scope: String,
    production: Schema.Types.Mixed,
    brief: String,
    baseBrief: String,
    timingRepair: Schema.Types.Mixed,
    sourceReferences: { type: [Schema.Types.Mixed], default: undefined },
    baseRevision: Number,
    targetClipId: String,
    baseProduction: Schema.Types.Mixed,
    reviewStages: { type: [String], default: undefined },
    workingKey: { type: String, index: true },
    draftStage: String,
    draftVersion: Number,
    previousDraftId: String,
    absorbedDraftIds: [String],
    supportingNotes: { type: [Schema.Types.Mixed], default: [] },
    removedSupportingNoteIds: { type: [String], default: [] },
    supersededBy: String,
    supersededAt: Date,
    scene: Schema.Types.Mixed,
    render: Schema.Types.Mixed,
    requestId: { type: String, unique: true, sparse: true },
    status: { type: String, default: 'pending' }
  })
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
