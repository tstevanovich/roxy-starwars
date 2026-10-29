import { Alert, Button, Stack, Typography } from '@mui/material';
import { useState } from 'react';

import { reviewHref } from './review-navigation.js';
import { ReferencePreview, UploadButton } from './StudioMedia.jsx';

export default function UpscaleImport({
  clip,
  media,
  episodeId,
  sceneId,
  disabled,
  onImport,
  review,
  showReviewLink = false
}) {
  const [receipt, setReceipt] = useState(null);
  const p = clip.production ?? {};
  const importedAt = receipt?.importedAt ?? clip.upscale?.importedAt;
  const mediaId = receipt?.mediaId ?? p.upscaleMediaId;
  const file = media.find((m) => m._id === mediaId);
  const currentSource = (receipt?.sourceTakeId ?? p.upscaleSourceTakeId) === clip.selectedTakeId;
  const savedFile = file?.kind === 'video' && currentSource;
  const approved =
    savedFile &&
    (review ?? clip.upscaleReview)?.status === 'approved' &&
    mediaId === p.upscaleMediaId;
  const target = { scope: 'clip', recordId: episodeId, sceneId, clipId: clip.id };
  return (
    <Stack component="section" aria-label={`1440p upscale: ${clip.title}`} spacing={1}>
      <Typography variant="h3">1440p upscale</Typography>
      <Alert
        severity={
          approved ? 'success' : mediaId && !savedFile ? 'warning' : savedFile ? 'info' : 'warning'
        }
        role="status"
      >
        <Typography fontWeight={600}>
          {approved
            ? '1440p upscale approved'
            : savedFile
              ? 'Upscale file saved — quality approval pending'
              : mediaId
                ? 'Upscale file missing or belongs to an older take'
                : 'No upscale imported for this clip'}
        </Typography>
        {savedFile && <Typography variant="body2">Saved file: {file.originalName}</Typography>}
        {savedFile && clip.upscale?.verified && (
          <Typography variant="body2">
            Verified: {clip.upscale.verified.width} × {clip.upscale.verified.height} ·{' '}
            {Number(clip.upscale.verified.duration).toFixed(2)} seconds · audio track present
          </Typography>
        )}
        {importedAt && savedFile && (
          <Typography variant="body2">
            Saved {new Date(importedAt).toLocaleString()}. The clip link is saved; no episode save
            is required.
          </Typography>
        )}
        {!mediaId && (
          <Typography variant="body2">
            Complete the upscale in OpenArt, download it, then import the 2560 × 1440 video with its
            soundtrack here.
          </Typography>
        )}
      </Alert>
      {!clip.selectedTakeId && (
        <Button component="a" href={reviewHref(target, 'visual', episodeId)}>
          Go to picture and sound approval first
        </Button>
      )}
      <UploadButton
        label={savedFile ? 'Replace upscale file' : 'Import 1440p video file'}
        multiple={false}
        accept=".mp4,.webm"
        busyLabel="Uploading, validating and saving upscale…"
        disabled={disabled || !clip.selectedTakeId || !onImport}
        onUploaded={async (file) => {
          if (file.kind !== 'video') throw new Error('Choose a video file for the upscale.');
          const result = await onImport(sceneId, clip.id, file);
          setReceipt({
            mediaId: file._id,
            sourceTakeId: clip.selectedTakeId,
            importedAt: result.importedAt
          });
        }}
      />
      {disabled && (
        <Typography variant="body2">
          Save your episode edits before importing or reviewing an upscale.
        </Typography>
      )}
      {savedFile && <ReferencePreview file={file} />}
      {showReviewLink && savedFile && !approved && (
        <Button component="a" href={reviewHref(target, 'upscale', episodeId)}>
          Go to 1440p quality approval
        </Button>
      )}
    </Stack>
  );
}
