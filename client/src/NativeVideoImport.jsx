import { Alert, Stack } from '@mui/material';
import { useState } from 'react';

import { request } from './api.js';
import { UploadButton } from './StudioMedia.jsx';

export default function NativeVideoImport({ episode, scene, clip, disabled, onSaved, onMedia }) {
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
          const result = await request('/studio/workflow/video/import', {
            method: 'POST',
            body: {
              target: { scope: 'clip', recordId: episode._id, sceneId: scene.id, clipId: clip.id },
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
