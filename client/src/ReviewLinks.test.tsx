import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';

import ReviewLinks from './ReviewLinks.tsx';
import { reviewFixture } from './test/fixtures.ts';

test('review links keep cross-record navigation and reveal local target panels', () => {
  const local = reviewFixture({
    key: 'local',
    title: 'Sound',
    navigationTitle: 'Sound plan',
    navigationHref: '#sound'
  });
  const remote = reviewFixture({
    key: 'remote',
    title: 'Another episode',
    target: { scope: 'episode', recordId: 'other' }
  });
  render(
    <>
      <details id="sound">
        <summary>Sound details</summary>
      </details>
      <ReviewLinks rows={[local, remote]} currentId="episode" />
    </>
  );
  fireEvent.click(screen.getByRole('link', { name: 'Go to Sound plan' }));
  expect(screen.getByRole('group')).toHaveAttribute('open');
  fireEvent.click(screen.getByRole('link', { name: 'Go to Another episode' }));
  expect(screen.getByRole('link', { name: 'Go to Another episode' })).toHaveAttribute(
    'href',
    expect.stringContaining('episode=other')
  );
  expect(within(screen.getByRole('group')).getByText('Sound details')).toBeVisible();
});
