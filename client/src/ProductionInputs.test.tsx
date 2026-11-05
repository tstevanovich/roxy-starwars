import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { shotContinuity } from '../../shared/shot-continuity.ts';
import type * as Studio from '../../shared/types.ts';
import { AssetProductionInputs, ShotProductionInputs } from './ProductionInputs.tsx';
import {
  assetFixture,
  clipFixture,
  episodeFixture,
  mediaFixture,
  sceneFixture
} from './test/fixtures.ts';

vi.mock('../../shared/shot-continuity.ts', () => ({ shotContinuity: vi.fn() }));
// Exercise parent attachment updates independently of the upload transport, which
// has its own media tests. These controls return the same complete media records.
vi.mock('./StudioMedia.tsx', () => ({
  ReferencePreview: ({ file }) => <span>Preview {file?._id || 'missing'}</span>,
  MediaAttachments: ({ onChange, onUploaded }) => (
    <>
      <button onClick={() => onChange(['source'])}>Choose evidence</button>
      <button onClick={() => onUploaded({ _id: 'upload', kind: 'image' })}>Upload evidence</button>
    </>
  ),
  UploadButton: ({ onUploaded }) => (
    <button onClick={() => onUploaded({ _id: 'upload', kind: 'image' })}>
      Import reference file
    </button>
  )
}));

beforeEach(() => {
  vi.mocked(shotContinuity).mockReturnValue({
    errors: [],
    sources: [],
    mode: 'auto',
    invalidSources: [],
    mediaIds: [],
    notes: '',
    directions: ''
  });
});
function choose(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(within(screen.getByRole('listbox')).getByText(option));
}
function closeMenu() {
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
}
const files = [
  mediaFixture({ _id: 'source', originalName: 'Source.png' }),
  mediaFixture({ _id: 'portrait', originalName: 'Portrait.png' }),
  mediaFixture({ _id: 'audio', originalName: 'Voice.wav', kind: 'audio' }),
  mediaFixture({ _id: 'take', originalName: 'Take.mp4', kind: 'video' }),
  mediaFixture({ _id: 'mixed', originalName: 'Mixed.mp4', kind: 'video', soundMix: {} })
];

function AssetEditor({
  initial,
  edited,
  onChat,
  onMedia = vi.fn(),
  onRejected
}: {
  initial: Studio.Asset;
  edited: (change: Studio.ProductionSettings) => void;
  onChat?: (context: Studio.ChatContext) => void;
  onMedia?: (file: Studio.MediaFile) => void;
  onRejected?: (result: Studio.RejectionResult) => void;
}) {
  const [asset, setAsset] = useState(initial);
  return (
    <AssetProductionInputs
      asset={asset}
      media={files}
      onMedia={onMedia}
      onChat={onChat}
      onRejected={onRejected}
      onEdit={(production) => {
        edited(production);
        setAsset({ ...asset, production });
      }}
    />
  );
}

