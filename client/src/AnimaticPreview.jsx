import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';

import { mediaUrl } from './studio-utils.js';
import { ReferencePreview } from './StudioMedia.jsx';
export default function AnimaticPreview({
  scene,
  episodeId,
  assets,
  media,
  playable = true,
  showShotList = true
}) {
  const [playing, setPlaying] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [error, setError] = useState('');
  const audio = useRef(null),
    position = useRef(0);
  const shots = scene.clips.map((c) => ({
    clip: c,
    image: assets.find(
      (a) =>
        !a.archived &&
        String(a.episodeId) === String(episodeId) &&
        a.sceneId === scene.id &&
        a.clipId === c.id
    )?.finalChoice?.mediaIds?.[0]
  }));
  const total = shots.reduce((sum, s) => sum + s.clip.duration, 0);
  const boundaries = shots.reduce(
    (values, shot) => [...values, (values.at(-1) ?? 0) + shot.clip.duration],
    []
  );
  const index = Math.max(
    0,
    boundaries.findIndex((end) => elapsed < end)
  );
  const start = index ? boundaries[index - 1] : 0;
  const current = shots[index];
  const selectedId = current?.clip.selectedDialogueId;
  useEffect(() => {
    position.current = elapsed;
  }, [elapsed]);
  useEffect(() => {
    if (!playing) return;
    const origin = performance.now() - position.current * 1000;
    const timer = setInterval(() => {
      const next = (performance.now() - origin) / 1000;
      if (next >= total) {
        setPlaying(false);
        setElapsed(0);
      } else setElapsed(next);
    }, 100);
    return () => clearInterval(timer);
  }, [playing, total]);
  useEffect(() => {
    const player = audio.current;
    if (!player) return;
    if (!playing) {
      player.pause();
      return;
    }
    let cancelled = false;
    player.currentTime = Math.max(0, position.current - start);
    void player.play().catch(() => {
      if (cancelled) return;
      setError(
        'Audio playback needs a user gesture. Use the audio player below, then restart the preview.'
      );
      setPlaying(false);
    });
    return () => {
      cancelled = true;
      player.pause();
    };
  }, [playing, index, selectedId, start]);
  const ready =
    shots.length > 0 &&
    shots.every((s) => s.image && (!s.clip.dialogue?.trim() || s.clip.selectedDialogueId));
  return (
    <Stack spacing={2}>
      {playable && (
        <>
          <Typography>
            Timed still-image preview with selected dialogue. Check pacing and continuity before
            video generation.
          </Typography>
          {!ready && (
            <Alert severity="info">
              Approve shot images and select dialogue performances to complete this animatic.
            </Alert>
          )}
          {error && <Alert severity="warning">{error}</Alert>}
          <Box sx={{ maxWidth: 900 }}>
            <ReferencePreview file={media.find((m) => m._id === current?.image)} />
          </Box>
          <Typography>
            {current?.clip.title} · {elapsed.toFixed(1)} / {total}s
          </Typography>
          {selectedId && (
            <audio ref={audio} src={mediaUrl(selectedId)} controls preload="metadata" />
          )}
          <Stack direction="row" spacing={1}>
            <Button
              disabled={!ready}
              onClick={() => {
                setError('');
                setPlaying((p) => !p);
              }}
            >
              {playing ? 'Pause preview' : 'Play preview'}
            </Button>
            <Button
              onClick={() => {
                setPlaying(false);
                setElapsed(0);
              }}
            >
              Reset preview
            </Button>
          </Stack>
        </>
      )}
      {showShotList && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
            gap: 2
          }}
        >
          {shots.map(({ clip, image }) => (
            <Box key={clip.id}>
              <ReferencePreview file={media.find((m) => m._id === image)} compact />
              <Typography>
                {clip.title} · {clip.duration}s
              </Typography>
              <Typography variant="body2">{clip.camera}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Stack>
  );
}
