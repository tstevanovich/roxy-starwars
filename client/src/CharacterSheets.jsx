import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useState } from 'react';

import { request } from './api.js';
import { ReferencePreview, UploadButton } from './StudioMedia.jsx';

const characterViews = {
  front: 'Front',
  'three-quarter': 'Three-quarter',
  side: 'Side',
  rear: 'Rear',
  face: 'Face detail'
};
const propViews = {
  front: 'Front',
  'three-quarter': 'Three-quarter',
  side: 'Side',
  'opposite-side': 'Opposite side',
  top: 'Top',
  rear: 'Rear',
  detail: 'Detail'
};

export default function CharacterSheets({
  asset,
  media,
  disabled,
  draftPending = false,
  onSaved,
  onMedia,
  onBusy
}) {
  const isProp = asset.kind === 'prop';
  const sheetName = isProp ? 'prop sheet' : 'character sheet';
  const views = isProp ? propViews : characterViews;
  const expectedViews = isProp
    ? ['side', 'opposite-side', 'top', 'rear', 'detail']
    : Object.keys(views);
  const [title, setTitle] = useState(`${asset.name} ${sheetName}`);
  const [mediaId, setMediaId] = useState('');
  const [selectedViews, setSelectedViews] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = disabled || busy;
  const registrationLocked = locked || draftPending;
  async function persist(sheetId) {
    setBusy(true);
    onBusy?.(true);
    setError('');
    setNotice('');
    try {
      const { asset: next } = await request(
        `/studio/assets/${asset._id}/character-sheets${sheetId ? `/${sheetId}/approve` : ''}`,
        {
          method: 'POST',
          body: sheetId
            ? { revision: asset.revision }
            : { revision: asset.revision, title, mediaId, views: selectedViews }
        }
      );
      onSaved(next);
      if (!sheetId) {
        setMediaId('');
        setSelectedViews([]);
      }
      setNotice(
        sheetId
          ? `${isProp ? 'Prop' : 'Character'} sheet approved for reuse.`
          : `${isProp ? 'Prop' : 'Character'} sheet saved for review.`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <Box className="editor-panel">
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h2">{isProp ? 'Prop sheets' : 'Character sheets'}</Typography>
          <Typography color="text.secondary">
            {isProp
              ? 'Every prop uses a reusable reference sheet. Establish both sides, top, rear, and a detail view; add front and three-quarter views when useful. Keep proportions, markings, materials, and attachments consistent.'
              : 'Every character and droid uses a reusable character sheet: front, three-quarter, side, rear, and face detail. Keep proportions, markings, and features consistent. Episode outfits have their own references.'}
          </Typography>
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        {[...(asset.characterSheets ?? [])]
          .sort((a, b) => Number(Boolean(a.approvedAt)) - Number(Boolean(b.approvedAt)))
          .map((sheet) => {
            const current =
              asset.finalChoice &&
              sheet.sourceCandidateId === asset.finalChoice.id &&
              new Date(sheet.sourceFinalizedAt).getTime() ===
                new Date(asset.finalChoice.finalizedAt).getTime();
            const file = media.find((file) => file._id === sheet.mediaId);
            return (
              <Box key={sheet.id} className="attachment">
                <ReferencePreview file={file} />
                <Stack spacing={1.5} sx={{ p: 2 }}>
                  <Typography variant="h3">{sheet.title}</Typography>
                  <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                    <Chip
                      label={
                        !current
                          ? isProp
                            ? 'Previous design'
                            : 'Previous identity'
                          : sheet.approvedAt
                            ? 'Approved sheet'
                            : 'Awaiting review'
                      }
                      color={current && sheet.approvedAt ? 'success' : 'default'}
                    />
                    {sheet.views.map((view) => (
                      <Chip key={view} label={views[view] || view} variant="outlined" />
                    ))}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {expectedViews.filter((view) => !sheet.views.includes(view)).length
                      ? `Additional views to establish: ${expectedViews
                          .filter((view) => !sheet.views.includes(view))
                          .map((view) => views[view])
                          .join(', ')}.`
                      : 'Review the covered views before approving this sheet.'}
                  </Typography>
                  {current && !sheet.approvedAt && draftPending && (
                    <Alert severity="info">
                      You can approve this saved sheet now. Your unsaved asset changes will be kept.
                    </Alert>
                  )}
                  {!current && (
                    <Typography variant="body2" color="text.secondary">
                      This sheet belongs to a previous finalized design. Add a sheet for the current
                      design before approving it.
                    </Typography>
                  )}
                  {locked && current && !sheet.approvedAt && (
                    <Typography variant="body2" role="status">
                      A save is in progress. Approval will be available when it finishes.
                    </Typography>
                  )}
                  <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                    <Button
                      variant="contained"
                      disabled={locked || !current || Boolean(sheet.approvedAt)}
                      onClick={() => persist(sheet.id)}
                    >
                      Approve {sheetName}
                    </Button>
                    {file && (
                      <Button component="a" href={`${file.url}?download=1`}>
                        Download sheet
                      </Button>
                    )}
                  </Stack>
                </Stack>
              </Box>
            );
          })}
        {!asset.finalChoice ? (
          <Alert severity="info">
            {isProp
              ? 'Finalize the prop’s design before adding its prop sheet.'
              : 'Finalize the character’s identity before adding its character sheet.'}
          </Alert>
        ) : (
          <>
            {draftPending && (
              <Alert severity="info">
                Save your asset draft before adding a {sheetName}. Saved sheets above can still be
                approved.
              </Alert>
            )}
            <Typography variant="h3">Add a sheet for review</Typography>
            <TextField
              label="Sheet title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={registrationLocked}
            />
            <TextField
              select
              label="Saved sheet image"
              value={mediaId}
              onChange={(e) => setMediaId(e.target.value)}
              disabled={registrationLocked}
            >
              <MenuItem value="">Choose an image</MenuItem>
              {media
                .filter((file) => file.kind === 'image')
                .map((file) => (
                  <MenuItem key={file._id} value={file._id}>
                    {file.originalName}
                  </MenuItem>
                ))}
            </TextField>
            <UploadButton
              label={`Upload ${sheetName}`}
              disabled={registrationLocked}
              onUploaded={(file) => {
                onMedia(file);
                if (file.kind === 'image') {
                  setMediaId(file._id);
                  setError('');
                } else setError(`Choose an image for the ${sheetName}.`);
              }}
            />
            <Typography variant="body2">
              Select only the views actually visible in the sheet:
            </Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
              {Object.entries(views).map(([value, label]) => (
                <FormControlLabel
                  key={value}
                  label={label}
                  control={
                    <Checkbox
                      disabled={registrationLocked}
                      checked={selectedViews.includes(value)}
                      onChange={(e) =>
                        setSelectedViews(
                          e.target.checked
                            ? [...selectedViews, value]
                            : selectedViews.filter((view) => view !== value)
                        )
                      }
                    />
                  }
                />
              ))}
            </Stack>
            <Button
              sx={{ alignSelf: 'flex-start' }}
              variant="outlined"
              disabled={registrationLocked || !mediaId || !title.trim() || !selectedViews.length}
              onClick={() => persist()}
            >
              Save {sheetName}
            </Button>
          </>
        )}
      </Stack>
    </Box>
  );
}
