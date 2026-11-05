import type * as Studio from '../../shared/types.ts';
import { fail, id, list, object, text } from './studio-validation.ts';

export const characterViews = ['front', 'three-quarter', 'side', 'rear', 'face'];
export const propViews = [
  'front',
  'three-quarter',
  'side',
  'opposite-side',
  'top',
  'rear',
  'detail'
];

export function characterSheetInput(input, kind = 'character') {
  object(input);
  const allowedViews = kind === 'prop' ? propViews : characterViews;
  const views = [...new Set(list(input.views, 'Sheet views', allowedViews.length))];
  if (
    !views.length ||
    views.some((view) => typeof view !== 'string' || !allowedViews.includes(view))
  )
    fail('Choose the views actually visible in this reference sheet.');
  return {
    title: text(input.title, 'Sheet title', 160, true),
    mediaId: id(input.mediaId),
    views: views as string[]
  };
}

export function currentCharacterSheet(asset: Studio.AssetInput, sheet) {
  return Boolean(
    asset.finalChoice &&
    sheet.sourceCandidateId === asset.finalChoice.id &&
    new Date(sheet.sourceFinalizedAt).getTime() ===
      new Date(asset.finalChoice.finalizedAt).getTime()
  );
}

export function approvedCharacterSheets(asset: Studio.AssetInput) {
  return (asset.characterSheets ?? []).filter(
    (sheet) => sheet.approvedAt && currentCharacterSheet(asset, sheet)
  );
}
