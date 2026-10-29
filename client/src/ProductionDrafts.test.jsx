import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.js';
import ProductionDrafts from './ProductionDrafts.jsx';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn() }));
const record = {
  _id: 'episode',
  revision: 4,
  production: { sourceNotes: 'Old saved research.', outline: 'Old outline.' }
};
const proposal = {
  _id: 'proposal',
  baseRevision: 4,
  chatId: 'chat',
  title: 'Correct source scope',
  text: 'Include arrival and flexible runtime.',
  production: {
    sourceNotes: 'Revised research includes Arrival at Korriban.',
    outline: 'Old outline.',
    outlineNeedsRevision: true
  },
  sourceReferences: [
    { id: 'crawl', chapter: 'Opening crawl', startSeconds: 840, endSeconds: 931 },
    { id: 'arrival', chapter: 'Arrival at Korriban', startSeconds: 931, endSeconds: 1007.16 }
  ]
};
beforeEach(() => {
  vi.mocked(request).mockReset();
  vi.mocked(request).mockResolvedValue({ applied: true });
});
const mount = (props = {}) =>
  render(
    <ThemeProvider theme={theme}>
      <ProductionDrafts proposals={[proposal]} record={record} onChanged={vi.fn()} {...props} />
    </ThemeProvider>
  );
test('supporting evidence stays inside one draft with one application action', () => {
  mount({
    proposals: [
      {
        ...proposal,
        supportingNotes: [
          { id: 'one', title: 'Opening subtitle', text: 'First evidence block.' },
          { id: 'two', title: 'Next subtitle', text: 'Second evidence block.' },
          { id: 'three', title: 'Timing correction', text: 'Third evidence block.' }
        ]
      }
    ]
  });
  expect(screen.getAllByRole('button', { name: 'Apply revised draft' })).toHaveLength(1);
  expect(screen.getByText('First evidence block.')).toBeVisible();
  expect(screen.getByText('Second evidence block.')).toBeVisible();
  expect(screen.getByText('Third evidence block.')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Supporting evidence and feedback' })).toBeVisible();
});

test('scene revisions explain which shots retain approvals and which need timing review', () => {
  const clip = { id: 'first', title: 'Approved flight', duration: 7, action: 'Fly over canyon.' };
  const scene = {
    id: 'arrival',
    title: 'Arrival',
    script: 'Original scene.',
    clips: [clip, { ...clip, id: 'landing', title: 'Landing', duration: 10 }]
  };
  mount({
    record: { ...record, scenes: [scene] },
    proposals: [
      {
        ...proposal,
        production: undefined,
        scene: {
          ...scene,
          script: 'Revise the landing.',
          clips: [clip, { ...scene.clips[1], duration: 12 }]
        }
      }
    ]
  });
  expect(screen.getByText('Review impact')).toBeVisible();
  expect(
    screen.getByText(/Approved flight: unchanged; existing image and video approvals are retained/)
  ).toBeVisible();
  expect(screen.getByText('Landing: review changed timing and affected video.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Apply revised draft' })).toBeEnabled();
});
test('shows the proposed research and source ranges beside a separate apply action', async () => {
  const user = userEvent.setup(),
    onChanged = vi.fn();
  mount({ onChanged });
  expect(screen.getByText('Revised research includes Arrival at Korriban.')).toBeVisible();
  expect(screen.getByText(/14:00.*15:31.*Opening crawl/)).toBeVisible();
  expect(screen.getByText(/15:31.*16:47.*Arrival at Korriban/)).toBeVisible();
  expect(screen.queryByText('Old outline.')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Apply revised draft' }));
  expect(request).toHaveBeenCalledWith('/studio/assistant/proposals/proposal/apply', {
    method: 'POST',
    body: {}
  });
  expect(onChanged).toHaveBeenCalled();
  expect(record.production.sourceNotes).toBe('Old saved research.');
});
test('unsaved episode edits and obsolete proposal revisions disable applying', () => {
  const view = mount({ disabled: true });
  expect(screen.getByRole('button', { name: 'Apply revised draft' })).toBeDisabled();
  view.rerender(
    <ThemeProvider theme={theme}>
      <ProductionDrafts
        proposals={[proposal]}
        record={{ ...record, revision: 5 }}
        onChanged={vi.fn()}
      />
    </ThemeProvider>
  );
  expect(screen.getByRole('button', { name: 'Apply revised draft' })).toBeDisabled();
  expect(screen.getByText(/conflicts with newer scene/)).toBeVisible();
});
test('failed application keeps the proposed correction available and displays the conflict', async () => {
  vi.mocked(request).mockRejectedValue(new Error('The record changed.'));
  const user = userEvent.setup(),
    onChanged = vi.fn();
  mount({ onChanged });
  await user.click(screen.getByRole('button', { name: 'Apply revised draft' }));
  expect(await screen.findByText('The record changed.')).toBeVisible();
  expect(screen.getByText('Revised research includes Arrival at Korriban.')).toBeVisible();
  expect(onChanged).not.toHaveBeenCalled();
});

test('a safely rebased scene draft remains actionable and explains that saved decisions are kept', async () => {
  const user = userEvent.setup();
  mount({
    proposals: [
      {
        ...proposal,
        production: undefined,
        baseRevision: 3,
        scene: {
          id: 'scene',
          title: 'Beneath the carrier',
          script: 'Corrected canyon flight.',
          clips: []
        },
        application: { canApply: true, rebased: true, recordRevision: 4 }
      }
    ]
  });
  expect(screen.getByText(/your saved notes, takes and selections will be kept/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Apply revised draft' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Apply revised draft' }));
  expect(request).toHaveBeenCalledWith('/studio/assistant/proposals/proposal/apply', {
    method: 'POST',
    body: {}
  });
});

