import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';

import { proposalBlocksReview } from '../../shared/production-proposals.js';
import { shotContinuity } from '../../shared/shot-continuity.js';
import AnimaticPreview from './AnimaticPreview.jsx';
import { request } from './api.js';
import ProductionDrafts from './ProductionDrafts.jsx';
import { studioUrl } from './project-url.js';
import { focusSection, reviewAnchor, reviewHref } from './review-navigation.js';
import ReviewLinks from './ReviewLinks.jsx';
import { ReferencePreview } from './StudioMedia.jsx';
import UpscaleImport from './UpscaleImport.jsx';

const labels = {
  draft: 'Draft',
  blocked: 'Blocked',
  'pending-review': 'Pending review',
  approved: 'Approved',
  'needs-review': 'Needs review',
  'needs-changes': 'Changes requested · saved'
};
const empty = [];
function sourceLink(ref) {
  try {
    const url = new URL(ref.url);
    if (['youtube.com', 'www.youtube.com', 'youtu.be'].includes(url.hostname))
      url.searchParams.set('t', `${Math.floor(ref.startSeconds ?? 0)}s`);
    return url.href;
  } catch {
    return ref.url;
  }
}
const sourceTime = (value) =>
  value == null
    ? 'end'
    : `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
export function EnableWorkflow({ disabled = false }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Stack spacing={1}>
      <Button
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await request('/studio/workflow/enable', { method: 'POST', body: {} });
            window.location.reload();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Enable production approval workflow for this project
      </Button>
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
function ReviewContent({ row, record, assets, media, disabled, onImportUpscale }) {
  const scene = record.scenes?.find((s) => s.id === row.target.sceneId);
  const clip = scene?.clips.find((c) => c.id === row.target.clipId);
  if (['music-plan', 'music'].includes(row.stage))
    return (
      <Alert severity="info">
        {row.stage === 'music-plan'
          ? 'Approving this brief automatically requests one ElevenLabs music audition. Review its complete prompt, duration and credit estimate first.'
          : 'Listen and approve one individual music audition in the background music panel.'}
        <Button
          component="a"
          href={'#music-' + scene.id}
          onClick={() => focusSection('music-' + scene.id)}
        >
          Go to background music
        </Button>
      </Alert>
    );
  if (clip && row.stage === 'upscale')
    return (
      <UpscaleImport
        clip={clip}
        media={media}
        episodeId={record._id}
        sceneId={scene.id}
        disabled={disabled}
        onImport={onImportUpscale}
        review={row}
      />
    );
  if (row.stage === 'storyboard' || row.stage === 'animatic')
    return (
      <Stack spacing={2}>
        {clip && row.stage === 'storyboard' && (
          <Box>
            <Typography fontWeight={600}>Current shot directions</Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{clip.action}</Typography>
            <Typography sx={{ mt: 1 }}>{clip.production?.passCondition}</Typography>
          </Box>
        )}
        <AnimaticPreview
          scene={clip ? { ...scene, clips: [clip] } : scene}
          episodeId={record._id}
          assets={assets}
          media={media}
          playable={row.stage === 'animatic'}
        />
      </Stack>
    );
  if (row.target.scope === 'asset') {
    const revisionPlan = row.stage.startsWith('reference-plan:');
    const item = record.production?.items?.find(
      (i) => (revisionPlan ? 'reference-plan:' : 'reference:') + i.id === row.stage
    );
    if (item)
      return (
        <Stack spacing={1}>
          <Typography>{item.notes}</Typography>
          {item.imagePrompt && (
            <Box>
              <Typography fontWeight={600}>Exact image prompt sent to OpenArt</Typography>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>{item.imagePrompt}</Typography>
            </Box>
          )}
          {revisionPlan && (
            <Alert severity="info">
              Approve these revised directions to generate one replacement image. Applying the draft
              saved the plan; it did not approve or render it. The replacement image will need its
              own approval.
            </Alert>
          )}
          {!revisionPlan && item.mediaId && (
            <ReferencePreview file={media.find((m) => m._id === item.mediaId)} />
          )}
        </Stack>
      );
    return (
      <Stack spacing={1}>
        <Typography sx={{ whiteSpace: 'pre-wrap' }}>
          {row.stage === 'brief' ? record.brief : record.production?.sourceNotes}
        </Typography>
        {row.stage === 'source' && record.production?.sourceUrl && (
          <Button component="a" href={record.production.sourceUrl} target="_blank" rel="noreferrer">
            Open source footage
          </Button>
        )}
        {row.stage === 'source' &&
          (record.production?.sourceMediaIds ?? []).map((mid) => (
            <ReferencePreview key={mid} file={media.find((m) => m._id === mid)} />
          ))}
      </Stack>
    );
  }
  if (row.stage === 'source')
    return (
      <Stack spacing={1}>
        <Typography variant="h3">Saved source research</Typography>
        <Typography sx={{ whiteSpace: 'pre-wrap' }}>{record.production?.sourceNotes}</Typography>
        {record.sourceReferences?.map((ref) => (
          <Box key={ref.id}>
            <Typography>
              {ref.chapter || ref.title} · {sourceTime(ref.startSeconds)}–
              {sourceTime(ref.endSeconds)} · {ref.status}
            </Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{ref.notes}</Typography>
            <Button component="a" href={sourceLink(ref)} target="_blank" rel="noreferrer">
              Open source footage
            </Button>
          </Box>
        ))}
      </Stack>
    );
  if (row.stage === 'outline')
    return (
      <Typography sx={{ whiteSpace: 'pre-wrap' }}>
        {record.production?.outline || record.premise}
      </Typography>
    );
  if (row.stage === 'script')
    return <Typography sx={{ whiteSpace: 'pre-wrap' }}>{scene.script}</Typography>;
  if (row.stage === 'shot-plan')
    return (
      <Stack spacing={2}>
        {scene.clips.map((c) => (
          <Box key={c.id}>
            <Typography variant="h3">
              {c.title} · {c.duration}s · {c.production?.mode || 'Choose mode'}
            </Typography>
            <Typography>
              {c.production?.framing} {c.camera}
            </Typography>
            <Typography>{c.action}</Typography>
            {c.production?.location && (
              <Typography>
                Shot location: {c.production.location} · {c.production.environment}
              </Typography>
            )}
            {c.production?.physicalConstraints && (
              <Typography>{c.production.physicalConstraints}</Typography>
            )}
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{c.production?.beats}</Typography>
            <Typography>{c.dialogue}</Typography>
            <Typography>Pass: {c.production?.passCondition || 'Not set'}</Typography>
            <Typography variant="body2">
              Reference views:{' '}
              {c.production?.referenceMediaIds?.length
                ? c.production.referenceMediaIds
                    .map((mid) => media.find((m) => m._id === mid)?.originalName ?? 'Missing file')
                    .join(', ')
                : 'Linked reference pack'}
            </Typography>
            <Typography variant="body2">
              Shot continuity: {c.production?.continuityMode || 'auto'} ·{' '}
              {shotContinuity(record, scene, c, assets, media)
                .sources.map((s) => s.title)
                .join(' / ') || 'No earlier shots inherited.'}
            </Typography>
            {c.production?.continuityNotes && (
              <Typography variant="body2">Preserve: {c.production.continuityNotes}</Typography>
            )}
            <Button component="a" href={`#shot-inputs-${c.id}`}>
              Go to this shot's continuity settings
            </Button>
          </Box>
        ))}
      </Stack>
    );
  if (row.stage === 'sound-plan')
    return (
      <Stack spacing={1}>
        <Alert severity="info">
          New Wan renders generate these effects and ambience with the picture. Review the resulting
          picture and soundtrack together. Separate sound generation and mixing are repair options;
          music is added in CapCut.
        </Alert>
        <Typography>{scene.soundPlan?.notes}</Typography>
        {scene.soundPlan?.layers.map((l) => (
          <Typography key={l.id}>
            {l.title}: {l.description}
          </Typography>
        ))}
      </Stack>
    );
  if (row.stage === 'references')
    return (
      <Stack>
        {assets
          .filter((a) => scene.assetIds.includes(a._id))
          .map((a) => (
            <Button key={a._id} component="a" href={studioUrl('/?asset=' + a._id)}>
              {a.name}
            </Button>
          ))}
      </Stack>
    );
  if (clip)
    return (
      <Stack spacing={1}>
        {row.stage === 'visual' && row.title === 'Video picture, performance and sound' && (
          <Alert severity="info">
            Review the full take with sound: synchronized effects, continuous ambience, clear
            dialogue and no music. Approval accepts this original soundtrack without a separate mix.
          </Alert>
        )}
        <ReferencePreview
          file={media.find(
            (m) =>
              m._id ===
              (row.stage === 'visual'
                ? clip.production?.visualTakeId
                : clip.production?.upscaleMediaId)
          )}
        />
      </Stack>
    );
  return (
    <Typography>
      Review shot order, approved final-resolution clips and separate audio files before exporting.
    </Typography>
  );
}
function ReviewRow({
  row,
  record,
  assets,
  media,
  disabled,
  draftPending,
  onChanged,
  onImportUpscale,
  proposals = empty,
  jobs = empty
}) {
  const anchor = reviewAnchor(row.target, row.stage);
  const generation =
    row.target.scope === 'asset' && row.stage.startsWith('reference:')
      ? jobs.find(
          (job) =>
            job.target?.assetId === row.target.recordId &&
            job.target?.packageItemId === row.stage.slice(10)
        )
      : null;
  const missingImage =
    row.target.scope === 'asset' &&
    !record.production?.items?.find((i) => 'reference:' + i.id === row.stage)?.mediaId;
  const generationFailed = missingImage && generation?.status === 'failed';
  const generationLabel =
    missingImage && generation
      ? {
          failed: 'Generation failed',
          queued: 'Queued for generation',
          preparing: 'Preparing generation',
          submitting: 'Submitting generation',
          rendering: 'Generating image',
          importing: 'Saving generated image',
          uncertain: 'Generation outcome unknown'
        }[generation.status]
      : null;
  const [expanded, setExpanded] = useState(
    generationFailed ||
      row.lastAction === 'request-changes' ||
      ((['episode', 'scene'].includes(row.target.scope) ||
        (row.target.scope === 'asset' && row.stage === 'source' && row.status === 'draft') ||
        (row.target.scope === 'clip' && ['storyboard', 'animatic'].includes(row.stage))) &&
        !['approved', 'blocked'].includes(row.status))
  );
  useEffect(() => {
    let frame;
    const follow = () => {
      if (window.location.hash !== '#' + anchor) return;
      setExpanded(true);
      frame = requestAnimationFrame(() => focusSection(anchor));
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => {
      window.removeEventListener('hashchange', follow);
      cancelAnimationFrame(frame);
    };
  }, [anchor]);
  const [feedback, setFeedback] = useState(row.feedback),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState(''),
    [savedReceipt, setSavedReceipt] = useState(null);
  const receipt =
    savedReceipt ??
    (row.lastAction === 'request-changes' && row.feedback
      ? {
          savedAt: row.savedAt,
          feedback: row.feedback
        }
      : null);
  const [verifiedSourceIds, setVerifiedSourceIds] = useState([]);
  const sourceReview = row.target.scope === 'episode' && row.stage === 'source';
  const canVerify = sourceReview && verifiedSourceIds.length > 0;
  const hasReplacement =
    ['episode', 'scene'].includes(row.target.scope) &&
    proposals.some((proposal) => proposalBlocksReview(proposal, row.stage, record, row.target));
  const turnaround = row.automatic && row.stage === 'reference:body-turnaround';
  const turnaroundFile = record.production?.items?.find(
    (item) => item.id === 'body-turnaround'
  )?.mediaId;
  const turnaroundCandidate = record.candidates?.find(
    (candidate) => !candidate.archived && candidate.mediaIds?.includes(turnaroundFile)
  );
  async function act(action) {
    setBusy(true);
    setPendingAction(action);
    setSavedReceipt(null);
    setError('');
    try {
      if (action === 'finalize-turnaround' || action === 'reopen-turnaround') {
        await request(
          `/studio/assets/${record._id}/${action === 'finalize-turnaround' ? 'finalize' : 'reopen'}`,
          {
            method: 'POST',
            body: { revision: row.parentRevision, candidateId: turnaroundCandidate?.id }
          }
        );
      } else {
        const result = await request('/studio/workflow/review', {
          method: 'POST',
          body: {
            target: row.target,
            stage: row.stage,
            action,
            fingerprint: row.fingerprint,
            parentRevision: row.parentRevision,
            reviewRevision: row.reviewRevision,
            feedback,
            ...(action === 'approve' && canVerify ? { verifiedSourceIds } : {})
          }
        });
        if (result.receipt) setSavedReceipt(result.receipt);
      }
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setPendingAction('');
    }
  }
  async function discussFeedback() {
    setBusy(true);
    setError('');
    try {
      const context =
        row.target.scope === 'asset'
          ? {
              assetId: row.target.recordId,
              ...(row.stage.startsWith('reference:')
                ? { packageItemId: row.stage.slice(10) }
                : row.stage.startsWith('reference-plan:')
                  ? { packageItemId: row.stage.slice(15) }
                  : {})
            }
          : {
              episodeId: row.target.recordId,
              sceneId: row.target.sceneId,
              clipId: row.target.clipId
            };
      const subject =
        record.scenes
          ?.find((s) => s.id === row.target.sceneId)
          ?.clips.find((c) => c.id === row.target.clipId)?.title ??
        record.name ??
        row.title;
      const title = `Requested changes: ${subject}`.slice(0, 160);
      const { chat } = await request('/studio/assistant/chats', {
        method: 'POST',
        body: { title, context }
      });
      localStorage.setItem(
        'roxy-chat-draft-' + chat._id,
        JSON.stringify({
          text: `Please prepare a revision draft for my saved ${row.title} change request.\n\nFeedback: ${receipt.feedback}\n\nPreserve unrelated creative choices. Propose the changes for my review; do not approve anything or generate media.`,
          mediaIds: [],
          requestId: crypto.randomUUID()
        })
      );
      window.location.assign(studioUrl('/?chat=' + chat._id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Accordion
      id={anchor}
      tabIndex={-1}
      sx={{ scrollMarginTop: '110px' }}
      disableGutters
      aria-busy={busy}
      expanded={expanded}
      onChange={(_event, open) => setExpanded(open)}
    >
      <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
        <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography>{row.title}</Typography>
          {pendingAction === 'request-changes' && (
            <CircularProgress size={16} aria-label="Saving change request" />
          )}
          <Chip
            size="small"
            label={generationLabel || labels[row.status] || row.status}
            color={
              generationFailed
                ? 'error'
                : row.status === 'approved'
                  ? 'success'
                  : row.status === 'pending-review'
                    ? 'warning'
                    : 'default'
            }
          />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          {generationFailed && (
            <Alert severity="error">
              <Typography fontWeight={600}>Image generation failed</Typography>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                {generation.error || 'OpenArt returned no image. Check the generation history.'}
              </Typography>
              <Typography variant="body2">
                This image has not been generated successfully and cannot be approved. Prepare
                revised image directions for review before another request. The failed request is
                not retried automatically.
              </Typography>
            </Alert>
          )}
          {pendingAction === 'request-changes' && (
            <Alert severity="info" role="status" icon={<CircularProgress size={20} />}>
              Saving change request… Your feedback is not confirmed saved yet.
            </Alert>
          )}
          {receipt && pendingAction !== 'request-changes' && (
            <Alert severity="success" role="status">
              <Typography fontWeight={600}>Change request saved</Typography>
              {receipt.savedAt && (
                <Typography variant="body2">
                  Saved {new Date(receipt.savedAt).toLocaleString()}
                </Typography>
              )}
              <Typography sx={{ whiteSpace: 'pre-wrap', my: 1 }}>{receipt.feedback}</Typography>
              <Typography variant="body2">
                This button records feedback; it does not automatically prepare a revision or start
                a render. Discuss saved feedback opens a production chat with this request filled
                in. Send that message to start revision work; the chat shows its progress.
              </Typography>
              {row.feedbackIsCurrent === false && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  This feedback was saved against an earlier version. Review the current draft
                  before approving.
                </Typography>
              )}
              <Button disabled={disabled || busy} onClick={discussFeedback}>
                Discuss saved feedback
              </Button>
            </Alert>
          )}
          <ReviewContent
            row={row}
            record={record}
            assets={assets}
            media={media}
            disabled={disabled || (draftPending && row.stage === 'upscale')}
            onImportUpscale={onImportUpscale}
          />
          {row.retainedApproval && (
            <Alert severity="success">
              Your existing approval is retained. This shot's approved content and references are
              unchanged; revisions to other shots do not require you to approve it again.
            </Alert>
          )}
          {row.coveredByScene && (
            <Alert severity="info">
              Covered by your current whole-scene approval. No separate approval is needed.
            </Alert>
          )}
          {hasReplacement && (
            <Alert severity="warning">
              A revised draft is waiting above. Apply or dismiss it before approving this saved
              version.
              <Button component="a" href="#production-revisions">
                Go to revised drafts
              </Button>
            </Alert>
          )}
          {sourceReview && row.status !== 'approved' && (
            <Stack spacing={1}>
              <Alert severity="info">
                Asset approvals preserve your creative choices. This review confirms the gameplay
                events and decisions used for the adaptation. Select only ranges you reviewed;
                unchecked ranges remain unverified. Approving research unlocks the episode outline
                below.
              </Alert>
              {(record.sourceReferences ?? [])
                .filter((ref) => ref.status !== 'verified')
                .map((ref) => (
                  <FormControlLabel
                    key={ref.id}
                    control={
                      <Checkbox
                        disabled={disabled || busy}
                        checked={verifiedSourceIds.includes(ref.id)}
                        onChange={(e) =>
                          setVerifiedSourceIds((ids) =>
                            e.target.checked ? [...ids, ref.id] : ids.filter((id) => id !== ref.id)
                          )
                        }
                      />
                    }
                    label={`I reviewed ${ref.chapter || ref.title} and confirm its recorded events and decisions`}
                  />
                ))}
            </Stack>
          )}
          {row.blockers.length > 0 && (
            <Alert severity="info">
              {[...new Set(row.blockers)].join(' ')}
              <ReviewLinks rows={row.prerequisites} currentId={record._id} />
              {row.target.scope === 'asset' && row.stage === 'source' && (
                <Button
                  component="a"
                  href="#asset-production-inputs"
                  onClick={() => focusSection('asset-production-inputs')}
                >
                  Go to source evidence fields
                </Button>
              )}
              {row.target.scope === 'clip' && row.stage !== 'upscale' && (
                <Button component="a" href={`#shot-inputs-${row.target.clipId}`}>
                  Go to shot images and inputs
                </Button>
              )}
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {turnaround && (
            <Button
              variant="contained"
              disabled={
                disabled ||
                busy ||
                !turnaroundCandidate ||
                row.blockers.some((reason) => reason.startsWith('Approve '))
              }
              onClick={() =>
                act(row.status === 'approved' ? 'reopen-turnaround' : 'finalize-turnaround')
              }
            >
              {row.status === 'approved' ? 'Unapprove body turnaround' : 'Approve body turnaround'}
            </Button>
          )}
          {!row.automatic && (
            <>
              <TextField
                label="Review feedback"
                multiline
                minRows={2}
                value={feedback}
                disabled={disabled || busy}
                onChange={(e) => setFeedback(e.target.value)}
              />
              <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  disabled={
                    disabled ||
                    busy ||
                    hasReplacement ||
                    ['music-plan', 'music'].includes(row.stage) ||
                    (!row.canApprove && !canVerify) ||
                    row.status === 'approved'
                  }
                  onClick={() => act('approve')}
                >
                  {canVerify
                    ? 'Verify selected sources and approve research'
                    : `Approve ${row.title}`}
                </Button>
                <Button
                  disabled={
                    disabled ||
                    busy ||
                    !feedback.trim() ||
                    (row.lastAction === 'request-changes' &&
                      row.feedbackIsCurrent &&
                      row.feedback.trim() === feedback.trim())
                  }
                  onClick={() => act('request-changes')}
                >
                  {pendingAction === 'request-changes'
                    ? 'Saving change request…'
                    : 'Request changes'}
                </Button>
                <Button
                  disabled={
                    disabled ||
                    busy ||
                    !['approved', 'needs-review', 'needs-changes'].includes(row.status)
                  }
                  onClick={() => act('unapprove')}
                >
                  Unapprove
                </Button>
              </Stack>
            </>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
export default function ProductionBoard({
  record,
  scope,
  assets = empty,
  media = empty,
  saving = false,
  draftPending = false,
  onChanged,
  onImportUpscale
}) {
  // Reviews operate on the server snapshot below, never the unsaved editor.
  // Only an active save pauses actions; a retained local draft is informational.
  const disabled = saving;
  const [board, setBoard] = useState(null),
    [error, setError] = useState(''),
    [retrying, setRetrying] = useState(false);
  const sequence = useRef({ value: 0 });
  useEffect(() => {
    const followCurrentHash = (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.hash && destination.href === window.location.href)
        window.dispatchEvent(new HashChangeEvent('hashchange'));
    };
    document.addEventListener('click', followCurrentHash);
    return () => document.removeEventListener('click', followCurrentHash);
  }, []);
  const refresh = useCallback(async () => {
    const requestId = ++sequence.current.value;
    try {
      const next = await request('/studio/workflow/board', {
        method: 'POST',
        body: { target: { scope, recordId: record._id } }
      });
      if (requestId !== sequence.current.value) return;
      setBoard(next);
      setError('');
    } catch (e) {
      if (requestId === sequence.current.value) setError(e.message);
    }
  }, [record._id, scope]);
  useEffect(() => {
    const counter = sequence.current;
    void Promise.resolve().then(refresh);
    const timer = setInterval(refresh, 10000);
    return () => {
      ++counter.value;
      clearInterval(timer);
    };
  }, [refresh, record.revision, assets, media]);
  async function changed() {
    await refresh();
    await onChanged?.();
  }
  const reviewRecord = board?.record ?? record;
  return (
    <Box
      id="production-approval-board"
      className="editor-panel"
      component="section"
      aria-label="Production approval board"
      sx={{ scrollMarginTop: '100px' }}
    >
      <Stack spacing={2}>
        <Typography variant="h2">Production approval board</Typography>
        {board?.enabled && (
          <Box component="nav" aria-label="Approval shortcuts">
            <Typography fontWeight={600}>Reviews waiting for you</Typography>
            <ReviewLinks
              currentId={record._id}
              prefix="Review"
              rows={board.groups
                .filter((g) => !g.optional)
                .flatMap((g) => g.stages)
                .filter(
                  (r) => r.status !== 'approved' && (r.canApprove || r.status === 'needs-changes')
                )
                .map((r) => ({
                  ...r,
                  navigationTitle: [
                    reviewRecord.scenes
                      ?.find((s) => s.id === r.target.sceneId)
                      ?.clips.find((c) => c.id === r.target.clipId)?.title ||
                      reviewRecord.scenes?.find((s) => s.id === r.target.sceneId)?.title,
                    r.title
                  ]
                    .filter(Boolean)
                    .join(' / ')
                }))}
            />
          </Box>
        )}
        <Typography>
          Review each stage in order. Approval covers the saved version; changed inputs reopen
          affected downstream reviews.
        </Typography>
        {draftPending && (
          <Alert severity="info" role="note">
            These reviews use the saved version shown on this board. Your unsaved editor draft is
            preserved separately and does not block saved reviews. Save your edits first if you want
            them included in an approval. File imports remain paused until your edits are saved.
          </Alert>
        )}
        {disabled && (
          <Alert severity="info" role="status">
            An editor save is in progress. Review controls will be available when it finishes.
          </Alert>
        )}
        {board?.enabled && (
          <Alert severity="info" role="note">
            Approval automatically queues the next supported generation step when its prerequisites
            are approved. Source approval unlocks the saved outline, or queues a replacement if one
            is missing or needs revision. Outline approval queues a first-scene proposal through
            your ChatGPT plan. Once a scene script and its references are approved, missing shot and
            sound plans are prepared automatically for review. Review and apply proposals here or in
            production chat before approving saved stages. Character packages start with the master
            portrait; approve it before the remaining images generate. Shot images and dialogue
            follow an approved shot plan and references. Each video follows its own approved image,
            storyboard and timed animatic, selected dialogue and the approved sound plan. Other shot
            storyboards do not block it. One video renders at a time and waits for your review. New
            Wan takes include native sound; separate mixing is for repairs. Failed renders are not
            retried automatically.
          </Alert>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {scope === 'episode' &&
          board?.groups?.[0]?.stages.some(
            (row) => row.stage === 'source' && row.status === 'approved'
          ) && (
            <Alert severity="success" role="note">
              Source research is approved. Remaining outline or scene drafts are separate workflow
              steps.
            </Alert>
          )}
        <ProductionDrafts
          proposals={board?.proposals}
          record={reviewRecord}
          disabled={disabled}
          onChanged={changed}
        />
        {board?.progress && (
          <Alert severity={board.progress.state === 'blocked' ? 'warning' : 'info'} role="status">
            {board.progress.message}
            {board.progress.review && (
              <Button
                component="a"
                href={reviewHref(
                  board.progress.review.target,
                  board.progress.review.stage,
                  record._id
                )}
              >
                Go to {board.progress.review.title}
              </Button>
            )}
            {board.progress.proposalId && (
              <Button component="a" href={`#proposal-${board.progress.proposalId}`}>
                Go to proposed revision
              </Button>
            )}
          </Alert>
        )}
        {board?.progress?.chatId && (
          <Button component="a" href={studioUrl('/?chat=' + board.progress.chatId)}>
            Open story draft in production chat
          </Button>
        )}
        {board?.sourceEvidence?.length > 0 && (
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
              Saved gameplay evidence
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                {board.sourceEvidence.map((packet) => (
                  <Box key={packet._id}>
                    <Typography variant="h3">{packet.title}</Typography>
                    <Typography sx={{ whiteSpace: 'pre-wrap', my: 1 }}>
                      {packet.observations}
                    </Typography>
                    <Typography variant="body2">{packet.limitations}</Typography>
                    {packet.videoMediaId && (
                      <ReferencePreview
                        file={media.find((file) => file._id === packet.videoMediaId)}
                      />
                    )}
                    <Stack spacing={1}>
                      {(packet.frames ?? [])
                        .filter((frame) => frame.overview)
                        .map((frame) => (
                          <ReferencePreview
                            key={frame.mediaId}
                            file={media.find((file) => file._id === frame.mediaId)}
                          />
                        ))}
                    </Stack>
                    {(packet.frames ?? []).some((f) => f.captured) && (
                      <Stack spacing={2} sx={{ mt: 2 }}>
                        <Typography variant="h3">Captured subtitle frames</Typography>
                        <Typography variant="body2">
                          Original-video timestamps. Captures are research evidence; they do not
                          approve dialogue or dialogue-wheel choices.
                        </Typography>
                        {(packet.frames ?? [])
                          .filter((f) => f.captured)
                          .toSorted((a, b) => a.requestedSeconds - b.requestedSeconds)
                          .map((frame) => (
                            <Box key={frame.captureKey}>
                              <Typography fontWeight={600}>
                                Source {sourceTime(frame.requestedSeconds)} · {frame.width} ×{' '}
                                {frame.height}
                              </Typography>
                              <ReferencePreview
                                file={
                                  media.find((m) => m._id === frame.mediaId) ?? {
                                    _id: frame.mediaId,
                                    kind: 'image',
                                    originalName: `Source frame at ${sourceTime(frame.requestedSeconds)}`
                                  }
                                }
                              />
                              {frame.subtitleCropMediaId && (
                                <ReferencePreview
                                  file={
                                    media.find((m) => m._id === frame.subtitleCropMediaId) ?? {
                                      _id: frame.subtitleCropMediaId,
                                      kind: 'image',
                                      originalName: `Subtitle crop at ${sourceTime(frame.requestedSeconds)}`
                                    }
                                  }
                                />
                              )}
                            </Box>
                          ))}
                      </Stack>
                    )}
                  </Box>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        )}
        {board?.progress?.retrySteps?.length > 0 && (
          <Button
            variant="contained"
            disabled={
              disabled ||
              retrying ||
              board.automation?.some((a) => ['queued', 'running'].includes(a.status))
            }
            onClick={async () => {
              setRetrying(true);
              setError('');
              try {
                await request('/studio/workflow/retry', {
                  method: 'POST',
                  body: {
                    target: { scope, recordId: record._id },
                    parentRevision: record.revision,
                    requestId: crypto.randomUUID()
                  }
                });
                await refresh();
              } catch (e) {
                setError(e.message);
              } finally {
                setRetrying(false);
              }
            }}
          >
            Retry failed requests ({board.progress.retrySteps.length})
          </Button>
        )}
        {disabled && (
          <Alert severity="info">Save your draft before reviewing production stages.</Alert>
        )}
        {board?.automation
          ?.filter((a) => ['queued', 'running', 'failed'].includes(a.status))
          .map((action) => (
            <Alert key={action._id} severity={action.status === 'failed' ? 'warning' : 'info'}>
              {action.status === 'failed'
                ? `Approval saved. The next step needs attention: ${action.error}`
                : 'Next production step queued. Jobs continue when you leave this page.'}
            </Alert>
          ))}
        {board?.enabled && board.nextSteps?.length > 0 && (
          <Button
            variant="contained"
            disabled={
              disabled || board.automation?.some((a) => ['queued', 'running'].includes(a.status))
            }
            onClick={async () => {
              try {
                await request('/studio/workflow/advance', {
                  method: 'POST',
                  body: {
                    target: { scope, recordId: reviewRecord._id },
                    parentRevision: reviewRecord.revision
                  }
                });
                await refresh();
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Start next production step ({board.nextSteps.length}{' '}
            {board.nextSteps.some((step) => step.kind.startsWith('story-')) ? 'requests' : 'jobs'})
          </Button>
        )}
        {board?.jobs?.length > 0 && (
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
              Production jobs and retries
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1}>
                {board.jobs.map((job) => (
                  <Alert
                    key={job._id}
                    severity={['failed', 'uncertain'].includes(job.status) ? 'warning' : 'info'}
                  >
                    {job.title}: {job.status}. {job.error}
                    {job.quote?.items?.[0] &&
                      ` Quoted ${job.quote.items[0].totalCredits} list credits for the recorded configuration.`}
                  </Alert>
                ))}
                {board.jobs.filter((j) => ['failed', 'uncertain'].includes(j.status)).length >=
                  2 && (
                  <Alert severity="warning">
                    Review the failure reasons and change the cause before another retry. Paid
                    failures are not resubmitted automatically.
                  </Alert>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>
        )}
        {board && !board.enabled ? (
          <>
            <Alert severity="info">
              This project uses the existing workflow. Enable the review workflow to require source,
              planning, animatic and finished-clip approvals. Existing selections are retained.
            </Alert>
            <Button
              disabled={disabled}
              onClick={async () => {
                try {
                  await request('/studio/workflow/enable', { method: 'POST', body: {} });
                  window.location.reload();
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Enable approval workflow for this project
            </Button>
          </>
        ) : (
          board?.groups.map((group) => (
            <Box
              key={group.title + JSON.stringify(group.target)}
              component={group.target?.scope === 'clip' ? 'section' : 'div'}
              aria-label={
                group.target?.scope === 'clip' ? `Prerequisites: ${group.title}` : undefined
              }
              id={
                group.target?.scope === 'clip'
                  ? `picture-prerequisites-${group.target.clipId}`
                  : undefined
              }
              sx={{ scrollMarginTop: '100px' }}
            >
              <Typography variant="h3" sx={{ mb: 1 }}>
                {group.title}
              </Typography>
              {group.target?.scope === 'clip' && (
                <Typography sx={{ mb: 2 }}>
                  Approve this clip's storyboard, then its timed animatic. When its image, dialogue
                  and shared scene prerequisites are approved, the video queues automatically. Other
                  shots can remain unfinished. Review each generated video before advancing.
                </Typography>
              )}
              {group.optional && (
                <Typography sx={{ mb: 2 }}>
                  Optional: review all shots together. These approvals cover the individual clips,
                  but are not required when you approve each clip's storyboard and timing
                  separately.
                </Typography>
              )}
              {group.stages.map((row) => (
                <ReviewRow
                  key={row.key + row.reviewRevision + row.fingerprint}
                  row={row}
                  record={reviewRecord}
                  assets={assets}
                  media={media}
                  proposals={board.proposals}
                  jobs={board.jobs}
                  disabled={disabled}
                  draftPending={draftPending}
                  onChanged={changed}
                  onImportUpscale={onImportUpscale}
                />
              ))}
            </Box>
          ))
        )}
      </Stack>
    </Box>
  );
}
