import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.ts';
import { currentProjectKey } from './project-url.ts';
import SceneBoardEditor from './SceneBoardEditor.tsx';
import { episodeFixture, sceneFixture } from './test/fixtures.ts';
import { theme } from './theme.ts';

vi.mock('./api.ts', () => ({ request: vi.fn() }));
const savedScene = sceneFixture({
  id: 'scene',
  title: 'Academy',
  location: 'Trial room',
  script: 'A saved script.',
  editToken: 'saved-scene',
  clips: [{ id: 'shot', production: { videoPrompt: 'Original prompt' } }]
});
const draftKey = () => `roxy-scene-board-${currentProjectKey()}-episode-scene`;
function editor(scene: Parameters<typeof sceneFixture>[0] = savedScene, onChanged = vi.fn()) {
  return (
    <ThemeProvider theme={theme}>
      <SceneBoardEditor
        episode={episodeFixture({ _id: 'episode' })}
        scene={sceneFixture(scene)}
        onChanged={onChanged}
      >
        {({
          draftScene,
          editClip,
          dirty,
          busy,
          saveError,
          pendingRefresh,
          refreshSaved,
          useSaved
        }) => (
          <>
            <input
              aria-label="Local video prompt"
              value={draftScene.clips[0].production.videoPrompt}
              onChange={(e) => editClip('shot', { production: { videoPrompt: e.target.value } })}
            />
            <output aria-label="Save error">{saveError}</output>
            <button disabled={dirty || busy} onClick={() => {}}>
              Generate video
            </button>
            {saveError && dirty && (
              <button onClick={useSaved}>Keep local draft and use saved scene</button>
            )}
            {pendingRefresh && <button onClick={refreshSaved}>Refresh saved scene</button>}
          </>
        )}
      </SceneBoardEditor>
    </ThemeProvider>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.mocked(request).mockReset();
});
afterEach(() => vi.restoreAllMocks());

