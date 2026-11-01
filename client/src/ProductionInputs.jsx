import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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

import { addCharacterPackage } from '../../shared/character-package.js';
import { shotContinuity } from '../../shared/shot-continuity.js';
import RejectMediaButton from './RejectMediaButton.jsx';
import { uid } from './studio-utils.js';
import { MediaAttachments, ReferencePreview, UploadButton } from './StudioMedia.jsx';
export function AssetProductionInputs({
  asset,
  media,
  onEdit,
  onMedia,
  onChat,
  onRejected,
  disabled
}) {
  const p = asset.production ?? {};
  const change = (patch) => onEdit({ ...p, ...patch });
  const itemChange = (id, patch) =>
    change({ items: (p.items ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const add = (title, type = 'image') => ({
    id: uid(),
    title,
    type,
    required: true,
    mediaId: null,
    notes: ''
  });
  return (
    <Box
      id="asset-production-inputs"
      tabIndex={-1}
      className="editor-panel"
      sx={{ scrollMarginTop: '110px' }}
    >
      <Stack spacing={2}>
        <Typography variant="h2">Source evidence and reference package</Typography>
        <TextField
          select
          label="Source direction"
          value={p.sourceMode ?? 'footage'}
          onChange={(e) => change({ sourceMode: e.target.value })}
        >
          <MenuItem value="footage">Gameplay / source footage</MenuItem>
          <MenuItem value="original">Original design direction</MenuItem>
        </TextField>
        <TextField
          label="Source URL"
          value={p.sourceUrl ?? ''}
          onChange={(e) => change({ sourceUrl: e.target.value })}
        />
        <TextField
          multiline
          minRows={3}
          label="Observed source details and unresolved choices"
          value={p.sourceNotes ?? ''}
          onChange={(e) => change({ sourceNotes: e.target.value })}
        />
        <MediaAttachments
          ids={p.sourceMediaIds ?? []}
          media={media}
          rejectionDisabled
          onChange={(sourceMediaIds) => change({ sourceMediaIds })}
          onUploaded={(file) => {
            onMedia(file);
            change({ sourceMediaIds: [...(p.sourceMediaIds ?? []), file._id] });
          }}
        />
        <Typography>
          Each package item is reviewed individually. Add only the views, expressions and voice
          notes needed for production.
        </Typography>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button
            onClick={() => change({ items: [...(p.items ?? []), add('Individual reference')] })}
          >
            Add image reference
          </Button>
          <Button
            onClick={() => change({ items: [...(p.items ?? []), add('Voice sample', 'audio')] })}
          >
            Add voice sample
          </Button>
          <Button
            onClick={() =>
              change({
                items: [...(p.items ?? []), add('Pronunciation and voice settings', 'notes')]
              })
            }
          >
            Add written reference
          </Button>
          <Button
            onClick={() =>
              change({
                items: addCharacterPackage(p.items)
              })
            }
          >
            Add character package
          </Button>
        </Stack>
        {(p.items ?? []).map((item) => (
          <Stack
            key={item.id}
            spacing={1}
            sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
          >
            <TextField
              label="Reference title"
              value={item.title}
              onChange={(e) => itemChange(item.id, { title: e.target.value })}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={item.required}
                  onChange={(e) => itemChange(item.id, { required: e.target.checked })}
                />
              }
              label="Required for linked scenes"
            />
            <TextField
              label="Reference instructions / pronunciation"
              multiline
              minRows={2}
              value={item.notes}
              onChange={(e) => itemChange(item.id, { notes: e.target.value })}
            />
            {item.type === 'image' && (
              <TextField
                label="Exact image prompt sent to OpenArt"
                multiline
                minRows={4}
                value={cleanRenderPrompt(item.imagePrompt ?? '')}
                helperText="Complete visual instructions for this image only. Planning notes, approvals, voice settings and credit details are kept separately."
                onChange={(e) => itemChange(item.id, { imagePrompt: e.target.value })}
              />
            )}
            {item.type === 'image' && p.sourceMediaIds?.length > 0 && (
              <TextField
                select
                label="Source images for this reference"
                helperText="Choose the evidence for this individual view or set. Leave empty to use all asset source images."
                value={item.sourceMediaIds ?? []}
                slotProps={{ select: { multiple: true } }}
                onChange={(e) => itemChange(item.id, { sourceMediaIds: e.target.value })}
              >
                {media
                  .filter((m) => p.sourceMediaIds.includes(m._id))
                  .map((m) => (
                    <MenuItem key={m._id} value={m._id}>
                      {m.originalName}
                    </MenuItem>
                  ))}
              </TextField>
            )}
            {item.type === 'image' && (
              <TextField
                select
                label="Approved package references"
                value={item.referenceMediaIds ?? []}
                helperText="Use approved design images from this package instead of gameplay evidence. The approved character master portrait is included first automatically."
                slotProps={{ select: { multiple: true } }}
                onChange={(e) => itemChange(item.id, { referenceMediaIds: e.target.value })}
              >
                {media
                  .filter(
                    (m) =>
                      m.kind === 'image' &&
                      p.items?.some((i) => i.id !== item.id && i.mediaId === m._id)
                  )
                  .map((m) => (
                    <MenuItem key={m._id} value={m._id}>
                      {m.originalName}
                    </MenuItem>
                  ))}
              </TextField>
            )}
            {item.type !== 'notes' && (
              <>
                <TextField
                  select
                  label="Individual reference file"
                  value={item.mediaId ?? ''}
                  onChange={(e) => itemChange(item.id, { mediaId: e.target.value || null })}
                >
                  <MenuItem value="">Choose file</MenuItem>
                  {media
                    .filter((m) => m.kind === (item.type === 'audio' ? 'audio' : 'image'))
                    .map((m) => (
                      <MenuItem key={m._id} value={m._id}>
                        {m.originalName}
                      </MenuItem>
                    ))}
                </TextField>
                <UploadButton
                  label="Import reference file"
                  onUploaded={(file) => {
                    onMedia(file);
                    itemChange(item.id, { mediaId: file._id });
                  }}
                />
                {item.mediaId && (
                  <>
                    <ReferencePreview file={media.find((m) => m._id === item.mediaId)} />
                    {onRejected && (
                      <RejectMediaButton
                        file={media.find((m) => m._id === item.mediaId)}
                        disabled={disabled}
                        onRejected={onRejected}
                        context={{
                          assetId: asset._id,
                          revision: asset.revision,
                          packageItemId: item.id
                        }}
                      />
                    )}
                  </>
                )}
              </>
            )}
            {item.type === 'image' && onChat && (
              <Button
                disabled={disabled}
                onClick={() => onChat({ assetId: asset._id, packageItemId: item.id })}
              >
                Request this reference in chat
              </Button>
            )}
            <Button onClick={() => change({ items: p.items.filter((i) => i.id !== item.id) })}>
              Remove package requirement
            </Button>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
export function ShotProductionInputs({ clip, media, onEdit, assets = [], scene, episode }) {
  const p = clip.production ?? {};
  const change = (patch) => onEdit({ ...p, ...patch });
  const continuity = shotContinuity(episode, scene, clip, assets, media);
  const shots = (episode?.scenes ?? [scene]).flatMap((s) =>
    s.clips.map((c) => ({ scene: s, clip: c }))
  );
  const prior = shots.slice(
    0,
    Math.max(
      0,
      shots.findIndex((s) => s.scene.id === scene.id && s.clip.id === clip.id)
    )
  );
  const referenceIds = assets
    .filter((a) => scene?.assetIds.includes(a._id))
    .flatMap((a) => [
      ...(a.finalChoice?.mediaIds ?? []),
      ...(a.production?.items ?? [])
        .filter((i) => i.required && i.type === 'image' && i.mediaId)
        .map((i) => i.mediaId)
    ]);
  return (
    <Stack spacing={2}>
      <Typography variant="h3">Shot planning and review</Typography>
      <TextField
        select
        label="Shot continuity"
        value={p.continuityMode || 'auto'}
        helperText="Earlier approved images carry the actual set and staging into this render. New setup deliberately starts fresh."
        onChange={(e) => change({ continuityMode: e.target.value, continuitySources: [] })}
      >
        <MenuItem value="auto">Automatic — same location in this scene</MenuItem>
        <MenuItem value="explicit">Use specific earlier shots</MenuItem>
        <MenuItem value="new-setup">New setup — no prior shot inheritance</MenuItem>
      </TextField>
      {p.continuityMode === 'explicit' && (
        <TextField
          select
          label="Earlier continuity shots"
          value={(p.continuitySources ?? []).map((s) => JSON.stringify([s.sceneId, s.clipId]))}
          slotProps={{ select: { multiple: true } }}
          onChange={(e) =>
            change({
              continuitySources: e.target.value.map((v) => {
                const [sceneId, clipId] = JSON.parse(v);
                return { sceneId, clipId };
              })
            })
          }
        >
          {prior.map((s) => (
            <MenuItem key={s.scene.id + s.clip.id} value={JSON.stringify([s.scene.id, s.clip.id])}>
              {s.scene.title} / {s.clip.title}
            </MenuItem>
          ))}
        </TextField>
      )}
      <TextField
        label="Continuity details to preserve"
        value={p.continuityNotes ?? ''}
        multiline
        minRows={2}
        onChange={(e) => change({ continuityNotes: e.target.value })}
        helperText="For example: identical landing platform, ship heading, background and metal walkway; only the camera changes."
      />
      {continuity.errors.length > 0 && (
        <Alert severity="warning">{continuity.errors.join(' ')}</Alert>
      )}
      {continuity.sources.length > 0 && (
        <Accordion>
          <AccordionSummary>
            {continuity.errors.length
              ? 'Continuity source shots — approval needed'
              : 'Approved continuity references — comparison only'}{' '}
            ({continuity.sources.length})
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              {continuity.sources.map((s) => (
                <Box key={s.sceneId + s.clipId}>
                  <Button component="a" href={`#shot-inputs-${s.clipId}`}>
                    {s.title}
                  </Button>
                  <Box sx={{ maxWidth: 400 }}>
                    <ReferencePreview file={media.find((m) => m._id === s.mediaId)} />
                  </Box>
                </Box>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}
      <TextField
        label="Location for this shot only"
        value={p.location ?? ''}
        helperText="Keep orbital space and surface locations separate. Only describe what is visible in this shot."
        onChange={(e) => change({ location: e.target.value })}
      />
      <TextField
        select
        label="Physical environment"
        value={p.environment ?? ''}
        onChange={(e) => change({ environment: e.target.value })}
      >
        <MenuItem value="">Choose environment</MenuItem>
        <MenuItem value="space-exterior">Orbital vacuum / exterior space</MenuItem>
        <MenuItem value="surface-exterior">Planetary surface / exterior</MenuItem>
        <MenuItem value="interior">Ship or building interior</MenuItem>
      </TextField>
      <TextField
        label="Physical continuity and exclusions"
        multiline
        minRows={2}
        value={p.physicalConstraints ?? ''}
        onChange={(e) => change({ physicalConstraints: e.target.value })}
      />
      <TextField
        select
        label="Reference views for this shot"
        value={p.referenceMediaIds ?? []}
        slotProps={{ select: { multiple: true } }}
        helperText="Choose the useful approved views, up to 12. Leaving this empty uses the linked reference pack."
        onChange={(e) => change({ referenceMediaIds: e.target.value })}
      >
        {media
          .filter((m) => m.kind === 'image' && referenceIds.includes(m._id))
          .map((m) => (
            <MenuItem key={m._id} value={m._id}>
              {m.originalName}
            </MenuItem>
          ))}
      </TextField>
      <TextField
        label="Framing"
        value={p.framing ?? ''}
        onChange={(e) => change({ framing: e.target.value })}
      />
      <TextField
        select
        label="Generation mode"
        value={p.mode ?? ''}
        onChange={(e) => change({ mode: e.target.value })}
      >
        <MenuItem value="">Choose supported mode</MenuItem>
        <MenuItem value="image2video">Image to video · no dialogue</MenuItem>
        <MenuItem value="voice-reference">Reference to video · referenced voice</MenuItem>
      </TextField>
      <Alert severity="info">
        Voice-reference mode does not guarantee the exact recorded performance. Review wording,
        voice and lip sync before accepting the visuals.
      </Alert>
      <TextField
        label="Timed action beats"
        multiline
        minRows={2}
        value={p.beats ?? ''}
        onChange={(e) => change({ beats: e.target.value })}
      />
      <TextField
        label="Pass conditions"
        multiline
        minRows={2}
        value={p.passCondition ?? ''}
        onChange={(e) => change({ passCondition: e.target.value })}
      />
      <TextField
        select
        label="Video take for picture / performance approval"
        value={p.visualTakeId ?? ''}
        onChange={(e) => change({ visualTakeId: e.target.value || null })}
      >
        <MenuItem value="">Choose original take</MenuItem>
        {media
          .filter((m) => clip.takeIds?.includes(m._id) && !m.soundMix)
          .map((m) => (
            <MenuItem key={m._id} value={m._id}>
              {m.originalName}
            </MenuItem>
          ))}
      </TextField>
      {p.visualTakeId && <ReferencePreview file={media.find((m) => m._id === p.visualTakeId)} />}
      <Typography>
        New Wan takes include sound effects and ambience. Approve picture, performance and sound
        together, or accept the picture for sound repair. Review the finished native or repaired
        soundtrack before exporting the approved video for CapCut.
      </Typography>
    </Stack>
  );
}
import { cleanRenderPrompt } from '../../shared/render-prompt.js';