test('the saved server check overrides an older browser record without an obsolete-version warning', () => {
  const view = mount({
    record: { ...record, revision: 2, history: [] },
    proposals: [
      {
        ...proposal,
        baseRevision: 3,
        production: undefined,
        scene: {
          id: 'arrival',
          title: 'Beneath the carrier',
          script: 'Corrected scene.',
          clips: []
        },
        application: { canApply: true, rebased: true, recordRevision: 4 }
      }
    ]
  });
  expect(screen.getByRole('button', { name: 'Apply revised draft' })).toBeEnabled();
  expect(screen.queryByText(/older saved version/)).not.toBeInTheDocument();
  view.rerender(
    <ThemeProvider theme={theme}>
      <ProductionDrafts
        proposals={[
          {
            ...proposal,
            application: { canApply: false, recordRevision: 5, reason: 'The saved scene changed.' }
          }
        ]}
        record={record}
        onChanged={vi.fn()}
      />
    </ThemeProvider>
  );
  expect(screen.getByRole('button', { name: 'Apply revised draft' })).toBeDisabled();
  expect(screen.getByText('The saved scene changed.')).toBeVisible();
});

test('a video revision displays exact directions and only its explicit approval queues generation', async () => {
  const user = userEvent.setup();
  mount({
    proposals: [
      {
        _id: 'video-revision',
        title: 'One ship canyon flight',
        baseRevision: 4,
        render: {
          model: 'Wan 3.0 Standard',
          resolution: '480p',
          aspectRatio: '16:9',
          duration: 16,
          instructions: 'Exactly one ship continues along the canyon.'
        }
      }
    ]
  });
  expect(screen.getByText('Exactly one ship continues along the canyon.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Apply revised draft' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Approve revision & generate video' }));
  expect(request).toHaveBeenCalledWith(
    '/studio/assistant/proposals/video-revision/approve-render',
    {
      method: 'POST',
      body: {}
    }
  );
});

test('an outline draft is labeled as the outline rather than an unapplied source revision', () => {
  mount({
    proposals: [
      {
        ...proposal,
        reviewStages: ['outline'],
        sourceReferences: undefined,
        production: { sourceNotes: record.production.sourceNotes, outline: 'A new outline.' }
      }
    ]
  });
  expect(screen.getByText(/Episode outline draft.*awaiting application/)).toBeVisible();
  expect(screen.queryByText('Proposed source research')).not.toBeInTheDocument();
});

test('planning drafts identify their review stages and expose the proposed sound layers', () => {
  mount({
    proposals: [
      {
        _id: 'planning',
        baseRevision: 4,
        title: 'Complete arrival planning',
        text: 'Approved script is preserved.',
        reviewStages: ['shot-plan', 'sound-plan'],
        scene: {
          title: 'Arrival',
          script: 'Existing approved script.',
          clips: [
            {
              id: 'fleet',
              title: 'Fleet in orbit',
              duration: 12,
              action: 'Hold above Korriban.',
              production: {
                framing: 'Extreme wide',
                beats: 'Hold the fleet geography.',
                passCondition: 'Stable approved hulls.'
              }
            }
          ],
          soundPlan: {
            notes: 'Sound effects only; no music.',
            layers: [
              {
                id: 'engine',
                title: 'Carrier engines',
                type: 'ambience',
                description: 'Deep steady engine resonance.',
                clipId: 'fleet',
                start: 0,
                duration: 12,
                gainDb: -20
              }
            ]
          }
        }
      }
    ]
  });
  expect(screen.getByText(/Shot plan and Sound plan draft.*awaiting application/)).toBeVisible();
  expect(screen.getByText('Proposed sound plan')).toBeVisible();
  expect(screen.getByText('Deep steady engine resonance.')).toBeVisible();
  expect(screen.getByText(/Fleet in orbit.*starts at 0s/)).toBeVisible();
  expect(screen.getByText('Stable approved hulls.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Apply revised draft' })).toBeEnabled();
});
