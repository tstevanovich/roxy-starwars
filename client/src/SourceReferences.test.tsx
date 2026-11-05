import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

import type * as Studio from '../../shared/types.ts';
import SourceReferences from './SourceReferences.tsx';
import { episodeFixture } from './test/fixtures.ts';

const source = {
  id: 'source',
  title: 'Gameplay',
  chapter: 'Welcome',
  url: 'https://youtu.be/abcdefghijk',
  startSeconds: 60.5,
  endSeconds: 90.5,
  status: 'unreviewed' as const,
  notes: ''
};

function Editor({
  initial,
  onEdit = vi.fn()
}: {
  initial: Studio.Episode;
  onEdit?: (patch: Partial<Studio.Episode>) => void;
}) {
  const [episode, setEpisode] = useState(initial);
  return (
    <SourceReferences
      episode={episode}
      onMedia={vi.fn()}
      onEdit={(patch) => {
        onEdit(patch);
        setEpisode({ ...episode, ...patch });
      }}
    />
  );
}

test('edits a source range, toggles verification, and plays only the chosen range', () => {
  const onEdit = vi.fn();
  render(
    <Editor
      initial={episodeFixture({
        sourceReferences: [source, { ...source, id: 'other', chapter: 'Next' }]
      })}
      onEdit={onEdit}
    />
  );
  const input = (label: string) => screen.getAllByLabelText(label)[0];
  for (const [label, value, key] of [
    ['Source title', 'Recorded chapter', 'title'],
    ['Source URL', 'https://www.youtube.com/watch?v=abcdefghijk', 'url'],
    ['Chapter', 'Trial room', 'chapter'],
    ['Source start (seconds)', '61', 'startSeconds'],
    ['Source end (seconds)', '92', 'endSeconds'],
    ['Source review notes', 'Observed dialogue', 'notes']
  ]) {
    fireEvent.change(input(label), { target: { value } });
    expect(onEdit).toHaveBeenLastCalledWith({
      sourceReferences: [
        expect.objectContaining({ [key]: key.endsWith('Seconds') ? Number(value) : value }),
        expect.objectContaining({ id: 'other' })
      ]
    });
  }
  const verified = screen.getAllByRole('checkbox')[0];
  fireEvent.click(verified);
  expect(onEdit.mock.lastCall[0].sourceReferences[0].status).toBe('verified');
  fireEvent.click(verified);
  expect(onEdit.mock.lastCall[0].sourceReferences[0].status).toBe('unreviewed');
  fireEvent.click(screen.getByRole('button', { name: 'Watch source chapter - Trial room' }));
  expect(screen.getByTitle('Source footage: Trial room')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/abcdefghijk?start=61&end=92'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close source player - Trial room' }));
  expect(screen.queryByTitle('Source footage: Trial room')).not.toBeInTheDocument();
  fireEvent.change(input('Source end (seconds)'), { target: { value: '' } });
  expect(screen.getByText('Source range: 1:01 - End not set')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Watch source chapter - Trial room' }));
  expect(screen.getByTitle('Source footage: Trial room')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/abcdefghijk?start=61'
  );
});

test.each([
  ['https://youtu.be/abcdefghijk', true],
  ['https://youtube.com/watch?v=abcdefghijk', true],
  ['https://www.youtube.com/watch?v=abcdefghijk', true],
  ['https://example.com/watch?v=abcdefghijk', false],
  ['https://youtube.com/watch', false],
  ['https://youtu.be/short', false],
  ['invalid URL', false]
])('embeds supported YouTube URLs without inventing video IDs: %s', (url, supported) => {
  render(
    <Editor
      initial={episodeFixture({
        sourceReferences: [{ ...source, chapter: '', url, startSeconds: undefined, endSeconds: 0 }]
      })}
    />
  );
  expect(screen.queryByRole('button', { name: /Watch source chapter/ }) !== null).toBe(supported);
  expect(screen.getByText('Source range: 0:00 - 0:00')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open source in new tab' })).toHaveAttribute(
    'href',
    supported ? 'https://www.youtube.com/watch?v=abcdefghijk&t=0s' : url
  );
  if (supported) {
    fireEvent.click(screen.getByRole('button', { name: /Watch source chapter/ }));
    expect(screen.getByTitle('Source footage:')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/abcdefghijk?start=0'
    );
  }
});

test('adds, edits and removes decisions while retaining other sources and decisions', () => {
  const onEdit = vi.fn();
  render(
    <Editor
      initial={episodeFixture({
        sourceReferences: [source, { ...source, id: 'other', title: 'Other source', chapter: '' }],
        decisions: [
          {
            id: 'existing',
            sourceId: 'other',
            timestampSeconds: 8,
            choice: 'Keep',
            outcome: 'Unchanged'
          }
        ]
      })}
      onEdit={onEdit}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add recorded decision' }));
  expect(onEdit.mock.lastCall[0].decisions[1]).toMatchObject({
    sourceId: 'source',
    timestampSeconds: 60
  });
  for (const [label, value, key] of [
    ['Decision timestamp (seconds)', '73', 'timestampSeconds'],
    ['Choice shown in footage', 'Sarcastic', 'choice'],
    ['Observed consequence', 'Dismissal', 'outcome']
  ]) {
    fireEvent.change(screen.getAllByLabelText(label)[1], { target: { value } });
    expect(onEdit.mock.lastCall[0].decisions).toEqual([
      expect.objectContaining({ id: 'existing' }),
      expect.objectContaining({ [key]: key === 'timestampSeconds' ? 73 : value })
    ]);
  }
  fireEvent.mouseDown(screen.getAllByRole('combobox', { name: 'Decision source' })[1]);
  fireEvent.click(within(screen.getByRole('listbox')).getByText('Other source'));
  expect(onEdit.mock.lastCall[0].decisions[1].sourceId).toBe('other');
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove decision' })[1]);
  expect(onEdit.mock.lastCall[0].decisions).toHaveLength(1);
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove source reference' })[1]);
  expect(onEdit.mock.lastCall[0]).toMatchObject({ sourceReferences: [source], decisions: [] });
});

test('removing a source clears its scene links and decisions, without changing other scene links', () => {
  const onEdit = vi.fn();
  render(
    <SourceReferences
      onMedia={vi.fn()}
      onEdit={onEdit}
      episode={episodeFixture({
        sourceReferences: [source],
        decisions: [{ id: 'decision', sourceId: source.id }],
        scenes: [{ id: 'one', sourceReferenceIds: ['source', 'keep'] }, { id: 'two' }]
      })}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove source reference' }));
  expect(onEdit.mock.lastCall[0]).toMatchObject({
    sourceReferences: [],
    decisions: [],
    scenes: [{ sourceReferenceIds: ['keep'] }, { sourceReferenceIds: [] }]
  });
});

test('an empty source list can add a new source but cannot create an ungrounded decision', () => {
  const onEdit = vi.fn();
  const episode = episodeFixture();
  delete episode.sourceReferences;
  delete episode.decisions;
  render(<Editor initial={episode} onEdit={onEdit} />);
  expect(screen.getByRole('button', { name: 'Add recorded decision' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add source reference' }));
  expect(onEdit.mock.lastCall[0].sourceReferences).toEqual([
    expect.objectContaining({
      title: 'New gameplay source',
      startSeconds: 0,
      endSeconds: null,
      status: 'unreviewed'
    })
  ]);
});