test('scene fields and clip edits use the latest draft while preserving sibling clips', async () => {
  const scene = sceneFixture({
    ...savedScene,
    clips: [...savedScene.clips, { id: 'other', title: 'Unchanged' }]
  });
  localStorage.setItem(draftKey(), JSON.stringify({ editToken: scene.editToken, scene }));
  vi.mocked(request).mockResolvedValue({ message: 'Saved' });
  render(editor(scene));
  fireEvent.click(screen.getByText('Edit scene details'));
  for (const [label, value] of [
    ['Scene title', 'Revised title'],
    ['Scene location', 'Trial chamber'],
    ['Scene script', 'Saved dialogue.']
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.change(screen.getByLabelText('Local video prompt'), {
    target: { value: 'Keep the room fixed.' }
  });
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getAllByRole('button', { name: 'Save scene' })[0]);
  await screen.findByRole('status');
  expect(request).toHaveBeenCalledWith(
    '/studio/workflow/scene/save',
    expect.objectContaining({
      body: expect.objectContaining({
        scene: expect.objectContaining({
          title: 'Revised title',
          location: 'Trial chamber',
          script: 'Saved dialogue.',
          clips: [
            expect.objectContaining({ production: { videoPrompt: 'Keep the room fixed.' } }),
            expect.objectContaining({ id: 'other', title: 'Unchanged' })
          ]
        })
      })
    })
  );
});

test('unavailable storage keeps the scene editable and refuses to discard a draft without a recovery copy', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Full');
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  vi.mocked(request).mockRejectedValue(new Error('Save failed'));
  render(editor());
  fireEvent.change(screen.getByLabelText('Local video prompt'), {
    target: { value: 'My local scene' }
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Save scene' })[0]);
  await waitFor(() => expect(screen.getByLabelText('Save error')).toHaveTextContent('Save failed'));
  fireEvent.click(screen.getByText('Keep local draft and use saved scene'));
  expect(screen.getByLabelText('Save error')).toHaveTextContent(
    'Could not keep a recovery copy of your local draft. Your edits are still open.'
  );
  expect(screen.getByLabelText('Local video prompt')).toHaveValue('My local scene');
});

test('exposed save and use-saved callbacks tolerate clean drafts and repeated clicks while saving', async () => {
  let finish: (value: unknown) => void;
  vi.mocked(request).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(
    <SceneBoardEditor episode={episodeFixture()} scene={savedScene} onChanged={vi.fn()}>
      {({ save, useSaved, editClip }) => (
        <>
          <button onClick={save}>Toolbar save</button>
          <button onClick={useSaved}>Use saved</button>
          <button onClick={() => editClip('shot', { title: 'Edited shot' })}>Edit shot</button>
        </>
      )}
    </SceneBoardEditor>
  );
  fireEvent.click(screen.getByText('Toolbar save'));
  fireEvent.click(screen.getByText('Use saved'));
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Edit shot'));
  fireEvent.click(screen.getByText('Toolbar save'));
  fireEvent.click(screen.getByText('Toolbar save'));
  expect(request).toHaveBeenCalledOnce();
  await act(async () => finish({ message: 'Saved' }));
});

test('a cached draft matching saved inputs does not block generation after review receipts change', async () => {
  localStorage.setItem(
    draftKey(),
    JSON.stringify({
      editToken: 'older-token',
      scene: {
        ...savedScene,
        editToken: 'older-token',
        approvalStatus: 'needs-review' as const,
        clips: savedScene.clips.map((c) => ({ ...c, selectedTakeId: null }))
      }
    })
  );
  render(
    editor({
      ...savedScene,
      approvalStatus: 'approved' as const,
      clips: savedScene.clips.map((c) => ({ ...c, selectedTakeId: 'approved-take' }))
    })
  );
  expect(screen.getByRole('button', { name: 'Generate video' })).toBeEnabled();
  await waitFor(() => expect(localStorage.getItem(draftKey())).toBeNull());
  expect(request).not.toHaveBeenCalled();
});

test('a conflicting save retains edits and can keep a recovery copy while using the approved saved scene', async () => {
  const user = userEvent.setup();
  vi.mocked(request).mockRejectedValue(new Error('This scene was edited elsewhere.'));
  render(editor());
  fireEvent.change(screen.getByRole('textbox', { name: 'Local video prompt' }), {
    target: { value: 'My mobile draft.' }
  });
  await user.click(screen.getAllByRole('button', { name: 'Save scene' })[0]);
  expect(screen.getByLabelText('Save error')).toHaveTextContent('This scene was edited elsewhere.');
  expect(screen.getByRole('textbox', { name: 'Local video prompt' })).toHaveValue(
    'My mobile draft.'
  );
  await user.click(screen.getByRole('button', { name: 'Keep local draft and use saved scene' }));
  expect(screen.getByRole('button', { name: 'Generate video' })).toBeEnabled();
  expect(screen.getByRole('textbox', { name: 'Local video prompt' })).toHaveValue(
    'Original prompt'
  );
  expect(
    JSON.parse(localStorage.getItem(draftKey() + '-recovery')).draft.scene.clips[0].production
      .videoPrompt
  ).toBe('My mobile draft.');
  await user.click(screen.getByRole('button', { name: 'Restore local draft' }));
  expect(screen.getByRole('textbox', { name: 'Local video prompt' })).toHaveValue(
    'My mobile draft.'
  );
  expect(request).toHaveBeenCalledTimes(1);
});

test('an acknowledged save clears the draft even if refreshing fails and retries only the refresh', async () => {
  const user = userEvent.setup();
  const nextScene = {
    ...savedScene,
    editToken: 'new-token',
    clips: [{ id: 'shot', production: { videoPrompt: 'Saved mobile directions.' } }]
  };
  vi.mocked(request).mockResolvedValue({ scene: nextScene, message: 'Scene saved.' });
  const onChanged = vi
    .fn()
    .mockRejectedValueOnce(new Error('Network unavailable.'))
    .mockResolvedValueOnce({});
  const view = render(editor(savedScene, onChanged));
  fireEvent.change(screen.getByRole('textbox', { name: 'Local video prompt' }), {
    target: { value: 'Saved mobile directions.' }
  });
  await user.click(screen.getAllByRole('button', { name: 'Save scene' })[0]);
  expect(screen.getByLabelText('Save error')).toHaveTextContent(
    'The scene was saved, but its status could not refresh.'
  );
  expect(localStorage.getItem(draftKey())).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Local video prompt' })).toHaveValue(
    'Saved mobile directions.'
  );
  expect(screen.getByRole('button', { name: 'Generate video' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Refresh saved scene' }));
  view.rerender(editor(nextScene, onChanged));
  expect(screen.getByRole('button', { name: 'Generate video' })).toBeEnabled();
  expect(screen.getByLabelText('Save error')).toBeEmptyDOMElement();
  expect(request).toHaveBeenCalledTimes(1);
  expect(onChanged).toHaveBeenCalledTimes(2);
});
test('a prompt edit saves only its scene and remains editable while the draft is unsaved', async () => {
  const scene = sceneFixture({
    id: 'scene',
    title: 'Academy',
    location: 'Trial room',
    script: 'A saved script.',
    editToken: 'saved-scene',
    clips: [{ id: 'shot', production: { videoPrompt: 'Original prompt' } }]
  });
  const onChanged = vi.fn();
  vi.mocked(request).mockResolvedValue({ message: 'Scene saved without generation.' });
  render(
    <ThemeProvider theme={theme}>
      <SceneBoardEditor
        episode={episodeFixture({ _id: 'episode' })}
        scene={sceneFixture(scene)}
        onChanged={onChanged}
      >
        {({ draftScene, editClip, dirty }) => (
          <>
            <input
              aria-label="Video prompt"
              value={draftScene.clips[0].production.videoPrompt}
              onChange={(event) =>
                editClip('shot', { production: { videoPrompt: event.target.value } })
              }
            />
            {dirty && <span>Draft pending</span>}
          </>
        )}
      </SceneBoardEditor>
    </ThemeProvider>
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Video prompt' }), {
    target: { value: 'Corrected camera and staging.' }
  });
  expect(screen.getByText('Draft pending')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Video prompt' })).toBeEnabled();
  await userEvent.setup().click(screen.getAllByRole('button', { name: 'Save scene' })[0]);
  expect(request).toHaveBeenCalledExactlyOnceWith('/studio/workflow/scene/save', {
    method: 'POST',
    body: {
      target: { scope: 'scene' as const, recordId: 'episode', sceneId: 'scene' },
      editToken: 'saved-scene',
      scene: {
        ...scene,
        clips: [{ ...scene.clips[0], production: { videoPrompt: 'Corrected camera and staging.' } }]
      }
    }
  });
  expect(await screen.findByRole('status')).toHaveTextContent('Scene saved without generation.');
  expect(onChanged).toHaveBeenCalledOnce();
});

test('a parent refresh with the acknowledged edit token clears stale errors while the refresh promise settles', async () => {
  const nextScene = {
    ...savedScene,
    editToken: 'acknowledged',
    clips: [{ ...savedScene.clips[0], production: { videoPrompt: 'Updated' } }]
  };
  vi.mocked(request).mockResolvedValue({ scene: nextScene, message: 'Saved' });
  let finish: () => void;
  const onChanged = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const view = render(editor(savedScene, onChanged));
  fireEvent.change(screen.getByRole('textbox', { name: 'Local video prompt' }), {
    target: { value: 'Updated' }
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Save scene' })[0]);
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  view.rerender(editor(nextScene, onChanged));
  expect(screen.getByLabelText('Save error')).toBeEmptyDOMElement();
  expect(screen.getByRole('textbox', { name: 'Local video prompt' })).toHaveValue('Updated');
  await act(async () => finish());
});
