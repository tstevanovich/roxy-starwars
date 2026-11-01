import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { useState } from 'react';

import { proposalApplication, proposalStageLabel } from '../../shared/production-proposals.js';
import { shotRevisionImpact } from '../../shared/shot-revisions.js';
import { request } from './api.js';
import { studioUrl } from './project-url.js';

const clock = (value) =>
  value == null
    ? 'end'
    : `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;

export function DraftSupportingNotes({ notes = [] }) {
  if (!notes.length) return null;
  return (
    <Box>
      <Typography variant="h3">Supporting evidence and feedback</Typography>
      <Typography variant="body2">
        These notes belong to this draft and are saved with it when applied. They do not replace the
        script shown below or independently approve dialogue or story choices.
      </Typography>
      {notes.map((note) => (
        <Box key={note.id} sx={{ mt: 2 }}>
          <Typography fontWeight={600}>{note.title}</Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {note.text}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
export function ProposalContent({ proposal, record }) {
  const fields = [
    ['voiceDescription', 'Proposed voice directions'],
    ['sourceNotes', 'Proposed source research'],
    ['outline', 'Proposed episode outline']
  ].filter(
    ([key]) =>
      proposal.production?.[key] &&
      (!record || proposal.production[key] !== record.production?.[key])
  );
  return (
    <Stack spacing={2}>
      <DraftSupportingNotes notes={proposal.supportingNotes} />
      {proposal.brief !== undefined && (
        <Box>
          <Typography variant="h3">Proposed Creative brief</Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{proposal.brief}</Typography>
          <Alert severity="info" sx={{ mt: 1 }}>
            Applying this draft fills the Creative brief field. Review the saved source and brief
            before image generation starts.
          </Alert>
        </Box>
      )}
      {record?.kind === 'voice' && proposal.production?.voiceDescription && (
        <Alert severity="info">
          Applying these voice directions saves the prompt. Review it, then use Generate voice
          auditions in the shot's dialogue section. Earlier auditions remain in history, and each
          new audition needs your listening review.
        </Alert>
      )}
      {proposal.sourceReferences && (
        <Box>
          <Typography variant="h3">Proposed source ranges</Typography>
          {proposal.sourceReferences.map((ref) => (
            <Typography key={ref.id}>
              {clock(ref.startSeconds)}–{clock(ref.endSeconds)} · {ref.chapter || ref.title}
            </Typography>
          ))}
          <Typography variant="caption">
            New or changed ranges still require your source verification.
          </Typography>
        </Box>
      )}
      {proposal.render && (
        <Box>
          <Typography variant="h3">
            {proposal.status === 'applied'
              ? 'Approved video directions'
              : 'Video directions to approve'}
          </Typography>
          <Typography>
            {proposal.render.model} · {proposal.render.resolution} · {proposal.render.aspectRatio} ·{' '}
            {proposal.render.duration}s
          </Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap', mt: 1 }}>
            {proposal.render.instructions ||
              'Use the saved approved shot directions without additional changes.'}
          </Typography>
          <Alert severity="info" sx={{ mt: 1 }}>
            Dialogue uses a voice reference, which does not guarantee synchronization to the saved
            recording. That mode also treats the image as a composition reference rather than a
            locked starting frame. Multiple speaking characters are allowed in the same shot.{' '}
            {proposal.status === 'applied'
              ? 'The approved request is saved. Follow its job status below; the resulting video still needs your review.'
              : 'This request has not generated a video. Approval below queues one render; its result still needs your review.'}
          </Alert>
        </Box>
      )}
      {fields.map(([key, label]) => (
        <Box component="details" key={key} open>
          <Typography component="summary" sx={{ cursor: 'pointer', fontWeight: 600 }}>
            {label}
          </Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mt: 1 }}>
            {proposal.production[key]}
          </Typography>
        </Box>
      ))}
      {proposal.production?.outlineNeedsRevision && (
        <Alert severity="info">
          These source changes require an updated outline. After you apply this draft and approve
          its research, the replacement outline will be drafted for review.
        </Alert>
      )}
      {proposal.scene && (
        <Box>
          {record?.scenes && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography fontWeight={600}>Review impact</Typography>
              {shotRevisionImpact(
                record.scenes.find((s) => s.id === proposal.scene.id),
                proposal.scene
              ).map((impact) => (
                <Typography key={impact.id} variant="body2">
                  {impact.title}:{' '}
                  {impact.changed
                    ? `review changed ${[impact.image && 'composition', impact.timing && 'timing', impact.sound && 'sound'].filter(Boolean).join(', ')} and affected video.`
                    : 'unchanged; existing image and video approvals are retained when references are unchanged.'}
                </Typography>
              ))}
            </Alert>
          )}
          <Typography variant="h3">Proposed scene: {proposal.scene.title}</Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{proposal.scene.script}</Typography>
          {proposal.scene.clips?.map((clip) => (
            <Box key={clip.id} sx={{ mt: 1 }}>
              <Typography fontWeight={600}>
                {clip.title} · {clip.duration}s
              </Typography>
              <Typography>{clip.dialogue || clip.action}</Typography>
              {clip.production?.imagePrompt &&
                (!proposal.targetClipId || proposal.targetClipId === clip.id) && (
                  <Box sx={{ mt: 1 }}>
                    <Typography fontWeight={600}>Exact image prompt sent to OpenArt</Typography>
                    <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                      {clip.production.imagePrompt}
                    </Typography>
                  </Box>
                )}
              {clip.production?.location && (
                <Typography>
                  Shot location: {clip.production.location} · {clip.production.environment}
                </Typography>
              )}
              {clip.production?.physicalConstraints && (
                <Typography>{clip.production.physicalConstraints}</Typography>
              )}
              <Typography>{clip.production?.framing}</Typography>
              <Typography>{clip.production?.beats}</Typography>
              <Typography>{clip.production?.passCondition}</Typography>
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
          ))}
          {proposal.scene.soundPlan && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="h3">Proposed sound plan</Typography>
              <Typography>{proposal.scene.soundPlan.notes}</Typography>
              {proposal.scene.soundPlan.layers?.map((layer) => (
                <Box key={layer.id} sx={{ mt: 1 }}>
                  <Typography fontWeight={600}>
                    {layer.title} · {layer.type} · {layer.duration}s
                  </Typography>
                  <Typography>{layer.description}</Typography>
                  <Typography variant="caption">
                    {proposal.scene.clips?.find((c) => c.id === layer.clipId)?.title || 'All clips'}{' '}
                    · starts at {layer.start ?? 0}s · {layer.gainDb ?? -20} dB
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}
      {proposal.production?.items?.length > 0 && (
        <Box>
          <Typography variant="h3">Proposed reference package</Typography>
          {proposal.production.items.map((item) => (
            <Box key={item.id} sx={{ mt: 1 }}>
              <Typography fontWeight={600}>
                {item.title} · {item.type}
                {item.required ? ' · required' : ''}
              </Typography>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>{item.notes}</Typography>
              {item.imagePrompt && (
                <Box sx={{ mt: 1 }}>
                  <Typography fontWeight={600}>Exact image prompt sent to OpenArt</Typography>
                  <Typography sx={{ whiteSpace: 'pre-wrap' }}>{item.imagePrompt}</Typography>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Stack>
  );
}

export default function ProductionDrafts({ proposals, record, disabled, onChanged }) {
  const [busy, setBusy] = useState(''),
    [failure, setFailure] = useState(null);
  if (!proposals?.length) return null;
  async function act(proposal, action) {
    setBusy(proposal._id);
    setFailure(null);
    try {
      await request(`/studio/assistant/proposals/${proposal._id}/${action}`, {
        method: 'POST',
        body: {}
      });
      await onChanged();
    } catch (e) {
      setFailure({ id: proposal._id, message: e.message });
    } finally {
      setBusy('');
    }
  }
  return (
    <Stack
      id="production-revisions"
      component="section"
      aria-label="Proposed production revisions"
      spacing={2}
      sx={{ scrollMarginTop: '110px' }}
    >
      <Typography variant="h3">Current drafts awaiting application</Typography>
      <Alert severity="info">
        The assistant's proposed changes are shown here. Apply a revised draft to update the saved
        episode below. Applying a story draft does not approve it or start rendering. Video requests
        have a separate Approve revision &amp; generate video action. Each scene or plan has one
        current review. Further additions carry forward into its replacement draft; earlier versions
        are kept as history.
      </Alert>
      {proposals.map((proposal) => {
        // The board checks the saved record. An older local editor is not a
        // second authority on whether that saved draft can be applied.
        const application = proposal.application ?? proposalApplication(proposal, record);
        return (
          <Box
            key={proposal._id}
            id={`proposal-${proposal._id}`}
            tabIndex={-1}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              p: 2,
              minWidth: 0,
              scrollMarginTop: '110px'
            }}
          >
            <Stack spacing={2}>
              <Chip
                label={`${proposalStageLabel(proposal, record)} draft · awaiting application`}
                color="warning"
                sx={{ alignSelf: 'flex-start' }}
              />
              <Typography variant="h3">{proposal.title}</Typography>
              <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {proposal.text?.split('\n\n{')[0]}
              </Typography>
              <ProposalContent proposal={proposal} record={record} />
              {failure?.id === proposal._id && <Alert severity="error">{failure.message}</Alert>}
              {!application.canApply && <Alert severity="warning">{application.reason}</Alert>}
              {application.rebased && (
                <Alert severity="info">
                  The episode has newer notes or take decisions. This scene draft can still be
                  applied; your saved notes, takes and selections will be kept.
                </Alert>
              )}
              <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  disabled={disabled || !!busy || !application.canApply}
                  onClick={() => act(proposal, proposal.render ? 'approve-render' : 'apply')}
                >
                  {busy === proposal._id
                    ? 'Applying draft…'
                    : proposal.render
                      ? 'Approve revision & generate video'
                      : record?.kind === 'voice' && proposal.production?.voiceDescription
                        ? 'Apply voice directions'
                        : 'Apply revised draft'}
                </Button>
                <Button disabled={disabled || !!busy} onClick={() => act(proposal, 'dismiss')}>
                  Dismiss draft
                </Button>
                {proposal.chatId && (
                  <Button component="a" href={studioUrl('/?chat=' + proposal.chatId)}>
                    Open production chat
                  </Button>
                )}
              </Stack>
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}
