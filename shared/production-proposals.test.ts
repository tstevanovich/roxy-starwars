import assert from 'node:assert/strict';

import { test } from 'vitest';

import { characterPackageItems } from './character-package.ts';
import {
  mergeAssetBrief,
  mergeAssetProduction,
  mergeSceneProposal,
  proposalApplication,
  proposalBlocksReview,
  proposalReviewStages,
  proposalStageLabel,
  videoRevisionInputs
} from './production-proposals.ts';

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

test('review stages prioritize deliberately edited content and use saved history for stale drafts', () => {
  assert.deepEqual(proposalReviewStages({ brief: '', assetId: 'a' }, {}), ['brief']);
  assert.deepEqual(proposalReviewStages({ brief: '', scope: 'asset' }, {}), ['brief']);
  assert.deepEqual(
    proposalReviewStages({ production: { voiceDescription: 'soft' } }, { kind: 'voice' }),
    ['voice-directions']
  );
  assert.deepEqual(proposalReviewStages({ reviewStages: ['shot-plan'] }, {}), ['shot-plan']);
  assert.deepEqual(proposalReviewStages({ render: {} }, {}), ['video-revision']);
  assert.deepEqual(proposalReviewStages({ scene: {} }, {}), ['scene']);
  assert.deepEqual(proposalReviewStages({ scope: 'asset' }, {}), ['reference-package']);
  assert.deepEqual(proposalReviewStages({ assetId: 'a' }, {}), ['reference-package']);
  assert.deepEqual(proposalReviewStages({ baseRevision: 1, production: {} }, undefined), []);
  assert.deepEqual(proposalReviewStages({ baseRevision: 1 }, { revision: 1 }), []);
  assert.deepEqual(
    proposalReviewStages(
      { baseRevision: 1, production: { sourceNotes: 'research', outline: 'new' } },
      { revision: 2, history: [{ revision: 1 }] }
    ),
    ['source', 'outline']
  );
  assert.deepEqual(
    proposalReviewStages({ baseRevision: 1, production: { outline: '' } }, { revision: 1 }),
    []
  );
  assert.equal(proposalStageLabel({ draftStage: 'shot-image' }), 'Shot image prompt');
  assert.equal(proposalStageLabel({}), 'Episode note');
  assert.equal(
    proposalStageLabel({ reviewStages: ['source', 'outline'] }),
    'Source research and Episode outline'
  );
});

test('only matching scene, shot or changed preparation fields block their reviews', () => {
  const saved = { revision: 2, production: {} };
  assert.equal(proposalBlocksReview({ baseRevision: 1, production: {} }, 'source', saved), false);
  assert.equal(
    proposalBlocksReview({ scene: { id: 's' } }, 'script', saved, { scope: 'scene', sceneId: 's' }),
    true
  );
  assert.equal(
    proposalBlocksReview({ scene: { id: 's' } }, 'visual', saved, { scope: 'scene', sceneId: 's' }),
    false
  );
  const repair = { scene: { id: 's' }, timingRepair: { repairs: [{ clipId: 'c' }] } };
  assert.equal(
    proposalBlocksReview(repair, 'animatic', saved, { scope: 'clip', sceneId: 's', clipId: 'c' }),
    true
  );
  assert.equal(
    proposalBlocksReview(repair, 'script', saved, { scope: 'clip', sceneId: 's', clipId: 'c' }),
    false
  );
  assert.equal(
    proposalBlocksReview(repair, 'visual', saved, { scope: 'clip', sceneId: 's', clipId: 'other' }),
    false
  );
  assert.equal(proposalBlocksReview({ sourceReferences: ['new'] }, 'source', {}), true);
  assert.equal(proposalBlocksReview({ sourceReferences: [] }, 'source', {}), false);
  assert.equal(proposalBlocksReview({ production: { sourceNotes: '' } }, 'source', {}), false);
  assert.equal(
    proposalBlocksReview(
      { production: { sourceNotes: 'same' }, sourceReferences: ['a'] },
      'source',
      { production: { sourceNotes: 'same' }, sourceReferences: ['a'] }
    ),
    false
  );
  assert.equal(
    proposalBlocksReview({ production: { outlineNeedsRevision: true } }, 'outline', saved),
    true
  );
  assert.equal(proposalBlocksReview({ production: { outline: 'new' } }, 'outline', saved), true);
  assert.equal(proposalBlocksReview({}, 'outline', saved), false);
  assert.equal(proposalBlocksReview({ brief: 'new' }, 'brief', { brief: 'old' }), true);
  assert.equal(proposalBlocksReview({ brief: 'same' }, 'brief', { brief: 'same' }), false);
  assert.equal(proposalBlocksReview({}, 'brief', saved), false);
  assert.equal(
    proposalBlocksReview({}, 'visual', saved, { scope: 'clip', sceneId: 'other' }),
    false
  );
});

