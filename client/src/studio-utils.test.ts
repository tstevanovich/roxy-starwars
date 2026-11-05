import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  downloadDraft,
  episodeTiming,
  forgetRejectedMedia,
  pendingVideoChoices,
  useDraft
} from './studio-utils.ts';
import { mediaFixture } from './test/fixtures.ts';

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('rejected files disappear from unsaved drafts without losing notes or being reattached on later edits', () => {
  const record = {
    _id: 'episode',
    revision: 1,
    notes: '',
    scenes: [
      {
        id: 'scene',
        clips: [{ id: 'clip', takeIds: ['rejected', 'other'], selectedTakeId: 'rejected' }]
      }
    ]
  };
  const { result } = renderHook(() => useDraft(record, 'episode'));
  act(() => result.current.edit((current) => ({ ...current, notes: 'Keep my notes.' })));
  act(() => forgetRejectedMedia('rejected'));
  expect(result.current.draft.notes).toBe('Keep my notes.');
  expect(result.current.draft.scenes[0].clips[0]).toMatchObject({
    takeIds: ['other'],
    selectedTakeId: null
  });
  act(() => result.current.edit((current) => ({ ...current, title: 'Another edit' })));
  expect(result.current.draft.scenes[0].clips[0].takeIds).toEqual(['other']);
  expect(JSON.parse(localStorage.getItem('roxy-studio-episode-episode')).notes).toBe(
    'Keep my notes.'
  );
});

test('pending videos count undecided clips, excluding approved alternates and missing media', () => {
  const episode = {
    scenes: [
      {
        id: 'scene',
        clips: [
          { id: 'pending', takeIds: ['one', 'two'], selectedTakeId: null },
          { id: 'approved', takeIds: ['one', 'two'], selectedTakeId: 'one' },
          { id: 'missing', takeIds: ['missing'] },
          { id: 'audio-only', takeIds: ['voice'] },
          { id: 'not-generated' }
        ]
      }
    ]
  };
  const media = [
    { _id: 'one', kind: 'video' as const },
    { _id: 'two', kind: 'video' as const },
    { _id: 'voice', kind: 'audio' as const }
  ];
  expect(pendingVideoChoices(episode, media).map(({ clip }) => clip.id)).toEqual(['pending']);
  expect(pendingVideoChoices({ scenes: [] }, media)).toEqual([]);
});

test('a cached voice draft cannot restore deleted audition audio after the media list refreshes', () => {
  const old = {
    _id: 'voice',
    revision: 1,
    notes: 'Keep these notes.',
    candidates: [{ id: 'a', mediaIds: ['rejected-audio'] }],
    finalChoice: { id: 'a', mediaIds: ['rejected-audio'] }
  };
  localStorage.setItem('roxy-studio-asset-voice', JSON.stringify(old));
  const saved = { ...old, revision: 2, candidates: [], finalChoice: null };
  const { result } = renderHook(() => useDraft(saved, 'asset', []));
  expect(result.current.draft.notes).toBe(old.notes);
  expect(result.current.draft.candidates).toEqual([]);
  expect(result.current.draft.finalChoice).toBeNull();
  act(() => result.current.edit((current) => ({ ...current, notes: 'Still editing.' })));
  expect(result.current.draft.candidates).toEqual([]);
  expect(JSON.stringify(result.current.draft)).not.toContain('rejected-audio');
});

test('functional edits use the latest saved record after an external refresh', () => {
  const original = { _id: 'al', revision: 1, candidates: ['original'] };
  const { result, rerender } = renderHook(({ record }) => useDraft(record, 'asset'), {
    initialProps: { record: original }
  });
  const latest = { ...original, revision: 2, candidates: ['original', 'new-sheet'] };
  rerender({ record: latest });
  act(() => result.current.edit((current) => ({ ...current, notes: 'Keep the new sheet.' })));
  expect(result.current.draft.candidates).toEqual(['original', 'new-sheet']);
  expect(result.current.draft.revision).toBe(2);
  expect(result.current.dirty).toBe(true);
});

