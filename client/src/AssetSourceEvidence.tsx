import { Box, Button, Stack, Typography } from '@mui/material';

import type * as Studio from '../../shared/types.ts';
import { capturedSourceLink, savedAssetSourceLinks } from './asset-source-links.ts';
import { ReferencePreview } from './StudioMedia.tsx';

export default function AssetSourceEvidence({
  asset,
  media = []
}: {
  asset: Studio.AssetInput;
  media?: Studio.MediaFile[];
}) {
  const links = savedAssetSourceLinks(asset);
  return (
    <Stack spacing={1}>
      <Typography sx={{ whiteSpace: 'pre-wrap' }}>{asset.production?.sourceNotes}</Typography>
      {links.map((link) => (
        <Button
          key={link.url}
          component="a"
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ alignSelf: 'flex-start' }}
        >
          {link.origin === 'primary' ? 'Open source footage' : 'Open supplementary reference'}
          {link.origin === 'primary' ? '' : ` - ${link.host}`}
        </Button>
      ))}
      {(asset.production?.sourceMediaIds ?? []).map((id) => {
        const file = media.find((file) => String(file._id) === String(id));
        const seconds = file?.sourceFrame?.requestedSeconds ?? file?.sourceFrame?.sourceSeconds;
        const timestamp = Number.isFinite(seconds)
          ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
          : null;
        const href = capturedSourceLink(file);
        return (
          <Box key={id}>
            <Typography sx={{ fontWeight: 600 }}>
              {timestamp
                ? `Saved gameplay capture - ${timestamp}`
                : file?.originalName || 'Saved source image'}
            </Typography>
            <ReferencePreview file={file} />
            {href && (
              <Button component="a" href={href} target="_blank" rel="noopener noreferrer">
                {timestamp ? `Open footage at ${timestamp}` : 'Open capture source'}
              </Button>
            )}
          </Box>
        );
      })}
      {links.some((link) => link.origin === 'brief') && (
        <Typography variant="caption">
          Supplementary links are shown from the saved brief. Listing a link does not verify its
          contents or change source approval.
        </Typography>
      )}
    </Stack>
  );
}
