import { Alert, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';

import type * as Studio from '../../shared/types.ts';
import { request } from './api.ts';
import { UploadButton } from './StudioMedia.tsx';
export default function SourceVideoImport({
  episodeId,
  sourceId,
  disabled,
  onMedia
}: {
  episodeId?: string;
  sourceId?: string;
  disabled?: boolean;
  onMedia: (file: Studio.MediaFile) => void;
}) {
  const [start, setStart] = useState('0:00'),
    [notice, setNotice] = useState('');
  return (
    <Stack spacing={1}>
      <Typography variant="body2">
        Optional local source copy. Chat reuses saved footage or retrieves a short YouTube segment
        automatically. Attach a copy here if source access is unavailable.
      </Typography>
      <TextField
        label="Original-video timestamp of this file’s first frame"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        disabled={disabled}
        helperText="Use 0:00 for the complete original video. For a trimmed chapter, enter its original start, such as 16:47.160."
      />
      <UploadButton
        label="Attach gameplay source video"
        accept=".mp4,.webm"
        multiple={false}
        disabled={disabled}
        busyLabel="Saving and verifying source-video mapping…"
        onUploaded={async (file) => {
          onMedia?.(file);
          setNotice('');
          const result = await request<Studio.ActionResult>('/studio/assistant/source-video', {
            method: 'POST',
            body: { episodeId, sourceId, mediaId: file._id, originalStartTime: start }
          });
          onMedia?.(result.media);
          setNotice(`${file.originalName}: ${result.message}`);
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
