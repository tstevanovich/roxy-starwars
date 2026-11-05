import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.ts';
import SeriesBible from './SeriesBible.tsx';
import { settingsFixture } from './test/fixtures.ts';

vi.mock('./api.ts', () => ({ request: vi.fn() }));
beforeEach(() => {
  localStorage.clear();
  vi.mocked(request).mockReset();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:bible'),
      revokeObjectURL: vi.fn()
    })
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('edits every bible field and saves a numeric, complete record without losing settings', async () => {
  const settings = settingsFixture({ cinematicOnly: false });
  const onSaved = vi.fn();
  let finish: (value: { settings: typeof settings }) => void;
  vi.mocked(request).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(<SeriesBible settings={settings} onSaved={onSaved} />);
  const save = screen.getByRole('button', { name: 'Save series bible' });
  expect(save).toBeDisabled();
  for (const [label, value] of [
    ['Era and setting', 'Old Republic'],
    ['Episode target in seconds', '120'],
    ['Vlog target percentage', '20'],
    ['Monthly OpenArt allowance', '500'],
    ['Story, tone, and continuity rules', 'Preserve identities.']
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(save);
  expect(save).toBeDisabled();
  const next = {
    ...settings,
    era: 'Old Republic',
    targetSeconds: 120,
    vlogPercent: 20,
    monthlyCredits: 500,
    notes: 'Preserve identities.'
  };
  expect(request).toHaveBeenCalledWith('/studio/settings', { method: 'PUT', body: next });
  await act(async () => finish({ settings: next }));
  expect(onSaved).toHaveBeenCalledWith(next);
  expect(screen.getByText('Series bible saved.')).toBeVisible();
  expect(save).toBeDisabled();
});

test('a failed save keeps edits and offers an exported recovery before restoring the saved version', async () => {
  const settings = settingsFixture({ cinematicOnly: true, era: 'Original era' });
  vi.mocked(request).mockRejectedValue(new Error('Offline'));
  render(<SeriesBible settings={settings} onSaved={vi.fn()} />);
  expect(screen.getByLabelText('Vlog target percentage')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Era and setting'), { target: { value: 'Local edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save series bible' }));
  await screen.findByText('Offline');
  expect(screen.getByLabelText('Era and setting')).toHaveValue('Local edit');
  fireEvent.click(screen.getByRole('button', { name: 'Export draft and reload saved version' }));
  await waitFor(() => expect(screen.getByLabelText('Era and setting')).toHaveValue('Original era'));
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  expect(localStorage.getItem(`roxy-studio-bible-${settings._id}`)).toBeNull();
});

test('exports the current bible and releases the temporary download URL', () => {
  vi.useFakeTimers();
  render(<SeriesBible settings={settingsFixture()} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Export series bible' }));
  expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  act(() => vi.runAllTimers());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:bible');
});
