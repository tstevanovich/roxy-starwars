import type { Types } from 'mongoose';
/** JSON records exchanged by the studio API. IDs and dates are serialized at the HTTP boundary. */
export type Id = string;
export type RecordId = string | Types.ObjectId;
/** Evaluators accept both partial stored documents and serialized API records. */
export type PersistedInput<T> = T extends string
  ? string
  : T extends (infer U)[]
    ? PersistedInput<U>[]
    : T extends object
      ? {
          [K in keyof T]?: K extends
            'createdAt' | 'updatedAt' | 'approvedAt' | 'finalizedAt' | 'sourceFinalizedAt'
            ? string | Date
            : K extends
                  | '_id'
                  | 'mediaId'
                  | 'episodeId'
                  | 'relatedAssetId'
                  | 'selectedTakeId'
                  | 'selectedDialogueId'
                  | 'soundLegacyTakeId'
                  | 'productionJobId'
              ? RecordId
              : K extends
                    | 'mediaIds'
                    | 'takeIds'
                    | 'dialogueTakeIds'
                    | 'identitySourceMediaIds'
                    | 'assetIds'
                ? RecordId[]
                : PersistedInput<T[K]>;
        }
      : T;
export type ClipInput = PersistedInput<Clip>;
export type SceneInput = PersistedInput<Scene>;
export type AssetInput = PersistedInput<Asset>;
export type MediaInput = PersistedInput<MediaFile>;
export type MediaKind = 'image' | 'video' | 'audio';
export type AssetKind =
  'character' | 'droid' | 'ship' | 'environment' | 'prop' | 'wardrobe' | 'voice' | 'sound';
export type ReviewStatus =
  'draft' | 'blocked' | 'pending-review' | 'needs-review' | 'needs-changes' | 'approved';
