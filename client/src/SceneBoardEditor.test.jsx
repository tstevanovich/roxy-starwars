import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.js';
import SceneBoardEditor from './SceneBoardEditor.jsx';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn() }));
beforeEach(() => {
  localStorage.clear();
  vi.mocked(request).mockReset();
});
test('a prompt edit saves only its scene and remains editable while the draft is unsaved', async () => {
  const scene = {
    id: 'scene',
    title: 'Academy',
    location: 'Trial room',
    script: 'A saved script.',
    editToken: 'saved-scene',
    clips: [{ id: 'shot', production: { videoPrompt: 'Original prompt' } }]
  };
  const onChanged = vi.fn();
  vi.mocked(request).mockResolvedValue({ message: 'Scene saved without generation.' });
  render(
    <ThemeProvider theme={theme}>
      <SceneBoardEditor episode={{ _id: 'episode' }} scene={scene} onChanged={onChanged}>
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
      target: { scope: 'scene', recordId: 'episode', sceneId: 'scene' },
      editToken: 'saved-scene',
      scene: {
        ...scene,
        clips: [{ id: 'shot', production: { videoPrompt: 'Corrected camera and staging.' } }]
      }
    }
  });
  expect(await screen.findByRole('status')).toHaveTextContent('Scene saved without generation.');
  expect(onChanged).toHaveBeenCalledOnce();
});
