import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';

import { toError } from '../../shared/errors.ts';
import { musicPrompt } from '../../shared/scene-music.ts';
import type * as Studio from '../../shared/types.ts';
import { request } from './api.ts';
import { focusSection } from './review-navigation.ts';
import { mediaDownloadUrl, mediaUrl } from './studio-utils.ts';

export default function SceneMusic({
  episode,
  scene,
  dirty,
  busy,
  onReload
}: {
  episode: Studio.Episode;
  scene: Studio.Scene;
  dirty?: boolean;
  busy?: boolean;
  onReload?: () => void | Promise<unknown>;
}) {
  const [data, setData] = useState<Studio.MusicStatus | null>(null),
    [prompt, setPrompt] = useState(''),
    [buffer, setBuffer] = useState(5),
    [working, setWorking] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [edited, setEdited] = useState(false),
    [deleting, setDeleting] = useState('');
  const refresh = useCallback(async () => {
    const next = await request<Studio.MusicStatus>(
      `/studio/assistant/music?episodeId=${episode._id}&sceneId=${encodeURIComponent(scene.id)}`
    );
    if (!next?.defaults || !Array.isArray(next.jobs))
      throw new Error(
        'Music status is unavailable. Refresh after the studio server has finished updating.'
      );
    setData(next);
    return next;
  }, [episode._id, scene.id]);
  useEffect(() => {
    let live = true;
    async function update() {
      try {
        const next = await refresh();
        if (live && !edited) {
          setPrompt(next.cue?.prompt ?? next.defaults.prompt);
          setBuffer(next.cue?.bufferSeconds ?? 5);
        }
      } catch (caughtError) {
        const e = toError(caughtError);
        if (live) setError(e.message);
      }
    }
    void update();
    const timer = setInterval(update, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [refresh, edited]);
  const active = data?.jobs.some((j) =>
    ['queued', 'preparing', 'submitting', 'importing', 'uncertain'].includes(j.status)
  );
  const disabled = dirty || busy || working;
  const complete = data?.takeReview.status === 'approved' && !edited;
  const total = data?.targetSeconds ?? 0,
    generated = total + Number(buffer),
    estimate = Math.ceil(generated * 15);
  async function run(action: 'plan' | 'music-plan' | 'music' | 'generate' | 'reject', extra = {}) {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      if (action === 'plan') {
        await request<Studio.ActionResult>('/studio/assistant/music/plan', {
          method: 'POST',
          body: {
            episodeId: episode._id,
            sceneId: scene.id,
            cueRevision: data.cue?.revision,
            prompt,
            bufferSeconds: Number(buffer),
            ...extra
          }
        });
        setEdited(false);
        setNotice(
          'Music brief saved. Review the complete prompt, then approve it. Use Generate music when ready.'
        );
      } else if (action === 'music-plan' || action === 'music') {
        const fresh = await refresh(),
          row = action === 'music-plan' ? fresh.planReview : fresh.takeReview;
        await request<Studio.ActionResult>('/studio/workflow/review', {
          method: 'POST',
          body: {
            target: row.target,
            stage: action,
            action: 'approve',
            fingerprint: row.fingerprint,
            parentRevision: row.parentRevision,
            reviewRevision: row.reviewRevision,
            ...extra
          }
        });
        setNotice(
          action === 'music-plan'
            ? 'Music brief approved. Use Generate music when ready.'
            : 'Music take approved. Download it separately for this section.'
        );
      } else if (action === 'generate') {
        await request<Studio.ActionResult>('/studio/assistant/music/generate', {
          method: 'POST',
          body: { episodeId: episode._id, sceneId: scene.id, requestId: crypto.randomUUID() }
        });
        setNotice('One music audition queued.');
      } else {
        await request<Studio.RejectionResult>('/studio/assistant/music/reject', {
          method: 'POST',
          body: {
            episodeId: episode._id,
            sceneId: scene.id,
            cueRevision: data.cue.revision,
            candidateId: deleting
          }
        });
        setDeleting('');
        setNotice('Rejected music and its original audio deleted.');
      }
      await refresh();
      onReload?.();
    } catch (caughtError) {
      const e = toError(caughtError);
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }
  return (
    <Box
      id={'music-' + scene.id}
      tabIndex={-1}
      sx={{
        scrollMarginTop: '110px',
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        p: { xs: 2, md: 3 }
      }}
    >
      <Stack spacing={2}>
        <Typography variant="h3">Background music for this section</Typography>
        <Typography>
          {complete
            ? 'Background music is complete. Download your approved track below.'
            : 'Generate a separate instrumental track for this section. Download it separately from the approved videos, which keep their dialogue and sound effects.'}
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {notice && (
          <Alert severity="success" role="status">
            {notice}
          </Alert>
        )}
        {!data ? (
          <CircularProgress size={24} />
        ) : (
          <>
            <Alert severity={complete ? 'success' : 'info'}>
              {complete ? (
                `Approved music covers this ${total}-second scene. No new generation is needed.`
              ) : (
                <>
                  Scene: {total} seconds. Generate: {generated} seconds ({buffer}-second allowance,
                  maximum 5). One audio file per request. Estimated {estimate} credits at your
                  reported 900 credits/minute; API billing may differ. Actual cost is shown when
                  ElevenLabs returns it. No automatic paid retries.
                </>
              )}
            </Alert>
            <TextField
              label="Complete background music prompt"
              multiline
              minRows={8}
              maxRows={20}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setEdited(true);
              }}
              helperText={`${prompt.length}/4100 characters. Review the full prompt before approving.`}
            />
            <TextField
              label="Extra seconds for silence allowance"
              type="number"
              value={buffer}
              slotProps={{ htmlInput: { min: 0, max: 5, step: 1 } }}
              onChange={(e) => {
                setBuffer(Number(e.target.value));
                setEdited(true);
              }}
            />
            <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                disabled={disabled || active || (!edited && Boolean(data.cue?.enabled))}
                onClick={() => run('plan', { enabled: true })}
              >
                {data.cue ? 'Save music brief' : 'Prepare music brief'}
              </Button>
              {data.cue?.enabled && data.planReview.status !== 'approved' && (
                <Button
                  variant="contained"
                  disabled={disabled || edited || active || !data.planReview.canApprove}
                  onClick={() => run('music-plan')}
                >
                  Approve music brief
                </Button>
              )}
              {data.cue?.enabled && data.planReview.status === 'approved' && (
                <Button
                  variant={complete ? 'text' : 'contained'}
                  disabled={disabled || edited || active || data.keyConfigured === false}
                  onClick={() => run('generate')}
                >
                  {complete || data.cue.candidates.length
                    ? `Generate another audition · estimated ${estimate} credits`
                    : 'Generate music'}
                </Button>
              )}
              <Button
                disabled={disabled || active}
                onClick={() => {
                  setPrompt(musicPrompt(scene, Number(buffer)));
                  setEdited(true);
                }}
              >
                Rebuild complete prompt from scene timing
              </Button>
              {data.cue?.enabled && (
                <Button
                  disabled={disabled || active}
                  onClick={() => run('plan', { enabled: false })}
                >
                  Remove music requirement
                </Button>
              )}
            </Stack>
            {dirty && (
              <Alert severity="warning">Save the episode before working on its music timing.</Alert>
            )}
            {data.cue?.enabled && data.planReview.blockers?.length > 0 && (
              <Alert severity="warning">{data.planReview.blockers.join(' ')}</Alert>
            )}
            {data.keyConfigured === false && (
              <Alert severity="warning">
                ElevenLabs API key is not configured on the studio PC. Add ELEVENLABS_API_KEY to
                server/.env and restart the server before generation.
              </Alert>
            )}
            {data.automation
              ?.filter((a) => a.status === 'failed')
              .map((a) => (
                <Alert key={a._id} severity="error">
                  Music submission failed: {a.error}. Your brief approval is saved. Resolve the
                  issue, then use Generate another audition; no paid retry runs automatically.
                </Alert>
              ))}
            {data.jobs.map((job) => (
              <Alert
                key={job._id}
                severity={
                  ['failed', 'uncertain'].includes(job.status)
                    ? 'error'
                    : job.status === 'ready'
                      ? 'success'
                      : 'info'
                }
                icon={
                  ['queued', 'preparing', 'submitting', 'importing'].includes(job.status) ? (
                    <CircularProgress size={20} />
                  ) : undefined
                }
              >
                <Typography>
                  Music job: {job.status}
                  {job.receipt?.creditsCharged != null
                    ? ` · ${job.receipt.creditsCharged} credits reported`
                    : ''}
                </Typography>
                {job.error}
              </Alert>
            ))}
            {data.cue?.candidates.map((option, index: number) => {
              const mid = option.mediaIds[0],
                current = data.currentCandidateIds
                  ? data.currentCandidateIds.includes(option.id)
                  : option.fingerprint === data.fingerprint,
                selected =
                  String(data.cue.selectedMediaId) === mid && data.takeReview.status === 'approved';
              return (
                <Box
                  key={option.id}
                  sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}
                >
                  <Stack spacing={2}>
                    <Typography sx={{ fontWeight: 600 }}>Music audition {index + 1}</Typography>
                    <Chip
                      label={selected ? 'Approved' : current ? 'Pending choice' : 'Earlier brief'}
                    />
                    <Box
                      component="audio"
                      controls
                      preload="metadata"
                      src={mediaUrl(mid)}
                      aria-label={`Music audition ${index + 1}`}
                      sx={{ width: '100%' }}
                    />
                    <Alert severity={option.qc.passed ? 'info' : 'warning'}>
                      {option.qc.passed
                        ? `Prepared ${option.qc.preparedSeconds}-second track with a short final fade.`
                        : `Insufficient audible music: ${option.qc.audibleSeconds.toFixed(2)} seconds. Original retained; no paid retry made.`}{' '}
                      Detected leading silence: {option.qc.leadingSeconds.toFixed(2)}s; trailing
                      silence: {option.qc.trailingSeconds.toFixed(2)}s. Listen before approval.
                    </Alert>
                    <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                      <Button
                        variant="contained"
                        disabled={
                          disabled ||
                          edited ||
                          !current ||
                          !option.qc.passed ||
                          selected ||
                          data.planReview.status !== 'approved'
                        }
                        onClick={() => run('music', { musicMediaId: mid })}
                      >
                        Approve this music take
                      </Button>
                      <Button
                        component="a"
                        href={mediaDownloadUrl(mid)}
                        download
                        target="_blank"
                        rel="noopener"
                      >
                        {option.qc.passed
                          ? 'Download scene-length audio'
                          : 'Download available audio'}
                      </Button>
                      <Button
                        component="a"
                        href={mediaDownloadUrl(option.sourceMediaId)}
                        download
                        target="_blank"
                        rel="noopener"
                      >
                        Download original
                      </Button>
                      <Button
                        color="error"
                        disabled={disabled}
                        onClick={() => setDeleting(option.id)}
                      >
                        Reject and delete
                      </Button>
                    </Stack>
                    {deleting === option.id && (
                      <Alert severity="warning">
                        Delete this audition and its original audio permanently?{' '}
                        <Button color="error" disabled={disabled} onClick={() => run('reject')}>
                          Delete this music take
                        </Button>
                        <Button onClick={() => setDeleting('')}>Cancel</Button>
                      </Alert>
                    )}
                  </Stack>
                </Box>
              );
            })}
            <Button onClick={() => focusSection('episode-top')}>Back to episode top</Button>
          </>
        )}
      </Stack>
    </Box>
  );
}
