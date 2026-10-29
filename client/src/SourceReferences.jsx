import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useState } from 'react';

import SourceVideoImport from './SourceVideoImport.jsx';
import { uid } from './studio-utils.js';
const clock = (value) => {
  const seconds = Math.floor(value ?? 0);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
function youtubeId(url) {
  try {
    const parsed = new URL(url);
    const id =
      parsed.hostname === 'youtu.be'
        ? parsed.pathname.slice(1)
        : ['www.youtube.com', 'youtube.com'].includes(parsed.hostname)
          ? parsed.searchParams.get('v')
          : null;
    return /^[\w-]{11}$/.test(id ?? '') ? id : null;
  } catch {
    return null;
  }
}
export default function SourceReferences({ episode, onEdit, disabled = false, onMedia }) {
  const [playing, setPlaying] = useState('');
  const sources = episode.sourceReferences ?? [],
    decisions = episode.decisions ?? [];
  function update(id, patch) {
    onEdit({
      sourceReferences: sources.map((ref) => (ref.id === id ? { ...ref, ...patch } : ref))
    });
  }
  return (
    <Stack
      component="section"
      aria-label="Gameplay source and decisions"
      className="editor-panel"
      spacing={2}
    >
      <Typography variant="h2">Gameplay source and decisions</Typography>
      <Typography>
        Use the recorded chapter as the source of truth. Chapter markers establish its time range;
        review the actual events and choices before verifying it. Save changes with Save episode.
      </Typography>
      {sources.map((ref) => {
        const videoId = youtubeId(ref.url);
        return (
          <Stack
            key={ref.id}
            spacing={2}
            sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2, minWidth: 0 }}
          >
            <Typography variant="h3">{ref.chapter || ref.title}</Typography>
            <SourceVideoImport
              episodeId={episode._id}
              sourceId={ref.id}
              disabled={disabled}
              onMedia={onMedia}
            />
            <Typography variant="body2">
              Source range: {clock(ref.startSeconds)} -{' '}
              {ref.endSeconds === null ? 'End not set' : clock(ref.endSeconds)}
            </Typography>
            <TextField
              label="Source title"
              value={ref.title}
              onChange={(e) => update(ref.id, { title: e.target.value })}
            />
            <TextField
              label="Source URL"
              value={ref.url}
              onChange={(e) => update(ref.id, { url: e.target.value })}
            />
            <TextField
              label="Chapter"
              value={ref.chapter}
              onChange={(e) => update(ref.id, { chapter: e.target.value })}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                fullWidth
                type="number"
                label="Source start (seconds)"
                value={ref.startSeconds}
                onChange={(e) => update(ref.id, { startSeconds: Number(e.target.value) })}
              />
              <TextField
                fullWidth
                type="number"
                label="Source end (seconds)"
                value={ref.endSeconds ?? ''}
                onChange={(e) =>
                  update(ref.id, {
                    endSeconds: e.target.value === '' ? null : Number(e.target.value)
                  })
                }
              />
            </Stack>
            {videoId && (
              <Button
                variant="outlined"
                onClick={() => setPlaying(playing === ref.id ? '' : ref.id)}
              >
                {playing === ref.id ? 'Close source player' : 'Watch source chapter'} -{' '}
                {ref.chapter}
              </Button>
            )}
            {playing === ref.id && videoId && (
              <Box
                component="iframe"
                title={`Source footage: ${ref.chapter}`}
                src={`https://www.youtube-nocookie.com/embed/${videoId}?start=${Math.floor(ref.startSeconds)}${ref.endSeconds ? `&end=${Math.ceil(ref.endSeconds)}` : ''}`}
                allow="fullscreen; picture-in-picture"
                referrerPolicy="strict-origin-when-cross-origin"
                sx={{ width: '100%', aspectRatio: '16 / 9', border: 0 }}
              />
            )}
            <Button
              component="a"
              href={
                videoId
                  ? `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(ref.startSeconds)}s`
                  : ref.url
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              Open source in new tab
            </Button>
            <TextField
              label="Source review notes"
              multiline
              minRows={3}
              value={ref.notes}
              onChange={(e) => update(ref.id, { notes: e.target.value })}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={ref.status === 'verified'}
                  onChange={(e) =>
                    update(ref.id, { status: e.target.checked ? 'verified' : 'unreviewed' })
                  }
                />
              }
              label="I reviewed this source range and confirmed its events and decisions"
            />
            {ref.status !== 'verified' && (
              <Alert severity="info">
                Source content awaits review. No dialogue choices or scene events have been
                verified.
              </Alert>
            )}
            <Button
              color="inherit"
              onClick={() =>
                onEdit({
                  sourceReferences: sources.filter((source) => source.id !== ref.id),
                  decisions: decisions.filter((choice) => choice.sourceId !== ref.id),
                  scenes: episode.scenes.map((scene) => ({
                    ...scene,
                    sourceReferenceIds: (scene.sourceReferenceIds ?? []).filter(
                      (id) => id !== ref.id
                    )
                  }))
                })
              }
            >
              Remove source reference
            </Button>
          </Stack>
        );
      })}
      <Button
        onClick={() =>
          onEdit({
            sourceReferences: [
              ...sources,
              {
                id: uid(),
                title: 'New gameplay source',
                url: 'https://www.youtube.com/',
                chapter: '',
                startSeconds: 0,
                endSeconds: null,
                status: 'unreviewed',
                notes: ''
              }
            ]
          })
        }
      >
        Add source reference
      </Button>
      <Typography variant="h3">Recorded decision log</Typography>
      <Typography variant="body2">
        Record the choice shown, its timestamp in the original video, and the observed consequence.
        Do not fill gaps with assumed choices.
      </Typography>
      {decisions.map((choice) => (
        <Stack
          key={choice.id}
          spacing={2}
          sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2 }}
        >
          <TextField
            select
            label="Decision source"
            value={choice.sourceId}
            onChange={(e) =>
              onEdit({
                decisions: decisions.map((item) =>
                  item.id === choice.id ? { ...item, sourceId: e.target.value } : item
                )
              })
            }
          >
            {sources.map((ref) => (
              <MenuItem key={ref.id} value={ref.id}>
                {ref.chapter || ref.title}
              </MenuItem>
            ))}
          </TextField>
          {[
            ['timestampSeconds', 'Decision timestamp (seconds)'],
            ['choice', 'Choice shown in footage'],
            ['outcome', 'Observed consequence']
          ].map(([key, label]) => (
            <TextField
              key={key}
              label={label}
              type={key === 'timestampSeconds' ? 'number' : 'text'}
              value={choice[key]}
              onChange={(e) =>
                onEdit({
                  decisions: decisions.map((item) =>
                    item.id === choice.id
                      ? {
                          ...item,
                          [key]:
                            key === 'timestampSeconds' ? Number(e.target.value) : e.target.value
                        }
                      : item
                  )
                })
              }
            />
          ))}
          <Button
            color="inherit"
            onClick={() => onEdit({ decisions: decisions.filter((item) => item.id !== choice.id) })}
          >
            Remove decision
          </Button>
        </Stack>
      ))}
      <Button
        disabled={!sources.length}
        onClick={() =>
          onEdit({
            decisions: [
              ...decisions,
              {
                id: uid(),
                sourceId: sources[0].id,
                timestampSeconds: Math.floor(sources[0].startSeconds),
                choice: '',
                outcome: ''
              }
            ]
          })
        }
      >
        Add recorded decision
      </Button>
    </Stack>
  );
}
