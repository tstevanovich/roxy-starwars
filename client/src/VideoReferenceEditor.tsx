import { Autocomplete, Button, Chip, Stack, TextField, Typography } from '@mui/material';

import type * as Studio from '../../shared/types.ts';
import { ReferencePreview } from './StudioMedia.tsx';

export default function VideoReferenceEditor({
  references,
  selection,
  choices,
  media,
  disabled,
  dirty,
  onChange,
  onSave
}: {
  references: Studio.VideoReference[];
  selection?: string[];
  choices: Studio.VideoReference[];
  media: Studio.MediaFile[];
  disabled?: boolean;
  dirty?: boolean;
  onChange: (ids: string[]) => void;
  onSave?: () => void | Promise<unknown>;
}) {
  const selected = selection ?? references.map((reference) => reference.mediaId);
  return (
    <Stack component="section" aria-label="Video identity references" spacing={1}>
      <Typography sx={{ fontWeight: 600 }}>
        Video identity references ({references.length}/9)
      </Typography>
      <Typography variant="body2">
        Image 1 is this shot's approved composition. Add or remove character identity images here;
        these are separate from the image-generation attachments. The selected dialogue remains
        Audio 1.
      </Typography>
      {selection === undefined && (
        <Typography variant="body2">
          Automatic identities include characters named in the video directions and selected for
          this shot's image. Explicit exclusions are respected. Use these controls to save your own
          video selection.
        </Typography>
      )}
      {selected.length !== references.length && (
        <Typography color="warning.main">
          Some saved video references are unavailable. Remove all video identity references, then
          choose current approved images.
        </Typography>
      )}
      <Autocomplete
        value={null}
        disableClearable
        options={choices.filter((choice) => !selected.includes(choice.mediaId))}
        getOptionLabel={(choice) => choice.title}
        getOptionKey={(choice) => choice.mediaId}
        disabled={disabled || references.length >= 9}
        onChange={(_event, choice) => {
          onChange([...selected, choice.mediaId]);
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Add video character reference"
            helperText="Choose an approved character identity. Tags update with the attachment order."
          />
        )}
      />
      <Stack direction="row" spacing={1}>
        <Button disabled={disabled || !selected.length} onClick={() => onChange([])}>
          Remove all video identity references
        </Button>
        <Button disabled={disabled || !dirty} onClick={onSave}>
          Save video references
        </Button>
      </Stack>
      {dirty && (
        <Typography variant="body2">
          Unsaved video references. Save this scene before generating.
        </Typography>
      )}
      <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap' }}>
        {references.map((reference, index: number) => (
          <Stack
            component="article"
            key={reference.mediaId}
            aria-label={`Video image ${reference.imageNumber}: ${reference.names.join(' / ')}`}
            spacing={1}
            sx={{ width: 220, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
          >
            <Chip
              size="small"
              label={`${reference.names.join(' / ')} = Image ${reference.imageNumber}`}
            />
            <Typography variant="body2">{reference.title}</Typography>
            <ReferencePreview file={media.find((file) => String(file._id) === reference.mediaId)} />
            <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
              <Button
                disabled={disabled}
                aria-label={`Remove video image ${reference.imageNumber}`}
                onClick={() => onChange(selected.filter((id) => id !== reference.mediaId))}
              >
                Remove
              </Button>
              {[-1, 1].map((step) => (
                <Button
                  key={step}
                  disabled={disabled || index + step < 0 || index + step >= selected.length}
                  aria-label={`Move video image ${reference.imageNumber} ${step < 0 ? 'earlier' : 'later'}`}
                  onClick={() => {
                    const next = [...selected];
                    [next[index], next[index + step]] = [next[index + step], next[index]];
                    onChange(next);
                  }}
                >
                  {step < 0 ? 'Earlier' : 'Later'}
                </Button>
              ))}
            </Stack>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}