export interface ReviewTarget {
  scope: 'asset' | 'episode' | 'scene' | 'clip';
  recordId: Id;
  sceneId?: string;
  clipId?: string;
}
export interface ProductionTarget {
  assetId?: Id;
  episodeId?: Id;
  sceneId?: string;
  clipId?: string;
  packageItemId?: string;
  layerId?: string;
}
export interface ChatContext extends ProductionTarget {
  candidateId?: string;
  revision?: number;
  title?: string;
}
export interface ContinuitySource {
  sceneId: string;
  clipId: string;
  mediaId?: Id;
  assetId?: Id;
  title?: string;
}
export interface Candidate {
  sourceMediaId?: string;
  qc?: {
    passed?: boolean;
    preparedSeconds?: number;
    status?: string;
    message?: string;
    leadingSeconds?: number;
    trailingSeconds?: number;
    audibleSeconds?: number;
    reason?: string;
    expectedSeconds?: number;
    measuredSeconds?: number;
  };
  id: string;
  title: string;
  description?: string;
  mediaIds: Id[];
  voiceId?: string;
  generatedVoiceId?: string;
  voiceDescription?: string;
  voiceModel?: string;
  archived?: boolean;
  finalizedAt?: string;
  continuitySources?: ContinuitySource[];
  fingerprint?: string;
  contentFingerprint?: string;
  approvalFingerprint?: string;
}
export interface PackageItem {
  id: string;
  title: string;
  type: 'image' | 'audio' | 'notes';
  required: boolean;
  notes: string;
  mediaId?: Id | null;
  imagePrompt?: string;
  referenceMediaIds?: Id[];
  sourceMediaIds?: Id[];
  revision?: number;
  approval?: unknown;
  imageReferenceMediaIds?: Id[];
  revisionSourceMediaId?: Id;
  requiresPlanApproval?: boolean;
}
export interface ProductionSettings {
  managed?: boolean;
  characterAssetId?: Id;
  sourceUrl?: string;
  sourceMode?: string;
  sourceNotes?: string;
  sourceReferenceIds?: string[];
  sourceEvidence?: unknown[];
  items?: PackageItem[];
  sourceMediaIds?: Id[];
  sourceLinks?: SourceReference[];
  identityNotes?: string;
  voiceDescription?: string;
  voiceSampleText?: string;
  voiceModel?: string;
  outline?: string;
  outlineNeedsRevision?: boolean;
  selectedOutline?: string;
  manualGeneration?: boolean;
  continuityMode?: string;
  continuitySources?: ContinuitySource[];
  continuityNotes?: string;
  location?: string;
  environment?: string;
  physicalConstraints?: string;
  mode?: string;
  framing?: string;
  beats?: string;
  passCondition?: string;
  referenceMediaIds?: Id[];
  referenceAssetIds?: Id[];
  imageReferenceMediaIds?: Id[];
  videoReferenceMediaIds?: Id[];
  imagePrompt?: string;
  videoPrompt?: string;
  videoTransitionPrompt?: string;
  videoEndFrame?: { mode: string; mediaId?: Id; assetId?: Id; sceneId?: string; clipId?: string };
  visualTakeId?: Id | null;
  upscaleMediaId?: Id | null;
  upscaleSourceTakeId?: Id | null;
  audioRepairTakeId?: Id | null;
  cleanDialogueMediaId?: Id | null;
  startState?: string;
  endState?: string;
  allowedMotion?: string;
  voiceStyle?: string;
}
export interface CharacterSheet {
  approvedAt?: string;
  sourceCandidateId?: string;
  sourceFinalizedAt?: string;
  views?: string[];
  id: string;
  title?: string;
  mediaId: Id;
  kind?: string;
  view?: string;
  notes?: string;
}
export interface StudioRecord {
  savedAt?: string;
  candidates?: Candidate[];
  finalChoice?: Candidate;
  sourceReferences?: SourceReference[];
  premise?: string;
  _id: Id;
  revision: number;
  production: ProductionSettings;
  notes: string;
  history?: StudioRecord[];
  projectKey?: string;
  createdAt?: string;
  updatedAt?: string;
  name?: string;
  title?: string;
  kind?: AssetKind;
  scenes?: Scene[];
  brief?: string;
}
export interface Asset extends StudioRecord {
  name: string;
  kind: AssetKind;
  brief: string;
  aliases: string[];
  candidates: Candidate[];
  finalChoice?: Candidate | null;
  characterSheets: CharacterSheet[];
  archived?: boolean;
  scope?: 'episode' | 'reusable';
  episodeId?: Id | null;
  sceneId?: string | null;
  clipId?: string | null;
  referenceRevision?: number;
  sheetLayout?: string;
  identitySourceMediaIds?: Id[];
  relatedAssetId?: Id | null;
  workflowStatus?: string;
  seedKey?: string;
  reviewStatus?: string | null;
  workflowVersion?: number;
  workflowReviews?: ReviewRow[];
  referencePrompts?: { itemId: string; prompt: string }[];
  referencePackageReady?: boolean;
}
export interface Clip {
  /** Older saved records may carry the prompt outside production. */
  videoPrompt?: string;
  id: string;
  title: string;
  duration: number;
  action: string;
  dialogue: string;
  camera: string;
  soundEffects: string;
  production: ProductionSettings;
  dialogueTakeIds: Id[];
  takeIds: Id[];
  selectedDialogueId?: Id | null;
  selectedTakeId?: Id | null;
  soundLegacyTakeId?: Id | null;
  pictureReview?: ReviewRow;
  soundReviewStatus?: ReviewStatus;
  upscale?: UpscaleState | null;
  pictureApprovalStatus?: ReviewStatus;
  pictureReviewBlockers?: string[];
}
export interface UpscaleState {
  importedAt?: string;
  verified?: { width?: number; height?: number; duration?: number; fps?: number };
  status: string;
  sourceTakeId?: Id;
  mediaId?: Id;
  message?: string;
}
export interface SoundLayer {
  approval?: unknown;
  id: string;
  title: string;
  type: 'ambience' | 'effect';
  description: string;
  assetId?: Id | null;
  clipId?: string | null;
  start: number;
  sourceStart: number;
  duration: number;
  gainDb: number;
  lowpassHz: number;
  loop: boolean;
}
export interface SoundPlan {
  notes: string;
  dialogueGainDb: number;
  layers: SoundLayer[];
  approval?: { fingerprint?: string; approvedAt?: string | Date };
}
export interface Scene {
  id: string;
  title: string;
  style: 'cinematic' | 'vlog';
  location: string;
  script: string;
  production: ProductionSettings;
  assetIds: Id[];
  clips: Clip[];
  soundPlan?: SoundPlan | null;
  approval?: { fingerprint?: string; approvedAt?: string | Date };
  sourceReferenceIds?: string[];
  sourceNotes?: string;
  sourceEvidenceHash?: string;
  editToken?: string;
  soundApprovalStatus?: ReviewStatus;
  approvalStatus?: ReviewStatus;
  pictureReviewBlockers?: string[];
}
export interface SourceReference {
  id: string;
  title: string;
  url: string;
  type?: string;
  chapter?: string;
  startSeconds?: number;
  endSeconds?: number;
  status?: string;
  notes?: string;
  mediaId?: Id | null;
  sourceMode?: string;
  captionStatus?: string;
}
export interface SourceDecision {
  timestampSeconds?: number;
  outcome?: string;
  id: string;
  sourceId: string;
  timestamp?: number;
  prompt?: string;
  choice?: string;
  notes?: string;
  status?: string;
}
export interface Episode extends StudioRecord {
  title: string;
  synopsis: string;
  premise: string;
  scenes: Scene[];
  sourceReferences: SourceReference[];
  decisions: SourceDecision[];
  workflowVersion?: number;
  workflowReady?: boolean;
  workflowReviewCount?: number;
  workflowReviews?: ReviewRow[];
  researchNotes?: { id: string; title?: string; text: string }[];
  videoPass?: { id?: string; policy?: string };
}
export interface MediaFile {
  _id: Id;
  filename: string;
  originalName: string;
  mime: string;
  kind: MediaKind;
  bytes: number;
  projectKey?: string;
  durationSeconds?: number;
  sha256?: string;
  productionJobId?: Id;
  createdAt?: string;
  sourceFrame?: {
    sourceUrl?: string;
    sourceSeconds?: number;
    requestedSeconds?: number;
    view?: string;
    sourceId?: string;
    episodeId?: Id;
    timestamp?: number;
    videoTime?: number;
    crop?: string;
  };
  sourceVideo?: { sourceId?: string; episodeId?: Id; startSeconds?: number; endSeconds?: number };
  voiceDesign?: {
    voiceId?: string;
    generatedVoiceId?: string;
    assetId?: Id;
    prompt?: string;
    model?: string;
  };
  nativeAudio?: {
    verified?: boolean;
    hasAudio?: boolean;
    policy?: string;
    version?: number;
    soundtrack?: string;
  };
  soundMix?: {
    sourceTakeId?: Id;
    fingerprint?: string;
    approved?: boolean;
    dialogueId?: Id;
    layers?: unknown[];
  };
  providerUpload?: unknown;
  providerReference?: { id?: string; url?: string; provider?: string };
  musicCue?: {
    cueId?: Id;
    fingerprint?: string;
    prompt?: string;
    durationSeconds?: number;
    cost?: number;
  };
  videoVerification?: { height?: number; width?: number };
  videoReview?: { state?: string; episodeId?: string; sceneId?: string; clipId?: string };
}
export interface ReviewRow {
  name?: string;
  key: string;
  target: ReviewTarget;
  stage: string;
  title: string;
  status: ReviewStatus;
  fingerprint: string;
  approvalFingerprint?: string;
  reviewRevision: number;
  parentRevision: number;
  feedback: string;
  canApprove: boolean;
  automatic?: boolean;
  blockers: string[];
  prerequisites?: ReviewLink[];
  lastAction?: string | null;
  feedbackIsCurrent?: boolean;
  retainedApproval?: boolean;
  coveredByScene?: boolean;
  savedAt?: string | null;
  navigationHref?: string;
  navigationTitle?: string;
  timingIssues?: TimingIssue[];
}
export type ReviewLink = Pick<ReviewRow, 'key' | 'target' | 'stage' | 'title' | 'status'> & {
  navigationHref?: string;
  navigationTitle?: string;
};
export interface TimingIssue {
  clipId: string;
  message: string;
  seconds?: number;
  duration?: number;
  split?: boolean;
}
export interface Job {
  _id: Id;
  kind: string;
  title: string;
  target: ProductionTarget;
  status: string;
  requestId?: string;
  error?: string | null;
  resultMediaIds?: Id[];
  resultAssetId?: Id;
  retryOf?: Id;
  createdAt?: string;
  settings?: {
    model?: string;
    mode?: string;
    resolution?: string;
    duration?: number;
    prompt?: string;
    params?: Record<string, unknown> & { mode?: string; resolution?: string };
  };
  snapshot?: {
    imageIds?: string[];
    characterReferences?: VideoReference[];
    transition?: VideoTransition;
    [key: string]: unknown;
  };
  historyId?: string;
  quote?: { items?: { totalCredits?: number }[]; pricingNote?: string };
  receipt?: { creditsCharged?: number };
}
export interface VideoTransition {
  files?: { id: string; sha?: string }[];
  endImageId?: string;
  finalPart?: boolean;
  nextClipId: string;
  nextEpisodeId?: Id;
  errors: string[];
  imageIds: Id[];
  instructions?: string;
  title?: string;
  mode?: string;
}
export interface Proposal {
  chatId?: string;
  _id: Id;
  title: string;
  text: string;
  status: string;
  episodeId?: Id;
  assetId?: Id;
  scene?: Scene;
  production?: ProductionSettings;
  targetClipId?: string;
  scope?: string;
  brief?: string;
  draftStage?: string;
  reviewStages?: string[];
  baseRevision?: number;
  draftVersion?: number;
  supportingNotes?: { id: string; title?: string; text: string }[];
  sourceReferences?: SourceReference[];
  application?: { canApply: boolean; reason?: string; rebased?: boolean; recordRevision?: number };
  render?: {
    target: ProductionTarget;
    model?: string;
    resolution?: string;
    duration?: number;
    instructions: string;
    referenceIds?: Id[];
    aspectRatio?: string;
  };
  timingRepair?: { repairs: TimingIssue[] };
}
export interface Chat {
  _id: Id;
  title: string;
  context: ChatContext;
  activeRun?: Id | null;
}
export interface ChatMessage {
  _id: Id;
  role: string;
  text: string;
  mediaIds?: Id[];
}
export interface ChatRun {
  _id: Id;
  status: string;
  error?: string;
  preview?: string;
  usage?: unknown;
}
export interface ChatDetail {
  media?: MediaFile[];
  chat: Chat;
  messages: ChatMessage[];
  runs: ChatRun[];
  jobs: Job[];
  proposals: Proposal[];
}
export interface StudioSettings {
  workflowVersion?: number;
  videoWorkflow?: string;
  cinematicOnly?: boolean;
  _id: Id;
  era: string;
  notes: string;
  targetSeconds: number;
  vlogPercent: number;
  monthlyCredits: number;
  revision: number;
  videoGeneration?: { model?: string; resolution?: string };
  imageGeneration?: unknown;
}
export interface Project {
  key: string;
  name: string;
  era?: string;
  cinematicOnly?: boolean;
  faithfulAdaptation?: boolean;
  workflowVersion?: number;
  videoWorkflow?: string;
  referenceLayout?: string;
  brief?: string;
  musicWorkflowEnabled?: boolean;
}
export interface StudioData {
  assets: Asset[];
  episodes: Episode[];
  media: MediaFile[];
  settings: StudioSettings;
  projects?: Project[];
  project?: Project;
  workflowReviews?: WorkflowReview[];
}
export interface RejectionResult {
  deletedMediaId: Id;
  asset?: Asset;
  episode?: Episode;
  message?: string;
}