test('asset production rebases only compatible edits and preserves deletions and owner-only flags', () => {
  assert.equal(mergeAssetProduction({ baseRevision: 1, production: {} }, { revision: 2 }), null);
  assert.deepEqual(mergeAssetProduction({ baseRevision: 1, production: {} }, { revision: 1 }), {
    items: [],
    managed: true
  });
  assert.deepEqual(
    mergeAssetProduction(
      { baseRevision: 1, baseProduction: { notes: '' }, production: { notes: undefined } },
      { revision: 2, clipId: 'shot' }
    ),
    { items: [], managed: false }
  );
  for (const value of [null, '', []])
    assert.ok(
      mergeAssetProduction(
        { baseRevision: 1, baseProduction: {}, production: { notes: value } },
        { revision: 2 }
      )
    );
  assert.equal(
    mergeAssetProduction(
      { baseProduction: { notes: 'old' }, production: { notes: 'draft' } },
      { revision: 2, production: { notes: 'owner' } }
    ),
    null
  );
  assert.equal(
    mergeAssetProduction(
      { baseProduction: { items: [{ id: 'a', title: 'old' }] }, production: { items: [] } },
      { production: { items: [{ id: 'a', title: 'new' }] } },
      { allowItemRemoval: true }
    ),
    null
  );
  assert.ok(
    mergeAssetProduction(
      { baseProduction: { items: [{ id: 'a' }] }, production: { items: [] } },
      { production: {} },
      { allowItemRemoval: true }
    )
  );
  assert.equal(
    mergeAssetProduction(
      { baseProduction: {}, production: { items: [{ id: 'a', title: 'new' }] } },
      { production: { items: [{ id: 'a', title: 'other' }] } }
    ),
    null
  );
  assert.deepEqual(
    mergeAssetProduction(
      { baseProduction: {}, production: { items: [{ id: 'a' }] } },
      { production: { items: [{ id: 'a' }] } }
    ).items,
    [{ id: 'a' }]
  );
  assert.deepEqual(
    mergeAssetProduction({ baseProduction: {}, production: { items: [{ id: 'a' }] } }, {}).items,
    [{ id: 'a' }]
  );
  assert.equal(
    mergeAssetProduction(
      {
        baseProduction: { items: [{ id: 'a' }] },
        production: { items: [{ id: 'a', title: 'new' }] }
      },
      {}
    ),
    null
  );
  assert.deepEqual(
    mergeAssetProduction(
      { baseProduction: { items: [{ id: 'a' }] }, production: { items: [{ id: 'a' }] } },
      {}
    ).items,
    []
  );
  assert.equal(
    mergeAssetProduction(
      {
        baseProduction: { items: [{ id: 'a', title: 'old' }] },
        production: { items: [{ id: 'a', title: 'new' }] }
      },
      { production: { items: [{ id: 'a', title: 'owner' }] } }
    ),
    null
  );
  assert.equal(
    mergeAssetProduction(
      { baseProduction: { notes: 'old' }, production: { notes: 'new' } },
      { production: { notes: 'new' }, clipId: 'shot' }
    ).managed,
    false
  );
  assert.ok(
    mergeAssetProduction(
      { baseProduction: { items: [{ id: 'a' }] }, production: {} },
      { production: { items: [{ id: 'a', requiresPlanApproval: true }] } }
    )
  );
  assert.ok(
    mergeAssetProduction(
      { baseProduction: { items: [{ id: 'a' }] }, production: {} },
      { clipId: 'shot', production: { managed: true, items: [{ id: 'a' }] } }
    ).managed
  );
});

