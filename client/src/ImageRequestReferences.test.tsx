import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import ImageRequestReferences from './ImageRequestReferences.tsx';
import { mediaFixture } from './test/fixtures.ts';

test('image references can move later, link to their source shot and explain omitted or unavailable files', () => {
  const onChange = vi.fn();
  const references = {
    selected: ['one', 'two', 'three'],
    omitted: ['extra', 'extra2'],
    choices: [],
    omittedItems: [
      {
        mediaId: 'extra',
        title: 'Extra portrait',
        view: 'Face',
        imageNumber: 4,
        role: 'Character identity'
      },
      { mediaId: 'extra2', title: 'Extra set', imageNumber: 5, role: 'Environment' }
    ],
    items: [
      {
        mediaId: 'one',
        imageNumber: 1,
        title: 'First',
        role: 'Character identity',
        subject: 'Roxy',
        sourceClipId: 'prior'
      },
      {
        mediaId: 'two',
        imageNumber: 2,
        title: 'Second',
        role: 'Character identity',
        subject: 'Roxy'
      },
      { mediaId: 'three', imageNumber: 3, title: 'Droid', role: 'Droid design' }
    ]
  };
  render(
    <>
      <section id="picture-prerequisites-prior" aria-label="Prior shot" tabIndex={-1} />
      <ImageRequestReferences
        references={references}
        media={[mediaFixture({ _id: 'two', kind: 'audio' })]}
        onChangeReferences={onChange}
      />
    </>
  );
  expect(screen.getAllByText('This reference file is unavailable.')).toHaveLength(2);
  expect(screen.getByText('This reference is not an image.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Move image 1 later' }));
  expect(onChange).toHaveBeenLastCalledWith(['two', 'one', 'three']);
  fireEvent.click(screen.getByRole('link', { name: 'Review source shot' }));
  expect(screen.getByRole('region', { name: 'Prior shot' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Character sheets only' }));
  expect(onChange).toHaveBeenLastCalledWith(['one', 'three']);
  fireEvent.click(screen.getByText('Show excluded references'));
  expect(screen.getByText('Extra portrait - Face')).toBeVisible();
  expect(screen.getByText('Extra set')).toBeVisible();
});

test('a reference picker can use omitted choices when a separate catalog is unavailable', () => {
  const onChange = vi.fn();
  render(
    <ImageRequestReferences
      references={{
        selected: [],
        items: [],
        omitted: [],
        omittedItems: [{ mediaId: 'one', imageNumber: 1, title: 'Available', role: 'Reference' }]
      }}
      onChangeReferences={onChange}
    />
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Add image reference' }));
  fireEvent.click(screen.getByRole('option', { name: 'Available' }));
  expect(onChange).toHaveBeenCalledWith(['one']);
});

test('minimal reference records remain editable and sheet selection prefers an available turnaround', () => {
  const onChange = vi.fn();
  const item = {
    mediaId: 'portrait',
    imageNumber: 1,
    title: 'Roxy',
    role: 'Character identity',
    assetId: 'roxy'
  };
  const references = { selected: ['portrait'], items: [item], omitted: [] };
  const view = render(
    <ImageRequestReferences references={references} onChangeReferences={onChange} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Character sheets only' }));
  expect(onChange).toHaveBeenLastCalledWith(['portrait']);
  view.rerender(
    <ImageRequestReferences
      references={{
        ...references,
        choices: [item, { ...item, mediaId: 'body', view: 'Body turnaround' }]
      }}
      onChangeReferences={onChange}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Character sheets only' }));
  expect(onChange).toHaveBeenLastCalledWith(['body']);
});