export interface ImageReference {
  subject?: string;
  sourceType?: string;
  sourceClipId?: string;
  mediaId: string;
  imageNumber: number;
  tag?: string;
  title: string;
  role: string;
  view?: string;
  filename?: string;
  assetId?: string;
  anchor?: string;
  episodeId?: string;
  sceneId?: string;
  clipId?: string;
}
export interface ImageReferences {
  selected: string[];
  omitted: string[];
  items: ImageReference[];
  choices?: ImageReference[];
  omittedItems?: ImageReference[];
}
export interface VideoReference {
  mediaId: string;
  assetId: string;
  title: string;
  names: string[];
  imageNumber?: number;
  tag?: string;
  originalName?: string;
}
export interface ShotPrompts {
  sceneId: string;
  clipId: string;
  image: string;
  imageBase?: string;
  imageReferences?: ImageReferences;
  video: string;
  videoBase?: string;
}
export interface VoicePrompt {
  speaker: string;
  prompt: string;
  finalized: boolean;
  sceneId?: string;
  clipId?: string;
}
export interface WorkflowStep {
  voiceAssetId?: string;
  requestId?: string;
  kind: string;
  target: ProductionTarget;
  title?: string;
  error?: string;
  resultAssetId?: string;
}
export interface WorkflowProgress {
  review?: ReviewLink;
  proposalId?: string;
  chatId?: string;
  retrySteps?: WorkflowStep[];
  state: string;
  message: string;
}
export interface ProductionBoardData {
  enabled: boolean;
  layout?: 'scenes' | 'asset';
  record: Asset | Episode;
  groups: { title: string; target: ReviewTarget; stages: ReviewRow[]; optional?: boolean }[];
  shotPrompts: ShotPrompts[];
  voicePrompts: VoicePrompt[];
  referencePrompts: { itemId: string; prompt: string }[];
  sourceEvidence?: SourceEvidence[];
  jobs: Job[];
  proposals: Proposal[];
  nextSteps: WorkflowStep[];
  blockedSteps: WorkflowStep[];
  progress: WorkflowProgress;
  automation: {
    _id: string;
    status: string;
    error?: string;
    failures?: WorkflowStep[];
    jobIds?: string[];
    target?: ProductionTarget;
  }[];
}
export interface ActionResult {
  media?: MediaFile;
  importedAt?: string;
  chat?: Chat;
  receipt?: { message?: string; applied?: boolean };
  pendingDraft?: boolean;
  authorizationUrl?: string;
  message?: string;
  status?: string;
  jobId?: string;
  approved?: boolean;
  applied?: boolean;
  episode?: Episode;
  asset?: Asset;
  job?: Job;
  signInUrl?: string;
  verified?: boolean;
  timingRepair?: string;
}
export interface AccountContext {
  session: Session;
  onSession: (session: Session) => void;
  onSignedOut: () => void;
}
export interface Session {
  authenticated: boolean;
  configured: boolean;
  username?: string;
  csrfToken?: string;
  setupRequired?: boolean;
}
export interface ConnectionProfile {
  id: string;
  label: string;
  email?: string;
  signedIn: boolean;
  planEnabled: boolean;
  model?: string;
  models: { id: string; name: string }[];
  modelsError?: string;
  lastError?: string;
  verifiedAt?: string;
  welcomeAcknowledged?: boolean;
}
export interface ChatGPTConnection {
  pending?: { expiresAt?: number };
  legacyApiKeyIgnored?: boolean;
  canChat: boolean;
  connected: boolean;
  planEnabled: boolean;
  activeProfileId?: string;
  profiles: ConnectionProfile[];
  model?: string;
  apiKeyFallback?: boolean;
}
export interface Connections {
  chatgpt: ChatGPTConnection;
  openart: {
    connected: boolean;
    projectId?: string;
    status?: string;
    referenceSharing?: { source?: string; ready?: boolean; message?: string; origin?: string };
  };
  elevenlabs: { configured: boolean };
}
export interface MusicCue {
  _id: string;
  enabled: boolean;
  revision: number;
  prompt: string;
  model: string;
  bufferSeconds: number;
  selectedMediaId?: string | null;
  candidates: Candidate[];
}
export interface MusicStatus {
  keyConfigured?: boolean;
  automation?: { _id: string; status: string; error?: string }[];
  currentCandidateIds?: string[];
  fingerprint?: string;
  cue?: MusicCue | null;
  defaults: { prompt: string; model: string; bufferSeconds: number };
  jobs: Job[];
  planReview: ReviewRow;
  takeReview: ReviewRow;
  targetSeconds: number;
  generatedSeconds: number;
  estimatedCredits: number;
  media: MediaFile[];
  candidates: Candidate[];
}

