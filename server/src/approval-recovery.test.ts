import { beforeEach, expect, test, vi } from 'vitest';

import { sceneApprovalBindings } from './approval-recovery.ts';
import { evaluateWorkflow } from './production-workflow.ts';

vi.mock('./production-workflow.ts', () => ({ evaluateWorkflow: vi.fn() }));
const target = { scope: 'scene', recordId: 'episode', sceneId: 'scene' };
const row = { fingerprint: 'old', approvalFingerprint: 'bound' };
beforeEach(() => {
  vi.mocked(evaluateWorkflow)
    .mockReset()
    .mockReturnValue({ evaluate: () => row } as never);
});
test('historical recovery skips deleted scenes and unprovable snapshots', () => {
  const reviews = [
    {
      _id: 'review',
      target,
      stage: 'sound-plan',
      state: 'approved',
      fingerprint: 'old',
      approvalFingerprint: 'legacy',
      reviewedAt: '2026-01-02',
      revision: 3
    }
  ];
  const data = { reviews, episodes: [], assets: [], media: [] };
  expect(sceneApprovalBindings(data).skipped[0].reason).toContain('no longer available');
  data.episodes.push({
    _id: 'episode',
    scenes: [{ id: 'scene' }],
    history: [{ scenes: [] }, { scenes: [{ id: 'scene' }] }]
  } as never);
  vi.mocked(evaluateWorkflow).mockImplementation(
    () =>
      ({
        evaluate: () => {
          throw new Error('Incomplete');
        }
      }) as never
  );
  expect(() => sceneApprovalBindings(data)).toThrow('Incomplete');
  vi.mocked(evaluateWorkflow).mockReturnValue({
    evaluate: () => ({ fingerprint: 'different' })
  } as never);
  expect(sceneApprovalBindings(data).skipped[0].reason).toContain('No saved snapshot');
});
test('recovery evaluates historical review order and binds requested changes only to matching saved evidence', () => {
  const review = {
    _id: 'review',
    target,
    stage: 'script',
    state: 'changes-requested',
    fingerprint: 'old',
    reviewedAt: '2026-01-02',
    revision: 3,
    history: [{ reviewedAt: '2026-01-01' }, { reviewedAt: '2026-01-01' }]
  };
  const data = {
    reviews: [review],
    episodes: [
      {
        _id: 'episode',
        scenes: [{ id: 'scene' }],
        updatedAt: '2026-01-03',
        history: [{ savedAt: '2026-01-01', scenes: [{ id: 'scene' }] }]
      }
    ],
    assets: [
      {
        createdAt: '2026-01-01',
        history: [{ updatedAt: '2026-01-02' }, { updatedAt: '2026-01-01' }]
      }
    ],
    media: []
  };
  expect(sceneApprovalBindings(data).feedbackBindings[0].approvalFingerprint).toBe('bound');
  vi.mocked(evaluateWorkflow).mockImplementation(
    () =>
      ({
        evaluate: () => {
          throw new Error('Incomplete snapshot');
        }
      }) as never
  );
  expect(sceneApprovalBindings(data).skipped).toHaveLength(1);
});
test('a failed legacy sound snapshot never authorizes a current approval', () => {
  const review = {
    _id: 'review',
    target,
    stage: 'sound-plan',
    state: 'approved',
    fingerprint: 'old',
    approvalFingerprint: 'legacy',
    reviewedAt: '2026-01-02',
    revision: 1
  };
  const data = {
    reviews: [review],
    episodes: [{ _id: 'episode', scenes: [{ id: 'scene' }], history: [{ scenes: [] }] }],
    assets: [],
    media: []
  };
  vi.mocked(evaluateWorkflow).mockImplementation(
    (_data, options) =>
      ({
        evaluate: () => {
          if (options?.legacySoundPlanDependencies) throw new Error('Incomplete');
          return { fingerprint: 'different' };
        }
      }) as never
  );
  expect(sceneApprovalBindings(data).skipped).toHaveLength(1);
});

test('legacy sound approvals bind only the reproducible historical scene while preserving other episodes', () => {
  const review = {
    _id: 'review',
    target,
    stage: 'sound-plan',
    state: 'approved',
    fingerprint: 'old',
    approvalFingerprint: 'legacy',
    reviewedAt: '2026-01-02',
    revision: 1
  };
  const data = {
    reviews: [review],
    episodes: [
      { _id: 'episode', scenes: [{ id: 'scene' }] },
      { _id: 'other', scenes: [] }
    ],
    assets: [],
    media: []
  };
  vi.mocked(evaluateWorkflow).mockImplementation(
    (_data, options) =>
      ({
        evaluate: () =>
          options?.legacySoundPlanDependencies
            ? { fingerprint: 'old', approvalFingerprint: 'legacy' }
            : { fingerprint: 'new', approvalFingerprint: 'bound' }
      }) as never
  );
  expect(sceneApprovalBindings(data).bindings[0].approvalFingerprint).toBe('bound');
  vi.mocked(evaluateWorkflow).mockImplementation(
    (_data, options) =>
      ({
        evaluate: () =>
          options?.legacySoundPlanDependencies
            ? { fingerprint: 'old', approvalFingerprint: 'other' }
            : { fingerprint: 'new', approvalFingerprint: 'bound' }
      }) as never
  );
  delete review.approvalFingerprint;
  expect(sceneApprovalBindings(data).bindings).toHaveLength(1);
});

test('historical feedback handles missing records and records saved with creation timestamps only', () => {
  const review = {
    _id: 'review',
    target,
    stage: 'script',
    state: 'changes-requested',
    fingerprint: 'old',
    reviewedAt: '2026-01-02',
    revision: 1
  };
  const data = { reviews: [review], episodes: [], assets: [], media: [] };
  expect(sceneApprovalBindings(data).skipped).toHaveLength(1);
  data.episodes.push(
    { _id: 'episode', scenes: [], createdAt: '2026-01-01' } as never,
    { _id: 'other', scenes: [], createdAt: '2026-01-01' } as never
  );
  data.assets.push({ createdAt: '2026-01-01', history: [{ createdAt: '2025-01-01' }] } as never);
  expect(sceneApprovalBindings(data).feedbackBindings).toHaveLength(1);
  data.reviews[0].stage = 'music-plan';
  expect(sceneApprovalBindings(data).feedbackBindings).toHaveLength(1);
});
