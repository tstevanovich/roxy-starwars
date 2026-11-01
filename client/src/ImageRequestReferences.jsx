import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { Autocomplete, TextField } from '@mui/material';

import { focusSection } from './review-navigation.js';
import { mediaUrl } from './studio-utils.js';
import { ReferencePreview } from './StudioMedia.jsx';

export default function ImageRequestReferences({
  references,
  media = [],
  sceneDirty = false,
  onInsertReference,
  onChangeReferences
}) {
  if (!references) return null;
  return (
    <Stack component="section" aria-label="Images attached to this request" spacing={1}>
      <Typography variant="h3">
        Images attached to this request ({references.items.length}/16)
      </Typography>
      <Typography variant="body2">
        These images will be sent in this order. Their @image tags identify them in the complete
        prompt below. Include only the views needed for this image.
      </Typography>
      {sceneDirty && (
        <Typography variant="body2">
          This preview includes your unsaved edits. Save before generating. Reference numbers and
          prompt tags update as you add, remove or reorder images.
        </Typography>
      )}
      {!references.items.length && (
        <Typography>No reference images are attached to this request.</Typography>
      )}
      {onChangeReferences && (
        <>
          <Autocomplete
            value={null}
            options={(references.choices ?? references.omittedItems ?? []).filter(
              (item) => !references.selected.includes(item.mediaId)
            )}
            getOptionLabel={(item) =>
              [item.title, item.view, item.filename].filter(Boolean).join(' - ')
            }
            getOptionKey={(item) => item.mediaId}
            disabled={references.items.length >= 16}
            onChange={(_event, item) => {
              if (item) onChangeReferences([...references.selected, item.mediaId]);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Add image reference"
                helperText="Search saved images by character, set, view or filename. Up to 16 images per request."
              />
            )}
            renderOption={(props, item) => {
              const { key, ...rest } = props;
              return (
                <Box component="li" key={key} {...rest} sx={{ gap: 1 }}>
                  <Box
                    component="img"
                    src={mediaUrl(item.mediaId)}
                    alt=""
                    sx={{ width: 64, height: 48, objectFit: 'contain' }}
                  />
                  <span>{[item.title, item.view, item.filename].filter(Boolean).join(' - ')}</span>
                </Box>
              );
            }}
          />
          <Button disabled={!references.selected.length} onClick={() => onChangeReferences([])}>
            Remove all references
          </Button>
          <Button
            disabled={
              !references.items.some((item) =>
                ['Character identity', 'Droid design'].includes(item.role)
              )
            }
            onClick={() => {
              const seen = new Set();
              const characters = references.items.filter((item) =>
                ['Character identity', 'Droid design'].includes(item.role)
              );
              onChangeReferences(
                characters
                  .filter((item) => {
                    const key = item.assetId || item.subject || item.mediaId;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                  })
                  .map(
                    (item) =>
                      (references.choices ?? []).find(
                        (choice) =>
                          choice.assetId === item.assetId &&
                          /body turnaround/i.test(choice.view ?? '')
                      )?.mediaId ?? item.mediaId
                  )
              );
            }}
          >
            Character sheets only
          </Button>
        </>
      )}
      <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap' }}>
        {references.items.map((reference) => {
          const file = media.find((file) => String(file._id) === reference.mediaId);
          return (
            <Stack
              key={reference.mediaId}
              component="article"
              aria-label={`Image ${reference.imageNumber}: ${reference.title}`}
              spacing={1}
              sx={{
                width: 220,
                maxWidth: '100%',
                p: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1
              }}
            >
              <Typography fontWeight={600}>
                Image {reference.imageNumber} - {reference.role}
              </Typography>
              <Box sx={{ '& img': { width: '100%', height: 140, objectFit: 'contain' } }}>
                {file?.kind === 'image' ? (
                  <ReferencePreview file={file} />
                ) : (
                  <Alert severity="warning">
                    {file
                      ? 'This reference is not an image.'
                      : 'This reference file is unavailable.'}
                  </Alert>
                )}
              </Box>
              <Typography variant="body2" fontWeight={600}>
                {reference.title}
              </Typography>
              {reference.view && <Typography variant="caption">{reference.view}</Typography>}
              {reference.filename && (
                <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
                  {reference.filename}
                </Typography>
              )}
              {reference.sourceType === 'approved-shot-image' && (
                <Typography variant="caption">
                  Earlier shot's saved still. Its video is not attached; video end frames are not
                  extracted automatically.
                </Typography>
              )}
              <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                {onChangeReferences && (
                  <>
                    <Button
                      size="small"
                      aria-label={`Remove image ${reference.imageNumber}`}
                      onClick={() =>
                        onChangeReferences(
                          references.selected.filter((id) => id !== reference.mediaId)
                        )
                      }
                    >
                      Remove
                    </Button>
                    <Button
                      size="small"
                      aria-label={`Move image ${reference.imageNumber} earlier`}
                      disabled={reference.imageNumber === 1}
                      onClick={() => {
                        const ids = [...references.selected];
                        const index = reference.imageNumber - 1;
                        [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                        onChangeReferences(ids);
                      }}
                    >
                      Earlier
                    </Button>
                    <Button
                      size="small"
                      aria-label={`Move image ${reference.imageNumber} later`}
                      disabled={reference.imageNumber === references.items.length}
                      onClick={() => {
                        const ids = [...references.selected];
                        const index = reference.imageNumber - 1;
                        [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]];
                        onChangeReferences(ids);
                      }}
                    >
                      Later
                    </Button>
                  </>
                )}
                {onInsertReference && (
                  <Button
                    size="small"
                    onClick={() => onInsertReference(`@image${reference.imageNumber}`)}
                  >
                    Insert @image{reference.imageNumber}
                  </Button>
                )}
                {file && (
                  <Button
                    size="small"
                    component="a"
                    href={mediaUrl(reference.mediaId)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View image {reference.imageNumber}
                  </Button>
                )}
                {reference.sourceClipId && (
                  <Button
                    size="small"
                    component="a"
                    href={'#picture-prerequisites-' + reference.sourceClipId}
                    onClick={() => focusSection('picture-prerequisites-' + reference.sourceClipId)}
                  >
                    Review source shot
                  </Button>
                )}
              </Stack>
            </Stack>
          );
        })}
      </Stack>
      {references.omitted?.length > 0 && (
        <Alert severity="info">
          The 16-image limit excludes {references.omitted.length} additional reference(s).
          <Box component="details">
            <Typography component="summary" sx={{ cursor: 'pointer' }}>
              Show excluded references
            </Typography>
            {references.omittedItems?.map((reference) => (
              <Typography key={reference.mediaId} variant="body2">
                {reference.title}
                {reference.view ? ' - ' + reference.view : ''}
              </Typography>
            ))}
          </Box>
        </Alert>
      )}
    </Stack>
  );
}