test('brief rebasing protects newer owner instructions while allowing already applied changes', () => {
  assert.equal(mergeAssetBrief({}, {}), '');
  assert.equal(mergeAssetBrief({}, { brief: 'current' }), 'current');
  assert.equal(
    mergeAssetBrief({ brief: 'new', baseRevision: 1 }, { revision: 1, brief: 'old' }),
    'new'
  );
  assert.equal(mergeAssetBrief({ brief: 'new', baseRevision: 1 }, { revision: 2 }), null);
  assert.equal(
    mergeAssetBrief(
      { brief: 'new', baseRevision: 1 },
      { revision: 2, brief: 'owner', history: [{ revision: 1, brief: 'old' }] }
    ),
    null
  );
  assert.equal(mergeAssetBrief({ brief: 'new', baseBrief: '' }, {}), 'new');
  assert.equal(mergeAssetBrief({ brief: 'new', baseBrief: 'old' }, { brief: 'new' }), 'new');
});

test('video revision approval uses only this shot directions and can rebase unrelated changes', () => {
  assert.equal(videoRevisionInputs(undefined), null);
  assert.deepEqual(videoRevisionInputs({}), {
    dialogue: '',
    duration: undefined,
    action: '',
    camera: '',
    framing: '',
    beats: '',
    allowedMotion: '',
    startState: '',
    endState: '',
    videoPrompt: '',
    videoEndFrame: null,
    videoTransitionPrompt: ''
  });
  const clip = {
    id: 'c',
    dialogue: 'A: Hello',
    duration: 4,
    action: 'stand',
    camera: 'locked',
    production: {
      framing: 'wide',
      beats: 'pause',
      allowedMotion: 'nod',
      startState: 'ready',
      endState: 'still',
      videoPrompt: 'speak',
      videoReferenceMediaIds: [],
      videoEndFrame: { mode: 'none' },
      videoTransitionPrompt: 'hold'
    }
  };
  const saved = {
    revision: 2,
    scenes: [{ id: 's', clips: [clip] }],
    history: [{ revision: 1, scenes: [{ id: 's', clips: [clip] }] }]
  };
  const draft = { baseRevision: 1, render: { target: { sceneId: 's', clipId: 'c' } } };
  assert.deepEqual(proposalApplication(draft, saved), { canApply: true, rebased: true });
  assert.deepEqual(proposalApplication({ ...draft, baseRevision: 2 }, saved), {
    canApply: true,
    rebased: false
  });
  assert.equal(proposalApplication(draft, undefined).canApply, false);
  assert.equal(proposalApplication({ render: {} }, saved).canApply, false);
  for (const record of [{}, { scenes: [{}] }, { scenes: [{ id: 's' }] }])
    assert.equal(proposalApplication(draft, record).canApply, false);
  assert.equal(proposalApplication(draft, { ...saved, history: [] }).canApply, false);
  assert.equal(
    proposalApplication(
      { ...draft, render: { ...draft.render, baseVideoInputs: { changed: true } } },
      saved
    ).canApply,
    false
  );
  assert.equal(
    proposalApplication(
      { ...draft, render: { ...draft.render, baseVideoInputs: videoRevisionInputs(clip) } },
      saved
    ).canApply,
    true
  );
});

