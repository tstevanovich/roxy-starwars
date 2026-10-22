import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { useState } from 'react';

import { request } from './api.js';
import RejectMediaButton from './RejectMediaButton.jsx';
import { ReferencePreview } from './StudioMedia.jsx';

export default function ShotImageReview({ asset, media, onSaved, onRejected, onBack, onChat }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choices = asset.candidates.filter((candidate) => !candidate.archived);
  async function approve(candidateId, reopen = false) {
    setBusy(true);
    setError('');
    try {
      const { asset: next } = await request(
        `/studio/assets/${asset._id}/${reopen ? 'reopen' : 'finalize'}`,
        {
          method: 'POST',
          body: { revision: asset.revision, candidateId }
        }
      );
      onSaved(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack component="section" aria-label={`Image review: ${asset.name}`} spacing={2}>
      {onBack && (
        <Button startIcon={<ArrowBackOutlined />} onClick={onBack} sx={{ alignSelf: 'flex-start' }}>
          Creative library
        </Button>
      )}
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Typography variant={onBack ? 'h1' : 'h3'}>{asset.name}</Typography>
        <Chip
          label={
            asset.finalChoice
              ? 'Image approved'
              : choices.length
                ? 'Pending choice'
                : 'Needs a new image'
          }
          color={asset.finalChoice ? 'success' : choices.length ? 'warning' : 'default'}
        />
      </Stack>
      <Typography color="text.secondary">{asset.brief}</Typography>
      {onChat && (
        <Button
          sx={{ alignSelf: 'flex-start' }}
          onClick={() =>
            onChat({
              assetId: asset._id,
              episodeId: asset.episodeId,
              sceneId: asset.sceneId,
              clipId: asset.clipId
            })
          }
        >
          Discuss in chat
        </Button>
      )}
      <Typography variant="body2">
        {choices.length > 1
          ? 'Choose one image for this clip. Each alternative is reviewed separately.'
          : 'Approve or reject this image for this clip.'}{' '}
        Video generation waits for your image approval.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {choices.map((candidate) => {
        const file = media.find(
          (item) => item._id === candidate.mediaIds[0] && item.kind === 'image'
        );
        const approved = asset.finalChoice?.id === candidate.id;
        return (
          <Box
            component="article"
            aria-label={candidate.title}
            className="attachment"
            key={candidate.id}
          >
            <ReferencePreview file={file} />
            <Stack spacing={2} sx={{ p: 2 }}>
              <Typography variant="h3">{candidate.title}</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                {candidate.description}
              </Typography>
              {candidate.mediaIds.length !== 1 && (
                <Alert severity="error">
                  This option must contain one image. Split other images into separate choices.
                </Alert>
              )}
              <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  disabled={busy || approved || !file || candidate.mediaIds.length !== 1}
                  onClick={() => approve(candidate.id)}
                >
                  {approved ? 'Image approved' : 'Approve image'}
                </Button>
                {approved && (
                  <Button disabled={busy} onClick={() => approve(candidate.id, true)}>
                    Un-finalize
                  </Button>
                )}
                {file && (
                  <RejectMediaButton
                    file={file}
                    disabled={busy}
                    context={{
                      assetId: asset._id,
                      revision: asset.revision,
                      candidateId: candidate.id
                    }}
                    onRejected={onRejected}
                  />
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Reject & delete permanently removes the studio’s stored file and this image choice.
              </Typography>
            </Stack>
          </Box>
        );
      })}
      {!choices.length && (
        <Alert severity="info">
          No image to approve yet. A replacement image must be reviewed here before video
          generation.
        </Alert>
      )}
    </Stack>
  );
}
