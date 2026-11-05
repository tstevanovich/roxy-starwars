import type {
  Asset,
  Candidate,
  Clip,
  Episode,
  MediaFile,
  PackageItem,
  ProductionSettings,
  Proposal,
  ReviewRow,
  Scene,
  StudioData,
  StudioSettings
} from '../../../shared/types.ts';

// UI fixtures use the same complete records as the HTTP boundary. Keep defaults
// here so a test can describe only the fields relevant to its behavior.
type AssetFixture = Omit<Partial<Asset>, 'finalChoice' | 'production' | 'history'> & {
  history?: AssetFixture[];
  finalChoice?: Partial<Candidate>;
  production?: Omit<ProductionSettings, 'items'> & { items?: Partial<PackageItem>[] };
};
export const assetFixture = (value: AssetFixture = {}): Asset => {
  const { items, ...production } = value.production ?? {};
  return {
    _id: 'asset',
    revision: 0,
    name: '',
    kind: 'character',
    aliases: [],
    brief: '',
    notes: '',
    candidates: [],
    characterSheets: [],
    ...value,
    history: value.history?.map(assetFixture),
    finalChoice: value.finalChoice
      ? { id: '', title: '', mediaIds: [], ...value.finalChoice }
      : null,
    production: {
      ...production,
      ...(items
        ? {
            items: items.map((item) => ({
              id: '',
              title: '',
              type: 'image' as const,
              required: false,
              notes: '',
              ...item
            }))
          }
        : {})
    }
  };
};
type ClipFixture = Omit<Partial<Clip>, 'pictureReview'> & { pictureReview?: Partial<ReviewRow> };
export const clipFixture = (value: ClipFixture = {}): Clip => ({
  id: 'clip',
  title: '',
  duration: 5,
  action: '',
  dialogue: '',
  camera: '',
  soundEffects: '',
  production: {},
  takeIds: [],
  dialogueTakeIds: [],
  ...value,
  pictureReview: value.pictureReview ? reviewFixture(value.pictureReview) : undefined
});
type SceneFixture = Omit<Partial<Scene>, 'clips'> & { clips?: ClipFixture[] };
export const sceneFixture = (value: SceneFixture = {}): Scene => ({
  id: 'scene',
  title: '',
  style: 'cinematic',
  location: '',
  script: '',
  production: {},
  assetIds: [],
  ...value,
  clips: (value.clips ?? []).map(clipFixture)
});
type EpisodeFixture = Omit<Partial<Episode>, 'scenes' | 'history'> & {
  scenes?: SceneFixture[];
  history?: EpisodeFixture[];
};
export const episodeFixture = (value: EpisodeFixture = {}): Episode => ({
  _id: 'episode',
  revision: 0,
  title: '',
  synopsis: '',
  premise: '',
  notes: '',
  production: {},
  sourceReferences: [],
  decisions: [],
  ...value,
  scenes: (value.scenes ?? []).map(sceneFixture),
  history: value.history?.map(episodeFixture)
});
export const mediaFixture = (value: Partial<MediaFile> = {}): MediaFile => ({
  _id: 'media',
  filename: '',
  originalName: '',
  mime: 'image/png',
  kind: 'image',
  bytes: 0,
  ...value
});
export const reviewFixture = (value: Partial<ReviewRow> = {}): ReviewRow => ({
  key: 'review',
  target: { scope: 'episode', recordId: 'episode' },
  stage: 'outline',
  title: '',
  status: 'needs-review',
  fingerprint: '',
  reviewRevision: 0,
  parentRevision: 0,
  feedback: '',
  canApprove: false,
  blockers: [],
  ...value
});
export const settingsFixture = (value: Partial<StudioSettings> = {}): StudioSettings => ({
  _id: 'settings',
  era: '',
  notes: '',
  targetSeconds: 600,
  vlogPercent: 0,
  monthlyCredits: 0,
  revision: 0,
  ...value
});
type StudioFixture = Omit<Partial<StudioData>, 'assets' | 'episodes' | 'media' | 'settings'> & {
  assets?: AssetFixture[];
  episodes?: EpisodeFixture[];
  media?: Partial<MediaFile>[];
  settings?: Partial<StudioSettings>;
};
export const studioFixture = (value: StudioFixture = {}): StudioData => ({
  ...value,
  assets: (value.assets ?? []).map(assetFixture),
  episodes: (value.episodes ?? []).map(episodeFixture),
  media: (value.media ?? []).map(mediaFixture),
  settings: settingsFixture(value.settings)
});
export const proposalFixture = (
  value: Omit<Partial<Proposal>, 'sourceReferences'> & {
    sourceReferences?: Partial<Proposal['sourceReferences'][number]>[];
  } = {}
): Proposal => ({
  _id: 'proposal',
  title: '',
  text: '',
  status: 'pending',
  ...value,
  sourceReferences: value.sourceReferences?.map((ref) => ({ id: '', title: '', url: '', ...ref }))
});
