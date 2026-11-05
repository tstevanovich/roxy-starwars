import { Alert, Stack } from '@mui/material';
import { useState } from 'react';

import type * as Studio from '../../shared/types.ts';
import { request } from './api.ts';
import { UploadButton } from './StudioMedia.tsx';

export default function NativeVideoImport({
  episode,
  scene,
  clip,
  disabled,
  onSaved,
  onMedia
}: {
  episode: Studio.Episode;
  scene: Studio.Scene;
  clip: Studio.Clip;
  disabled?: boolean;
  onSaved: (record: Studio.Episode) => void | Promise<unknown>;
  onMedia: (file: Studio.MediaFile) => void;
}) {
  const [notice, setNotice] = useState('');
  return (
    <Stack spacing={1}>
      <UploadButton
        label="Import native 1080p video"
        multiple={false}
        accept=".mp4,.webm"
        disabled={disabled}
        busyLabel="Importing and verifying 1080p video…"
        onUploaded={async (file) => {
          onMedia?.(file);
          setNotice('');
          const result = await request<Studio.ActionResult>('/studio/workflow/video/import', {
            method: 'POST',
            body: {
              target: {
                scope: 'clip' as const,
                recordId: episode._id,
                sceneId: scene.id,
                clipId: clip.id
              },
              parentRevision: episode.revision,
              mediaId: file._id
            }
          });
          onMedia?.(result.media);
          onSaved(result.episode);
          setNotice(result.message);
        }}
      />
      {notice && (
        <Alert severity="success" role="status">
          {notice}
        </Alert>
      )}
    </Stack>
  );
}
