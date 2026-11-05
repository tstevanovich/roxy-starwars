import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import ShotDisclosure from './ShotDisclosure.tsx';

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  localStorage.clear();
});
test('a shot still expands and collapses when browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Full');
  });
  render(
    <ShotDisclosure storageKey="shot" anchorId="shot-one" title="Response" index={0} duration={5}>
      <p>Editor</p>
    </ShotDisclosure>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Collapse shot' }));
  expect(screen.getByRole('button', { name: 'Expand shot' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Expand shot' }));
  expect(screen.getByText('Editor')).toBeVisible();
});

test('hash navigation reveals a stored collapsed shot and ignores other destinations', () => {
  localStorage.setItem('shot', 'false');
  render(
    <section id="shot-one">
      <ShotDisclosure storageKey="shot" anchorId="shot-one" title="Response" index={0} duration={5}>
        <p id="editor">Editor</p>
      </ShotDisclosure>
    </section>
  );
  expect(screen.getByRole('button', { name: 'Expand shot' })).toBeVisible();
  act(() => {
    history.replaceState(null, '', '/#missing');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(screen.getByRole('button', { name: 'Expand shot' })).toBeVisible();
  act(() => {
    history.replaceState(null, '', '/#editor');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(screen.getByRole('button', { name: 'Collapse shot' })).toBeVisible();
  fireEvent(screen.getByRole('group'), new Event('toggle'));
});
