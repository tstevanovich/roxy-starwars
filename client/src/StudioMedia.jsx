import AudioFileOutlined from '@mui/icons-material/AudioFileOutlined';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import RocketLaunchOutlined from '@mui/icons-material/RocketLaunchOutlined';
import SmartToyOutlined from '@mui/icons-material/SmartToyOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useState } from 'react';

import { uploadMedia } from './api.js';
import RejectMediaButton from './RejectMediaButton.jsx';
import { mediaUrl } from './studio-utils.js';
export function ReferencePreview({ file, kind = 'image', compact = false }) {
  if (file?.kind === 'image')
    return (
      <Box
        component="img"
        className="reference-image"
        src={mediaUrl(file._id)}
        alt={file.originalName}
        loading="lazy"
      />
    );
  if (file?.kind === 'video')
    return (
      <Box
        component="video"
        aria-label={file.originalName}
        className="reference-video"
        src={mediaUrl(file._id)}
        controls
        playsInline
        preload="metadata"
      />
    );
  if (file?.kind === 'audio')
    return (
      <Box className="audio-preview">
        <AudioFileOutlined
          sx={{
            fontSize: 40
          }}
        />
        <Box
          component="audio"
          aria-label={file.originalName}
          src={mediaUrl(file._id)}
          controls
          preload="metadata"
          sx={{
            width: '100%',
            mt: 2
          }}
        />
      </Box>
    );
  const Icon =
    kind === 'ship'
      ? RocketLaunchOutlined
      : kind === 'droid'
        ? SmartToyOutlined
        : ['voice', 'sound'].includes(kind)
          ? AudioFileOutlined
          : ImageOutlined;
  return (
    <Box className={`reference-placeholder ${compact ? 'compact' : ''}`}>
      <Box className="reference-orbit" />
      <Icon
        sx={{
          fontSize: compact ? 36 : 56,
          opacity: 0.7
        }}
      />
      <Typography
        variant="caption"
        sx={{
          zIndex: 1
        }}
      >
        Reference pending
      </Typography>
    </Box>
  );
}
export function UploadButton({
  onUploaded,
  label = 'Upload reference',
  disabled = false,
  multiple = true,
  accept = '.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mp3,.wav,.m4a,.ogg',
  busyLabel = 'Saving local files…'
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function upload(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of files) await onUploaded(await uploadMedia(file));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={1}>
      <Button
        component="label"
        variant="outlined"
        startIcon={busy ? <CircularProgress size={18} /> : <CloudUploadOutlined />}
        disabled={busy || disabled}
      >
        {busy ? busyLabel : label}
        <input type="file" hidden multiple={multiple} accept={accept} onChange={upload} />
      </Button>
      {busy && (
        <Typography role="status" variant="body2">
          {busyLabel} Keep this page open until saving finishes.
        </Typography>
      )}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
export function MediaAttachments({
  ids,
  media,
  onChange,
  onUploaded,
  disabled,
  onRejected,
  rejectionContext,
  rejectionDisabled
}) {
  return (
    <Stack spacing={2}>
      <Stack
        direction={{
          xs: 'column',
          sm: 'row'
        }}
        spacing={1.5}
      >
        <UploadButton disabled={disabled} onUploaded={onUploaded} />
        <TextField
          select
          size="small"
          label="Attach saved media"
          value=""
          disabled={disabled}
          onChange={(e) => onChange([...new Set([...ids, e.target.value])])}
          sx={{
            minWidth: 200
          }}
        >
          <MenuItem value="">Choose a saved file</MenuItem>
          {media
            .filter((m) => !ids.includes(m._id))
            .map((m) => (
              <MenuItem key={m._id} value={m._id}>
                {m.originalName}
              </MenuItem>
            ))}
        </TextField>
      </Stack>
      {ids.map((id) => {
        const file = media.find((m) => m._id === id);
        return (
          <Box key={id} className="attachment">
            <ReferencePreview file={file} compact />
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
                p: 1.5,
                gap: 1
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  overflowWrap: 'anywhere'
                }}
              >
                {file?.originalName || 'Missing reference'}
              </Typography>
              <Button
                size="small"
                disabled={disabled}
                onClick={() => onChange(ids.filter((value) => value !== id))}
              >
                Detach
              </Button>
              {onRejected && file && ['image', 'video', 'audio'].includes(file.kind) && (
                <RejectMediaButton
                  file={file}
                  disabled={rejectionDisabled || disabled}
                  context={rejectionContext}
                  onRejected={onRejected}
                />
              )}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}
export default function MediaLibrary({ media, onMedia, onRejected }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const files = media.filter(
    (m) =>
      (filter === 'all' || m.kind === filter) &&
      m.originalName.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <Stack spacing={3}>
      <Stack
        direction={{
          xs: 'column',
          sm: 'row'
        }}
        sx={{
          justifyContent: 'space-between',
          gap: 2
        }}
      >
        <Box>
          <Typography variant="h1">Media library</Typography>
          <Typography
            color="text.secondary"
            sx={{
              mt: 1
            }}
          >
            Your original images, footage, and voice auditions. Stored on this computer.
          </Typography>
        </Box>
        <UploadButton label="Import local media" onUploaded={onMedia} />
      </Stack>
      <Stack
        direction="row"
        sx={{
          gap: 1,
          flexWrap: 'wrap'
        }}
      >
        {['all', 'image', 'video', 'audio'].map((value) => (
          <Chip
            key={value}
            label={value === 'all' ? 'All files' : `${value[0].toUpperCase()}${value.slice(1)}`}
            onClick={() => setFilter(value)}
            color={filter === value ? 'primary' : 'default'}
          />
        ))}
      </Stack>
      <TextField
        label="Search filenames"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        size="small"
      />
      <Box className="media-grid">
        {files.map((file) => (
          <Box className="media-card" key={file._id}>
            <ReferencePreview file={file} />
            <Box
              sx={{
                p: 2
              }}
            >
              <Typography
                sx={{
                  fontWeight: 600,
                  overflowWrap: 'anywhere'
                }}
              >
                {file.originalName}
              </Typography>
              <Stack
                direction="row"
                sx={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  mt: 1
                }}
              >
                <Typography variant="caption">
                  {file.kind} · {(file.bytes / 1048576).toFixed(1)} MB
                </Typography>
                <Button
                  component="a"
                  href={`${mediaUrl(file._id)}${mediaUrl(file._id).includes('?') ? '&' : '?'}download=1`}
                  size="small"
                >
                  Download original
                </Button>
                {['image', 'video', 'audio'].includes(file.kind) && (
                  <RejectMediaButton file={file} onRejected={onRejected} />
                )}
              </Stack>
            </Box>
          </Box>
        ))}
      </Box>
      {!files.length && (
        <Box className="empty-state">
          <ImageOutlined
            sx={{
              fontSize: 40
            }}
          />
          <Typography variant="h3">Make room for your references.</Typography>
          <Typography color="text.secondary">
            Import a character sheet, concept image, video take, or voice audition to start.
          </Typography>
        </Box>
      )}
      <Typography variant="caption" color="text.secondary">
        Up to 250 MB per file. Detaching a reference keeps the original in this library.
      </Typography>
    </Stack>
  );
}
