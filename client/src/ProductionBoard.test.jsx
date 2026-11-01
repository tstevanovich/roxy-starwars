import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.js';
import ProductionBoard from './ProductionBoard.jsx';
import { reviewAnchor } from './review-navigation.js';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn() }));
const record = {
  _id: 'asset-one',
  name: 'Test character',
  revision: 2,
  brief: 'Keep the source outfit.',
  production: { sourceNotes: 'Red tunic and black trousers.' }
};
const row = {
  key: 'source-key',
  title: 'Source evidence',
  stage: 'source',
  target: { scope: 'asset', recordId: 'asset-one' },
  status: 'pending-review',
  canApprove: true,
  blockers: [],
  fingerprint: 'saved-hash',
  parentRevision: 2,
  reviewRevision: 0,
  feedback: ''
};
const board = {
  enabled: true,
  groups: [{ title: 'Source and creative brief', target: row.target, stages: [row] }]
};
beforeEach(() => {
  window.history.replaceState({}, '', '/');
  vi.mocked(request).mockReset();
  vi.mocked(request).mockImplementation(async (url) => (url.endsWith('/board') ? board : {}));
});

test('the episode board groups each shot under its own scene and links directly to scenes', async () => {
  const episode = {
    _id: 'episode',
    revision: 2,
    scenes: [
      {
        id: 'arrival',
        title: 'Arrival',
        clips: [{ id: 'landing', title: 'Landing', duration: 5, dialogue: '', production: {} }]
      },
      {
        id: 'academy',
        title: 'Academy',
        clips: [{ id: 'opening', title: 'Opening', duration: 5, dialogue: '', production: {} }]
      }
    ]
  };
  vi.mocked(request).mockResolvedValue({
    enabled: true,
    layout: 'scenes',
    record: episode,
    groups: episode.scenes.flatMap((scene) => [
      {
        title: scene.title,
        target: { scope: 'scene', recordId: 'episode', sceneId: scene.id },
        stages: []
      },
      ...scene.clips.map((clip) => ({
        title: clip.title,
        target: { scope: 'clip', recordId: 'episode', sceneId: scene.id, clipId: clip.id },
        stages: []
      }))
    ])
  });
  render(
    <ThemeProvider theme={theme}>
      <ProductionBoard record={episode} scope="episode" onChanged={vi.fn()} />
    </ThemeProvider>
  );
  const first = await screen.findByRole('region', { name: 'Scene 1: Arrival' });
  const second = screen.getByRole('region', { name: 'Scene 2: Academy' });
  expect(within(first).getByRole('region', { name: 'Shot 1: Landing' })).toBeVisible();
  expect(within(second).getByRole('region', { name: 'Shot 1: Opening' })).toBeVisible();
  expect(within(first).queryByRole('region', { name: 'Shot 1: Opening' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Scene 2: Academy' })).toHaveAttribute(
    'href',
    '#board-scene-academy'
  );
  expect(within(second).getByRole('button', { name: 'Generate video' })).toBeDisabled();
});

test('an over-limit animatic shows measured timing and offers an actual split draft instead of approval', async () => {
  const target = { scope: 'clip', recordId: 'episode', sceneId: 'scene', clipId: 'shot' };
  const timingRow = {
    ...row,
    key: 'timing',
    title: 'Timed animatic',
    stage: 'animatic',
    target,
    status: 'draft',
    canApprove: false,
    timingIssues: [
      {
        clipId: 'shot',
        message: 'Selected dialogue is 18.88s; the audio-reference limit is 15 seconds.'
      }
    ]
  };
  const episode = {
    _id: 'episode',
    revision: 2,
    scenes: [
      {
        id: 'scene',
        clips: [{ id: 'shot', title: 'Mandate', duration: 24, dialogue: 'HARKUN: Begin.' }]
      }
    ]
  };
  vi.mocked(request).mockImplementation(async (url) =>
    url.endsWith('/animatic/prepare')
      ? { timingRepair: 'split', message: 'Timing revision draft ready above.' }
      : {
          enabled: true,
          record: episode,
          groups: [{ title: 'Mandate', target, stages: [timingRow] }]
        }
  );
  const user = userEvent.setup();
  render(
    <ThemeProvider theme={theme}>
      <ProductionBoard record={episode} scope="episode" media={[]} onChanged={vi.fn()} />
    </ThemeProvider>
  );
  expect(await screen.findByRole('button', { name: 'Approve Timed animatic' })).toBeDisabled();
  expect(screen.getByText(/Selected dialogue is 18.88s/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Prepare split or retimed shots' }));
  expect(request).toHaveBeenCalledWith('/studio/workflow/animatic/prepare', {
    method: 'POST',
    body: { target, parentRevision: 2 }
  });
  expect(await screen.findByText('Timing revision draft ready above.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Go to timing draft' })).toHaveAttribute(
    'href',
    '#production-revisions'
  );
});

test('a provider failure is shown at the missing reference instead of an unexplained Draft label', async () => {
  const failed = {
    ...row,
    key: 'front-key',
    stage: 'reference:view-front',
    title: 'Individual full-body front view',
    status: 'draft',
    canApprove: false,
    blockers: ['Attach the reference image.']
  };
  vi.mocked(request).mockResolvedValue({
    ...board,
    record: {
      ...record,
      production: {
        items: [
          {
            id: 'view-front',
            type: 'image',
            title: failed.title,
            notes: 'One front view.',
            mediaId: null
          }
        ]
      }
    },
    groups: [{ title: 'Reference package', target: row.target, stages: [failed] }],
    jobs: [
      {
        _id: 'failed-front',
        status: 'failed',
        target: { assetId: record._id, packageItemId: 'view-front' },
        error: 'OpenArt render failed: request rejected by the safety system.'
      }
    ]
  });
  mount();
  expect(
    await screen.findByRole('button', { name: 'Individual full-body front view Generation failed' })
  ).toBeInTheDocument();
  expect(
    screen.getByText('OpenArt render failed: request rejected by the safety system.')
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Approve Individual full-body front view' })
  ).toBeDisabled();
});

test('exact visual prompts are visible in the revision review', async () => {
  const imagePrompt = 'Star Wars universe, Old Republic era. One full-body front view. No labels.';
  const plan = {
    ...row,
    key: 'plan-key',
    stage: 'reference-plan:view-front',
    title: 'Front revision directions'
  };
  vi.mocked(request).mockResolvedValue({
    ...board,
    record: {
      ...record,
      production: {
        items: [
          {
            id: 'view-front',
            title: 'Front',
            type: 'image',
            notes: 'Preserve the selected design.',
            imagePrompt,
            requiresPlanApproval: true
          }
        ]
      }
    },
    groups: [{ title: 'Reference package', target: row.target, stages: [plan] }]
  });
  mount();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Front revision directions Pending review' })
  );
  expect(screen.getByText(imagePrompt)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Approve Front revision directions' })).toBeEnabled();
});

test('next-step and prerequisite links open the exact collapsed review', async () => {
  const user = userEvent.setup();
  const brief = {
    ...row,
    key: 'brief-key',
    stage: 'brief',
    title: 'Creative brief',
    status: 'blocked',
    canApprove: false,
    blockers: ['Approve Source evidence.'],
    prerequisites: [{ key: row.key, target: row.target, stage: row.stage, title: row.title }]
  };
  vi.mocked(request).mockResolvedValue({
    ...board,
    progress: {
      state: 'review',
      message: 'Next step: Creative brief.',
      review: { target: brief.target, stage: brief.stage, title: brief.title }
    },
    groups: [{ ...board.groups[0], stages: [row, brief] }]
  });
  mount();
  const next = await screen.findByRole('link', { name: 'Go to Creative brief' });
  expect(next).toHaveAttribute('href', '#' + reviewAnchor(brief.target, brief.stage));
  const summary = screen.getByRole('button', { name: 'Creative brief Blocked' });
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  await user.click(next);
  await waitFor(() => expect(summary).toHaveAttribute('aria-expanded', 'true'));
  await user.click(summary);
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  await user.click(next);
  await waitFor(() => expect(summary).toHaveAttribute('aria-expanded', 'true'));
  expect(screen.getByRole('link', { name: 'Go to Source evidence' })).toHaveAttribute(
    'href',
    '#' + reviewAnchor(row.target, row.stage)
  );
});
function mount(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ProductionBoard record={record} scope="asset" {...props} />
    </ThemeProvider>
  );
}
test('missing asset source evidence is expanded and links directly to its input fields', async () => {
  vi.mocked(request).mockResolvedValue({
    ...board,
    groups: [
      {
        ...board.groups[0],
        stages: [
          {
            ...row,
            status: 'draft',
            canApprove: false,
            blockers: ['Attach source frames or a source URL.']
          }
        ]
      }
    ]
  });
  mount();
  const summary = await screen.findByRole('button', { name: 'Source evidence Draft' });
  expect(summary).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'Approve Source evidence' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Go to source evidence fields' })).toHaveAttribute(
    'href',
    '#asset-production-inputs'
  );
});

test('approval sends saved fingerprint and revisions and reopens from the refreshed board', async () => {
  const user = userEvent.setup(),
    onChanged = vi.fn();
  mount({ onChanged });
  await user.click(await screen.findByRole('button', { name: /Source evidence Pending review/ }));
  expect(screen.getByText('Red tunic and black trousers.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Approve Source evidence' }));
  expect(request).toHaveBeenCalledWith('/studio/workflow/review', {
    method: 'POST',
    body: {
      target: row.target,
      stage: 'source',
      action: 'approve',
      fingerprint: 'saved-hash',
      parentRevision: 2,
      reviewRevision: 0,
      feedback: ''
    }
  });
  expect(onChanged).toHaveBeenCalled();
});
test('board reviews use the saved server snapshot instead of an older editor copy', async () => {
  vi.mocked(request).mockResolvedValue({
    ...board,
    record: {
      ...record,
      revision: 3,
      production: { sourceNotes: 'Current saved source research.' }
    },
    proposals: [
      {
        _id: 'scene-draft',
        title: 'Correct arrival',
        baseRevision: 1,
        scene: { id: 'arrival', title: 'Beneath the carrier', script: 'One transport.', clips: [] },
        application: { canApply: true, rebased: true, recordRevision: 3 }
      }
    ]
  });
  mount();
  expect(await screen.findByRole('button', { name: 'Apply revised draft' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: /Source evidence Pending review/ }));
  expect(screen.getByText('Current saved source research.')).toBeVisible();
  expect(screen.queryByText('Red tunic and black trousers.')).not.toBeInTheDocument();
});

