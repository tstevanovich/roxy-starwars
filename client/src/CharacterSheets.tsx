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

import { characterPackageLayout, turnaroundViews } from '../../shared/character-package.ts';
import { toError } from '../../shared/errors.ts';
import type * as Studio from '../../shared/types.ts';
import { request } from './api.ts';
import {
  assetFinalizationAnchor,
  assetImageGenerationAnchor,
  assetReferenceSetupAnchor,
  focusSection,
  reviewAnchor
} from './review-navigation.ts';
import { mediaUrl } from './studio-utils.ts';
import { ReferencePreview, UploadButton } from './StudioMedia.tsx';

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
}: {
  asset: Studio.Asset;
  media: Studio.MediaFile[];
  disabled?: boolean;
  draftPending?: boolean;
  onSaved: (record: Studio.Asset) => void | Promise<unknown>;
  onMedia?: (file: Studio.MediaFile) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const isProp = asset.kind === 'prop';
  const sheetName = isProp ? 'prop sheet' : 'character sheet';
  const packageWorkflow = !isProp && asset.sheetLayout === characterPackageLayout;
  const turnaround = asset.production?.items?.find((item) => item.id === 'body-turnaround');
  const nextStep = packageWorkflow
    ? !turnaround
      ? {
          anchor: assetReferenceSetupAnchor(asset._id),
          label: 'Go to reference setup',
          message:
            'This package has no body turnaround yet. Add the remaining reference views, then generate and approve the body turnaround to finalize this character reference.'
        }
      : !turnaround.mediaId
        ? {
            anchor: assetImageGenerationAnchor(asset._id, 'body-turnaround'),
            label: 'Go to body turnaround',
            message:
              'Generate the body turnaround from its image prompt, then review and approve the result to finalize this character reference.'
          }
        : {
            anchor: reviewAnchor(
              { scope: 'asset' as const, recordId: asset._id },
              'reference:body-turnaround'
            ),
            label: 'Review body turnaround',
            message:
              'Review and approve the generated body turnaround to finalize this character reference. Its approval saves the reusable character sheet.'
          }
    : {
        anchor: assetFinalizationAnchor(asset._id),
        label: 'Go to finalization',
        message: `Choose a ${isProp ? 'prop' : 'character'} reference in Compare your options and press Finalize this option before adding its ${sheetName}.`
      };

  const views = isProp ? propViews : characterViews;
  const expectedViews = isProp
    ? ['side', 'opposite-side', 'top', 'rear', 'detail']
    : turnaroundViews;
  const [title, setTitle] = useState(`${asset.name} ${sheetName}`);
  const [mediaId, setMediaId] = useState('');
  const [selectedViews, setSelectedViews] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = disabled || busy;
  const registrationLocked = locked || draftPending;
  async function persist(sheetId?) {
    setBusy(true);
    onBusy?.(true);
    setError('');
    setNotice('');
    try {
      const { asset: next } = await request<{ asset: Studio.Asset; message?: string }>(
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
    } catch (caughtError) {
      const e = toError(caughtError);
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
              : 'Body turnaround: front, three-quarter, profile and rear full-body views, with heads and feet visible. Use one character and one outfit. Review the master portrait, expressions, costume, written identity and separate useful views individually in the reference package.'}
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
                      <Button
                        component="a"
                        href={`${mediaUrl(file._id)}${mediaUrl(file._id).includes('?') ? '&' : '?'}download=1`}
                      >
                        Download sheet
                      </Button>
                    )}
                  </Stack>
                </Stack>
              </Box>
            );
          })}
        {!asset.finalChoice ? (
          <Alert
            severity="info"
            action={
              <Button
                component="a"
                color="inherit"
                href={'#' + nextStep.anchor}
                onClick={() => focusSection(nextStep.anchor)}
              >
                {nextStep.label}
              </Button>
            }
          >
            {nextStep.message}
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
                onMedia?.(file);
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
