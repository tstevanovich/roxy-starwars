import { Alert, Box, Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';

import {
  improveVideoLipSyncPrompt,
  videoDialogueTurns
} from '../../shared/dialogue-video-prompt.js';
import { selectedImageReferences } from '../../shared/image-references.js';
import { proposalBlocksReview } from '../../shared/production-proposals.js';
import {
  imageReferencePromptBase,
  remapImageReferencePrompt,
  taggedVideoReferences,
  withImageReferencePrompt
} from '../../shared/reference-prompt.js';
import { cleanRenderPrompt } from '../../shared/render-prompt.js';
import {
  joinVideoPrompt,
  multipartShot,
  nextEpisodeShot,
  shotTransition,
  videoTransitionPrompt
} from '../../shared/shot-transitions.js';
import { videoCharacterReferences, withVideoCastPrompt } from '../../shared/video-cast.js';
import { videoSoundCues, withVideoSoundPrompt } from '../../shared/video-sound-prompt.js';
import AnimaticPreview from './AnimaticPreview.jsx';
import { request } from './api.js';
import ImageRequestReferences from './ImageRequestReferences.jsx';
import { studioUrl } from './project-url.js';
import RejectMediaButton from './RejectMediaButton.jsx';
import { endImageHref, focusSection } from './review-navigation.js';
import ShotImageReview from './ShotImageReview.jsx';
import { mediaDownloadUrl } from './studio-utils.js';
import { ReferencePreview } from './StudioMedia.jsx';

export default function ShotProductionCard({
  episode,
  scene,
  clip,
  index,
  rows,
  sceneRows,
  assets,
  media,
  transitionChoices = [],
  jobs = [],
  proposals = [],
  prompts,
  voicePrompts = [],
  draftClip = clip,
  draftScene = scene,
  onEdit,
  onSaveScene,
  sceneDirty = false,
  editingDisabled = false,
  disabled,
  onChanged,
  onAssetSaved,
  onRejected,
  renderReview
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const cardId = `picture-prerequisites-${clip.id}`;
  const expansionKey = `roxy-shot-expanded-${episode._id}-${scene.id}-${clip.id}`;
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(expansionKey) !== 'false';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    let frame;
    const follow = () => {
      const anchor = window.location.hash.slice(1);
      const destination = anchor && document.getElementById(anchor);
      if (!destination || !document.getElementById(cardId)?.contains(destination)) return;
      setExpanded(true);
      frame = requestAnimationFrame(() => focusSection(anchor));
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => {
      window.removeEventListener('hashchange', follow);
      cancelAnimationFrame(frame);
    };
  }, [cardId]);
  const target = { scope: 'clip', recordId: episode._id, sceneId: scene.id, clipId: clip.id };
  const image = assets.find(
    (a) =>
      !a.archived &&
      String(a.episodeId) === String(episode._id) &&
      a.sceneId === scene.id &&
      a.clipId === clip.id
  );
  const storyboard = rows.find((r) => r.stage === 'storyboard');
  const animatic = rows.find((r) => r.stage === 'animatic');
  const visual = rows.find((r) => r.stage === 'visual');
  const transition = shotTransition(
    episode._id,
    scene,
    draftClip,
    assets,
    media,
    episode.scenes ?? [scene]
  );
  const nextShot = nextEpisodeShot(episode.scenes ?? [scene], scene.id, clip.id);
  const endChoices = transitionChoices.filter(
    (choice) =>
      String(choice.episodeId) === String(episode._id) &&
      choice.sceneId === nextShot?.sceneId &&
      choice.clipId === nextShot?.clipId
  );
  const numbered = multipartShot(scene, draftClip);
  const endFrame = draftClip.production?.videoEndFrame;
  const endValue =
    endFrame?.mode === 'image'
      ? `${endFrame.assetId}:${endFrame.mediaId}`
      : (endFrame?.mode ?? 'auto');
  const selectedEnd = endChoices.find(
    (choice) => `${choice.assetId}:${choice.mediaId}` === endValue
  );
  const finalPart = transition?.finalPart ?? Boolean(numbered && !numbered.needsEnd);
  const videoFiles = (clip.takeIds ?? [])
    .map((id) => media.find((m) => m._id === id && m.kind === 'video'))
    .filter(Boolean);
  const downloadVideo =
    media.find((file) => file.kind === 'video' && file._id === clip.selectedTakeId) ||
    media.find((file) => file.kind === 'video' && file._id === clip.production?.visualTakeId) ||
    videoFiles.at(-1);
  const localJobs = jobs.filter(
    (job) => job.target?.sceneId === scene.id && job.target?.clipId === clip.id
  );
  const active = localJobs.find(
    (job) =>
      job.kind === 'video' &&
      ['queued', 'preparing', 'submitting', 'rendering', 'importing', 'uncertain'].includes(
        job.status
      )
  );
  const pending = proposals.some(
    (p) =>
      (!p.targetClipId || p.targetClipId === clip.id) &&
      ((p.render?.target.sceneId === scene.id && p.render.target.clipId === clip.id) ||
        proposalBlocksReview(p, 'shot-plan', episode, { ...target, scope: 'scene' }))
  );
  const timingReady =
    animatic?.status === 'approved' ||
    animatic?.canApprove ||
    ((storyboard?.status === 'approved' || storyboard?.canApprove) &&
      animatic?.blockers?.every((reason) => /^Approve Storyboard continuity\.?$/.test(reason)));
  const soundReady = sceneRows.some((r) => r.stage === 'sound-plan' && r.status === 'approved');
  const reason = sceneDirty
    ? 'Save this scene before generating a video.'
    : pending
      ? 'A revision is waiting for review. Apply or dismiss it before generating this shot.'
      : active
        ? 'This shot already has a video request in progress or awaiting a provider-history check.'
        : !soundReady
          ? 'Approve the shared sound plan in this scene’s preparation.'
          : transition?.errors.length
            ? transition.errors.join(' ')
            : !(storyboard?.status === 'approved' || storyboard?.canApprove)
              ? 'Complete this scene’s preparation and approve one image for this shot.'
              : !timingReady
                ? animatic?.timingIssues?.map((issue) => issue.message).join(' ') ||
                  animatic?.blockers?.join(' ') ||
                  'Review this shot’s timing before generating its video.'
                : '';
  async function act(action) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      if (result?.status === 'blocked') setError(result.message);
      else setNotice(result?.message || 'Saved.');
      await onChanged();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  const hasDialogue = Boolean(clip.dialogue?.trim());
  const imageInput = useRef(null);
  const videoInput = useRef(null);
  const imageReferences = selectedImageReferences(
    prompts?.imageReferences,
    draftClip.production?.imageReferenceMediaIds ?? prompts?.imageReferences?.selected ?? []
  );
  const imagePrompt = imageReferencePromptBase(
    cleanRenderPrompt(
      draftClip.production?.imagePrompt ?? prompts?.imageBase ?? prompts?.image ?? ''
    )
  );
  const completeImagePrompt = withImageReferencePrompt(imagePrompt, imageReferences?.items);
  function changeImageReferences(ids) {
    onEdit({
      production: {
        imageReferenceMediaIds: ids,
        imagePrompt: remapImageReferencePrompt(imagePrompt, imageReferences.items, ids)
      }
    });
  }
  function insertImageReference(tag) {
    const input = imageInput.current;
    const start = input?.selectionStart ?? imagePrompt.length;
    const end = input?.selectionEnd ?? start;
    const insertion = `${start && !/\s/.test(imagePrompt[start - 1]) ? ' ' : ''}${tag} `;
    onEdit({
      production: {
        imagePrompt: imagePrompt.slice(0, start) + insertion + imagePrompt.slice(end),
        ...(imageReferences ? { imageReferenceMediaIds: imageReferences.selected } : {})
      }
    });
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  }
  const characterReferences = videoCharacterReferences(
    episode._id,
    draftScene,
    draftClip,
    assets,
    media,
    episode.scenes ?? [scene]
  );
  const soundCues = videoSoundCues(draftScene, draftClip);
  const missingCharacterNames = [
    ...new Set((videoDialogueTurns(draftClip.dialogue ?? '') ?? []).map((turn) => turn.speaker))
  ].filter(
    (name) =>
      !characterReferences.some((reference) =>
        reference.names.some((alias) => alias.toLowerCase() === name.toLowerCase())
      )
  );
  const videoPrompt = cleanRenderPrompt(
    withVideoCastPrompt(
      withVideoSoundPrompt(
        improveVideoLipSyncPrompt(
          draftClip.production?.videoPrompt ?? prompts?.videoBase ?? prompts?.video ?? '',
          draftClip.dialogue ?? ''
        ),
        draftScene,
        draftClip
      ),
      characterReferences
    )
  );
  const transitionPrompt = cleanRenderPrompt(videoTransitionPrompt(scene, draftClip));
  const completeVideoPrompt = taggedVideoReferences(
    cleanRenderPrompt(joinVideoPrompt(videoPrompt, transitionPrompt)),
    { endImage: Boolean(transition?.needsEnd) }
  );
  function insertVideoReference(tag) {
    const input = videoInput.current;
    const start = input?.selectionStart ?? videoPrompt.length;
    const end = input?.selectionEnd ?? start;
    const insertion = `${start && !/\s/.test(videoPrompt[start - 1]) ? ' ' : ''}${tag} `;
    onEdit({
      production: { videoPrompt: videoPrompt.slice(0, start) + insertion + videoPrompt.slice(end) }
    });
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  }
  const imageReady = ['references', 'shot-plan'].every((stage) =>
    sceneRows.some((row) => row.stage === stage && row.status === 'approved')
  );
  const imageWorking = localJobs.some(
    (job) =>
      job.kind === 'image' &&
      ['queued', 'preparing', 'submitting', 'rendering', 'importing', 'uncertain'].includes(
        job.status
      )
  );
  const latestVideo = localJobs.find((job) => job.kind === 'video');
  const mode = latestVideo?.settings?.mode || (hasDialogue ? 'element2video' : 'image2video');
  const modeLabel =
    {
      image2video: 'Frame-to-video · approved image is the starting frame',
      element2video: 'Reference-to-video · image and voice references',
      text2video: 'Text-to-video'
    }[mode] || mode;
  return (
    <Box
      component="section"
      id={cardId}
      aria-label={`Shot ${index + 1}: ${clip.title}`}
      className="clip-panel"
      sx={{ scrollMarginTop: '110px' }}
    >
      <Box
        component="details"
        data-shot-panel
        open={expanded}
        onToggle={(event) => {
          const open = event.currentTarget.open;
          setExpanded(open);
          try {
            localStorage.setItem(expansionKey, String(open));
          } catch {
            /* Keep this tab's choice. */
          }
        }}
      >
        <Box
          component="summary"
          aria-label={`Shot ${index + 1}: ${clip.title} - ${expanded ? 'Collapse shot' : 'Expand shot'}`}
          sx={{
            cursor: 'pointer',
            listStyle: 'none',
            borderRadius: 1,
            '&::-webkit-details-marker': { display: 'none' },
            '&:focus-visible': {
              outline: '2px solid',
              outlineColor: 'primary.main',
              outlineOffset: 4
            }
          }}
        >
          <Stack
            direction="row"
            sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 2 }}
          >
            <Box>
              <Typography variant="overline">
                Shot {index + 1} · {clip.duration}s
              </Typography>
              <Typography variant="h3" component="h3">
                {clip.title}
              </Typography>
            </Box>
            <Typography component="span" color="primary" sx={{ fontWeight: 600, flexShrink: 0 }}>
              {expanded ? 'Collapse shot' : 'Expand shot'}
            </Typography>
          </Stack>
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
            <Chip
              size="small"
              label={
                image?.finalChoice && image.reviewStatus !== 'pending-choice'
                  ? 'Image approved'
                  : 'Image needs approval'
              }
            />
            <Chip
              size="small"
              label={
                hasDialogue
                  ? clip.selectedDialogueId
                    ? 'Dialogue approved'
                    : 'Dialogue needs approval'
                  : 'No dialogue'
              }
            />
            {visual?.status === 'approved' && (
              <Chip size="small" color="success" label="Video approved" />
            )}
          </Stack>
        </Box>
        <Stack spacing={2} sx={{ mt: 2 }}>
          <Box>
            <Button
              component="a"
              variant="outlined"
              href={studioUrl(
                `/?chat=1&episode=${encodeURIComponent(episode._id)}&scene=${encodeURIComponent(scene.id)}&shot=${encodeURIComponent(clip.id)}`
              )}
              target="_blank"
              rel="noopener"
            >
              Discuss this shot
            </Button>
            <Typography variant="caption" display="block">
              Opens this shot's production chat in a new tab. Chat reads saved changes; save scene
              edits first if you want to discuss them.
            </Typography>
          </Box>
          {transition && (
            <Chip
              color="primary"
              variant="outlined"
              sx={{
                alignSelf: 'flex-start',
                maxWidth: '100%',
                height: 'auto',
                '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 }
              }}
              label={
                transition.needsEnd
                  ? 'Next generation: start + end image references'
                  : finalPart
                    ? 'Next generation: start image only · final part'
                    : 'Next generation: start image only'
              }
            />
          )}
          {downloadVideo && (
            <Button
              component="a"
              variant="contained"
              sx={{ alignSelf: 'flex-start' }}
              href={mediaDownloadUrl(downloadVideo._id)}
              download={downloadVideo.originalName}
              target="_blank"
              rel="noopener"
            >
              {visual?.status === 'approved' ? 'Download approved video' : 'Download video'}
            </Button>
          )}
          <Typography variant="body2">{modeLabel}</Typography>
          {hasDialogue && !transition && (
            <Typography variant="body2">
              The current voice-reference route does not synchronize the exact saved recording or
              lock the image as a literal first frame.
            </Typography>
          )}
          {transition && (
            <Stack component="section" aria-label="References for next generation" spacing={1}>
              <Typography fontWeight={600}>References for next generation</Typography>
              <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
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
                {hasDialogue && (
                  <Chip
                    size="small"
                    label={
                      clip.selectedDialogueId
                        ? 'Approved voice reference included'
                        : 'Voice reference needs selection'
                    }
                  />
                )}
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography>Image 1 · Start reference — this shot’s approved image</Typography>
                  <ReferencePreview
                    file={media.find((file) => file._id === transition.startImageId)}
                  />
                </Box>
                {transition.needsEnd && (
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography>
                      Image 2 · End reference —{' '}
                      {selectedEnd?.label || transition.nextTitle || `part ${transition.part + 1}`}
                    </Typography>
                    <ReferencePreview
                      file={media.find((file) => file._id === transition.endImageId)}
                    />
                    {transition.nextClipId && (
                      <Button
                        component="a"
                        href={endImageHref(transition, episode._id)}
                        onClick={() => {
                          if (
                            !transition.nextEpisodeId ||
                            String(transition.nextEpisodeId) === String(episode._id)
                          )
                            focusSection(`picture-prerequisites-${transition.nextClipId}`);
                        }}
                      >
                        Review end image
                      </Button>
                    )}
                  </Box>
                )}
              </Stack>
              <Typography variant="body2">
                {transition.needsEnd
                  ? 'The prompt directs the video from Image 1 to Image 2 as its ending composition.'
                  : finalPart
                    ? 'Final part: its own image supplies the start composition; no end-image reference is required.'
                    : 'Only this shot’s start image is supplied. No end image is selected.'}
                {hasDialogue &&
                  ' Audio 1 keeps your approved voice reference. These are prompt-guided endpoints; exact frame matching and lip sync still need review.'}
              </Typography>
              {videoFiles.length > 0 && (
                <Typography variant="body2">
                  This setup applies to your next generation. Existing takes below are unchanged.
                </Typography>
              )}
            </Stack>
          )}
          {image ? (
            <Box component="details" open>
              <Typography component="summary" sx={{ cursor: 'pointer', fontWeight: 600 }}>
                Image choices
              </Typography>
              <ShotImageReview
                asset={image}
                media={media}
                disabled={disabled || busy}
                onSaved={async (next) => {
                  await onAssetSaved?.(next);
                  await onChanged();
                }}
                onRejected={onRejected}
              />
            </Box>
          ) : (
            <Alert severity="info">
              No shot image yet. Review the saved prompt and press Generate image.
            </Alert>
          )}
          {hasDialogue && (
            <Box component="details" open>
              <Typography component="summary" sx={{ cursor: 'pointer', fontWeight: 600 }}>
                Dialogue choices
              </Typography>
              <Typography sx={{ whiteSpace: 'pre-wrap', my: 1 }}>{clip.dialogue}</Typography>
              {voicePrompts
                .filter((voice) => !voice.finalized)
                .map((voice) => (
                  <Stack key={voice.speaker} spacing={1}>
                    <TextField
                      label={`${voice.speaker} voice audition prompt`}
                      multiline
                      value={voice.prompt}
                      slotProps={{ input: { readOnly: true } }}
                    />
                    <Button
                      disabled={disabled || busy}
                      onClick={() =>
                        act(() =>
                          request('/studio/assistant/voice/generate', {
                            method: 'POST',
                            body: {
                              target: {
                                episodeId: episode._id,
                                sceneId: scene.id,
                                clipId: clip.id
                              },
                              speaker: voice.speaker,
                              prompt: voice.prompt,
                              requestId: crypto.randomUUID()
                            }
                          })
                        )
                      }
                    >
                      Generate {voice.speaker} voice auditions
                    </Button>
                  </Stack>
                ))}
              <Typography variant="body2">
                Read the exact speaker-labelled text above. Generation uses each speaker's finalized
                voice. Save text changes before generating.
              </Typography>
              <Button
                variant="outlined"
                disabled={disabled || busy || !clip.dialogue?.trim()}
                onClick={() =>
                  act(() =>
                    request('/studio/workflow/shot/dialogue/generate', {
                      method: 'POST',
                      body: {
                        target,
                        parentRevision: episode.revision,
                        dialogue: clip.dialogue,
                        requestId: crypto.randomUUID()
                      }
                    })
                  )
                }
              >
                Generate dialogue
              </Button>
              {!clip.dialogueTakeIds?.length && !clip.selectedDialogueId && (
                <Typography>
                  No dialogue take yet. Review the text and press Generate dialogue.
                </Typography>
              )}
              {[
                ...new Set(
                  [...(clip.dialogueTakeIds ?? []), clip.selectedDialogueId].filter(Boolean)
                )
              ]
                .reverse()
                .map((id) => {
                  const file = media.find((m) => m._id === id);
                  return (
                    <Box
                      key={id}
                      component="section"
                      aria-label={`Dialogue take: ${file?.originalName ?? id}`}
                      sx={{ my: 2 }}
                    >
                      <Typography variant="body2">
                        {file?.originalName ?? 'Dialogue take'}
                      </Typography>
                      <ReferencePreview file={file} kind="voice" />
                      <Button
                        disabled={disabled || busy || !file || clip.selectedDialogueId === id}
                        onClick={() =>
                          act(() =>
                            request('/studio/workflow/shot/dialogue', {
                              method: 'POST',
                              body: { target, parentRevision: episode.revision, mediaId: id }
                            })
                          )
                        }
                      >
                        {clip.selectedDialogueId === id ? 'Dialogue approved' : 'Approve dialogue'}
                      </Button>
                      {file && (
                        <RejectMediaButton
                          file={file}
                          disabled={disabled || busy}
                          context={{
                            episodeId: episode._id,
                            revision: episode.revision,
                            sceneId: scene.id,
                            clipId: clip.id
                          }}
                          onRejected={async (result) => {
                            await onRejected?.(result);
                            await onChanged();
                          }}
                        />
                      )}
                    </Box>
                  );
                })}
            </Box>
          )}
          {onEdit && (
            <Stack
              spacing={2}
              component="section"
              aria-label={`Generation prompts for ${clip.title}`}
            >
              <Typography variant="h3">Image generation prompt</Typography>
              <TextField
                label="Image generation prompt"
                multiline
                minRows={4}
                maxRows={12}
                value={imagePrompt}
                inputRef={imageInput}
                disabled={editingDisabled || busy}
                onChange={(event) =>
                  onEdit({
                    production: {
                      imagePrompt: event.target.value,
                      ...(imageReferences
                        ? { imageReferenceMediaIds: imageReferences.selected }
                        : {})
                    }
                  })
                }
                helperText="Edit the image directions and insert reference tags where useful. The complete prompt below includes the attachment roles. Save the scene before generating. Blank restores the generated prompt."
              />
              <ImageRequestReferences
                references={imageReferences}
                media={media}
                sceneDirty={sceneDirty}
                onInsertReference={editingDisabled || busy ? undefined : insertImageReference}
                onChangeReferences={editingDisabled || busy ? undefined : changeImageReferences}
              />
              <TextField
                label="Complete image prompt sent to OpenArt"
                value={completeImagePrompt}
                multiline
                minRows={4}
                maxRows={12}
                slotProps={{ input: { readOnly: true } }}
                helperText="Reference tags and roles match the attached images in order. Saving does not generate an image."
              />
              <Button
                variant="outlined"
                disabled={
                  disabled ||
                  busy ||
                  sceneDirty ||
                  imageWorking ||
                  !imageReady ||
                  !imagePrompt.trim()
                }
                onClick={() =>
                  act(() =>
                    request('/studio/workflow/shot/image', {
                      method: 'POST',
                      body: {
                        target,
                        parentRevision: episode.revision,
                        requestId: crypto.randomUUID(),
                        prompt: completeImagePrompt,
                        ...(imageReferences ? { imageReferenceIds: imageReferences.selected } : {})
                      }
                    })
                  )
                }
              >
                Generate image
              </Button>
              <Button disabled={!sceneDirty || editingDisabled || busy} onClick={onSaveScene}>
                Save image setup
              </Button>
              {!imageReady && (
                <Typography variant="body2">
                  Complete shared scene references and shot-plan approval before generating an
                  image.
                </Typography>
              )}
              <Typography variant="h3">Last frame / end image</Typography>
              <TextField
                select
                label="End image (optional)"
                value={endValue}
                disabled={editingDisabled || busy}
                onChange={(event) => {
                  const choice = endChoices.find(
                    (item) => `${item.assetId}:${item.mediaId}` === event.target.value
                  );
                  onEdit({
                    production: {
                      videoEndFrame:
                        event.target.value === 'auto'
                          ? null
                          : event.target.value === 'none'
                            ? { mode: 'none' }
                            : { mode: 'image', assetId: choice.assetId, mediaId: choice.mediaId }
                    }
                  });
                }}
                helperText={
                  nextShot
                    ? 'Optionally end on the next shot’s approved image in this episode. Review the instructions, save this scene, then Generate video.'
                    : 'This is the last shot in this episode. No following shot image is available.'
                }
                slotProps={{
                  select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 360 } } } } }
                }}
              >
                <MenuItem value="auto">
                  {numbered
                    ? 'Automatic — next numbered part, if applicable'
                    : 'Default — no end image'}
                </MenuItem>
                <MenuItem value="none">No end image</MenuItem>
                {endFrame?.mode === 'image' && !selectedEnd && (
                  <MenuItem value={endValue}>
                    Selected end image — no longer approved or available
                  </MenuItem>
                )}
                {nextShot && !endChoices.length && (
                  <MenuItem value="unavailable" disabled>
                    Next shot image needs approval — {nextShot.title}
                  </MenuItem>
                )}
                {endChoices.map((choice) => (
                  <MenuItem
                    key={`${choice.assetId}:${choice.mediaId}`}
                    value={`${choice.assetId}:${choice.mediaId}`}
                    sx={{ whiteSpace: 'normal' }}
                  >
                    {choice.label}
                  </MenuItem>
                ))}
              </TextField>
              {endFrame && draftClip.production?.videoTransitionPrompt && (
                <Typography variant="body2">
                  Your custom reference instructions are retained. Review them against this
                  end-image choice before saving.
                </Typography>
              )}
              <Typography variant="h3">Video generation prompt</Typography>
              {draftClip.dialogue?.trim() && (
                <Stack component="section" aria-label="Character identification" spacing={1}>
                  <Typography fontWeight={600}>Character identification</Typography>
                  <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                    {characterReferences.map((reference) => (
                      <Chip
                        key={reference.assetId}
                        size="small"
                        label={`${reference.names.join(' / ')} = Image ${reference.imageNumber}`}
                      />
                    ))}
                  </Stack>
                  {characterReferences.length > 0 && (
                    <Box component="details">
                      <Typography component="summary" sx={{ cursor: 'pointer' }}>
                        Show character identity references
                      </Typography>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        {characterReferences.map((reference) => (
                          <Box key={reference.assetId} sx={{ flex: 1, maxWidth: 300 }}>
                            <Typography>
                              {reference.names.join(' / ')} · Image {reference.imageNumber}
                            </Typography>
                            <ReferencePreview
                              file={media.find((file) => String(file._id) === reference.mediaId)}
                            />
                          </Box>
                        ))}
                      </Stack>
                    </Box>
                  )}
                  {missingCharacterNames.length > 0 && (
                    <Typography variant="body2" color="warning.main">
                      No unique approved character image matched: {missingCharacterNames.join(', ')}
                      . The composition image remains available.
                    </Typography>
                  )}
                </Stack>
              )}
              <Stack component="section" aria-label="Sound in this video" spacing={1}>
                <Typography fontWeight={600}>Sound in this video</Typography>
                <TextField
                  label="Sound effects and ambience for this shot"
                  multiline
                  minRows={2}
                  value={draftClip.soundEffects ?? ''}
                  disabled={editingDisabled || busy}
                  onChange={(event) => onEdit({ soundEffects: event.target.value })}
                  helperText="These directions and the shot’s sound-plan cues are included automatically in the complete video prompt."
                />
                {soundCues.map((cue, cueIndex) => (
                  <Typography key={cue.id || cueIndex} variant="body2">
                    {cue.type === 'ambience' ? 'Ambience' : 'Effect'} · {cue.start}–{cue.end}s ·{' '}
                    {cue.description}
                  </Typography>
                ))}
              </Stack>
              {draftClip.dialogue?.trim() && (
                <Chip
                  size="small"
                  label="Lip sync included automatically"
                  sx={{ alignSelf: 'flex-start' }}
                />
              )}
              <TextField
                label="Video generation prompt"
                multiline
                minRows={4}
                maxRows={12}
                value={videoPrompt}
                inputRef={videoInput}
                error={completeVideoPrompt.length > 4500}
                disabled={editingDisabled || busy}
                onChange={(event) => onEdit({ production: { videoPrompt: event.target.value } })}
                helperText={`${completeVideoPrompt.length}/4500 characters total, including automatic sound, character and transition directions. The complete submitted prompt is shown below.`}
              />
              <Stack
                direction="row"
                sx={{ gap: 1, flexWrap: 'wrap' }}
                aria-label="Insert video reference tags"
              >
                {[
                  ['@Image1', 'start composition'],
                  ...(transition?.needsEnd ? [['@Image2', 'end composition']] : []),
                  ...characterReferences.map((reference) => [
                    `@Image${reference.imageNumber}`,
                    reference.names.join(' / ')
                  ]),
                  ...(hasDialogue ? [['@Audio1', 'voice reference']] : [])
                ].map(([tag, role]) => (
                  <Button
                    key={tag}
                    disabled={editingDisabled || busy}
                    onClick={() => insertVideoReference(tag)}
                  >
                    Insert {tag} ({role})
                  </Button>
                ))}
              </Stack>
              {transition && (
                <>
                  <TextField
                    label="Start/end reference instructions"
                    multiline
                    minRows={3}
                    maxRows={10}
                    value={transitionPrompt}
                    disabled={editingDisabled || busy}
                    onChange={(event) =>
                      onEdit({ production: { videoTransitionPrompt: event.target.value } })
                    }
                    helperText="Edit these directions before generating. Image 1 is this shot; Image 2, when selected, is its end reference. Blank restores the default directions."
                  />
                </>
              )}
              <TextField
                label="Complete video prompt sent to Wan"
                multiline
                minRows={5}
                maxRows={16}
                value={completeVideoPrompt}
                slotProps={{ input: { readOnly: true } }}
                helperText="This is the exact combined prompt submitted when you choose Generate video. Edit the shot, sound and reference instructions above to update it."
              />
              <TextField
                label="Action and performance"
                multiline
                value={draftClip.action ?? ''}
                disabled={editingDisabled || busy}
                onChange={(event) => onEdit({ action: event.target.value })}
              />
              <TextField
                label="Exact dialogue with speaker names"
                multiline
                value={draftClip.dialogue ?? ''}
                disabled={editingDisabled || busy}
                onChange={(event) => onEdit({ dialogue: event.target.value })}
              />
              <Button disabled={!sceneDirty || editingDisabled || busy} onClick={onSaveScene}>
                Save scene
              </Button>
            </Stack>
          )}
          {(!videoFiles.length || onEdit) && (
            <>
              <AnimaticPreview
                scene={{ ...scene, clips: [clip] }}
                episodeId={episode._id}
                assets={assets}
                media={media}
                showShotList={false}
              />
              <Typography variant="body2">
                Review this image with the selected dialogue and timing. One approval covers the
                shot composition and timed preview, then requests this video. Review each result in
                its own shot card.
              </Typography>
              {reason && <Alert severity="warning">{reason}</Alert>}
              {animatic?.timingIssues?.length > 0 && (
                <Button
                  disabled={disabled || busy || pending}
                  onClick={() =>
                    act(() =>
                      request('/studio/workflow/animatic/prepare', {
                        method: 'POST',
                        body: { target, parentRevision: episode.revision }
                      })
                    )
                  }
                >
                  Prepare split or retimed shots
                </Button>
              )}
              <Button
                variant="contained"
                disabled={
                  disabled ||
                  busy ||
                  Boolean(reason) ||
                  !storyboard ||
                  !animatic ||
                  (onEdit && (!videoPrompt.trim() || completeVideoPrompt.length > 4500))
                }
                onClick={() =>
                  act(() =>
                    request('/studio/workflow/shot/approve', {
                      method: 'POST',
                      body: {
                        target,
                        parentRevision: episode.revision,
                        ...(onEdit
                          ? {
                              generate: true,
                              prompt: completeVideoPrompt,
                              requestId: crypto.randomUUID()
                            }
                          : {}),
                        ...(transition ? { transitionImageIds: transition.imageIds } : {}),
                        reviews: Object.fromEntries(
                          [storyboard, animatic].map((row) => [
                            row.stage,
                            {
                              approvalFingerprint: row.approvalFingerprint,
                              reviewRevision: row.reviewRevision
                            }
                          ])
                        )
                      }
                    })
                  )
                }
              >
                {busy
                  ? 'Saving shot review…'
                  : onEdit
                    ? 'Generate video'
                    : 'Approve shot & generate video'}
              </Button>
            </>
          )}
          {videoFiles.length > 0 && (
            <Stack spacing={2}>
              <Typography fontWeight={600}>Video takes</Typography>
              {[...videoFiles].reverse().map((file) => {
                const sourceJob = localJobs.find(
                  (job) =>
                    String(job._id) === String(file.productionJobId) ||
                    job.resultMediaIds?.some((id) => String(id) === String(file._id))
                );
                const recordedTransition = sourceJob?.snapshot?.transition;
                const setupLabel = recordedTransition
                  ? recordedTransition.endImageId
                    ? 'Generated with start + end image references'
                    : recordedTransition.finalPart === false
                      ? 'Generated with start image only'
                      : 'Generated with start image only · final part'
                  : sourceJob?.snapshot?.imageIds?.length === 1
                    ? 'Generated with one image reference'
                    : 'Generation reference setup not recorded';
                return (
                  <Box key={file._id}>
                    {transition && (
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        {setupLabel}
                      </Typography>
                    )}
                    {sourceJob?.snapshot?.characterReferences?.length > 0 && (
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        Character identity references included:{' '}
                        {sourceJob.snapshot.characterReferences
                          .flatMap((reference) => reference.names)
                          .join(', ')}
                      </Typography>
                    )}
                    <ReferencePreview file={file} kind="video" />
                    <Button
                      component="a"
                      href={mediaDownloadUrl(file._id)}
                      download={file.originalName}
                      target="_blank"
                      rel="noopener"
                    >
                      Download video
                    </Button>
                    <Button
                      disabled={
                        disabled ||
                        busy ||
                        !visual ||
                        (visual.status === 'approved' &&
                          clip.production?.visualTakeId === file._id) ||
                        animatic?.status !== 'approved' ||
                        !soundReady
                      }
                      onClick={() =>
                        act(() =>
                          request('/studio/workflow/review', {
                            method: 'POST',
                            body: {
                              target,
                              stage: 'visual',
                              action: 'approve',
                              fingerprint: visual.fingerprint,
                              parentRevision: visual.parentRevision,
                              reviewRevision: visual.reviewRevision,
                              feedback: '',
                              takeId: file._id
                            }
                          })
                        )
                      }
                    >
                      {visual?.status === 'approved' && clip.production?.visualTakeId === file._id
                        ? 'Video approved'
                        : 'Approve picture, performance & sound'}
                    </Button>
                    {onRejected && (
                      <RejectMediaButton
                        file={file}
                        disabled={disabled || busy}
                        context={{
                          episodeId: episode._id,
                          revision: episode.revision,
                          sceneId: scene.id,
                          clipId: clip.id
                        }}
                        onRejected={onRejected}
                      />
                    )}
                  </Box>
                );
              })}
            </Stack>
          )}
          {localJobs.slice(0, 3).map((job) => (
            <Alert
              key={job._id}
              severity={['failed', 'uncertain'].includes(job.status) ? 'warning' : 'info'}
            >
              {job.title}: {job.status}. {job.error}
            </Alert>
          ))}
          {error && <Alert severity="error">{error}</Alert>}
          {notice && (
            <Alert severity="success" role="status">
              {notice}
            </Alert>
          )}
          <Box component="details">
            <Typography component="summary" sx={{ cursor: 'pointer' }}>
              Detailed reviews and feedback
            </Typography>
            {rows.map(renderReview)}
          </Box>
        </Stack>
      </Box>
    </Box>
  );
}
