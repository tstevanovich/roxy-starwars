import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { request } from './api.ts';
import RejectMediaButton from './RejectMediaButton.tsx';
vi.mock('./api.ts', () => ({ request: vi.fn() }));

test('rejection errors leave the original file available and permit retry', async () => {
  vi.mocked(request)
    .mockRejectedValueOnce(new Error('Revision changed'))
    .mockResolvedValueOnce({ deletedMediaIds: ['voice'] });
  const onRejected = vi.fn();
  render(<RejectMediaButton file={{ _id: 'voice', kind: 'audio' }} onRejected={onRejected} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reject & delete' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Revision changed');
  expect(onRejected).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reject & delete' }));
  await screen.findByRole('button', { name: 'Reject & delete' });
  expect(onRejected).toHaveBeenCalledWith({ deletedMediaIds: ['voice'] });
});

test('missing files disable rejection and an optional completion callback is not required', async () => {
  const view = render(<RejectMediaButton />);
  expect(screen.getByRole('button')).toBeDisabled();
  vi.mocked(request).mockResolvedValueOnce({});
  view.rerender(<RejectMediaButton file={{ _id: 'voice', kind: 'audio' }} />);
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('button', { name: 'Reject & delete' })).toBeEnabled();
});