test('creates image, audio, written and standard character package requirements', () => {
  const edited = vi.fn();
  const asset = assetFixture();
  delete asset.production;
  render(<AssetEditor initial={asset} edited={edited} />);
  for (const [button, title, type] of [
    ['Add image reference', 'Individual reference', 'image'],
    ['Add voice sample', 'Voice sample', 'audio'],
    ['Add written reference', 'Pronunciation and voice settings', 'notes']
  ]) {
    fireEvent.click(screen.getByRole('button', { name: button }));
    expect(edited.mock.lastCall[0].items.at(-1)).toMatchObject({
      title,
      type,
      required: true,
      mediaId: null,
      notes: ''
    });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Add character package' }));
  expect(edited.mock.lastCall[0].items.length).toBeGreaterThan(3);
  expect(screen.getAllByLabelText('Reference title').length).toBe(
    edited.mock.lastCall[0].items.length
  );
});

test('edits source direction and package instructions, selects references and removes only the chosen requirement', () => {
  const edited = vi.fn(),
    onChat = vi.fn(),
    onMedia = vi.fn();
  render(
    <AssetEditor
      initial={assetFixture({
        production: {
          sourceMediaIds: ['source'],
          items: [
            { id: 'face', title: 'Face', type: 'image', required: true },
            {
              id: 'portrait',
              title: 'Portrait',
              type: 'notes',
              required: false,
              mediaId: 'portrait'
            }
          ]
        }
      })}
      edited={edited}
      onChat={onChat}
      onMedia={onMedia}
      onRejected={vi.fn()}
    />
  );
  choose('Source direction', 'Original design direction');
  expect(edited.mock.lastCall[0].sourceMode).toBe('original');
  for (const [label, value, key] of [
    ['Source URL', 'https://example.test/source', 'sourceUrl'],
    ['Observed source details and unresolved choices', 'Red robe', 'sourceNotes']
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(edited.mock.lastCall[0][key]).toBe(value);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Choose evidence' }));
  expect(edited.mock.lastCall[0].sourceMediaIds).toEqual(['source']);
  fireEvent.click(screen.getByRole('button', { name: 'Upload evidence' }));
  expect(edited.mock.lastCall[0].sourceMediaIds).toEqual(['source', 'upload']);
  expect(onMedia).toHaveBeenCalledWith({ _id: 'upload', kind: 'image' });
  for (const [label, value, key] of [
    ['Reference title', 'Master face', 'title'],
    ['Reference instructions / pronunciation', 'Neutral expression', 'notes'],
    ['Exact image prompt sent to OpenArt', 'Head and shoulders', 'imagePrompt']
  ]) {
    fireEvent.change(screen.getAllByLabelText(label)[0], { target: { value } });
    expect(edited.mock.lastCall[0].items[0][key]).toBe(value);
    expect(edited.mock.lastCall[0].items[1].title).toBe('Portrait');
  }
  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Required for linked scenes' })[0]);
  expect(edited.mock.lastCall[0].items[0].required).toBe(false);
  choose('Source images for this reference', 'Source.png');
  closeMenu();
  expect(edited.mock.lastCall[0].items[0].sourceMediaIds).toEqual(['source']);
  choose('Approved package references', 'Portrait.png');
  closeMenu();
  expect(edited.mock.lastCall[0].items[0].referenceMediaIds).toEqual(['portrait']);
  choose('Individual reference file', 'Portrait.png');
  expect(screen.getByText('Preview portrait')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Reject & delete' })).toBeEnabled();
  choose('Individual reference file', 'Choose file');
  expect(edited.mock.lastCall[0].items[0].mediaId).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Import reference file' }));
  expect(edited.mock.lastCall[0].items[0].mediaId).toBe('upload');
  fireEvent.click(screen.getByRole('button', { name: 'Request this reference in chat' }));
  expect(onChat).toHaveBeenCalledWith({ assetId: 'asset', packageItemId: 'face' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove package requirement' })[0]);
  expect(edited.mock.lastCall[0].items.map((item) => item.id)).toEqual(['portrait']);
});

test('voice package selectors show only audio files and can preserve an existing source list on upload', () => {
  const edited = vi.fn();
  render(
    <AssetEditor
      initial={assetFixture({
        production: { items: [{ id: 'voice', title: 'Voice', type: 'audio' }] }
      })}
      edited={edited}
    />
  );
  choose('Individual reference file', 'Voice.wav');
  expect(edited.mock.lastCall[0].items[0].mediaId).toBe('audio');
  fireEvent.click(screen.getByRole('button', { name: 'Upload evidence' }));
  expect(edited.mock.lastCall[0].sourceMediaIds).toEqual(['upload']);
});

test('edits all shot production inputs, explicit continuity sources and the original picture take', () => {
  const edited = vi.fn();
  const scene = sceneFixture({
    id: 'scene',
    title: 'Welcome',
    assetIds: ['identity'],
    clips: [
      { id: 'prior', title: 'Opening' },
      { id: 'clip', title: 'Response' }
    ]
  });
  const episode = episodeFixture({ scenes: [scene] });
  const asset = assetFixture({
    _id: 'identity',
    finalChoice: { mediaIds: ['source'] },
    production: {
      items: [
        { id: 'body', type: 'image', required: true, mediaId: 'portrait' },
        { id: 'voice', type: 'audio', required: true, mediaId: 'audio' },
        { id: 'optional', type: 'image', required: false },
        { id: 'missing', type: 'image', required: true }
      ]
    }
  });
  function Editor() {
    const [clip, setClip] = useState(clipFixture({ id: 'clip', takeIds: ['take', 'mixed'] }));
    return (
      <ShotProductionInputs
        clip={clip}
        scene={scene}
        episode={episode}
        assets={[asset, assetFixture({ _id: 'unlinked' })]}
        media={files}
        onEdit={(production) => {
          edited(production);
          setClip({ ...clip, production });
        }}
      />
    );
  }
  render(<Editor />);
  choose('Shot continuity', 'Use specific earlier shots');
  expect(edited.mock.lastCall[0]).toMatchObject({
    continuityMode: 'explicit',
    continuitySources: []
  });
  choose('Earlier continuity shots', 'Welcome / Opening');
  closeMenu();
  expect(edited.mock.lastCall[0].continuitySources).toEqual([
    { sceneId: 'scene', clipId: 'prior' }
  ]);
  for (const [label, key] of [
    ['Continuity details to preserve', 'continuityNotes'],
    ['Location for this shot only', 'location'],
    ['Physical continuity and exclusions', 'physicalConstraints'],
    ['Framing', 'framing'],
    ['Timed action beats', 'beats'],
    ['Pass conditions', 'passCondition']
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: 'Keep staging' } });
    expect(edited.mock.lastCall[0][key]).toBe('Keep staging');
  }
  choose('Physical environment', 'Ship or building interior');
  expect(edited.mock.lastCall[0].environment).toBe('interior');
  choose('Reference views for this shot', 'Portrait.png');
  closeMenu();
  expect(edited.mock.lastCall[0].referenceMediaIds).toEqual(['portrait']);
  choose('Generation mode', 'Reference to video · referenced voice');
  expect(edited.mock.lastCall[0].mode).toBe('voice-reference');
  choose('Video take for picture / performance approval', 'Take.mp4');
  expect(edited.mock.lastCall[0].visualTakeId).toBe('take');
  expect(screen.getByText('Preview take')).toBeVisible();
  choose('Video take for picture / performance approval', 'Choose original take');
  expect(edited.mock.lastCall[0].visualTakeId).toBeNull();
});

test.each([{ errors: [] }, { errors: ['Approve the preceding image.'] }])(
  'shows continuity comparisons and any actionable approval warnings: %j',
  ({ errors }) => {
    vi.mocked(shotContinuity).mockReturnValue({
      errors,
      sources: [{ sceneId: 'scene', clipId: 'prior', title: 'Earlier shot', mediaId: 'source' }]
    } as ReturnType<typeof shotContinuity>);
    const clip = clipFixture();
    delete clip.production;
    const scene = sceneFixture({ clips: [clip] });
    render(
      <ShotProductionInputs
        clip={clip}
        scene={scene}
        episode={undefined}
        media={files}
        onEdit={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: new RegExp(
          errors.length ? 'Continuity source shots' : 'Approved continuity references'
        )
      })
    );
    expect(screen.getByRole('link', { name: 'Earlier shot' })).toHaveAttribute(
      'href',
      '#shot-inputs-prior'
    );
    expect(screen.getByText('Preview source')).toBeVisible();
    if (errors.length) expect(screen.getByText(errors[0])).toBeVisible();
  }
);

test('explicit continuity starts empty and linked assets without approved references remain selectable for later preparation', () => {
  const scene = sceneFixture({
    assetIds: ['empty'],
    clips: [{ production: { continuityMode: 'explicit' } }]
  });
  render(
    <ShotProductionInputs
      clip={scene.clips[0]}
      scene={scene}
      episode={episodeFixture({ scenes: [scene] })}
      assets={[assetFixture({ _id: 'empty' })]}
      media={files}
      onEdit={vi.fn()}
    />
  );
  expect(screen.getByRole('combobox', { name: 'Earlier continuity shots' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Reference views for this shot' })).toBeVisible();
});
