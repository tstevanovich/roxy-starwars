import AutoDeleteOutlined from '@mui/icons-material/AutoDeleteOutlined';
import { Alert, Button, Stack } from '@mui/material';
import { useState } from 'react';

import { request } from './api.js';
export default function RejectMediaButton({ file, context = {}, disabled = false, onRejected }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function reject() {
    setBusy(true);
    setError('');
    try {
      const result = await request(`/studio/media/${file._id}`, {
        method: 'DELETE',
        body: context
      });
      await onRejected?.(result);
    } catch (e) {
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
