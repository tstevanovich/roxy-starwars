import AddOutlined from '@mui/icons-material/AddOutlined';
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import ArrowForwardOutlined from '@mui/icons-material/ArrowForwardOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useRef, useState } from 'react';

import { hasNativeAudio } from '../../shared/audio-policy.js';
import { imageGenerationDefaults } from '../../shared/production-defaults.js';
import { request } from './api.js';
import NativeVideoImport from './NativeVideoImport.jsx';
import ProductionBoard, { EnableWorkflow } from './ProductionBoard.jsx';
import { ShotProductionInputs } from './ProductionInputs.jsx';
import { studioUrl } from './project-url.js';
import RejectMediaButton from './RejectMediaButton.jsx';
import ReviewLinks from './ReviewLinks.jsx';
import ShotImageReview from './ShotImageReview.jsx';
import SoundDesign from './SoundDesign.jsx';
import SourceReferences from './SourceReferences.jsx';
import {
  downloadDraft,
  episodeTiming,
  pendingVideoChoices,
  runtime,
  uid,
  useDraft
} from './studio-utils.js';
import { ReferencePreview, UploadButton } from './StudioMedia.jsx';
import UpscaleImport from './UpscaleImport.jsx';
function VideoApprovalButton({
  file,
  clip,
  scene,
  workflow,
  native1080,
  disabled,
  onPicture,
  onVideo
}) {
  const picture = workflow && !file.soundMix;
  const native = hasNativeAudio(file);
  const approved = picture
    ? clip.production?.visualTakeId === file._id &&
      clip.pictureApprovalStatus === 'approved' &&
      (!native || clip.selectedTakeId === file._id)
    : clip.selectedTakeId === file._id;
  const blockers = picture ? (clip.pictureReviewBlockers ?? scene.pictureReviewBlockers ?? []) : [];
  return (
    <Stack spacing={1}>
      <Button
        variant={approved ? 'outlined' : 'contained'}
        disabled={
          disabled ||
          approved ||
          blockers.length > 0 ||
          (!picture && !file.soundMix && clip.soundLegacyTakeId !== file._id)
        }
        onClick={() =>
          picture ? onPicture(scene.id, clip.id, file._id) : onVideo(scene.id, clip.id, file._id)
        }
      >
        {picture
          ? approved
            ? native
              ? 'Picture & sound approved'
              : 'Picture & performance approved'
            : native
              ? 'Approve picture, performance & sound'
              : 'Approve picture & performance'
          : approved
            ? 'Selected for edit'
            : 'Approve video take'}
      </Button>
      {native && (
        <Button
          variant="outlined"
          disabled={
            disabled ||
            blockers.length > 0 ||
            approved ||
            (clip.production?.audioRepairTakeId === file._id &&
              clip.pictureApprovalStatus === 'approved')
          }
          onClick={() => onPicture(scene.id, clip.id, file._id, true)}
        >
          Accept picture; repair sound
        </Button>
      )}
      {native && !approved && (
        <Typography variant="body2">
          Listen to the entire take: effects match the action, ambience is present, dialogue is
          clear and there is no music.{' '}
          {native1080
            ? 'Approval keeps this native 1080p soundtrack and video for the edit.'
            : 'Approving keeps this soundtrack and requests the 1440p upscale.'}{' '}
          Use Sound design only if the audio needs repair.
        </Typography>
      )}
      {blockers.length > 0 && (
        <Alert severity="info">
          Complete these reviews for this clip before picture approval: {blockers.join(', ')}.
          <ReviewLinks
            rows={clip.pictureReview?.prerequisites}
            currentId={clip.pictureReview?.target.recordId}
          />
          <Button component="a" href={`#picture-prerequisites-${clip.id}`} size="small">
            Review this clip's prerequisites
          </Button>
        </Alert>
      )}
    </Stack>
  );
}
function EpisodeEditor({
  episode,
  assets,
  media,
  settings,
  onSaved,
  onMedia,
  onAssetSaved,
  onRejected,
  onChat,
  onReload,
  onBack
}) {
  const {
    draft,
    dirty,
    edit,
    saved,
    reloadSaved,
    newerSavedVersion,
    recovery,
    resolveSavedConflicts
  } = useDraft(episode, 'episode', media);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [prompts, setPrompts] = useState(null);
  const [selectedScene, setSelectedScene] = useState('');
  const pendingSceneJump = useRef(null);
  const episodeHeading = useRef(null);
  const sceneHeadings = useRef(new Map());
  const clipPanels = useRef(new Map());
  const pending = pendingVideoChoices(dirty ? episode : draft, media);
  const timing = episodeTiming(draft);
  const workflow = settings?.workflowVersion === 1;
  const native1080 = settings?.videoWorkflow === 'native-1080p';
  function jumpToScene(id) {
    setSelectedScene(id);
    pendingSceneJump.current = id;
  }
  function finishSceneJump() {
    const id = pendingSceneJump.current;
    pendingSceneJump.current = null;
    if (id === null) return;
    // Wait for the menu's scroll lock and focus trap to be removed.
    requestAnimationFrame(() => scrollToScene(id));
  }
  function scrollToScene(id) {
    const boardScene = workflow && id ? document.getElementById(`board-scene-${id}`) : null;
    const heading = boardScene || (id ? sceneHeadings.current.get(id) : episodeHeading.current);
    if (!heading) return;
    const address = new URL(window.location.href);
    address.hash = boardScene ? `board-scene-${id}` : id ? `scene-edit-${id}` : 'episode-top';
    window.history.replaceState(window.history.state, '', address);
    const navigation = document.querySelector('.scene-navigation');
    const inset = navigation
      ? navigation.getBoundingClientRect().height +
        (Number.parseFloat(window.getComputedStyle(navigation).top) || 0) +
        12
      : 12;
    window.scrollTo({
      top: Math.max(0, window.scrollY + heading.getBoundingClientRect().top - inset),
      behavior: 'instant'
    });
    heading.focus({ preventScroll: true });
  }
  function field(name, value) {
    edit({
      ...draft,
      [name]: value
    });
    setPrompts(null);
  }
  function sceneEdit(id, patch) {
    field(
      'scenes',
      draft.scenes.map((s) =>
        s.id === id
          ? {
              ...s,
              ...patch
            }
          : s
      )
    );
  }
  function clipEdit(sceneId, clipId, patch) {
    edit((current) => ({
      ...current,
      scenes: current.scenes.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              clips: s.clips.map((c) =>
                c.id === clipId
                  ? {
                      ...c,
                      ...patch
                    }
                  : c
              )
            }
          : s
      )
    }));
    setPrompts(null);
  }
  async function handleError(e) {
    setError(e.message);
    if (e.status !== 409) return;
    try {
      const studio = await request('/studio');
      const latest = studio.episodes.find((item) => item._id === episode._id);
      if (latest) {
        onSaved(latest);
        setError('');
        setNotice(
          'The saved episode was refreshed. Your draft is preserved; review any conflicts before saving again.'
        );
      }
    } catch {
      // The recoverable draft stays intact if the refresh also fails.
    }
  }
  async function approvePicture(sceneId, clipId, takeId, audioRepair = false) {
    if (busy || dirty) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let row = episode.scenes
        .find((s) => s.id === sceneId)
        ?.clips.find((c) => c.id === clipId)?.pictureReview;
      if (!row) {
        const board = await request('/studio/workflow/board', {
          method: 'POST',
          body: { target: { scope: 'episode', recordId: episode._id } }
        });
        row = board.groups
          .find(
            (g) =>
              g.target.scope === 'clip' &&
              g.target.sceneId === sceneId &&
              g.target.clipId === clipId
          )
          ?.stages.find((r) => r.stage === 'visual');
      }
      if (!row) throw new Error('Picture review is unavailable. Refresh the episode.');
      await request('/studio/workflow/review', {
        method: 'POST',
        body: {
          target: row.target,
          stage: 'visual',
          action: 'approve',
          takeId,
          ...(audioRepair ? { audioRepair: true } : {}),
          fingerprint: row.fingerprint,
          parentRevision: row.parentRevision,
          reviewRevision: row.reviewRevision
        }
      });
      const studio = await request('/studio');
      const next = studio.episodes.find((e) => e._id === episode._id);
      if (next) {
        saved(next);
        onSaved(next);
      }
      onReload?.();
      setNotice(
        audioRepair
          ? 'Picture accepted for sound repair. No finished take or upscale has been approved.'
          : hasNativeAudio(media.find((m) => m._id === takeId))
            ? native1080
              ? 'Native 1080p picture, performance and sound approved. Ready for the edit; no upscale required.'
              : 'Picture, performance and native sound approved. The 1440p upscale request is recorded.'
            : 'Picture and performance approved. The finished sound mix is reviewed separately.'
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function approveVideo(sceneId, clipId, takeId) {
    if (busy || dirty) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { episode: next } = await request(`/studio/episodes/${draft._id}`, {
        method: 'PUT',
        body: {
          ...draft,
          scenes: draft.scenes.map((scene) =>
            scene.id === sceneId
              ? {
                  ...scene,
                  clips: scene.clips.map((clip) =>
                    clip.id === clipId ? { ...clip, selectedTakeId: takeId } : clip
                  )
                }
              : scene
          )
        }
      });
      saved(next);
      onSaved(next);
      if (workflow) onReload?.();
      setNotice(
        workflow
          ? native1080
            ? 'Finished 1080p sound mix approved and saved. No upscale required.'
            : 'Finished mix approved and saved. The 1440p request is recorded; import the completed upscale for quality review.'
          : native1080
            ? '1080p video take approved and saved. No upscale required.'
            : 'Video take approved and saved. A 1440p (2K) upscale has been requested.'
      );
    } catch (e) {
      await handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function importUpscale(sceneId, clipId, file) {
    if (busy || dirty) throw new Error('Save your episode edits before importing an upscale.');
    const clip = episode.scenes.find((s) => s.id === sceneId)?.clips.find((c) => c.id === clipId);
    if (!clip?.selectedTakeId) throw new Error('Approve the original video first.');
    setBusy(true);
    setError('');
    onMedia(file);
    try {
      const result = await request('/studio/workflow/upscale/import', {
        method: 'POST',
        body: {
          target: { scope: 'clip', recordId: episode._id, sceneId, clipId },
          parentRevision: episode.revision,
          sourceTakeId: clip.selectedTakeId,
          mediaId: file._id
        }
      });
      onSaved(result.episode);
      setNotice(`Upscale saved: ${file.originalName}. Review its 1440p quality next.`);
      await onReload?.();
      return result;
    } finally {
      setBusy(false);
    }
  }
  async function run(action, sceneId) {
    if (action === 'save' && newerSavedVersion) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (action === 'prompts') {
        const result = await request('/studio/prompts', {
          method: 'POST',
          body: draft
        });
        setPrompts(result.prompts);
      } else {
        const { episode: next } = await request(
          `/studio/episodes/${draft._id}${action === 'approve' ? `/scenes/${sceneId}/approve` : ''}`,
          {
            method: action === 'approve' ? 'POST' : 'PUT',
            body:
              action === 'approve'
                ? {
                    revision: draft.revision
                  }
                : draft
          }
        );
        saved(next);
        onSaved(next);
        if (workflow) onReload?.();
        setNotice(
          action === 'approve'
            ? 'Scene script, planned clips and sound plan approved.'
            : 'Episode saved. Changed scenes need renewed approval.'
        );
      }
    } catch (e) {
      await handleError(e);
    } finally {
      setBusy(false);
    }
  }
  function addScene() {
    field('scenes', [
      ...draft.scenes,
      {
        id: uid(),
        title: `Scene ${draft.scenes.length + 1}`,
        style: 'cinematic',
        location: '',
        script: '',
        assetIds: [],
        clips: [],
        approval: null
      }
    ]);
  }
  return (
    <Stack spacing={3}>
      {draft.videoPass?.policy === 'wan-native-effects-v1' && (
        <Alert severity="info">
          Episode video pass restarted with Wan sound effects and ambience. Previous files remain in
          Media library. Review any outstanding script, shot plan and image choices below; approved
          inputs are reused. Each new video waits for your picture and sound approval before the
          next.
        </Alert>
      )}
      <Button
        startIcon={<ArrowBackOutlined />}
        onClick={onBack}
        sx={{
          alignSelf: 'flex-start'
        }}
      >
        All episodes
      </Button>
      <Stack
        direction={{
          xs: 'column',
          sm: 'row'
        }}
        sx={{
          justifyContent: 'space-between',
          gap: 2
        }}
      >
        <Box>
          <Typography variant="overline">Episode workspace</Typography>
          <Typography
            id="episode-top"
            variant="h1"
            ref={episodeHeading}
            tabIndex={-1}
            className="scene-heading"
          >
            {draft.title}
          </Typography>
        </Box>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          {onChat && (
            <Button onClick={() => onChat({ episodeId: episode._id })}>Discuss in chat</Button>
          )}
          <Button
            variant="contained"
            disabled={busy || !dirty || newerSavedVersion}
            onClick={() => run('save')}
          >
            Save episode
          </Button>
        </Stack>
      </Stack>
      {draft.scenes.length > 0 && (
        <Box component="nav" aria-label="Scene navigation" className="scene-navigation">
          <TextField
            select
            fullWidth
            size="small"
            label="Jump to scene"
            value={selectedScene}
            onChange={(e) => jumpToScene(e.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
              select: {
                displayEmpty: true,
                MenuProps: {
                  disableRestoreFocus: true,
                  slotProps: {
                    paper: { sx: { maxHeight: 320 } },
                    transition: { onExited: finishSceneJump }
                  }
                }
              }
            }}
          >
            <MenuItem
              value=""
              onClick={() => {
                if (selectedScene === '') jumpToScene('');
              }}
            >
              Top of episode
            </MenuItem>
            {draft.scenes.map((scene, index) => (
              <MenuItem
                key={scene.id}
                value={scene.id}
                sx={{ whiteSpace: 'normal' }}
                onClick={() => {
                  if (selectedScene === scene.id) jumpToScene(scene.id);
                }}
              >
                {String(index + 1).padStart(2, '0')} · {scene.title || 'Untitled scene'}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      )}
      {error && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={() => downloadDraft(draft)}>
              Export draft
            </Button>
          }
        >
          {error}
          <Button color="inherit" onClick={reloadSaved}>
            Export draft and reload saved version
          </Button>
        </Alert>
      )}
      {notice && <Alert severity="success">{notice}</Alert>}
      {dirty && (
        <Alert severity="info">
          Unsaved draft retained in this browser. Save before approving scenes or exporting.
        </Alert>
      )}
      {newerSavedVersion && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" onClick={reloadSaved}>
              Export draft and reload saved version
            </Button>
          }
        >
          {recovery?.unavailable
            ? 'The original revision for this older draft is no longer in episode history. Export your draft before loading the saved episode.'
            : 'Your draft and the saved episode changed the same fields. Choose which values to keep before saving. Newly saved videos remain available for review below.'}
          {recovery && !recovery.unavailable && (
            <Stack spacing={1} sx={{ mt: 1 }}>
              <Typography variant="body2">
                Conflicting fields: {recovery.conflicts.join(', ')}
              </Typography>
              <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                <Button
                  color="inherit"
                  onClick={() => {
                    resolveSavedConflicts('local');
                    setError('');
                  }}
                >
                  Keep my edits in conflicting fields
                </Button>
                <Button
                  color="inherit"
                  onClick={() => {
                    resolveSavedConflicts('saved');
                    setError('');
                  }}
                >
                  Use saved values in conflicting fields
                </Button>
              </Stack>
            </Stack>
          )}
        </Alert>
      )}
      {recovery && !newerSavedVersion && (
        <Alert severity="info">
          Newly saved videos and episode updates have been merged with your draft. Your edits are
          preserved, and a recovery copy of the original draft is kept in this browser. Save episode
          to keep the combined version.
        </Alert>
      )}
      {workflow && episode.workflowReviewCount > 0 && (
        <Button component="a" href="#production-approval-board" variant="outlined">
          Production reviews waiting for you ({episode.workflowReviewCount})
        </Button>
      )}
      {pending.length > 0 && (
        <Box component="section" aria-label="Pending video choices" className="editor-panel">
          <Typography variant="h2">Pending video choices ({pending.length})</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 2 }}>
            {workflow
              ? 'New Wan takes include sound effects and ambience. Review picture, performance and sound together, including the absence of music. Approve a good take directly; use Sound design only when audio needs repair. Music belongs in CapCut.'
              : native1080
                ? 'Watch these finished 1080p takes with sound, then approve a video take in its clip. No upscale is required.'
                : 'Watch these finished takes with sound, then approve a video take in its clip. Approval saves the selection and requests a 1440p upscale.'}
          </Typography>
          {dirty && <Alert severity="info">Save your draft before approving a video take.</Alert>}
          <Stack spacing={1}>
            {pending.map(({ scene, clip }) => (
              <Stack key={clip.id} spacing={1}>
                <Button
                  variant="outlined"
                  sx={{ justifyContent: 'flex-start' }}
                  onClick={() => {
                    setSelectedScene(scene.id);
                    const panel =
                      clipPanels.current.get(clip.id) || sceneHeadings.current.get(scene.id);
                    panel?.scrollIntoView({
                      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
                        ? 'instant'
                        : 'smooth',
                      block: 'start'
                    });
                    panel?.focus({ preventScroll: true });
                  }}
                >
                  Review video: {clip.title} · {scene.title}
                </Button>
                {[...(clip.takeIds ?? [])].reverse().map((id) => {
                  const file = media.find((item) => item._id === id && item.kind === 'video');
                  return file ? (
                    <Box className="attachment" key={id}>
                      <ReferencePreview file={file} kind="video" />
                      <Typography sx={{ p: 2 }}>
                        {clip.title} ·{' '}
                        {file.soundMix
                          ? 'Finished sound mix'
                          : hasNativeAudio(file)
                            ? 'Picture / performance / native sound take'
                            : 'Picture / performance take'}
                        : {file.originalName}
                      </Typography>
                      <Box sx={{ px: 2, pb: 2 }}>
                        <VideoApprovalButton
                          file={file}
                          clip={clip}
                          scene={scene}
                          workflow={workflow}
                          native1080={native1080}
                          disabled={busy || dirty}
                          onPicture={approvePicture}
                          onVideo={approveVideo}
                        />
                        <RejectMediaButton
                          file={file}
                          disabled={busy || dirty}
                          context={{
                            episodeId: episode._id,
                            revision: episode.revision,
                            sceneId: scene.id,
                            clipId: clip.id
                          }}
                          onRejected={onRejected}
                        />
                      </Box>
                    </Box>
                  ) : null;
                })}
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
      {workflow ? (
        <ProductionBoard
          record={episode}
          scope="episode"
          assets={assets}
          media={media}
          saving={busy}
          draftPending={dirty}
          onChanged={onReload}
          onImportUpscale={importUpscale}
          onAssetSaved={onAssetSaved}
          onRejected={onRejected}
        />
      ) : (
        <EnableWorkflow disabled={busy || dirty} />
      )}
      {workflow && (
        <Box className="editor-panel">
          <Stack spacing={2}>
            <Typography variant="h2">Episode planning</Typography>
            <TextField
              label="Source research / original story direction"
              multiline
              minRows={3}
              value={draft.production?.sourceNotes ?? ''}
              onChange={(e) =>
                field('production', { ...draft.production, sourceNotes: e.target.value })
              }
            />
            <TextField
              label="Episode outline for approval"
              multiline
              minRows={4}
              value={draft.production?.outline ?? ''}
              onChange={(e) =>
                field('production', {
                  ...draft.production,
                  outline: e.target.value,
                  outlineNeedsRevision: false
                })
              }
            />
          </Stack>
        </Box>
      )}
      {(draft.sourceReferences?.length > 0 || settings.cinematicOnly) && (
        <SourceReferences
          disabled={busy || dirty}
          onMedia={onMedia}
          episode={draft}
          onEdit={(patch) => edit((current) => ({ ...current, ...patch }))}
        />
      )}
      <Box className="runtime-strip">
        <Box>
          <Typography variant="caption">PLANNED RUNTIME</Typography>
          <Typography variant="h2">
            {runtime(timing.total)}{' '}
            <Typography component="span" color="text.secondary">
              / {runtime(settings.targetSeconds)}
            </Typography>
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption">VLOG / CINEMATIC</Typography>
          <Typography variant="h2">
            {timing.vlogPercent}% / {100 - timing.vlogPercent}%
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption">CLIP LENGTHS</Typography>
          <Typography variant="h3">Scene-led · 2–30 seconds</Typography>
        </Box>
      </Box>
      <Box className="editor-panel">
        <Stack spacing={2}>
          <TextField
            label="Episode title"
            value={draft.title}
            onChange={(e) => field('title', e.target.value)}
          />
          <TextField
            label="Episode summary"
            multiline
            minRows={2}
            value={draft.synopsis || ''}
            onChange={(e) => field('synopsis', e.target.value)}
            helperText="A short synopsis for the Episodes overview. Keep the full story outline below."
            slotProps={{ htmlInput: { maxLength: 1200 } }}
          />
          <TextField
            label="Premise and story outline"
            multiline
            minRows={4}
            value={draft.premise}
            onChange={(e) => field('premise', e.target.value)}
          />
          <TextField
            label="Episode continuity notes"
            id="episode-continuity-notes"
            sx={{ '& textarea': { scrollMarginTop: '200px' } }}
            multiline
            minRows={2}
            value={draft.notes}
            onChange={(e) => field('notes', e.target.value)}
          />
        </Stack>
      </Box>
      <Stack
        direction="row"
        sx={{
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <Typography variant="h2">Scene board</Typography>
        <Button startIcon={<AddOutlined />} onClick={addScene}>
          Add scene
        </Button>
      </Stack>
      {!draft.scenes.length && (
        <Box className="empty-state">
          <Typography variant="h3">Start with the story.</Typography>
          <Typography>
            Write the outline, add a scene, and let its action determine the clips.
          </Typography>
          <Button onClick={addScene} startIcon={<AddOutlined />}>
            Add the first scene
          </Button>
        </Box>
      )}
      {draft.scenes.map((scene, index) => (
        <Box
          className="editor-panel scene-panel"
          key={scene.id}
          id={`scene-edit-${scene.id}`}
          tabIndex={-1}
          sx={{ scrollMarginTop: '110px' }}
        >
          <Stack
            direction={{
              xs: 'column',
              sm: 'row'
            }}
            sx={{
              justifyContent: 'space-between',
              gap: 2,
              mb: 3
            }}
          >
            <Box>
              <Typography variant="overline">SCENE {String(index + 1).padStart(2, '0')}</Typography>
              <Typography
                variant="h2"
                tabIndex={-1}
                className="scene-heading"
                ref={(node) => {
                  if (node) sceneHeadings.current.set(scene.id, node);
                  else sceneHeadings.current.delete(scene.id);
                }}
              >
                {scene.title}
              </Typography>
            </Box>
            <Stack
              direction="row"
              sx={{
                gap: 1,
                alignItems: 'center'
              }}
            >
              <Chip
                color={!dirty && scene.approvalStatus === 'approved' ? 'success' : 'default'}
                label={
                  dirty
                    ? 'Draft edits'
                    : scene.approvalStatus === 'approved'
                      ? 'Script approved'
                      : scene.approvalStatus === 'needs-review'
                        ? 'Needs review'
                        : 'Draft'
                }
              />
              <Button
                disabled={
                  busy ||
                  dirty ||
                  !scene.script.trim() ||
                  !scene.clips.length ||
                  scene.approvalStatus === 'approved'
                }
                onClick={() => run('approve', scene.id)}
                sx={workflow ? { display: 'none' } : undefined}
                startIcon={<CheckCircleOutlined />}
              >
                Approve script
              </Button>
            </Stack>
          </Stack>
          <Stack spacing={2}>
            <Stack
              direction={{
                xs: 'column',
                sm: 'row'
              }}
              spacing={2}
            >
              <TextField
                fullWidth
                label="Scene title"
                value={scene.title}
                onChange={(e) =>
                  sceneEdit(scene.id, {
                    title: e.target.value
                  })
                }
              />
              <TextField
                select
                label="Presentation"
                value={scene.style}
                onChange={(e) =>
                  sceneEdit(scene.id, {
                    style: e.target.value
                  })
                }
                sx={{
                  minWidth: 180
                }}
              >
                <MenuItem value="cinematic">Cinematic</MenuItem>
                <MenuItem value="vlog" disabled={settings.cinematicOnly}>
                  Vlog to audience
                </MenuItem>
              </TextField>
            </Stack>
            <TextField
              label="Location"
              value={scene.location}
              onChange={(e) =>
                sceneEdit(scene.id, {
                  location: e.target.value
                })
              }
            />
            <TextField
              label="Scene script"
              multiline
              minRows={5}
              value={scene.script}
              onChange={(e) =>
                sceneEdit(scene.id, {
                  script: e.target.value
                })
              }
              helperText="Write dialogue, action, and the scene's turning point. Approval applies to this script and the planned clips."
            />
            <TextField
              select
              label="Characters, sets, wardrobe, and props"
              slotProps={{
                select: {
                  multiple: true
                }
              }}
              value={scene.assetIds}
              onChange={(e) =>
                sceneEdit(scene.id, {
                  assetIds: e.target.value
                })
              }
            >
              {assets
                .filter(
                  (a) =>
                    scene.assetIds.includes(a._id) ||
                    (a.kind !== 'sound' &&
                      !a.archived &&
                      (a.scope !== 'episode' || a.episodeId === draft._id))
                )
                .map((a) => (
                  <MenuItem key={a._id} value={a._id}>
                    {a.name}
                    {a.finalChoice ? ' · finalized' : ' · in development'}
                  </MenuItem>
                ))}
            </TextField>
            {draft.sourceReferences?.length > 0 && (
              <>
                <TextField
                  select
                  fullWidth
                  label="Source footage for this scene"
                  value={scene.sourceReferenceIds ?? []}
                  slotProps={{ select: { multiple: true } }}
                  onChange={(e) => sceneEdit(scene.id, { sourceReferenceIds: e.target.value })}
                >
                  {draft.sourceReferences.map((ref) => (
                    <MenuItem key={ref.id} value={ref.id}>
                      {ref.chapter || ref.title} - {ref.status}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  multiline
                  label="Scene source notes and adaptation choices"
                  value={scene.sourceNotes ?? ''}
                  onChange={(e) => sceneEdit(scene.id, { sourceNotes: e.target.value })}
                />
              </>
            )}
            <SoundDesign
              episode={draft}
              scene={scene}
              assets={assets}
              media={media}
              dirty={dirty}
              busy={busy}
              onEdit={(soundPlan) => sceneEdit(scene.id, { soundPlan })}
              onSaved={(next) => {
                saved(next);
                onSaved(next);
              }}
              onAssetSaved={onAssetSaved}
              onMedia={onMedia}
              onRejected={onRejected}
              onReload={onReload}
            />
            {scene.clips.map((clip, clipIndex) => (
              <Box className="clip-panel" key={clip.id}>
                <Stack spacing={2}>
                  <Typography variant="overline">CLIP {clipIndex + 1}</Typography>
                  {onChat && (
                    <Button
                      sx={{ alignSelf: 'flex-start' }}
                      onClick={() =>
                        onChat({ episodeId: episode._id, sceneId: scene.id, clipId: clip.id })
                      }
                    >
                      Discuss this clip
                    </Button>
                  )}
                  {pending.some(({ clip: choice }) => choice.id === clip.id) && (
                    <Chip
                      label="Pending choice — video take"
                      color="warning"
                      sx={{ alignSelf: 'flex-start' }}
                    />
                  )}
                  <Stack
                    direction={{
                      xs: 'column',
                      sm: 'row'
                    }}
                    spacing={2}
                  >
                    <TextField
                      fullWidth
                      label="Clip title"
                      value={clip.title}
                      onChange={(e) =>
                        clipEdit(scene.id, clip.id, {
                          title: e.target.value
                        })
                      }
                    />
                    <TextField
                      type="number"
                      label="Duration in seconds"
                      value={clip.duration}
                      slotProps={{
                        htmlInput: {
                          min: 2,
                          max: 30
                        }
                      }}
                      onChange={(e) =>
                        clipEdit(scene.id, clip.id, {
                          duration: Number(e.target.value)
                        })
                      }
                      sx={{
                        minWidth: 180
                      }}
                    />
                  </Stack>
                  <Box
                    id={`shot-inputs-${clip.id}`}
                    tabIndex={-1}
                    sx={{ scrollMarginTop: '128px' }}
                  />
                  {assets
                    .filter(
                      (asset) =>
                        !asset.archived &&
                        asset.episodeId === draft._id &&
                        asset.sceneId === scene.id &&
                        asset.clipId === clip.id
                    )
                    .map((asset) => (
                      <ShotImageReview
                        key={asset._id}
                        asset={asset}
                        media={media}
                        onSaved={onAssetSaved}
                        onRejected={onRejected}
                      />
                    ))}
                  {(clip.takeIds ?? []).length > 0 && (
                    <Stack
                      component="section"
                      aria-label={`Video takes for ${clip.title}`}
                      spacing={2}
                      tabIndex={-1}
                      sx={{ scrollMarginTop: '128px' }}
                      ref={(node) => {
                        if (node) clipPanels.current.set(clip.id, node);
                        else clipPanels.current.delete(clip.id);
                      }}
                    >
                      <Typography variant="h3">Video takes to review</Typography>
                      {clip.soundReviewStatus === 'needs-review' && (
                        <Alert severity="warning">
                          This selected mix needs review because the sound plan or an approved sound
                          changed. Create and approve a current mix before export.
                        </Alert>
                      )}
                      <Typography variant="body2" color="text.secondary">
                        Play each take with sound, then choose the one to use. Importing a take does
                        not select it for the edit.
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {native1080
                          ? 'Approve the native 1080p video with its soundtrack for direct use in CapCut. No upscale step is required.'
                          : 'Approve video take saves your choice and requests a 1440p (2K) upscale. The original review video is retained.'}{' '}
                        Save any draft edits first.
                      </Typography>
                      {[...clip.takeIds].reverse().map((id) => {
                        const file = media.find((m) => m._id === id);
                        return (
                          <Box key={id} className="attachment">
                            {!pending.some(({ clip: choice }) => choice.id === clip.id) && (
                              <ReferencePreview file={file} kind="video" />
                            )}
                            <Stack spacing={1} sx={{ p: 2 }}>
                              <Typography>{file?.originalName || 'Missing video take'}</Typography>
                              <Typography variant="caption">
                                {file?.soundMix
                                  ? 'Finished sound mix'
                                  : clip.soundLegacyTakeId === id
                                    ? 'Previously approved take'
                                    : 'Original video: create a sound mix before approval'}
                              </Typography>
                              {file &&
                                !pending.some(({ clip: choice }) => choice.id === clip.id) && (
                                  <VideoApprovalButton
                                    file={file}
                                    clip={clip}
                                    scene={scene}
                                    workflow={workflow}
                                    native1080={native1080}
                                    disabled={busy || dirty}
                                    onPicture={approvePicture}
                                    onVideo={approveVideo}
                                  />
                                )}
                              {file &&
                                !pending.some(({ clip: choice }) => choice.id === clip.id) && (
                                  <RejectMediaButton
                                    file={file}
                                    disabled={busy || dirty}
                                    context={{
                                      episodeId: draft._id,
                                      revision: draft.revision,
                                      sceneId: scene.id,
                                      clipId: clip.id
                                    }}
                                    onRejected={onRejected}
                                  />
                                )}
                            </Stack>
                          </Box>
                        );
                      })}
                    </Stack>
                  )}
                  <TextField
                    label="Action and performance"
                    helperText="Describe this shot independently: Star Wars universe, Imperial era, the visible setting, approved subjects, and action."
                    multiline
                    minRows={2}
                    value={clip.action}
                    onChange={(e) =>
                      clipEdit(scene.id, clip.id, {
                        action: e.target.value
                      })
                    }
                  />
                  <TextField
                    id={`shot-dialogue-${clip.id}`}
                    sx={{ '& textarea': { scrollMarginTop: '200px' } }}
                    label="Exact dialogue with speaker names"
                    multiline
                    minRows={2}
                    value={clip.dialogue}
                    onChange={(e) =>
                      clipEdit(scene.id, clip.id, {
                        dialogue: e.target.value
                      })
                    }
                  />
                  {clip.dialogue?.trim() && (
                    <Stack spacing={1}>
                      <Typography>
                        Final mixes require a dialogue-only audio stem with the video's timing and
                        duration. Generated video audio is excluded because it may contain music.
                        Import cleaned synchronized speech, then review lip sync in the finished
                        mix.
                      </Typography>
                      <UploadButton
                        label="Import synchronized dialogue-only stem"
                        onUploaded={(file) => {
                          onMedia(file);
                          if (file.kind !== 'audio') {
                            setError('Choose an audio file for the dialogue-only stem.');
                            return;
                          }
                          clipEdit(scene.id, clip.id, {
                            production: { ...clip.production, cleanDialogueMediaId: file._id }
                          });
                        }}
                      />
                      {clip.production?.cleanDialogueMediaId && (
                        <ReferencePreview
                          file={media.find((m) => m._id === clip.production.cleanDialogueMediaId)}
                        />
                      )}
                    </Stack>
                  )}
                  {workflow && (
                    <>
                      {!native1080 && (
                        <UpscaleImport
                          clip={clip}
                          media={media}
                          episodeId={episode._id}
                          sceneId={scene.id}
                          disabled={busy || dirty}
                          onImport={importUpscale}
                          showReviewLink
                        />
                      )}
                      <ShotProductionInputs
                        episode={draft}
                        assets={assets}
                        scene={scene}
                        clip={clip}
                        media={media}
                        onEdit={(production) => clipEdit(scene.id, clip.id, { production })}
                        onMedia={onMedia}
                      />
                    </>
                  )}
                  <Stack
                    direction={{
                      xs: 'column',
                      sm: 'row'
                    }}
                    spacing={2}
                  >
                    <TextField
                      fullWidth
                      label="Camera and light"
                      multiline
                      minRows={2}
                      value={clip.camera}
                      onChange={(e) =>
                        clipEdit(scene.id, clip.id, {
                          camera: e.target.value
                        })
                      }
                    />
                    <TextField
                      fullWidth
                      label="Sound effects and ambience"
                      multiline
                      minRows={2}
                      value={clip.soundEffects}
                      onChange={(e) =>
                        clipEdit(scene.id, clip.id, {
                          soundEffects: e.target.value
                        })
                      }
                      helperText="No generated music. Music is added in CapCut."
                    />
                  </Stack>
                  {(clip.dialogueTakeIds ?? []).length > 0 && (
                    <Stack
                      component="section"
                      aria-label={`Dialogue takes for ${clip.title}`}
                      spacing={2}
                    >
                      <Typography variant="h3">Dialogue to review</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Compare the delivery with the finalized voice. Check the words,
                        pronunciation and pacing before choosing the performance for this clip.
                      </Typography>
                      {[...clip.dialogueTakeIds].reverse().map((id) => {
                        const file = media.find((m) => m._id === id);
                        return (
                          <Box key={id} className="attachment">
                            <ReferencePreview file={file} kind="voice" />
                            <Stack spacing={1} sx={{ p: 2 }}>
                              <Typography sx={{ overflowWrap: 'anywhere' }}>
                                {file?.originalName || 'Missing dialogue take'}
                              </Typography>
                              <Button
                                variant={clip.selectedDialogueId === id ? 'outlined' : 'contained'}
                                disabled={!file || clip.selectedDialogueId === id}
                                onClick={() =>
                                  clipEdit(scene.id, clip.id, { selectedDialogueId: id })
                                }
                              >
                                {clip.selectedDialogueId === id
                                  ? 'Selected dialogue'
                                  : 'Use this dialogue'}
                              </Button>
                              {file && (
                                <RejectMediaButton
                                  file={file}
                                  disabled={busy || dirty}
                                  context={{
                                    episodeId: draft._id,
                                    revision: draft.revision,
                                    sceneId: scene.id,
                                    clipId: clip.id
                                  }}
                                  onRejected={onRejected}
                                />
                              )}
                            </Stack>
                          </Box>
                        );
                      })}
                      {clip.selectedDialogueId && (
                        <Button
                          onClick={() => clipEdit(scene.id, clip.id, { selectedDialogueId: null })}
                        >
                          Clear dialogue selection
                        </Button>
                      )}
                    </Stack>
                  )}
                  <TextField
                    select
                    fullWidth
                    label="Selected video take"
                    slotProps={{
                      inputLabel: { shrink: true },
                      select: { displayEmpty: true }
                    }}
                    value={clip.selectedTakeId || ''}
                    onChange={(e) =>
                      clipEdit(scene.id, clip.id, {
                        selectedTakeId: e.target.value || null
                      })
                    }
                  >
                    <MenuItem value="">No take selected</MenuItem>
                    {media
                      .filter(
                        (m) =>
                          m.kind === 'video' &&
                          (clip.takeIds?.includes(m._id) || clip.selectedTakeId === m._id) &&
                          (m.soundMix ||
                            clip.soundLegacyTakeId === m._id ||
                            clip.selectedTakeId === m._id)
                      )
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
                  {!workflow &&
                    clip.upscale?.status === 'waiting-provider' &&
                    clip.upscale.sourceTakeId === clip.selectedTakeId && (
                      <Alert severity="warning">
                        <strong>2K upscale waiting for provider connection.</strong>{' '}
                        {clip.upscale.message}
                      </Alert>
                    )}
                  {clip.selectedTakeId &&
                    clip.selectedTakeId !==
                      episode.scenes
                        .find((s) => s.id === scene.id)
                        ?.clips.find((c) => c.id === clip.id)?.selectedTakeId && (
                      <Typography variant="body2" color="text.secondary">
                        {native1080
                          ? 'Save episode to record this video selection. No upscale is required.'
                          : 'Save episode to record this video approval and its 2K upscale request.'}
                      </Typography>
                    )}
                  {native1080 ? (
                    <NativeVideoImport
                      episode={episode}
                      scene={scene}
                      clip={clip}
                      disabled={busy || dirty}
                      onMedia={onMedia}
                      onSaved={(next) => {
                        saved(next);
                        onSaved(next);
                        onReload?.();
                      }}
                    />
                  ) : (
                    <UploadButton
                      label="Import a video take"
                      onUploaded={(file) => {
                        onMedia(file);
                        if (file.kind === 'video')
                          clipEdit(scene.id, clip.id, {
                            takeIds: [...new Set([...(clip.takeIds ?? []), file._id])]
                          });
                      }}
                    />
                  )}
                  {clip.selectedTakeId && !(clip.takeIds ?? []).includes(clip.selectedTakeId) && (
                    <ReferencePreview file={media.find((m) => m._id === clip.selectedTakeId)} />
                  )}
                  <Stack
                    direction="row"
                    sx={{
                      gap: 1
                    }}
                  >
                    <Button
                      size="small"
                      disabled={clipIndex === 0}
                      onClick={() => {
                        const clips = [...scene.clips];
                        [clips[clipIndex - 1], clips[clipIndex]] = [
                          clips[clipIndex],
                          clips[clipIndex - 1]
                        ];
                        sceneEdit(scene.id, {
                          clips
                        });
                      }}
                    >
                      Move earlier
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        sceneEdit(scene.id, {
                          clips: scene.clips.filter((c) => c.id !== clip.id)
                        })
                      }
                    >
                      Remove clip from draft
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            ))}
            <Button
              startIcon={<AddOutlined />}
              sx={{
                alignSelf: 'flex-start'
              }}
              onClick={() =>
                sceneEdit(scene.id, {
                  clips: [
                    ...scene.clips,
                    {
                      id: uid(),
                      title: `Clip ${scene.clips.length + 1}`,
                      duration: 15,
                      action: '',
                      dialogue: '',
                      camera: '',
                      soundEffects: '',
                      selectedTakeId: null
                    }
                  ]
                })
              }
            >
              Plan another clip
            </Button>
            <Divider />
            <Stack
              direction="row"
              sx={{
                gap: 1,
                flexWrap: 'wrap'
              }}
            >
              <Button
                size="small"
                disabled={index === 0}
                onClick={() => {
                  const scenes = [...draft.scenes];
                  [scenes[index - 1], scenes[index]] = [scenes[index], scenes[index - 1]];
                  field('scenes', scenes);
                }}
              >
                Move scene earlier
              </Button>
              <Button
                size="small"
                onClick={() =>
                  field(
                    'scenes',
                    draft.scenes.filter((s) => s.id !== scene.id)
                  )
                }
              >
                Remove scene from draft
              </Button>
            </Stack>
          </Stack>
        </Box>
      ))}
      <Box className="editor-panel">
        <Typography
          variant="h2"
          sx={{
            mb: 1
          }}
        >
          Production prompts and notes
        </Typography>
        <Typography
          color="text.secondary"
          sx={{
            mb: 3
          }}
        >
          Review generator directions here. Download approved videos and separate background music
          from each scene on the production board.
        </Typography>
        <Stack
          direction="row"
          sx={{
            gap: 1.5,
            flexWrap: 'wrap'
          }}
        >
          <Button
            variant="outlined"
            disabled={busy || !draft.scenes.some((s) => s.clips.length)}
            onClick={() => run('prompts')}
          >
            Preview generator prompts
          </Button>
          <Button
            component="a"
            href={studioUrl(`/api/studio/episodes/${draft._id}/brief`)}
            download
            target="_blank"
            rel="noopener"
            startIcon={<DownloadOutlined />}
          >
            Download production brief
          </Button>
        </Stack>
      </Box>
      {prompts?.map((p) => (
        <Box className="editor-panel" key={p.clipId}>
          <Typography variant="h3">
            {
              draft.scenes.find((s) => s.id === p.sceneId)?.clips.find((c) => c.id === p.clipId)
                ?.title
            }
          </Typography>
          <Stack
            spacing={2}
            sx={{
              mt: 2
            }}
          >
            <TextField
              label={`${imageGenerationDefaults.displayName} · 2K image prompt`}
              multiline
              value={p.image}
              slotProps={{
                input: {
                  readOnly: true
                }
              }}
            />
            <TextField
              label="Wan 3.0 · 16:9 video prompt"
              multiline
              value={p.video}
              error={!p.videoWithinLimit}
              helperText={`${p.video.length} / 4,500 characters`}
              slotProps={{
                input: {
                  readOnly: true
                }
              }}
            />
          </Stack>
        </Box>
      ))}
      <Alert severity="info">
        Request images, dialogue and video through Production chat. Use each scene's Sound design
        panel to approve sounds and create a finished mix before video approval.
      </Alert>
      <Button
        onClick={() => downloadDraft(draft)}
        sx={{
          alignSelf: 'flex-start'
        }}
      >
        Export working draft
      </Button>
    </Stack>
  );
}
export default function Episodes({
  episodes,
  assets,
  media,
  settings,
  onSaved,
  onMedia,
  onAssetSaved,
  onRejected,
  onChat,
  onReload,
  initialCreate = false,
  initialId = ''
}) {
  const [selected, setSelected] = useState(initialId);
  const [creating, setCreating] = useState(initialCreate);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    setBusy(true);
    setError('');
    try {
      const { episode } = await request('/studio/episodes', {
        method: 'POST',
        body: {
          title,
          premise: '',
          notes: '',
          scenes: []
        }
      });
      onSaved(episode);
      setSelected(episode._id);
      setCreating(false);
      setTitle('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const episode = episodes.find((e) => e._id === selected);
  if (episode)
    return (
      <EpisodeEditor
        onChat={onChat}
        onReload={onReload}
        key={episode._id}
        {...{
          episode,
          assets,
          media,
          settings,
          onSaved,
          onMedia
        }}
        onAssetSaved={onAssetSaved}
        onRejected={onRejected}
        onBack={() => setSelected('')}
      />
    );
  return (
    <Stack spacing={3}>
      <Stack
        direction={{
          xs: 'column',
          sm: 'row'
        }}
        sx={{
          justifyContent: 'space-between',
          gap: 2
        }}
      >
        <Box>
          <Typography variant="h1">Episodes</Typography>
          <Typography
            color="text.secondary"
            sx={{
              mt: 1
            }}
          >
            Plan scenes, review one video at a time, and download approved takes.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreating(true)}>
          New episode
        </Button>
      </Stack>
      {!episodes.length && (
        <Box className="empty-state">
          <Typography variant="overline">THE NEXT JOB STARTS HERE</Typography>
          <Typography variant="h2">Give Roxy a reason to lift off.</Typography>
          <Typography color="text.secondary">
            Create an episode, write the scenes, and review each creative decision.
          </Typography>
          <Button
            variant="outlined"
            onClick={() => setCreating(true)}
            sx={{
              mt: 2
            }}
          >
            Create the first episode
          </Button>
        </Box>
      )}
      {episodes.map((e) => {
        const clips = e.scenes.flatMap((scene) => scene.clips);
        const approved = e.scenes.filter((scene) => scene.approvalStatus === 'approved').length;
        const selectedTakes = clips.filter((clip) => clip.selectedTakeId).length;
        const pendingCount = pendingVideoChoices(e, media).length;
        const productionReviews = e.workflowReviewCount ?? 0;
        const ready =
          e.scenes.length > 0 &&
          approved === e.scenes.length &&
          e.scenes.every((scene) => scene.clips.length > 0) &&
          selectedTakes === clips.length;
        const needsReview = e.scenes.some((scene) => scene.approvalStatus === 'needs-review');
        const status = productionReviews
          ? `Pending choice (${productionReviews} production ${productionReviews === 1 ? 'review' : 'reviews'})`
          : pendingCount
            ? `Pending choice (${pendingCount} video ${pendingCount === 1 ? 'clip' : 'clips'})`
            : ready
              ? 'Ready for editing'
              : needsReview
                ? 'Needs review'
                : e.scenes.length
                  ? 'Scenes in development'
                  : e.premise?.trim()
                    ? 'Outline draft'
                    : 'New episode';
        const fallback = (e.premise || '').replace(/\s+/g, ' ').trim();
        const summary =
          e.synopsis?.trim() ||
          (fallback.length > 280 ? `${fallback.slice(0, 280).replace(/\s+\S*$/, '')}…` : fallback);
        return (
          <Box
            component="article"
            aria-labelledby={`episode-title-${e._id}`}
            key={e._id}
            className="episode-overview"
          >
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 2 }}>
              <Typography variant="overline">Episode overview</Typography>
              <Chip
                size="small"
                label={status}
                color={
                  productionReviews || pendingCount || needsReview
                    ? 'warning'
                    : ready
                      ? 'success'
                      : 'default'
                }
              />
            </Stack>
            <Typography
              id={`episode-title-${e._id}`}
              variant="h2"
              sx={{ overflowWrap: 'anywhere' }}
            >
              {e.title}
            </Typography>
            <Typography className="episode-synopsis" color="text.secondary">
              {summary || 'The story is waiting for its first draft.'}
            </Typography>
            <Box component="dl" className="episode-facts">
              {[
                ['Target runtime', runtime(settings.targetSeconds)],
                ['Scenes approved', `${approved} / ${e.scenes.length}`],
                ['Clips planned', String(clips.length)],
                ['Selected takes', `${selectedTakes} / ${clips.length}`]
              ].map(([label, value]) => (
                <Box key={label}>
                  <Typography component="dt" variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography component="dd" variant="h3" sx={{ m: 0, mt: 0.5 }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Box className="episode-overview-footer">
              <Typography variant="body2" color="text.secondary">
                {clips.length
                  ? `${runtime(episodeTiming(e).total)} of clips planned`
                  : 'Scene planning has not started yet.'}
              </Typography>
              <Button
                variant="contained"
                endIcon={<ArrowForwardOutlined />}
                onClick={() => {
                  setSelected(e._id);
                  window.scrollTo({ top: 0, behavior: 'instant' });
                }}
              >
                Open episode
              </Button>
            </Box>
          </Box>
        );
      })}
      <Dialog open={creating} onClose={() => !busy && setCreating(false)} fullWidth maxWidth="sm">
        <DialogTitle>Start an episode</DialogTitle>
        <DialogContent>
          <Stack
            spacing={2}
            sx={{
              pt: 1
            }}
          >
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Episode title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setCreating(false)}>
            Cancel
          </Button>
          <Button variant="contained" disabled={busy || !title.trim()} onClick={create}>
            Create episode
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
