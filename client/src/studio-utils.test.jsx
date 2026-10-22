import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';

import { forgetRejectedMedia, pendingVideoChoices, useDraft } from './studio-utils.js';

beforeEach(() => localStorage.clear());

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
    { _id: 'one', kind: 'video' },
    { _id: 'two', kind: 'video' },
    { _id: 'voice', kind: 'audio' }
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