test('an older episode draft receives saved videos without losing edits and keeps its original recovery copy', () => {
  const base = {
    _id: 'episode',
    revision: 1,
    title: 'Episode 01',
    notes: '',
    scenes: [{ id: 'scene', clips: [{ id: 'clip', takeIds: [] }] }]
  };
  const local = { ...base, notes: 'My unsaved notes.' };
  localStorage.setItem('roxy-studio-episode-episode', JSON.stringify(local));
  const latest = {
    ...base,
    revision: 2,
    history: [base],
    scenes: [{ ...base.scenes[0], clips: [{ id: 'clip', takeIds: ['new-video'] }] }]
  };
  const { result } = renderHook(() => useDraft(latest, 'episode'));
  expect(result.current.dirty).toBe(true);
  expect(result.current.newerSavedVersion).toBe(false);
  expect(result.current.draft).toMatchObject({
    revision: 2,
    notes: 'My unsaved notes.',
    scenes: [{ clips: [{ takeIds: ['new-video'] }] }]
  });
  expect(JSON.parse(localStorage.getItem('roxy-studio-episode-episode-recovery-1'))).toEqual(local);
  act(() => result.current.edit((draft) => ({ ...draft, title: 'Still editing' })));
  expect(result.current.draft.scenes[0].clips[0].takeIds).toEqual(['new-video']);
  expect(result.current.draft.revision).toBe(2);
});

test('drafts remain editable with corrupt or unavailable storage and register unload protection only while dirty', () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Unavailable');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Full');
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('Unavailable');
  });
  const record = { _id: 'asset', revision: 1, notes: '' };
  const { result } = renderHook(() => useDraft(record, 'asset'));
  expect(result.current.dirty).toBe(false);
  act(() => result.current.edit({ ...record, notes: 'Keep locally' }));
  const pending = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(pending);
  expect(pending.defaultPrevented).toBe(true);
  expect(result.current.draft.notes).toBe('Keep locally');
  get.mockRestore();
  act(() => result.current.saved({ ...record, revision: 2, notes: 'Saved' }));
  const clean = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
});

test('storage events remove rejected media across tabs and ignore invalid or unrelated events', () => {
  const record = { _id: 'asset', revision: 1, production: { sourceMediaIds: ['source', 'keep'] } };
  const { result } = renderHook(() => useDraft(record, 'asset'));
  const changed = (key: string, newValue: string | null) =>
    act(() => window.dispatchEvent(new StorageEvent('storage', { key, newValue })));
  changed('other', '[]');
  expect(result.current.draft).toEqual(record);
  changed('roxy-studio-rejected-media', 'invalid');
  expect(result.current.draft).toEqual(record);
  changed('roxy-studio-rejected-media', '["source"]');
  expect(result.current.draft.production.sourceMediaIds).toEqual(['keep']);
  changed('roxy-studio-rejected-media', null);
  expect(result.current.draft.production.sourceMediaIds).toEqual(['source', 'keep']);
});

test('draft sanitization removes missing individual selections as well as unavailable media arrays', () => {
  const record = {
    _id: 'episode',
    revision: 1,
    scenes: [
      {
        id: 'scene',
        clips: [
          {
            id: 'shot',
            selectedTakeId: 'deleted',
            selectedDialogueId: 'voice',
            takeIds: ['deleted', 'video'],
            dialogueTakeIds: ['voice'],
            production: { visualTakeId: 'deleted', resultMediaId: null }
          }
        ]
      }
    ]
  };
  const { result } = renderHook(() =>
    useDraft(record, 'episode', [mediaFixture({ _id: 'voice' }), mediaFixture({ _id: 'video' })])
  );
  expect(result.current.draft.scenes[0].clips[0]).toMatchObject({
    selectedTakeId: null,
    selectedDialogueId: 'voice',
    takeIds: ['video'],
    production: { visualTakeId: null }
  });
});

test('recovery conflict resolution leaves an unavailable base intact', () => {
  const local = { _id: 'episode', revision: 1, scenes: [], notes: 'Keep' };
  localStorage.setItem('roxy-studio-episode-episode', JSON.stringify(local));
  const { result } = renderHook(() => useDraft({ ...local, revision: 3 }, 'episode'));
  act(() => result.current.resolveSavedConflicts('saved'));
  expect(result.current.draft).toEqual(local);
  expect(result.current.recovery.unavailable).toBe(true);
});

test('download recovery exports a readable JSON file and revokes its temporary URL', () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:draft'), revokeObjectURL: vi.fn() })
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    expect(this.download).toBe('roxy-draft.json');
    expect(this.href).toBe('blob:draft');
  });
  downloadDraft({ notes: 'Recover me' });
  expect(click).toHaveBeenCalledOnce();
  act(() => vi.runAllTimers());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:draft');
});

test('missing shot lists have no pending choices, and empty vlog durations count as zero', () => {
  expect(pendingVideoChoices({}, [])).toEqual([]);
  expect(pendingVideoChoices({ scenes: [{}] }, [])).toEqual([]);
  expect(
    episodeTiming({ scenes: [{ style: 'vlog', clips: [{ duration: 0 }, { duration: 60 }] }] })
  ).toEqual({ total: 60, vlogPercent: 100 });
});
