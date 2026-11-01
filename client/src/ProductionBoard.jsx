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
import { cleanRenderPrompt } from '../../shared/render-prompt.js';
import { shotContinuity } from '../../shared/shot-continuity.js';
import AnimaticPreview from './AnimaticPreview.jsx';
import { request } from './api.js';
import AssetSourceEvidence from './AssetSourceEvidence.jsx';
import ProductionDrafts from './ProductionDrafts.jsx';
import { studioUrl } from './project-url.js';
import { focusSection, reviewAnchor, reviewHref } from './review-navigation.js';
import ReviewLinks from './ReviewLinks.jsx';
import SceneBoardEditor from './SceneBoardEditor.jsx';
import SceneMusic from './SceneMusic.jsx';
import ShotProductionCard from './ShotProductionCard.jsx';
import ShotTransitionSummary from './ShotTransitionSummary.jsx';
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
          ? 'Approval saves this music brief. Review its complete prompt, duration and credit estimate, then use Generate music in this section.'
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
            {clip.production?.startState && (
              <Typography>Start: {clip.production.startState}</Typography>
            )}
            {clip.production?.allowedMotion && (
              <Typography>Movement: {clip.production.allowedMotion}</Typography>
            )}
            {clip.production?.endState && (
              <Typography>End at cut: {clip.production.endState}</Typography>
            )}
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
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                {cleanRenderPrompt(item.imagePrompt)}
              </Typography>
            </Box>
          )}
          {revisionPlan && (
            <Alert severity="info">
              Approve these revised directions, then use Generate image for one replacement.
              Applying or approving the draft saves your choices without rendering. Review the
              resulting image separately.
            </Alert>
          )}
          {!revisionPlan && item.mediaId && (
            <ReferencePreview file={media.find((m) => m._id === item.mediaId)} />
          )}
        </Stack>
      );
    if (row.stage === 'source') return <AssetSourceEvidence asset={record} media={media} />;
    return <Typography sx={{ whiteSpace: 'pre-wrap' }}>{record.brief}</Typography>;
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
            {c.production?.startState && <Typography>Start: {c.production.startState}</Typography>}
            {c.production?.allowedMotion && (
              <Typography>Movement: {c.production.allowedMotion}</Typography>
            )}
            {c.production?.endState && <Typography>End at cut: {c.production.endState}</Typography>}
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
  jobs = empty,
  referencePrompts = empty
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
    [savedReceipt, setSavedReceipt] = useState(null),
    [timingNotice, setTimingNotice] = useState('');
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
    ['episode', 'scene', 'clip'].includes(row.target.scope) &&
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
      } else if (action === 'prepare-timing') {
        const result = await request('/studio/workflow/animatic/prepare', {
          method: 'POST',
          body: { target: row.target, parentRevision: row.parentRevision }
        });
        setTimingNotice(result.message);
      } else {
        const result = await request('/studio/workflow/review', {
          method: 'POST',
          body: {
            target: row.target,
            stage: row.stage,
            action,
            fingerprint: row.fingerprint,
            ...(row.stage === 'sound-plan' && row.approvalFingerprint
              ? { approvalFingerprint: row.approvalFingerprint }
              : {}),
            parentRevision: row.parentRevision,
            reviewRevision: row.reviewRevision,
            feedback,
            ...(action === 'approve' && canVerify ? { verifiedSourceIds } : {})
          }
        });
        if (result.receipt) setSavedReceipt(result.receipt);
        if (result.timingRepair || result.pendingDraft) setTimingNotice(result.message);
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
      sx={{ scrollMarginTop: '200px' }}
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
                {timingNotice || (row.stage === 'animatic' && hasReplacement)
                  ? 'A timing revision draft is ready above. Review and apply it before approving the animatic. No render has started.'
                  : 'This button records feedback; it does not automatically prepare a revision or start a render. Discuss saved feedback opens a production chat with this request filled in. Send that message to start revision work; the chat shows its progress.'}
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
          {row.target.scope === 'asset' &&
            row.stage.startsWith('reference:') &&
            referencePrompts.find((p) => p.itemId === row.stage.slice(10)) && (
              <Stack spacing={1}>
                <TextField
                  label="Saved image generation prompt"
                  multiline
                  minRows={4}
                  maxRows={12}
                  value={referencePrompts.find((p) => p.itemId === row.stage.slice(10)).prompt}
                  slotProps={{ input: { readOnly: true } }}
                />
                <Button
                  variant="contained"
                  disabled={
                    disabled ||
                    busy ||
                    Boolean(
                      generation &&
                      [
                        'queued',
                        'preparing',
                        'submitting',
                        'rendering',
                        'importing',
                        'uncertain'
                      ].includes(generation.status)
                    )
                  }
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await request('/studio/assistant/image/generate', {
                        method: 'POST',
                        body: {
                          assetId: record._id,
                          revision: record.revision,
                          packageItemId: row.stage.slice(10),
                          prompt: referencePrompts.find((p) => p.itemId === row.stage.slice(10))
                            .prompt,
                          requestId: crypto.randomUUID()
                        }
                      });
                      await onChanged();
                    } catch (failure) {
                      setError(failure.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Generate image
                </Button>
              </Stack>
            )}
          {row.retainedApproval && (
            <Alert severity="success">
              Your existing approval is retained. The approved content and its relevant sources and
              references are unchanged; edits elsewhere do not require you to approve it again.
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
          {timingNotice && (
            <Alert severity="warning">
              {timingNotice}
              <Button component="a" href="#production-revisions">
                Go to timing draft
              </Button>
            </Alert>
          )}
          {row.stage === 'animatic' && row.timingIssues?.length > 0 && (
            <Alert severity="warning">
              {row.timingIssues.map((issue) => (
                <Typography key={issue.clipId}>{issue.message}</Typography>
              ))}
              <Button
                disabled={disabled || busy || hasReplacement}
                onClick={() => act('prepare-timing')}
              >
                Prepare split or retimed shots
              </Button>
            </Alert>
          )}
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
  onAssetSaved,
  onRejected,
  onChanged,
  onImportUpscale
}) {
  // Reviews operate on the server snapshot below, never the unsaved editor.
  // Only an active save pauses actions; a retained local draft is informational.
  const disabled = saving;
  const [board, setBoard] = useState(null),
    [error, setError] = useState(''),
    [retrying, setRetrying] = useState(false),
    [starting, setStarting] = useState(false),
    [startReceipt, setStartReceipt] = useState(''),
    [jobsExpanded, setJobsExpanded] = useState(false);
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
  useEffect(() => {
    let frame;
    const follow = () => {
      const anchor = window.location.hash.slice(1);
      if (anchor !== 'production-jobs' && !anchor.startsWith('production-job-')) return;
      setJobsExpanded(true);
      frame = requestAnimationFrame(() => focusSection(anchor));
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => {
      window.removeEventListener('hashchange', follow);
      cancelAnimationFrame(frame);
    };
  }, [board?.jobs?.length]);
  const refresh = useCallback(async () => {
    const requestId = ++sequence.current.value;
    try {
      const next = await request('/studio/workflow/board', {
        method: 'POST',
        body: { target: { scope, recordId: record._id }, boardVersion: 3 }
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
  const subject = (target) => {
    const scene = reviewRecord.scenes?.find((s) => s.id === target?.sceneId);
    return (
      scene?.clips.find((c) => c.id === target?.clipId)?.title ||
      scene?.title ||
      reviewRecord.name ||
      'Production'
    );
  };
  const inputHref = (step) => {
    if (step.kind === 'voice' && step.resultAssetId)
      return studioUrl('/?asset=' + step.resultAssetId);
    const target = step.target;
    if (board?.layout === 'scenes' && target?.clipId)
      return `#picture-prerequisites-${target.clipId}`;
    if (target?.clipId)
      return `#shot-${step.kind === 'dialogue' ? 'dialogue' : 'inputs'}-${target.clipId}`;
    if (target?.assetId)
      return reviewHref(
        { scope: 'asset', recordId: target.assetId },
        target.packageItemId ? 'reference:' + target.packageItemId : 'brief',
        record._id
      );
    if (target?.sceneId && step.kind === 'music') return '#music-' + target.sceneId;
    return '#production-jobs';
  };
  const reviews = (board?.groups ?? [])
    .filter((g) => !g.optional)
    .flatMap((g) => g.stages)
    .filter((r) => r.status !== 'approved' && (r.canApprove || r.status === 'needs-changes'))
    .map((r) => ({
      ...r,
      navigationTitle: [subject(r.target), r.title].join(' / '),
      navigationHref:
        board?.layout === 'scenes' && r.target.scope === 'clip'
          ? `#picture-prerequisites-${r.target.clipId}`
          : undefined
    }));
  const blockedSteps = board?.blockedSteps ?? [];
  // Keep only the newest attempt for each scope. Older failures remain in job history.
  const seenTargets = new Set();
  const failedActions = (board?.automation ?? []).filter((action) => {
    const key = JSON.stringify(action.target ?? {});
    if (seenTargets.has(key)) return false;
    seenTargets.add(key);
    return action.status === 'failed';
  });
  const issues = [
    ...blockedSteps,
    ...failedActions.flatMap((action) =>
      action.failures?.length ? action.failures : [{ error: action.error }]
    )
  ].filter(
    (issue, index, all) =>
      !all
        .slice(0, index)
        .some(
          (prior) =>
            prior.error === issue.error &&
            JSON.stringify(prior.target) === JSON.stringify(issue.target)
        ) &&
      !(index >= blockedSteps.length && blockedSteps.some((step) => step.error === issue.error))
  );
  const latestJobs = new Map();
  for (const job of board?.jobs ?? []) {
    const key = JSON.stringify([job.kind, job.target]);
    if (!latestJobs.has(key)) latestJobs.set(key, job);
  }
  const problemJobs = [...latestJobs.values()].filter((job) =>
    ['failed', 'uncertain'].includes(job.status)
  );
  const renderReview = (row) => (
    <ReviewRow
      key={row.key + row.reviewRevision + row.fingerprint}
      row={row}
      record={reviewRecord}
      assets={assets}
      media={media}
      proposals={board.proposals}
      jobs={board.jobs}
      referencePrompts={board.referencePrompts}
      disabled={disabled}
      draftPending={draftPending}
      onChanged={changed}
      onImportUpscale={onImportUpscale}
    />
  );
  const renderGroup = (group) => (
    <Box
      key={group.title + JSON.stringify(group.target)}
      component={group.target?.scope === 'clip' ? 'section' : 'div'}
      aria-label={group.target?.scope === 'clip' ? `Prerequisites: ${group.title}` : undefined}
      id={
        group.target?.scope === 'clip' ? `picture-prerequisites-${group.target.clipId}` : undefined
      }
      sx={{ scrollMarginTop: '100px' }}
    >
      <Typography variant="h3" sx={{ mb: 1 }}>
        {group.title}
      </Typography>
      {group.target?.scope === 'clip' && (
        <Typography sx={{ mb: 2 }}>
          Other shots can remain unfinished. Review this shot's composition, timing and generated
          result here.
        </Typography>
      )}
      {group.optional && (
        <Typography sx={{ mb: 2 }}>
          Optional whole-scene reviews. Individual shot approval covers its composition and timed
          preview.
        </Typography>
      )}
      {group.stages.map(renderReview)}
    </Box>
  );
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
        {board?.layout === 'scenes' && scope === 'episode' && (
          <Box component="nav" aria-label="Scenes on the production board">
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
              {reviewRecord.scenes.map((scene, index) => (
                <Button
                  key={scene.id}
                  component="a"
                  href={`#board-scene-${scene.id}`}
                  onClick={() => focusSection(`board-scene-${scene.id}`)}
                >
                  Scene {index + 1}: {scene.title}
                </Button>
              ))}
            </Stack>
          </Box>
        )}
        {board?.enabled && (
          <Box component="nav" aria-label="Approval shortcuts">
            <Typography fontWeight={600}>Needs your attention</Typography>
            {reviews.length === 0 && issues.length === 0 && problemJobs.length === 0 && (
              <Typography variant="body2">
                No approvals are ready right now. Check the production status below.
              </Typography>
            )}
            <ReviewLinks currentId={record._id} prefix="Review" rows={reviews} />
            <Stack spacing={1}>
              {issues.map((issue, index) => (
                <Alert key={index} severity="warning">
                  {issue.target ? `${subject(issue.target)}: ` : 'Production could not start: '}
                  {issue.error}
                  {issue.kind === 'dialogue' &&
                    issues.findIndex((i) => i.kind === 'dialogue' && i.error === issue.error) ===
                      index && (
                      <Typography variant="body2">
                        {issue.error.includes('one speaker')
                          ? 'Use one speaker per clip, for example ROXY: Hello. Split a conversation into separate clips, then save your edits.'
                          : 'Review the saved voice direction and press Generate voice auditions. After selecting a voice, press Generate dialogue when you are ready.'}
                      </Typography>
                    )}
                  <Button
                    component="a"
                    href={inputHref(issue)}
                    onClick={() => focusSection(inputHref(issue).slice(1))}
                  >
                    {issue.kind === 'dialogue'
                      ? `Edit dialogue for ${subject(issue.target)}`
                      : issue.target
                        ? `Review inputs for ${subject(issue.target)}`
                        : 'Go to production jobs'}
                  </Button>
                  {issue.kind === 'dialogue' && !issue.error.includes('one speaker') && (
                    <Button component="a" href={studioUrl('/?asset=' + (issue.voiceAssetId || ''))}>
                      Review voice auditions
                    </Button>
                  )}
                </Alert>
              ))}
              {problemJobs.map((job) => (
                <Alert key={job._id} severity="warning">
                  {job.title}:{' '}
                  {job.error ||
                    (job.status === 'uncertain'
                      ? 'Submission outcome unknown.'
                      : 'Generation failed.')}
                  <Button component="a" href={`#production-job-${job._id}`}>
                    Go to job details for {job.title}
                  </Button>
                  <Button
                    component="a"
                    href={inputHref(job)}
                    onClick={() => focusSection(inputHref(job).slice(1))}
                  >
                    Review inputs for {subject(job.target)}
                  </Button>
                </Alert>
              ))}
            </Stack>
          </Box>
        )}
        <Typography>
          Review each stage in order. Approval covers the saved version; changed inputs reopen
          affected downstream reviews.
        </Typography>
        {scope === 'episode' &&
          board?.groups?.[0]?.stages.some(
            (r) => r.stage === 'source' && r.status === 'approved'
          ) && (
            <Button
              component="a"
              sx={{ alignSelf: 'flex-start' }}
              href={reviewHref({ scope: 'episode', recordId: record._id }, 'source', record._id)}
            >
              Source research approved
            </Button>
          )}
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
          <Typography variant="body2">
            Saving and approving do not generate media. Read the saved prompts, then choose Generate
            image, Generate video, Generate dialogue or the music generation button. Each action
            requests one generation.
          </Typography>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        <ProductionDrafts
          proposals={board?.proposals}
          record={reviewRecord}
          disabled={disabled}
          onChanged={changed}
        />
        {board?.progress && (
          <Alert severity={board.progress.state === 'blocked' ? 'warning' : 'info'} role="status">
            {board.progress.message}
            {['blocked', 'working'].includes(board.progress.state) && board.jobs?.length > 0 && (
              <Button component="a" href="#production-jobs">
                Go to production jobs
              </Button>
            )}
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
        {board?.automation
          ?.filter((a) => ['queued', 'running'].includes(a.status))
          .map((action) => (
            <Alert key={action._id} severity={action.status === 'failed' ? 'warning' : 'info'}>
              Next production step {action.status === 'running' ? 'is being prepared' : 'queued'}.
              Jobs continue when you leave this page.
            </Alert>
          ))}
        {board?.enabled && board.nextSteps?.length > 0 && (
          <Button
            variant="contained"
            disabled={
              disabled ||
              starting ||
              board.automation?.some((a) => ['queued', 'running'].includes(a.status))
            }
            onClick={async () => {
              setStarting(true);
              setError('');
              setStartReceipt('');
              try {
                await request('/studio/workflow/advance', {
                  method: 'POST',
                  body: {
                    target: { scope, recordId: reviewRecord._id },
                    parentRevision: reviewRecord.revision
                  }
                });
                setStartReceipt(
                  'Production step queued. Each request is checked before a job is created. Follow its status in production jobs below.'
                );
                await refresh();
              } catch (e) {
                setError(e.message);
              } finally {
                setStarting(false);
              }
            }}
          >
            {starting
              ? 'Starting production…'
              : `Start next production step (${board.nextSteps.length} ${board.nextSteps.length === 1 ? 'request' : 'requests'})`}
          </Button>
        )}
        {startReceipt && (
          <Alert severity="info" role="status">
            {startReceipt}
            <Button component="a" href="#production-jobs">
              Go to production jobs
            </Button>
          </Alert>
        )}
        {board?.enabled && !board.nextSteps?.length && blockedSteps.length > 0 && (
          <Typography role="status">
            No production requests are ready to start. Resolve the linked problems above, save your
            changes, and review any reopened approvals.
          </Typography>
        )}
        {board?.enabled && board.nextSteps?.length > 0 && (
          <Box>
            <Typography variant="body2">Ready to request:</Typography>
            <Stack component="ul" sx={{ my: 0, pl: 3 }}>
              {board.nextSteps.map((step, index) => (
                <Typography component="li" variant="body2" key={step.requestId || index}>
                  {step.kind} · {subject(step.target)}
                </Typography>
              ))}
            </Stack>
          </Box>
        )}
        {board?.enabled && (
          <Accordion
            id="production-jobs"
            tabIndex={-1}
            sx={{ scrollMarginTop: '200px' }}
            expanded={jobsExpanded}
            onChange={(_event, open) => setJobsExpanded(open)}
          >
            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
              Production jobs and retries
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1}>
                {!board.jobs?.length && (
                  <Typography>
                    No production jobs yet. Queued requests will appear here after preparation.
                  </Typography>
                )}
                {(board.jobs ?? []).map((job) => (
                  <Alert
                    key={job._id}
                    aria-label={`Production job: ${job.title}`}
                    id={`production-job-${job._id}`}
                    tabIndex={-1}
                    sx={{ scrollMarginTop: '200px' }}
                    severity={['failed', 'uncertain'].includes(job.status) ? 'warning' : 'info'}
                  >
                    {job.title}: {job.status}. {job.error}
                    {job.quote?.items?.[0] &&
                      ` Quoted ${job.quote.items[0].totalCredits} list credits for the recorded configuration.`}
                    <Button
                      component="a"
                      href={inputHref(job)}
                      onClick={() => focusSection(inputHref(job).slice(1))}
                    >
                      Review inputs for {subject(job.target)}
                    </Button>
                  </Alert>
                ))}
                {(board.jobs ?? []).filter((j) => ['failed', 'uncertain'].includes(j.status))
                  .length >= 2 && (
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
        ) : board?.layout === 'scenes' && scope === 'episode' ? (
          <>
            {board.groups
              .filter(
                (g) => g.target.scope === 'episode' && !g.stages.some((r) => r.stage === 'export')
              )
              .map(renderGroup)}
            {reviewRecord.scenes.map((scene, sceneIndex) => {
              const groups = board.groups.filter((g) => g.target.sceneId === scene.id);
              const preparation = groups.find(
                (g) => g.target.scope === 'scene' && g.stages.some((r) => r.stage === 'script')
              );
              return (
                <Box
                  key={scene.id}
                  component="section"
                  aria-label={`Scene ${sceneIndex + 1}: ${scene.title}`}
                  sx={{ borderTop: 1, borderColor: 'divider', pt: 3 }}
                >
                  <Stack spacing={2}>
                    <Typography
                      variant="h2"
                      id={`board-scene-${scene.id}`}
                      tabIndex={-1}
                      className="scene-heading"
                    >
                      Scene {sceneIndex + 1}: {scene.title}
                    </Typography>
                    <Button
                      component="a"
                      href={`#board-scene-edit-${scene.id}`}
                      onClick={() => focusSection(`board-scene-edit-${scene.id}`)}
                      sx={{ alignSelf: 'flex-start' }}
                    >
                      Edit this scene
                    </Button>
                    <Typography>
                      {scene.clips.length} shots · Work on one video at a time. Image, dialogue,
                      shot approval and finished video review stay together below.
                    </Typography>
                    <ShotTransitionSummary
                      episodeId={reviewRecord._id}
                      scene={scene}
                      scenes={reviewRecord.scenes}
                      assets={assets}
                      media={media}
                    />
                    {preparation && (
                      <Box
                        component="details"
                        open={preparation.stages.some((r) => r.status !== 'approved')}
                      >
                        <Typography component="summary" sx={{ cursor: 'pointer', fontWeight: 600 }}>
                          Shared scene preparation
                        </Typography>
                        {preparation.stages.map(renderReview)}
                      </Box>
                    )}
                    <SceneBoardEditor
                      episode={reviewRecord}
                      scene={scene}
                      disabled={disabled}
                      onChanged={changed}
                    >
                      {({ draftScene, editClip, dirty, busy, save }) => (
                        <>
                          {scene.clips.map((clip, index) => (
                            <ShotProductionCard
                              key={clip.id}
                              episode={reviewRecord}
                              scene={scene}
                              clip={clip}
                              index={index}
                              rows={
                                groups.find(
                                  (g) => g.target.scope === 'clip' && g.target.clipId === clip.id
                                )?.stages ?? []
                              }
                              sceneRows={preparation?.stages ?? []}
                              assets={assets}
                              media={media}
                              transitionChoices={board.transitionChoices ?? []}
                              jobs={board.jobs}
                              proposals={board.proposals}
                              prompts={board.shotPrompts?.find(
                                (p) => p.sceneId === scene.id && p.clipId === clip.id
                              )}
                              voicePrompts={board.voicePrompts?.filter(
                                (p) => p.sceneId === scene.id && p.clipId === clip.id
                              )}
                              draftClip={draftScene.clips.find((c) => c.id === clip.id)}
                              draftScene={draftScene}
                              onEdit={(change) => editClip(clip.id, change)}
                              onSaveScene={save}
                              sceneDirty={dirty}
                              editingDisabled={disabled || busy}
                              disabled={disabled || busy || dirty}
                              onChanged={changed}
                              onAssetSaved={onAssetSaved}
                              onRejected={onRejected}
                              renderReview={renderReview}
                            />
                          ))}
                        </>
                      )}
                    </SceneBoardEditor>
                    <Box component="details">
                      <Typography component="summary" sx={{ cursor: 'pointer', fontWeight: 600 }}>
                        Background music for this section
                      </Typography>
                      <SceneMusic
                        episode={reviewRecord}
                        scene={scene}
                        dirty={false}
                        busy={disabled}
                        onReload={changed}
                      />
                    </Box>
                    {groups
                      .filter((g) => g.target.scope === 'scene' && g !== preparation)
                      .map((g) =>
                        g.optional ? (
                          <Box component="details" key={g.title}>
                            <Typography component="summary" sx={{ cursor: 'pointer' }}>
                              {g.title}
                            </Typography>
                            {g.stages.map(renderReview)}
                          </Box>
                        ) : (
                          renderGroup(g)
                        )
                      )}
                  </Stack>
                </Box>
              );
            })}
            {board.groups
              .filter(
                (g) => g.target.scope === 'episode' && g.stages.some((r) => r.stage === 'export')
              )
              .map(renderGroup)}
          </>
        ) : (
          board?.groups.map(renderGroup)
        )}
      </Stack>
    </Box>
  );
}
