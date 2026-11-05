import { expectTypeOf, test } from 'vitest';

import type {
  AssetInput,
  ClipInput,
  Id,
  MediaKind,
  PersistedInput,
  RecordId,
  ReviewTarget
} from './types.ts';

test('API identities and persisted input contracts accept partial saved records', () => {
  expectTypeOf<Id>().toEqualTypeOf<string>();
  expectTypeOf<MediaKind>().toEqualTypeOf<'image' | 'video' | 'audio'>();
  expectTypeOf({
    id: 'shot',
    production: { imageReferenceMediaIds: ['image'] }
  }).toExtend<ClipInput>();
  expectTypeOf({
    _id: 'character',
    finalChoice: { finalizedAt: new Date(), mediaIds: ['image'] }
  }).toExtend<AssetInput>();
  expectTypeOf<PersistedInput<{ _id: string; mediaIds: string[] }>>().toEqualTypeOf<{
    _id?: RecordId;
    mediaIds?: RecordId[];
  }>();
  expectTypeOf<ReviewTarget['scope']>().toEqualTypeOf<'asset' | 'episode' | 'scene' | 'clip'>();
});
