import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';

import { request } from './api.js';
import RejectMediaButton from './RejectMediaButton.jsx';
import { uid } from './studio-utils.js';
import { ReferencePreview, UploadButton } from './StudioMedia.jsx';

function newSoundLayer(scene) {
  return {
    id: uid(),
    title: 'Continuous ambience',
    description: `Star Wars universe, Imperial era. ${scene.location || 'Describe the scene environment'}. Continuous environmental ambience with distant activity. No music, speech, broken engines or rusty hinges.`,
    type: 'ambience',
    assetId: null,
    clipId: null,
    start: 0,
    sourceStart: 0,
    duration: 15,
    gainDb: -22,
    lowpassHz: 0,
    loop: true
  };
}
export default function SoundDesign({
  episode,
  scene,
  assets,
  media,
  dirty,
  busy,
  onEdit,
  onSaved,
  onAssetSaved,
  onMedia,
  onRejected,
  onReload
}) {
  const [working, setWorking] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [jobs, setJobs] = useState([]),
    [imports, setImports] = useState({}),
    [sources, setSources] = useState({});
  const seen = useRef(new Set());
  const plan = scene.soundPlan;
  const hasPlan = Boolean(plan);
  const ready = !dirty && !busy && !working;
  const approved =
    scene.soundApprovalStatus === 'approved' && scene.approvalStatus === 'approved' && !dirty;
  useEffect(() => {
    if (!hasPlan) return;
    let cancelled = false;
    async function refresh() {
      try {
        const result = await request(
          `/studio/assistant/sound/jobs?episodeId=${episode._id}&sceneId=${encodeURIComponent(scene.id)}`
        );
        if (cancelled || !Array.isArray(result.jobs)) return;
        setJobs(result.jobs);
        let changed = false;
        for (const job of result.jobs) {
          if (!seen.current.has(job._id + job.status)) {
            if (['ready', 'failed', 'uncertain'].includes(job.status)) changed = true;
            seen.current.add(job._id + job.status);
          }
        }
        if (changed) onReload?.();
      } catch {
        /* Offline status does not discard the sound-plan draft. */
      }
    }
    void refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [episode._id, scene.id, onReload, hasPlan]);
  function edit(patch) {
    onEdit({ ...plan, ...patch });
  }
  function layerEdit(layerId, patch) {
    edit({
      layers: plan.layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer))
    });
  }
  async function run(action, body = {}) {
    if (!ready) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const result = await request(
        action === 'approve'
          ? `/studio/episodes/${episode._id}/scenes/${scene.id}/sound-plan/approve`
          : `/studio/assistant/sound/${action}`,
        {
          method: 'POST',
          body: {
            episodeId: episode._id,
            sceneId: scene.id,
            revision: episode.revision,
            requestId: uid(),
            ...body
          }
        }
      );
      if (result.episode) onSaved(result.episode);
      if (result.asset) onAssetSaved(result.asset);
      if (result.job)
        setJobs((current) => [result.job, ...current.filter((job) => job._id !== result.job._id)]);
      setNotice(
        action === 'approve'
          ? 'Sound plan approved. Review each sound before mixing.'
          : action === 'generate'
            ? 'Sound generation queued. Its audio will need your approval.'
            : action === 'mix'
              ? 'Local sound mix requested. Review the finished video below when ready.'
              : 'Audio imported as a pending choice.'
      );
      onReload?.();
    } catch (e) {
      setError(e.message);
      if (e.status === 409) onReload?.();
    } finally {
      setWorking(false);
    }
  }
  async function approveSound(asset, candidate) {
    if (!ready) return;
    setWorking(true);
    setError('');
    try {
      const result = await request(`/studio/assets/${asset._id}/finalize`, {
        method: 'POST',
        body: { revision: asset.revision, candidateId: candidate.id }
      });
      onAssetSaved(result.asset);
      onReload?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }
  return (
    <Stack
      component="section"
      aria-label={`Sound design for ${scene.title}`}
      spacing={2}
      sx={{
        p: { xs: 1.5, sm: 2.5 },
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        minWidth: 0
      }}
    >
      <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h3">Sound design</Typography>
        <Chip
          size="small"
          label={approved ? 'Plan approved' : 'Plan needs review'}
          color={approved ? 'success' : 'warning'}
        />
      </Stack>
      <Typography variant="body2">
        Plan ambience and timed effects before rendering. Wan generates them with the picture;
        approve a good picture and soundtrack together in the video player. The tools below are
        optional repairs for missing effects, unwanted music or poor audio. Music is added in
        CapCut.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="info">{notice}</Alert>}
      {dirty && (
        <Alert severity="info">
          Save episode edits before approving the plan, requesting sounds or creating mixes.
        </Alert>
      )}
      {!plan ? (
        <Button
          variant="outlined"
          onClick={() =>
            onEdit({
              notes: 'Maintain the same ambience across adjacent shots. No music.',
              dialogueGainDb: 0,
              layers: [newSoundLayer(scene)]
            })
          }
        >
          Add sound plan
        </Button>
      ) : (
        <>
          <TextField
            label="Sound continuity and notes"
            multiline
            minRows={2}
            value={plan.notes}
            onChange={(e) => edit({ notes: e.target.value })}
          />
          <TextField
            label="Clean dialogue level (dB)"
            type="number"
            value={plan.dialogueGainDb}
            onChange={(e) => edit({ dialogueGainDb: Number(e.target.value) })}
            slotProps={{ htmlInput: { min: -30, max: 6, step: 1 } }}
            helperText="Applies only to the separate dialogue-only stem. Provider soundtracks are excluded."
          />
          {plan.layers.map((layer, index) => {
            const asset = assets.find((a) => a._id === layer.assetId);
            return (
              <Accordion key={layer.id} defaultExpanded={index === 0} disableGutters>
                <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
                  <Typography sx={{ overflowWrap: 'anywhere' }}>
                    Sound {index + 1}: {layer.title} -{' '}
                    {asset?.finalChoice && asset.reviewStatus !== 'pending-choice'
                      ? 'Approved sound'
                      : asset?.candidates.some((c) => !c.archived && c.mediaIds.length)
                        ? 'Pending choice'
                        : 'In development'}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2} sx={{ minWidth: 0 }}>
                    <TextField
                      label="Sound title"
                      value={layer.title}
                      onChange={(e) => layerEdit(layer.id, { title: e.target.value })}
                    />
                    <TextField
                      select
                      label="Layer type"
                      value={layer.type}
                      onChange={(e) =>
                        layerEdit(layer.id, {
                          type: e.target.value,
                          clipId: e.target.value === 'effect' ? (scene.clips[0]?.id ?? null) : null,
                          loop: e.target.value === 'ambience'
                        })
                      }
                    >
                      <MenuItem value="ambience">Continuous ambience</MenuItem>
                      <MenuItem value="effect">Timed effect</MenuItem>
                    </TextField>
                    <TextField
                      label="Sound description / ElevenLabs prompt"
                      multiline
                      minRows={2}
                      value={layer.description}
                      onChange={(e) => layerEdit(layer.id, { description: e.target.value })}
                    />
                    <TextField
                      select
                      label="Apply to clip"
                      value={layer.clipId || ''}
                      slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
                      onChange={(e) => layerEdit(layer.id, { clipId: e.target.value || null })}
                    >
                      <MenuItem value="" disabled={layer.type === 'effect'}>
                        All clips in this scene
                      </MenuItem>
                      {scene.clips.map((c) => (
                        <MenuItem key={c.id} value={c.id}>
                          {c.title}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,minmax(0,1fr))' },
                        gap: 2
                      }}
                    >
                      {[
                        ['start', 'Start in clip (seconds)', 0, 30],
                        ['duration', 'Sound length (seconds)', 0.5, 30],
                        ['sourceStart', 'Start in audio source (seconds)', 0, 3600],
                        ['gainDb', 'Effect level (dB)', -60, 6],
                        ['lowpassHz', 'Low-pass filter (Hz; 0 = off)', 0, 20000]
                      ].map(([key, label, min, max]) => (
                        <TextField
                          key={key}
                          type="number"
                          label={label}
                          value={layer[key]}
                          slotProps={{
                            htmlInput: {
                              min,
                              max,
                              step: key === 'gainDb' || key === 'lowpassHz' ? 1 : 0.1
                            }
                          }}
                          onChange={(e) => layerEdit(layer.id, { [key]: Number(e.target.value) })}
                        />
                      ))}
                    </Box>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={layer.loop}
                          onChange={(e) => layerEdit(layer.id, { loop: e.target.checked })}
                        />
                      }
                      label="Loop audio; keep all-scene ambience continuous across cuts"
                    />
                    <TextField
                      select
                      label="Reusable or episode sound"
                      value={layer.assetId || ''}
                      slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
                      onChange={(e) => layerEdit(layer.id, { assetId: e.target.value || null })}
                    >
                      <MenuItem value="">Create a new reusable sound</MenuItem>
                      {assets
                        .filter(
                          (a) =>
                            a.kind === 'sound' &&
                            !a.archived &&
                            (a.scope !== 'episode' || a.episodeId === episode._id)
                        )
                        .map((a) => (
                          <MenuItem key={a._id} value={a._id}>
                            {a.name} -{' '}
                            {a.finalChoice && a.reviewStatus !== 'pending-choice'
                              ? 'approved'
                              : 'pending review'}
                          </MenuItem>
                        ))}
                    </TextField>
                    <Typography variant="caption">
                      New effects: estimated {Math.ceil(layer.duration * 40).toLocaleString()}{' '}
                      ElevenLabs credits ({layer.duration}s x 40). Reusing saved audio and local
                      mixing cost no generation credits. Actual provider charges appear on the job
                      when supplied.
                    </Typography>
                    <Button
                      disabled={!ready || !approved}
                      variant="outlined"
                      onClick={() => run('generate', { layerId: layer.id })}
                    >
                      Generate new sound option
                    </Button>
                    <TextField
                      select
                      label="Import saved audio as an option"
                      value={imports[layer.id] || ''}
                      slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
                      onChange={(e) => setImports({ ...imports, [layer.id]: e.target.value })}
                    >
                      <MenuItem value="">Choose a saved audio file</MenuItem>
                      {media
                        .filter((m) => m.kind === 'audio')
                        .map((m) => (
                          <MenuItem
                            key={m._id}
                            value={m._id}
                            sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                          >
                            {m.originalName}
                          </MenuItem>
                        ))}
                    </TextField>
                    <Button
                      disabled={!ready || !approved || !imports[layer.id]}
                      onClick={() =>
                        run('import', { layerId: layer.id, mediaId: imports[layer.id] })
                      }
                    >
                      Import sound option
                    </Button>
                    <UploadButton
                      disabled={!ready || !approved}
                      label="Upload sound option"
                      onUploaded={(file) => {
                        onMedia(file);
                        if (file.kind === 'audio')
                          void run('import', { layerId: layer.id, mediaId: file._id });
                        else setError('Choose an audio file for this sound layer.');
                      }}
                    />
                    {asset?.candidates
                      .filter((c) => !c.archived)
                      .map((candidate) => (
                        <Stack
                          key={candidate.id}
                          spacing={1}
                          sx={{
                            p: 1,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1
                          }}
                        >
                          <Typography>{candidate.title}</Typography>
                          {candidate.mediaIds.map((mediaId) => {
                            const file = media.find((m) => m._id === mediaId);
                            return (
                              <Box key={mediaId}>
                                <ReferencePreview file={file} kind="sound" />
                                {file && (
                                  <RejectMediaButton
                                    file={file}
                                    disabled={!ready}
                                    context={{
                                      assetId: asset._id,
                                      revision: asset.revision,
                                      candidateId: candidate.id
                                    }}
                                    onRejected={onRejected}
                                  />
                                )}
                              </Box>
                            );
                          })}
                          <Button
                            variant="contained"
                            disabled={
                              !ready ||
                              candidate.mediaIds.length !== 1 ||
                              (asset.finalChoice?.id === candidate.id &&
                                asset.reviewStatus !== 'pending-choice')
                            }
                            onClick={() => approveSound(asset, candidate)}
                          >
                            {asset.finalChoice?.id === candidate.id &&
                            asset.reviewStatus !== 'pending-choice'
                              ? 'Approved sound'
                              : 'Approve this sound'}
                          </Button>
                        </Stack>
                      ))}
                    <Button
                      color="inherit"
                      disabled={working}
                      onClick={() => edit({ layers: plan.layers.filter((l) => l.id !== layer.id) })}
                    >
                      Remove layer from plan
                    </Button>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            );
          })}
          <Button onClick={() => edit({ layers: [...plan.layers, newSoundLayer(scene)] })}>
            Add sound layer
          </Button>
          <Button
            variant="contained"
            sx={episode.workflowVersion === 1 ? { display: 'none' } : undefined}
            disabled={
              !ready || approved || scene.approvalStatus !== 'approved' || !plan.layers.length
            }
            onClick={() => run('approve')}
          >
            Approve sound plan
          </Button>
          {scene.approvalStatus !== 'approved' && (
            <Typography variant="caption">
              Approve the scene script to approve its sound plan together.
            </Typography>
          )}
          <Typography variant="h3">Repair audio with a replacement mix</Typography>
          <Typography variant="body2">
            Select an original picture take for each clip. Mixing preserves its video and uses only
            approved effects and a separate clean dialogue stem when speaking. It excludes the
            provider soundtrack. A separate effects stem is saved for CapCut. Review the finished
            mix.
          </Typography>
          {scene.clips.map((clip) => (
            <Stack key={clip.id} spacing={1}>
              <TextField
                select
                label={`Original take: ${clip.title}`}
                value={sources[clip.id] || clip.production?.visualTakeId || ''}
                slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
                onChange={(e) => setSources({ ...sources, [clip.id]: e.target.value })}
              >
                <MenuItem value="">Choose original video</MenuItem>
                {(clip.takeIds || [])
                  .map((mediaId) => media.find((m) => m._id === mediaId))
                  .filter((m) => m && !m.soundMix)
                  .map((m) => (
                    <MenuItem
                      key={m._id}
                      value={m._id}
                      sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                    >
                      {m.originalName}
                    </MenuItem>
                  ))}
              </TextField>
              <Button
                disabled={
                  !ready ||
                  !approved ||
                  !(sources[clip.id] || clip.production?.visualTakeId) ||
                  (Boolean(clip.dialogue?.trim()) && !clip.production?.cleanDialogueMediaId)
                }
                onClick={() =>
                  run('mix', {
                    clipId: clip.id,
                    sourceTakeId: sources[clip.id] || clip.production?.visualTakeId
                  })
                }
              >
                Create sound mix - {clip.title}
              </Button>
            </Stack>
          ))}
        </>
      )}
      {jobs.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="h3">Sound jobs</Typography>
          {jobs.slice(0, 10).map((job) => (
            <Alert
              key={job._id}
              severity={
                ['failed', 'uncertain'].includes(job.status)
                  ? 'warning'
                  : job.status === 'ready'
                    ? 'success'
                    : 'info'
              }
              sx={{ overflowWrap: 'anywhere' }}
            >
              {job.title}: {job.status}
              {job.error ? `. ${job.error}` : ''}
              {job.receipt?.creditsCharged != null
                ? ` - ${job.receipt.creditsCharged} ElevenLabs credits charged`
                : ''}
            </Alert>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