test('application checks distinguish safe notes, asset conflicts and scene preparation conflicts', () => {
  assert.equal(
    proposalApplication(
      { production: {}, scope: 'asset', brief: 'draft', baseBrief: 'old' },
      { brief: 'owner' }
    ).canApply,
    false
  );
  assert.equal(
    proposalApplication({ production: {}, assetId: 'a', baseRevision: 1 }, { revision: 2 })
      .canApply,
    false
  );
  assert.deepEqual(
    proposalApplication({ production: {}, scope: 'asset', baseRevision: 1 }, { revision: 1 }),
    { canApply: true, rebased: false }
  );
  assert.deepEqual(
    proposalApplication(
      { production: {}, scope: 'asset', baseRevision: 1, baseProduction: {} },
      { revision: 2 }
    ),
    { canApply: true, rebased: true }
  );
  assert.deepEqual(proposalApplication({ baseRevision: 1 }, { revision: 1 }), {
    canApply: true,
    rebased: false
  });
  assert.deepEqual(proposalApplication({ baseRevision: 1 }, { revision: 2 }), {
    canApply: true,
    rebased: true
  });
  const checked = { canApply: false, recordRevision: 2 };
  assert.equal(
    proposalApplication({ production: {}, application: checked }, { revision: 2 }),
    checked
  );
  const scene = {
    id: 's',
    approval: { status: 'approved' },
    clips: [{ id: 'c', takeIds: ['old'], production: { visualTakeId: 'old' } }],
    soundPlan: { approval: { status: 'approved' } }
  };
  const base = { revision: 1, scenes: [scene] };
  const saved = {
    revision: 2,
    scenes: [
      { ...scene, clips: [{ id: 'c', takeIds: ['new'], production: { visualTakeId: 'new' } }] }
    ],
    history: [base]
  };
  const draft = { baseRevision: 1, scene: { id: 's' } };
  assert.deepEqual(proposalApplication(draft, saved), { canApply: true, rebased: true });
  assert.equal(
    proposalApplication(draft, { ...saved, scenes: [{ ...scene, title: 'changed' }] }).canApply,
    false
  );
  for (const field of ['production', 'sourceReferences', 'decisions'])
    assert.equal(
      proposalApplication(draft, { ...saved, [field]: { changed: true } }).canApply,
      false
    );
  assert.equal(proposalApplication({ ...draft, production: {} }, saved).canApply, false);
  assert.equal(
    proposalApplication({ ...draft, application: { recordRevision: 0 } }, {}).canApply,
    false
  );
  assert.equal(
    proposalApplication(draft, { revision: 2, history: [{ revision: 1 }] }).canApply,
    true
  );
  assert.equal(
    proposalApplication(draft, {
      revision: 2,
      history: [{ revision: 1, scenes: [{ id: 's' }] }],
      scenes: [{ id: 's' }]
    }).canApply,
    true
  );
});

test('merging a scene retains saved outputs and resets dialogue selection only for changed speech', () => {
  const current = {
    clips: [
      {
        id: 'same',
        selectedDialogueId: 'approved',
        dialogueTakeIds: ['approved'],
        production: { visualTakeId: 'image' }
      },
      { id: 'changed', dialogue: 'old', production: {} }
    ]
  };
  const proposed = {
    clips: [
      { id: 'same', production: { videoPrompt: 'hold' } },
      { id: 'changed', dialogue: 'new' },
      { id: 'new' }
    ]
  };
  const result = mergeSceneProposal(proposed, current, 'changed');
  assert.equal(result.approval, null);
  assert.equal(result.clips[0].selectedDialogueId, 'approved');
  assert.equal(result.clips[0].production.visualTakeId, 'image');
  assert.equal(result.clips[1].selectedDialogueId, null);
  assert.deepEqual(result.clips[1].dialogueTakeIds, []);
  assert.deepEqual(result.clips[2], { id: 'new' });
  assert.deepEqual(mergeSceneProposal({ clips: [{ id: 'new' }] }, undefined, undefined).clips, [
    { id: 'new' }
  ]);
  assert.deepEqual(mergeSceneProposal({ clips: [{ id: 'new' }] }, {}, undefined).clips, [
    { id: 'new' }
  ]);
});
