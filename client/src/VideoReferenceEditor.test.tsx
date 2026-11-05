import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import VideoReferenceEditor from './VideoReferenceEditor.tsx';

test('video references expose unavailable saved selections and save local changes explicitly', () => {
  const onChange = vi.fn(),
    onSave = vi.fn();
  render(
    <VideoReferenceEditor
      references={[]}
      selection={['missing']}
      choices={[]}
      media={[]}
      dirty
      onChange={onChange}
      onSave={onSave}
    />
  );
  expect(screen.getByText(/Some saved video references are unavailable/)).toBeVisible();
  expect(screen.getByText(/Unsaved video references/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save video references' }));
  expect(onSave).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Remove all video identity references' }));
  expect(onChange).toHaveBeenCalledWith([]);
});