test('active editor saves disable reviews with an explanation; request changes requires feedback', async () => {
  const user = userEvent.setup();
  const view = mount({ saving: true });
  await user.click(await screen.findByRole('button', { name: /Source evidence Pending review/ }));
  expect(screen.getByRole('button', { name: 'Approve Source evidence' })).toBeDisabled();
  view.rerender(
    <ThemeProvider theme={theme}>
      <ProductionBoard record={record} scope="asset" />
    </ThemeProvider>
  );
  expect(screen.getByRole('button', { name: 'Request changes' })).toBeDisabled();
  await user.type(
    screen.getByRole('textbox', { name: 'Review feedback' }),
    'Check the belt against footage.'
  );
  await user.click(screen.getByRole('button', { name: 'Request changes' }));
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/review',
    expect.objectContaining({
      body: expect.objectContaining({
        action: 'request-changes',
        feedback: 'Check the belt against footage.'
      })
    })
  );
});
test('a stale review retains feedback and shows the server conflict', async () => {
  const user = userEvent.setup();
  vi.mocked(request).mockImplementation(async (url) => {
    if (url.endsWith('/review'))
      throw Object.assign(new Error('This review changed. Refresh and review the saved version.'), {
        status: 409
      });
    return board;
  });
  mount();
  await user.click(await screen.findByRole('button', { name: /Source evidence Pending review/ }));
  await user.type(
    screen.getByRole('textbox', { name: 'Review feedback' }),
    'My feedback is retained.'
  );
  await user.click(screen.getByRole('button', { name: 'Approve Source evidence' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This review changed.'));
  expect(screen.getByRole('textbox', { name: 'Review feedback' })).toHaveValue(
    'My feedback is retained.'
  );
});

test('request changes shows saving, then a persistent timestamped receipt after a reload', async () => {
  const user = userEvent.setup();
  const feedback = 'We only need maybe 7 seconds of the canyon flight';
  const savedAt = '2026-10-24T14:28:16.593Z';
  const savedRow = {
    ...row,
    status: 'needs-changes',
    feedback,
    savedAt,
    lastAction: 'request-changes',
    feedbackIsCurrent: true,
    reviewRevision: 1
  };
  let resolveSave;
  let saved = false;
  vi.mocked(request).mockImplementation(async (url) => {
    if (url.endsWith('/review'))
      return new Promise((resolve) => {
        resolveSave = () => {
          saved = true;
          resolve({ receipt: { action: 'request-changes', savedAt, feedback } });
        };
      });
    return saved ? { ...board, groups: [{ ...board.groups[0], stages: [savedRow] }] } : board;
  });
  const view = mount();
  await user.click(await screen.findByRole('button', { name: /Source evidence Pending review/ }));
  await user.type(screen.getByRole('textbox', { name: 'Review feedback' }), feedback);
  await user.click(screen.getByRole('button', { name: 'Request changes' }));
  expect(screen.getByRole('status')).toHaveTextContent('Saving change request');
  expect(screen.getByRole('status')).toHaveTextContent('not confirmed saved yet');
  expect(screen.getByRole('textbox', { name: 'Review feedback' })).toBeDisabled();
  resolveSave();
  await waitFor(() => expect(screen.getByText('Change request saved')).toBeVisible());
  expect(screen.getByRole('status')).toHaveTextContent(feedback);
  expect(screen.getByRole('status')).toHaveTextContent('does not automatically prepare a revision');
  view.unmount();
  mount();
  expect(await screen.findByText('Change request saved')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent(new Date(savedAt).toLocaleString());
  expect(screen.getByRole('status')).toHaveTextContent(feedback);
  expect(screen.getByRole('button', { name: 'Request changes' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Discuss saved feedback' })).toBeEnabled();
});

test('failed change requests keep the comment and never show a saved receipt', async () => {
  vi.mocked(request).mockImplementation(async (url) => {
    if (url.endsWith('/review'))
      throw new Error('Connection lost. Your request was not confirmed.');
    return board;
  });
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole('button', { name: /Source evidence Pending review/ }));
  const input = screen.getByRole('textbox', { name: 'Review feedback' });
  await user.type(input, 'Shorten the shot.');
  await user.click(screen.getByRole('button', { name: 'Request changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not confirmed');
  expect(input).toHaveValue('Shorten the shot.');
  expect(screen.queryByText('Change request saved')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Request changes' })).toBeEnabled();
});

test('feedback discussion carries the saved context and comment without sending a message, and storage failure preserves the receipt', async () => {
  const feedback = 'We only need maybe 7 seconds of the canyon flight';
  const requestedRow = {
    ...row,
    status: 'needs-changes',
    feedback,
    lastAction: 'request-changes',
    savedAt: '2026-10-24T14:28:16.593Z',
    feedbackIsCurrent: true
  };
  vi.mocked(request).mockImplementation(async (url) =>
    url.endsWith('/chats')
      ? { chat: { _id: 'feedback-chat' } }
      : { ...board, groups: [{ ...board.groups[0], stages: [requestedRow] }] }
  );
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Browser storage is unavailable.');
  });
  try {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Discuss saved feedback' }));
    expect(request).toHaveBeenCalledWith('/studio/assistant/chats', {
      method: 'POST',
      body: {
        title: 'Requested changes: Test character',
        context: { assetId: 'asset-one' }
      }
    });
    expect(setItem).toHaveBeenCalledWith('roxy-chat-draft-feedback-chat', expect.any(String));
    const draft = JSON.parse(setItem.mock.calls[0][1]);
    expect(draft.text).toContain(feedback);
    expect(draft.text).toContain('do not approve anything or generate media');
    expect(await screen.findByRole('alert')).toHaveTextContent('Browser storage is unavailable.');
    expect(screen.getByText('Change request saved')).toBeVisible();
    expect(vi.mocked(request).mock.calls.some(([url]) => url.endsWith('/messages'))).toBe(false);
  } finally {
    setItem.mockRestore();
  }
});

test('body turnaround has its own approval action rather than approving other package items', async () => {
  const user = userEvent.setup();
  const targetRow = {
    ...row,
    stage: 'reference:body-turnaround',
    title: 'Body turnaround',
    automatic: true,
    status: 'blocked',
    canApprove: false,
    blockers: ['Finalize this body turnaround in the asset image choices.']
  };
  vi.mocked(request).mockImplementation(async (url) =>
    url.endsWith('/board')
      ? {
          enabled: true,
          groups: [{ title: 'Reference package', target: row.target, stages: [targetRow] }]
        }
      : {}
  );
  const body = {
    ...record,
    production: {
      items: [
        {
          id: 'body-turnaround',
          type: 'image',
          title: 'Body turnaround',
          mediaId: 'turnaround-file',
          notes: 'Full body and head.'
        }
      ]
    },
    candidates: [{ id: 'new-turnaround', mediaIds: ['turnaround-file'], archived: false }]
  };
  mount({
    record: body,
    media: [{ _id: 'turnaround-file', kind: 'image', originalName: 'turnaround.png' }]
  });
  await user.click(await screen.findByRole('button', { name: /Body turnaround Blocked/ }));
  await user.click(screen.getByRole('button', { name: 'Approve body turnaround' }));
  expect(request).toHaveBeenCalledWith('/studio/assets/asset-one/finalize', {
    method: 'POST',
    body: { revision: 2, candidateId: 'new-turnaround' }
  });
  expect(vi.mocked(request).mock.calls.some(([url]) => url.endsWith('/review'))).toBe(false);
});

test('already-approved inputs can start the next step and queued work is visible', async () => {
  const user = userEvent.setup();
  vi.mocked(request).mockImplementation(async (url) =>
    url.endsWith('/board')
      ? {
          ...board,
          nextSteps: [{ kind: 'image' }],
          automation: []
        }
      : {}
  );
  mount();
  await user.click(
    await screen.findByRole('button', { name: 'Start next production step (1 request)' })
  );
  expect(request).toHaveBeenCalledWith('/studio/workflow/advance', {
    method: 'POST',
    body: { target: { scope: 'asset', recordId: 'asset-one' }, parentRevision: 2 }
  });
  expect(await screen.findByRole('status')).toHaveTextContent('Production step queued.');
  await user.click(screen.getByRole('link', { name: 'Go to production jobs' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Production jobs and retries' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  );
});

test('queued automation disables duplicate starts and replaces the earlier failure notice', async () => {
  vi.mocked(request).mockResolvedValue({
    ...board,
    nextSteps: [{ kind: 'image' }],
    automation: [
      { _id: 'queued', status: 'queued' },
      { _id: 'failed', status: 'failed', error: 'Connect OpenArt first.' }
    ]
  });
  mount();
  expect(
    await screen.findByRole('button', { name: 'Start next production step (1 request)' })
  ).toBeDisabled();
  expect(screen.queryByText(/Connect OpenArt first/)).not.toBeInTheDocument();
  expect(screen.getByText(/Jobs continue when you leave this page/)).toBeVisible();
});

test('dialogue blockers link to their exact fields and old repeated failures appear once', async () => {
  const target = { episodeId: 'episode-one', sceneId: 'scene', clipId: 'shot' };
  const episode = {
    _id: 'episode-one',
    revision: 1,
    scenes: [{ id: 'scene', title: 'Arrival', clips: [{ id: 'shot', title: 'Harkun opening' }] }]
  };
  const error = 'Dialogue generation requires one speaker per clip.';
  vi.mocked(request).mockResolvedValue({
    enabled: true,
    groups: [],
    blockedSteps: [{ kind: 'dialogue', target, error }],
    automation: [
      { _id: 'new', status: 'failed', error },
      { _id: 'old', status: 'failed', error }
    ],
    nextSteps: [{ kind: 'image', target }]
  });
  mount({ scope: 'episode', record: episode });
  expect(
    await screen.findByRole('link', { name: 'Edit dialogue for Harkun opening' })
  ).toHaveAttribute('href', '#shot-dialogue-shot');
  expect(screen.getAllByText(/Dialogue generation requires one speaker per clip/)).toHaveLength(1);
  expect(
    screen.getByRole('button', { name: 'Start next production step (1 request)' })
  ).toBeEnabled();
  expect(screen.getByText('image · Harkun opening')).toBeVisible();
});

test('failed job shortcuts open and focus the exact job even after recollapsing it', async () => {
  const user = userEvent.setup();
  vi.mocked(request).mockResolvedValue({
    ...board,
    jobs: [
      {
        _id: 'failed-image',
        kind: 'image',
        title: 'Image · Harkun opening',
        status: 'failed',
        target: { episodeId: record._id, sceneId: 'scene', clipId: 'shot' },
        error: 'Too many image references.'
      }
    ]
  });
  mount();
  const link = await screen.findByRole('link', {
    name: 'Go to job details for Image · Harkun opening'
  });
  expect(link).toHaveAttribute('href', '#production-job-failed-image');
  const summary = screen.getByRole('button', { name: 'Production jobs and retries' });
  await user.click(link);
  await waitFor(() => expect(summary).toHaveAttribute('aria-expanded', 'true'));
  await waitFor(() =>
    expect(
      screen.getByRole('alert', { name: 'Production job: Image · Harkun opening' })
    ).toHaveFocus()
  );
  await user.click(summary);
  await user.click(link);
  await waitFor(() => expect(summary).toHaveAttribute('aria-expanded', 'true'));
});

test('starting production disables repeat clicks while the request is pending', async () => {
  const user = userEvent.setup();
  let resolveStart;
  vi.mocked(request).mockImplementation((url) =>
    url.endsWith('/board')
      ? Promise.resolve({ ...board, nextSteps: [{ kind: 'image' }] })
      : new Promise((resolve) => {
          resolveStart = resolve;
        })
  );
  mount();
  await user.click(
    await screen.findByRole('button', { name: 'Start next production step (1 request)' })
  );
  expect(screen.getByRole('button', { name: 'Starting production…' })).toBeDisabled();
  resolveStart({});
  expect(await screen.findByRole('status')).toHaveTextContent('Production step queued.');
});

test('failed prerequisites stay visible after approval and retry starts through the application', async () => {
  const user = userEvent.setup();
  vi.mocked(request).mockResolvedValue({
    ...board,
    progress: {
      state: 'blocked',
      message: '5 requests failed. Your approvals are saved.',
      retrySteps: Array.from({ length: 5 }, () => ({ kind: 'image' }))
    }
  });
  mount();
  expect(await screen.findByRole('status')).toHaveTextContent(
    '5 requests failed. Your approvals are saved.'
  );
  await user.click(screen.getByRole('button', { name: 'Retry failed requests (5)' }));
  expect(request).toHaveBeenCalledWith('/studio/workflow/retry', {
    method: 'POST',
    body: expect.objectContaining({
      target: { scope: 'asset', recordId: 'asset-one' },
      parentRevision: 2,
      requestId: expect.any(String)
    })
  });
});

test('episode source review collects explicit range confirmation next to its research', async () => {
  const user = userEvent.setup();
  const episode = {
    _id: 'episode-one',
    revision: 4,
    scenes: [],
    production: { sourceNotes: 'Recorded events to review.' },
    sourceReferences: [
      {
        id: 'chapter',
        chapter: 'Initial Sith Trials',
        title: 'Chapter',
        startSeconds: 1007,
        endSeconds: 2043,
        status: 'unreviewed',
        url: 'https://www.youtube.com/watch?v=ojIORTFv7WU'
      }
    ]
  };
  const source = {
    ...row,
    target: { scope: 'episode', recordId: episode._id },
    title: 'Source research',
    status: 'draft',
    canApprove: false,
    parentRevision: 4,
    blockers: ['Verify the source.']
  };
  vi.mocked(request).mockImplementation(async (url) =>
    url.endsWith('/board')
      ? { enabled: true, groups: [{ title: 'Episode preparation', stages: [source] }] }
      : {}
  );
  mount({ scope: 'episode', record: episode });
  expect(await screen.findByText('Recorded events to review.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Approve Source research' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /I reviewed Initial Sith Trials/ }));
  await user.click(
    screen.getByRole('button', { name: 'Verify selected sources and approve research' })
  );
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/review',
    expect.objectContaining({
      body: expect.objectContaining({
        verifiedSourceIds: ['chapter'],
        parentRevision: 4,
        action: 'approve'
      })
    })
  );
});

test('approved source research stays explicit when the applied outline is ready for approval', async () => {
  const episode = {
    _id: 'episode-one',
    revision: 8,
    scenes: [],
    sourceReferences: [],
    production: { sourceNotes: 'Approved research.', outline: 'Applied outline.' }
  };
  const source = {
    ...row,
    target: { scope: 'episode', recordId: episode._id },
    title: 'Source research',
    stage: 'source',
    status: 'approved'
  };
  const outline = {
    ...source,
    key: 'outline-key',
    title: 'Episode outline',
    stage: 'outline',
    status: 'pending-review'
  };
  vi.mocked(request).mockResolvedValue({
    enabled: true,
    proposals: [],
    groups: [{ title: 'Episode preparation', stages: [source, outline] }]
  });
  mount({ scope: 'episode', record: episode });
  expect(await screen.findByRole('link', { name: 'Source research approved' })).toHaveAttribute(
    'href',
    '#' + reviewAnchor(source.target, 'source')
  );
  expect(
    screen.getByRole('button', { name: 'Approve Episode outline', exact: true })
  ).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Apply revised draft' })).not.toBeInTheDocument();
});

test('clip prerequisite anchor exposes an approval and previews only the selected clip', async () => {
  const user = userEvent.setup();
  const target = { scope: 'clip', recordId: 'episode-one', sceneId: 'arrival', clipId: 'giants' };
  const clip = {
    id: 'giants',
    title: 'Beneath the stone giants',
    duration: 6,
    camera: 'Wide approach.',
    dialogue: ''
  };
  const episode = {
    _id: 'episode-one',
    revision: 3,
    scenes: [
      {
        id: 'arrival',
        title: 'Arrival',
        clips: [clip, { ...clip, id: 'unfinished', title: 'Unfinished parked shot', duration: 4 }]
      }
    ]
  };
  vi.mocked(request).mockResolvedValue({
    enabled: true,
    record: episode,
    groups: [
      {
        title: 'Arrival / Beneath the stone giants',
        target,
        stages: [
          {
            ...row,
            key: 'clip-storyboard',
            target,
            stage: 'storyboard',
            title: 'Storyboard continuity'
          }
        ]
      }
    ]
  });
  mount({
    record: episode,
    scope: 'episode',
    assets: [
      {
        _id: 'shot-image',
        episodeId: episode._id,
        sceneId: 'arrival',
        clipId: 'giants',
        finalChoice: { mediaIds: ['image'] }
      }
    ],
    media: [{ _id: 'image', kind: 'image', originalName: 'giants.png' }]
  });
  const approve = await screen.findByRole('button', { name: 'Approve Storyboard continuity' });
  expect(approve).toBeEnabled();
  expect(
    screen.getByRole('region', { name: 'Prerequisites: Arrival / Beneath the stone giants' })
  ).toHaveAttribute('id', 'picture-prerequisites-giants');
  expect(screen.getByText(/Beneath the stone giants.*6s/)).toBeVisible();
  expect(screen.queryByText(/Unfinished parked shot.*4s/)).not.toBeInTheDocument();
  expect(screen.getByText(/Other shots can remain unfinished/)).toBeVisible();
  await user.click(approve);
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/review',
    expect.objectContaining({
      body: expect.objectContaining({ target, stage: 'storyboard', action: 'approve' })
    })
  );
});

test('saved gameplay evidence can be inspected on the episode without a new approval', async () => {
  const user = userEvent.setup();
  vi.mocked(request).mockResolvedValue({
    ...board,
    sourceEvidence: [
      {
        _id: 'packet',
        title: 'Arrival at Korriban source',
        observations: 'Actual footage shows the transport approaching the landing platform.',
        limitations: 'Caption markers do not establish dialogue.',
        frames: [
          {
            captured: true,
            captureKey: 'frame-key',
            mediaId: 'full-frame',
            subtitleCropMediaId: 'subtitle-crop',
            requestedSeconds: 1038,
            sourceSeconds: 1038,
            width: 1920,
            height: 1080
          }
        ]
      }
    ]
  });
  mount();
  await user.click(await screen.findByRole('button', { name: 'Saved gameplay evidence' }));
  expect(screen.getByText('Arrival at Korriban source')).toBeVisible();
  expect(screen.getByText('Source 17:18 · 1920 × 1080')).toBeVisible();
  expect(screen.getByAltText('Source frame at 17:18')).toHaveAttribute(
    'src',
    '/api/studio/media/full-frame'
  );
  expect(screen.getByAltText('Subtitle crop at 17:18')).toHaveAttribute(
    'src',
    '/api/studio/media/subtitle-crop'
  );
  expect(
    screen.getByText('Actual footage shows the transport approaching the landing platform.')
  ).toBeVisible();
  expect(vi.mocked(request).mock.calls.every(([url]) => url.endsWith('/board'))).toBe(true);
});
