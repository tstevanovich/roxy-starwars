import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  addCharacterPackage,
  characterPackageItems,
  turnaroundViews
} from './character-package.ts';
test('the supplied package has eight image deliverables and a separate written identity', () => {
  const items = characterPackageItems();
  assert.equal(items.filter((i) => i.type === 'image').length, 8);
  assert.deepEqual(
    items.filter((i) => i.type === 'notes').map((i) => i.id),
    ['written-identity']
  );
  assert.deepEqual(turnaroundViews, ['front', 'three-quarter', 'side', 'rear']);
  assert.match(
    items.find((i) => i.id === 'master-portrait').notes,
    /neutral three-quarter portrait/
  );
  assert.match(
    items.find((i) => i.id === 'body-turnaround').notes,
    /Every figure includes its head and feet/
  );
  assert.match(
    items.find((i) => i.id === 'expressions').notes,
    /neutral, amused, angry, worried and surprised/
  );
  assert.equal(items.filter((i) => i.id.startsWith('view-')).length, 4);
  assert.doesNotMatch(JSON.stringify(items), /headless|four-panel|NO HEAD OR FACE/i);
});
test('adding the package retains existing choices and does not duplicate its required items', () => {
  const items = characterPackageItems();
  items[0].mediaId = 'saved-master';
  const result = addCharacterPackage(items);
  assert.equal(result.length, 9);
  assert.equal(result[0].mediaId, 'saved-master');
});
