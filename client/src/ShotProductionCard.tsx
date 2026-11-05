import { Alert, Box, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import type * as React from 'react';
import { useRef, useState } from 'react';

import {
  improveVideoLipSyncPrompt,
  videoDialogueTurns
} from '../../shared/dialogue-video-prompt.ts';
import { toError } from '../../shared/errors.ts';
import { selectedImageReferences } from '../../shared/image-references.ts';
import { videoGenerationDefaults } from '../../shared/production-defaults.ts';
import { proposalBlocksReview } from '../../shared/production-proposals.ts';
import {
  imageReferencePromptBase,
  remapImageReferencePrompt,
  taggedVideoReferences,
  withImageReferencePrompt
} from '../../shared/reference-prompt.ts';
import { cleanRenderPrompt } from '../../shared/render-prompt.ts';
import {
  joinVideoPrompt,
  startOnlyVideoPrompt,
  videoTransitionPrompt
} from '../../shared/shot-transitions.ts';
import type * as Studio from '../../shared/types.ts';
import {
  remapVideoReferencePrompt,
  videoCharacterReferences,
  videoReferenceChoices,
  withVideoCastPrompt
} from '../../shared/video-cast.ts';
import { videoSoundCues, withVideoSoundPrompt } from '../../shared/video-sound-prompt.ts';
import AnimaticPreview from './AnimaticPreview.tsx';
import { request } from './api.ts';
import ImageRequestReferences from './ImageRequestReferences.tsx';
import { studioUrl } from './project-url.ts';
import RejectMediaButton from './RejectMediaButton.tsx';
import { focusSection, reviewAnchor } from './review-navigation.ts';
import ReviewLinks from './ReviewLinks.tsx';
import ShotDisclosure from './ShotDisclosure.tsx';
import ShotImageReview from './ShotImageReview.tsx';
import { mediaDownloadUrl } from './studio-utils.ts';
import { ReferencePreview } from './StudioMedia.tsx';
import VideoReferenceEditor from './VideoReferenceEditor.tsx';

export default function ShotProductionCard({
  episode,
  scene,
  clip,
  index,
  rows,
  sceneRows,
  assets,
  media,
  jobs = [],
  proposals = [],
  prompts,
  voicePrompts = [],
  draftClip = clip,
  draftScene = scene,
  onEdit,
  onSaveScene,
  sceneDirty = false,
  sceneSaveError = '',
  sceneSaveNotice = '',
  sceneRefreshing = false,
  onRefreshScene,
  onUseSavedScene,
  editingDisabled = false,
  disabled,
  onChanged,
  onAssetSaved,
  onRejected,
  renderReview
}: {
  episode: Studio.Episode;
  scene: Studio.Scene;
  clip: Studio.Clip;
  index: number;
  rows?: Studio.ReviewRow[];
  sceneRows?: Studio.ReviewRow[];
  assets: Studio.Asset[];
  media: Studio.MediaFile[];
  jobs?: Studio.Job[];
  proposals?: Studio.Proposal[];
  prompts?: Studio.ShotPrompts;
  voicePrompts?: Studio.VoicePrompt[];
  draftClip?: Studio.Clip;
  draftScene?: Studio.Scene;
  onEdit?: (change: Partial<Studio.Clip>) => void;
  onSaveScene?: () => void | Promise<unknown>;
  sceneDirty?: boolean;
  sceneSaveError?: string;
  sceneSaveNotice?: string;
  sceneRefreshing?: boolean;
  onRefreshScene?: () => void | Promise<unknown>;
  onUseSavedScene?: () => void;
  editingDisabled?: boolean;
  disabled?: boolean;
  onChanged: () => void | Promise<unknown>;
  onAssetSaved?: (asset: Studio.Asset) => void | Promise<unknown>;
  onRejected?: (result: Studio.RejectionResult) => void | Promise<unknown>;
  renderReview: (row: Studio.ReviewRow) => React.ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const cardId = `picture-prerequisites-${clip.id}`;
  const expansionKey = `roxy-shot-expanded-${episode._id}-${scene.id}-${clip.id}`;
  const target = {
    scope: 'clip' as const,
    recordId: episode._id,
    sceneId: scene.id,
    clipId: clip.id
  };
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
        proposalBlocksReview(p, 'shot-plan', episode, { ...target, scope: 'scene' as const }))
  );
  const timingReady =
    animatic?.status === 'approved' ||
    animatic?.canApprove ||
    ((storyboard?.status === 'approved' || storyboard?.canApprove) &&
      animatic?.blockers?.every((reason) => /^Approve Storyboard continuity\.?$/.test(reason)));
  const soundPlan = sceneRows.find((r) => r.stage === 'sound-plan');
  const soundReady = soundPlan?.status === 'approved';
  const soundPlanAnchor = reviewAnchor(
    soundPlan?.target ?? { scope: 'scene' as const, recordId: episode._id, sceneId: scene.id },
    'sound-plan'
  );
  const reviewReason = sceneDirty
    ? 'Save this scene before generating a video.'
    : pending
      ? 'A revision is waiting for review. Apply or dismiss it before generating this shot.'
      : active
        ? 'This shot already has a video request in progress or awaiting a provider-history check.'
        : !soundReady
          ? 'Approve the shared sound plan in this scene’s preparation.'
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
    } catch (caughtError) {
      const failure = toError(caughtError);
      setError(failure.message);
      if (failure.status === 409) {
        try {
          await onChanged();
        } catch {
          /* Retain the original conflict explanation. */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  const hasDialogue = Boolean(clip.dialogue?.trim());
  const imageInput = useRef<HTMLTextAreaElement | null>(null);
  const videoInput = useRef<HTMLTextAreaElement | null>(null);
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
  function changeImageReferences(ids: string[]) {
    onEdit({
      production: {
        imageReferenceMediaIds: ids,
        imagePrompt: remapImageReferencePrompt(imagePrompt, imageReferences.items, ids)
      }
    });
  }
  function insertImageReference(tag) {
    const input = imageInput.current;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const insertion = `${start && !/\s/.test(imagePrompt[start - 1]) ? ' ' : ''}${tag} `;
    onEdit({
      production: {
        imagePrompt: imagePrompt.slice(0, start) + insertion + imagePrompt.slice(end),
        imageReferenceMediaIds: imageReferences.selected
      }
    });
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  }
  const characterReferences = videoCharacterReferences(draftScene, draftClip, assets, media);
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
          startOnlyVideoPrompt(
            draftScene,
            draftClip,
            draftClip.production?.videoPrompt ?? prompts?.videoBase ?? prompts?.video ?? ''
          ),
          draftClip.dialogue ?? ''
        ),
        draftScene,
        draftClip
      ),
      characterReferences
    )
  );
  const transitionPrompt = cleanRenderPrompt(
    videoTransitionPrompt(draftScene, draftClip, videoPrompt)
  );
  const completeVideoPrompt = taggedVideoReferences(
    cleanRenderPrompt(joinVideoPrompt(videoPrompt, transitionPrompt))
  );
  const promptProblem =
    onEdit &&
    (!videoPrompt.trim()
      ? 'Add a video prompt before generating this shot.'
      : completeVideoPrompt.length > 4500
        ? `The complete video prompt is ${completeVideoPrompt.length} characters; the limit is 4500. Shorten the video directions before generating.`
        : '');
  const reason =
    (sceneRefreshing ? 'The scene was saved. Refresh its status before generating.' : '') ||
    reviewReason ||
    promptProblem ||
    (disabled && !busy ? 'This scene is being saved. Wait for the save to finish.' : '');
  const preparationLinks = [
    ...sceneRows,
    ...(storyboard?.prerequisites ?? []),
    ...(animatic?.prerequisites ?? [])
  ].filter(
    (row, index, all) =>
      row.status !== 'approved' &&
      row.target &&
      all.findIndex(
        (other) =>
          other.target &&
          reviewAnchor(other.target, other.stage) === reviewAnchor(row.target, row.stage)
      ) === index
  );
  const imageAnchor = `shot-image-choices-${clip.id}`;
  const dialogueAnchor = `shot-dialogue-${clip.id}`;
  const promptAnchor = `shot-video-prompt-${clip.id}`;
  const generateAnchor = `shot-video-generation-${clip.id}`;
  function changeVideoReferences(ids: string[]) {
    onEdit({
      production: {
        videoReferenceMediaIds: ids,
        videoPrompt: remapVideoReferencePrompt(videoPrompt, characterReferences, ids)
      }
    });
  }
  function insertVideoReference(tag) {
    const input = videoInput.current;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const insertion = `${start && !/\s/.test(videoPrompt[start - 1]) ? ' ' : ''}${tag} `;
    onEdit({
      production: { videoPrompt: videoPrompt.slice(0, start) + insertion + videoPrompt.slice(end) }
    });
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + insertion.length, start + insertion.length);
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
      <ShotDisclosure
        storageKey={expansionKey}
        anchorId={cardId}
        title={clip.title}
        index={index}
        duration={clip.duration}
        status={
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
        }
      >
        <Stack spacing={2}>
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
            <Typography variant="caption" sx={{ display: 'block' }}>
              Opens this shot's production chat in a new tab. Chat reads saved changes; save scene
              edits first if you want to discuss them.
            </Typography>
          </Box>
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }} aria-label="Shot navigation">
            {[
              ['Go to image choices', imageAnchor],
              ...(hasDialogue ? [['Go to dialogue choices', dialogueAnchor]] : []),
              ...(!videoFiles.length || onEdit ? [['Go to video generation', generateAnchor]] : [])
            ].map(([label, anchor]) => (
              <Button
                key={anchor}
                component="a"
                href={`#${anchor}`}
                onClick={() => focusSection(anchor)}
              >
                {label}
              </Button>
            ))}
          </Stack>
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
          <Typography variant="body2">
            Next generation: {videoGenerationDefaults.displayName} ·{' '}
            {videoGenerationDefaults.resolution} · {videoGenerationDefaults.aspectRatio}
          </Typography>
          {hasDialogue && (
            <Typography variant="body2">
              The current voice-reference route does not synchronize the exact saved recording or
              lock the image as a literal first frame.
            </Typography>
          )}
          {image ? (
            <Box
              component="details"
              id={imageAnchor}
              tabIndex={-1}
              sx={{ scrollMarginTop: '110px' }}
              open
            >
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
            <Alert id={imageAnchor} tabIndex={-1} severity="info" sx={{ scrollMarginTop: '110px' }}>
              No shot image yet. Review the saved prompt and press Generate image.
            </Alert>
          )}
          {hasDialogue && (
            <Box
              component="details"
              id={dialogueAnchor}
              tabIndex={-1}
              sx={{ scrollMarginTop: '110px' }}
              open
            >
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
                          request<Studio.ActionResult>('/studio/assistant/voice/generate', {
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
                    request<Studio.ActionResult>('/studio/workflow/shot/dialogue/generate', {
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
                            request<Studio.ActionResult>('/studio/workflow/shot/dialogue', {
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
                    request<Studio.ActionResult>('/studio/workflow/shot/image', {
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
              <Typography variant="h3">Video generation prompt</Typography>
              {draftClip.dialogue?.trim() && (
                <Stack component="section" aria-label="Character identification" spacing={1}>
                  <Typography sx={{ fontWeight: 600 }}>Character identification</Typography>
                  <VideoReferenceEditor
                    references={characterReferences}
                    selection={draftClip.production?.videoReferenceMediaIds}
                    choices={videoReferenceChoices(assets, media)}
                    media={media}
                    disabled={editingDisabled || busy}
                    dirty={sceneDirty}
                    onChange={changeVideoReferences}
                    onSave={onSaveScene}
                  />
                  {missingCharacterNames.length > 0 && (
                    <Typography variant="body2" color="warning.main">
                      No unique approved character image matched: {missingCharacterNames.join(', ')}
                      . The composition image remains available.
                    </Typography>
                  )}
                </Stack>
              )}
              <Stack component="section" aria-label="Sound in this video" spacing={1}>
                <Typography sx={{ fontWeight: 600 }}>Sound in this video</Typography>
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
                id={promptAnchor}
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
            <Stack
              component="section"
              id={generateAnchor}
              tabIndex={-1}
              spacing={2}
              sx={{ scrollMarginTop: '110px' }}
            >
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
              {sceneSaveError && (
                <Alert severity="error">
                  {sceneSaveError}
                  {sceneDirty && onUseSavedScene && (
                    <Button onClick={onUseSavedScene}>Keep local draft and use saved scene</Button>
                  )}
                  {sceneRefreshing && onRefreshScene && (
                    <Button onClick={onRefreshScene}>Refresh saved scene</Button>
                  )}
                </Alert>
              )}
              {!sceneSaveError && sceneSaveNotice && (
                <Alert severity="success">{sceneSaveNotice}</Alert>
              )}
              {reason && (
                <Alert severity="warning">
                  {reason}
                  {sceneDirty && onSaveScene && (
                    <Button disabled={editingDisabled || busy} onClick={onSaveScene}>
                      Save scene to continue
                    </Button>
                  )}
                  {!sceneDirty && pending && (
                    <Button
                      component="a"
                      href="#production-revisions"
                      onClick={() => focusSection('production-revisions')}
                    >
                      Go to pending revision
                    </Button>
                  )}
                  {!sceneDirty && !pending && active && (
                    <Button
                      component="a"
                      href={`#production-job-${active._id}`}
                      onClick={() => focusSection(`production-job-${active._id}`)}
                    >
                      Go to video request
                    </Button>
                  )}
                  {!sceneDirty && !pending && !active && !soundReady && (
                    <Button
                      component="a"
                      color="inherit"
                      href={`#${soundPlanAnchor}`}
                      onClick={() => focusSection(soundPlanAnchor)}
                    >
                      Go to Sound plan
                    </Button>
                  )}
                  {!sceneDirty && !pending && !active && soundReady && reviewReason && (
                    <>
                      <ReviewLinks rows={preparationLinks} currentId={episode._id} />
                      <Button
                        component="a"
                        href={`#${imageAnchor}`}
                        onClick={() => focusSection(imageAnchor)}
                      >
                        Go to shot image approval
                      </Button>
                      {hasDialogue && (
                        <Button
                          component="a"
                          href={`#${dialogueAnchor}`}
                          onClick={() => focusSection(dialogueAnchor)}
                        >
                          Go to selected dialogue
                        </Button>
                      )}
                      {storyboard && <ReviewLinks rows={[storyboard]} currentId={episode._id} />}
                      {animatic && <ReviewLinks rows={[animatic]} currentId={episode._id} />}
                    </>
                  )}
                  {!reviewReason && promptProblem && (
                    <Button
                      component="a"
                      href={`#${promptAnchor}`}
                      onClick={() => focusSection(promptAnchor)}
                    >
                      Go to video prompt
                    </Button>
                  )}
                </Alert>
              )}
              {!reason && !error && (
                <Alert severity="success">
                  Ready to generate this shot. Generate video approves its current composition and
                  timed preview, then queues one video.
                  {animatic && animatic.status !== 'approved' && (
                    <ReviewLinks rows={[animatic]} currentId={episode._id} />
                  )}
                </Alert>
              )}
              {animatic?.timingIssues?.length > 0 && (
                <Button
                  disabled={disabled || busy || pending}
                  onClick={() =>
                    act(() =>
                      request<Studio.ActionResult>('/studio/workflow/animatic/prepare', {
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
                    request<Studio.ActionResult>('/studio/workflow/shot/approve', {
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
            </Stack>
          )}
          {videoFiles.length > 0 && (
            <Stack spacing={2}>
              <Typography sx={{ fontWeight: 600 }}>Video takes</Typography>
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
                    {sourceJob?.settings?.params?.mode && (
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        Generated with Wan 3.0{' '}
                        {sourceJob.settings.params.mode === 'prime' ? 'Prime' : 'Standard'} ·{' '}
                        {sourceJob.settings.params.resolution}
                      </Typography>
                    )}
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      {setupLabel}
                    </Typography>
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
                          request<Studio.ActionResult>('/studio/workflow/review', {
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
      </ShotDisclosure>
    </Box>
  );
}
