import {
  Box,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';

import { shotTransition } from '../../shared/shot-transitions.js';
import { endImageHref, focusSection } from './review-navigation.js';

export default function ShotTransitionSummary({
  episodeId,
  scene,
  scenes = [scene],
  assets,
  media
}) {
  const shots = scene.clips
    .map((clip) => ({
      clip,
      transition: shotTransition(episodeId, scene, clip, assets, media, scenes)
    }))
    .filter((shot) => shot.transition);
  if (!shots.length) return null;
  return (
    <Stack component="section" aria-label={`Video transition setup for ${scene.title}`} spacing={1}>
      <Typography variant="h3">Video transition setup</Typography>
      <Typography variant="body2">
        These references will be used when you press Generate video. Dialogue videos also keep their
        approved voice reference. Existing takes keep their original setup.
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-label={`Transition references for ${scene.title}`}>
          <TableHead>
            <TableRow>
              <TableCell>Video</TableCell>
              <TableCell>Start reference · Image 1</TableCell>
              <TableCell>End reference · Image 2</TableCell>
              <TableCell>Reference status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shots.map(({ clip, transition }) => (
              <TableRow key={clip.id}>
                <TableCell component="th" scope="row">
                  <Button
                    component="a"
                    href={`#picture-prerequisites-${clip.id}`}
                    onClick={() => focusSection(`picture-prerequisites-${clip.id}`)}
                    sx={{ textAlign: 'left', justifyContent: 'flex-start' }}
                  >
                    {clip.title}
                  </Button>
                </TableCell>
                <TableCell>This shot’s approved image</TableCell>
                <TableCell>
                  {transition.needsEnd ? (
                    transition.nextClipId ? (
                      <Button
                        component="a"
                        href={endImageHref(transition, episodeId)}
                        onClick={() => {
                          if (
                            !transition.nextEpisodeId ||
                            String(transition.nextEpisodeId) === String(episodeId)
                          )
                            focusSection(`picture-prerequisites-${transition.nextClipId}`);
                        }}
                        sx={{ textAlign: 'left', justifyContent: 'flex-start' }}
                      >
                        {transition.nextTitle}
                      </Button>
                    ) : (
                      `Next part ${transition.part + 1} is missing`
                    )
                  ) : transition.finalPart === false ? (
                    'No end image selected'
                  ) : (
                    'Final part · no end image'
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={transition.errors.length ? 'warning' : 'success'}
                    label={
                      transition.errors.length
                        ? 'Reference needs attention'
                        : transition.needsEnd
                          ? 'Both images approved'
                          : 'Start image approved'
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  );
}
