import assert from 'node:assert/strict';
import { test } from 'node:test';

import { characterPackageItems } from '../../shared/character-package.js';
import { mergeAssetProduction } from '../../shared/production-proposals.js';

const items = characterPackageItems().map((item) => ({
  ...item,
  mediaId: item.id === 'master-portrait' ? 'approved-master' : null
}));
const record = { revision: 3, production: { managed: true, items } };
const proposal = {
  baseRevision: 3,
  baseProduction: record.production,
  production: { items: [{ ...items[0], imagePrompt: 'Photographic portrait, frontal framing.' }] }
};
test('a one-image chat revision retains every omitted character package view and its saved fields', () => {
  const before = structuredClone(record);
  const merged = mergeAssetProduction(proposal, record);
  assert.equal(merged.items.length, 9);
  assert.equal(merged.items[0].imagePrompt, 'Photographic portrait, frontal framing.');
  assert.equal(merged.items[0].mediaId, 'approved-master');
  assert.deepEqual(merged.items.slice(1), items.slice(1));
  assert.deepEqual(record, before);
});
test('only an explicit direct-editor save can remove entries from its complete package list', () => {
  assert.equal(mergeAssetProduction(proposal, record, { allowItemRemoval: true }).items.length, 1);
  const deleted = {
    revision: 4,
    history: [record],
    production: { managed: true, items: items.slice(0, -1) }
  };
  assert.ok(!mergeAssetProduction(proposal, deleted).items.some((item) => item.id === 'view-rear'));
});