export interface CharacterGenerationData {
  asset: Asset;
  voice?: Asset;
  speaker: string;
  voicePrompt: string;
  voicePromptSource: string;
  characterSource?: { assetId: string; name: string; status: ReviewStatus };
  images: {
    itemId: string;
    title: string;
    mediaId?: string;
    prompt: string;
    promptBase: string;
    imageReferences: ImageReferences;
    plan?: ReviewRow;
    blockers: string[];
    job?: Job;
  }[];
  jobs: Job[];
  voiceJob?: Job;
}

/** Partial persisted records accepted by evaluators and unit fixtures. Mixed schema fields retain their driver types. */
export type PartialRecord<T> = 0 extends 1 & T
  ? T
  : T extends Date
    ? Date
    : T extends { toHexString(): string }
      ? RecordId
      : T extends (infer U)[]
        ? PartialRecord<U>[]
        : T extends object
          ? { [K in keyof T]?: PartialRecord<T[K]> }
          : T;

export interface SourceEvidence {
  _id: string;
  title: string;
  observations: string;
  limitations: string;
  videoMediaId?: string;
  frames?: {
    mediaId: string;
    overview?: boolean;
    captured?: boolean;
    requestedSeconds?: number;
    captureKey?: string;
    width?: number;
    height?: number;
    subtitleCropMediaId?: string;
  }[];
  videoSegments?: { mediaId: string; startSeconds?: number; endSeconds?: number; notes?: string }[];
  captions?: {
    id?: string;
    text?: string;
    startSeconds?: number;
    endSeconds?: number;
    mediaId?: string;
  }[];
}

export type WorkflowReview = Pick<ReviewRow, 'key' | 'target' | 'stage' | 'title' | 'status'> &
  Partial<ReviewRow> & { chatId?: string };
