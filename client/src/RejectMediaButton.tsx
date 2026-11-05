import AutoDeleteOutlined from '@mui/icons-material/AutoDeleteOutlined';
import { Alert, Button, Stack } from '@mui/material';
import { useState } from 'react';

import { toError } from '../../shared/errors.ts';
import type * as Studio from '../../shared/types.ts';
import { request } from './api.ts';
export default function RejectMediaButton({
  file,
  context = {},
  disabled = false,
  onRejected
}: {
  file?: Pick<Studio.MediaFile, '_id' | 'kind'> & Partial<Studio.MediaFile>;
  context?: Studio.ChatContext;
  disabled?: boolean;
  onRejected?: (result: Studio.RejectionResult) => void | Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function reject() {
    setBusy(true);
    setError('');
    try {
      const result = await request<Studio.RejectionResult>(`/studio/media/${file._id}`, {
        method: 'DELETE',
        body: context
      });
      await onRejected?.(result);
    } catch (caughtError) {
      const e = toError(caughtError);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={1}>
      <Button
        color="error"
        startIcon={<AutoDeleteOutlined />}
        disabled={disabled || busy || !file}
        onClick={reject}
      >
        {busy ? 'Deleting…' : 'Reject & delete'}
      </Button>
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
