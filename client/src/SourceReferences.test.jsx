import { ThemeProvider } from '@mui/material/styles';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import SourceReferences from './SourceReferences.jsx';
import { theme } from './theme.js';
const episode = {
  sourceReferences: [
    {
      id: 'chapter',
      title: 'Sith Inquisitor source',
      url: 'https://www.youtube.com/watch?v=ojIORTFv7WU',
      chapter: 'Initial Sith trials',
      startSeconds: 1007.16,
      endSeconds: 2043.639,
      status: 'unreviewed',
      notes: 'Chapter timings only.'
    }
  ],
  decisions: [],
  scenes: []
};
function mount(record = episode) {
  const onEdit = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <SourceReferences episode={record} onEdit={onEdit} />
    </ThemeProvider>
  );
  return onEdit;
}
test('source chapter retains its exact timestamp range and needs an explicit review decision', async () => {
  const user = userEvent.setup(),
    onEdit = mount();
  expect(screen.getByText('Source range: 16:47 - 34:03')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open source in new tab' })).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=ojIORTFv7WU&t=1007s'
  );
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  await user.click(screen.getByRole('checkbox'));
  expect(onEdit).toHaveBeenCalledWith({
    sourceReferences: [expect.objectContaining({ status: 'verified' })]
  });
});
test('source player is loaded on request and uses a bounded YouTube privacy embed', async () => {
  const user = userEvent.setup();
  mount();
  expect(screen.queryByTitle('Source footage: Initial Sith trials')).not.toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: 'Watch source chapter - Initial Sith trials' })
  );
  expect(screen.getByTitle('Source footage: Initial Sith trials')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/ojIORTFv7WU?start=1007&end=2044'
  );
});
test('new decisions are blank and linked to a source rather than filled with guessed story choices', async () => {
  const user = userEvent.setup(),
    onEdit = mount();
  await user.click(screen.getByRole('button', { name: 'Add recorded decision' }));
  expect(onEdit).toHaveBeenCalledWith({
    decisions: [
      expect.objectContaining({
        sourceId: 'chapter',
        timestampSeconds: 1007,
        choice: '',
        outcome: ''
      })
    ]
  });
  const region = screen.getByRole('region', { name: 'Gameplay source and decisions' });
  expect(
    within(region).getByText(/No dialogue choices or scene events have been verified/)
  ).toBeInTheDocument();
});
