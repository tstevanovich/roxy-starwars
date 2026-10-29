import AddOutlined from '@mui/icons-material/AddOutlined';
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
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
import { useState } from 'react';

import { request } from './api.js';
import CharacterSheets from './CharacterSheets.jsx';
import ProductionBoard, { EnableWorkflow } from './ProductionBoard.jsx';
import { AssetProductionInputs } from './ProductionInputs.jsx';
import ShotImageReview from './ShotImageReview.jsx';
import {
  assetStatus,
  assetStatusColor,
  assetStatuses,
  categories,
  downloadDraft,
  pendingVideoChoices,
  uid,
  useDraft
} from './studio-utils.js';
import { MediaAttachments, ReferencePreview } from './StudioMedia.jsx';
export function AssetEditor({
  asset,
  assets = [],
  episodes = [],
  media,
  onSaved,
  onMedia,
  onBack,
  onOpenAsset,
  onChat,
  onRejected,
  workflowVersion = 0,
  onReload
}) {
  const { draft, dirty, edit, saved, reloadSaved, newerSavedVersion } = useDraft(
    asset,
    'asset',
    media
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [targetId, setTargetId] = useState('');
  const status = assetStatus(draft);
  const comparisons = assets.filter((a) => a.archived && a.relatedAssetId === draft._id);
  function field(name, value) {
    edit({
      ...draft,
      [name]: value
    });
  }
  function candidate(id, patch) {
    edit({
      ...draft,
      candidates: draft.candidates.map((c) =>
        c.id === id
          ? {
              ...c,
              ...patch
            }
          : c
      )
    });
  }
  async function persist(action, candidateId) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { asset: next } = await request(
        `/studio/assets/${draft._id}${action ? `/${action}` : ''}`,
        {
          method: action ? 'POST' : 'PUT',
          body: action
            ? {
                revision: draft.revision,
                candidateId
              }
            : draft
        }
      );
      saved(next);
      onSaved(next);
      setNotice(
        action === 'finalize'
          ? 'Final choice saved with its reference files.'
          : action === 'reopen'
            ? 'Choice reopened. Previous decisions remain in history.'
            : next.finalChoice
              ? 'Organization saved. Approved references are preserved.'
              : 'Draft saved. Finalize an option when its references are ready.'
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function organize(patch) {
    setBusy(true);
    setError('');
    try {
      const { asset: next } = await request(`/studio/assets/${draft._id}/organization`, {
        method: 'PATCH',
        body: { revision: draft.revision, ...patch }
      });
      saved(next);
      onSaved(next);
      setNotice(
        next.archived ? 'Asset archived. Its files and history are preserved.' : 'Asset restored.'
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function consolidate() {
    const target = assets.find((a) => a._id === targetId);
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      const result = await request(`/studio/assets/${draft._id}/consolidate`, {
        method: 'POST',
        body: { revision: draft.revision, targetId, targetRevision: target.revision }
      });
      onSaved(result.asset);
      onSaved(result.archivedAsset);
      if (onOpenAsset) onOpenAsset(result.asset._id);
      else onBack();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack
      component="fieldset"
      disabled={busy}
      spacing={3}
      sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}
    >
      <Button
        startIcon={<ArrowBackOutlined />}
        onClick={onBack}
        sx={{
          alignSelf: 'flex-start'
        }}
      >
        Creative library
      </Button>
      <Stack
        direction={{
          xs: 'column',
          sm: 'row'
        }}
        sx={{
          gap: 2,
          justifyContent: 'space-between',
          alignItems: {
            sm: 'center'
          }
        }}
      >
        <Box>
          <Typography variant="overline">
            {categories[draft.kind]} / creative development
          </Typography>
          <Typography variant="h1">{draft.name}</Typography>
        </Box>
        <Stack
          direction="row"
          sx={{
            gap: 1,
            flexWrap: 'wrap'
          }}
        >
          <Chip
            icon={draft.finalChoice && !dirty ? <CheckCircleOutlined /> : undefined}
            label={dirty ? 'Unsaved draft' : assetStatuses[status]}
            color={dirty ? 'default' : assetStatusColor(draft)}
          />
          {draft.finalChoice && (
            <Button variant="outlined" disabled={dirty || busy} onClick={() => persist('reopen')}>
              Un-finalize
            </Button>
          )}
          <Button variant="contained" disabled={busy || !dirty} onClick={() => persist('')}>
            Save changes
          </Button>
          {onChat && (
            <Button onClick={() => onChat({ assetId: asset._id })}>Discuss in chat</Button>
          )}
        </Stack>
      </Stack>
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
      {newerSavedVersion && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" onClick={reloadSaved}>
              Export draft and load latest
            </Button>
          }
        >
          New choices or sheets have been saved for this asset. Your unsaved draft is preserved;
          saved sheets below can be reviewed now. Load the latest version before continuing asset
          edits.
        </Alert>
      )}
      {draft.archived && (
        <Alert severity="info">
          This asset is archived. Its options, media and decision history are retained.
        </Alert>
      )}
      {status === 'pending-choice' && !dirty && (
        <Alert severity="warning">
          A choice is waiting for your review.
          {draft.finalChoice
            ? ' The current approved reference stays in place until you select a replacement.'
            : ''}
        </Alert>
      )}
      {dirty && (
        <Alert severity="info">
          Your draft stays in this browser until saved. Creative edits reopen a finalized choice.
          Organization changes preserve approved references.
        </Alert>
      )}
      {draft.identitySourceMediaIds?.length > 0 && (
        <Box className="editor-panel">
          <Typography variant="h2">Roxy identity reference</Typography>
          <Typography>
            Preserve the approved face, hair and proportions. Episode wardrobe and weapons are
            separate choices.
          </Typography>
          {draft.identitySourceMediaIds.map((id) => (
            <ReferencePreview key={id} file={media.find((file) => file._id === id)} />
          ))}
        </Box>
      )}
      {!draft.clipId && workflowVersion === 1 && (
        <>
          <ProductionBoard
            onChanged={onReload}
            record={asset}
            scope="asset"
            media={media}
            assets={assets}
            saving={busy}
            draftPending={dirty}
          />
          <AssetProductionInputs
            asset={draft}
            media={media}
            onEdit={(production) => field('production', production)}
            onMedia={onMedia}
            onChat={onChat}
            onRejected={onRejected}
            disabled={busy || dirty}
          />
        </>
      )}
      {workflowVersion !== 1 && <EnableWorkflow disabled={busy || dirty} />}
      {['character', 'droid', 'prop'].includes(draft.kind) && (
        <CharacterSheets
          asset={dirty ? asset : draft}
          media={media}
          disabled={busy}
          draftPending={dirty}
          onMedia={onMedia}
          onBusy={setBusy}
          onSaved={(next) => {
            if (dirty) {
              if (draft.revision === asset.revision) {
                edit((current) => ({
                  ...current,
                  revision: next.revision,
                  characterSheets: next.characterSheets,
                  referenceRevision: next.referenceRevision,
                  history: next.history,
                  updatedAt: next.updatedAt
                }));
              }
            } else saved(next);
            onSaved(next);
          }}
        />
      )}
      <Box className="editor-panel">
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              fullWidth
              label="Asset use"
              value={draft.scope || 'reusable'}
              onChange={(e) =>
                edit({
                  ...draft,
                  scope: e.target.value,
                  episodeId: e.target.value === 'reusable' ? null : draft.episodeId || ''
                })
              }
            >
              <MenuItem value="reusable">Reusable across episodes</MenuItem>
              <MenuItem value="episode">Episode only</MenuItem>
            </TextField>
            {draft.scope === 'episode' && (
              <TextField
                select
                fullWidth
                required
                label="Episode"
                value={draft.episodeId || ''}
                onChange={(e) => field('episodeId', e.target.value)}
              >
                <MenuItem value="">Choose an episode</MenuItem>
                {episodes.map((e) => (
                  <MenuItem key={e._id} value={e._id}>
                    {e.title}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              select
              fullWidth
              label="Review status"
              value={status}
              disabled={Boolean(draft.finalChoice)}
              helperText={
                draft.finalChoice
                  ? 'Un-finalize to restart development, or choose a replacement below.'
                  : 'Mark Pending choice when you need to make a decision.'
              }
              onChange={(e) => field('reviewStatus', e.target.value)}
            >
              {Object.entries(assetStatuses).map(([value, label]) => (
                <MenuItem key={value} value={value} disabled={value === 'finalized'}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack
            direction={{
              xs: 'column',
              sm: 'row'
            }}
            spacing={2}
          >
            <TextField
              fullWidth
              label="Asset name"
              value={draft.name}
              onChange={(e) => field('name', e.target.value)}
            />
            <TextField
              fullWidth
              label="Aliases, separated by commas"
              value={(draft.aliases || []).join(', ')}
              onChange={(e) =>
                field(
                  'aliases',
                  e.target.value.split(',').map((s) => s.trim())
                )
              }
            />
          </Stack>
          <TextField
            label="Creative brief"
            multiline
            minRows={3}
            value={draft.brief}
            onChange={(e) => field('brief', e.target.value)}
          />
          <TextField
            label="Continuity notes"
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
        <Box>
          <Typography variant="h2">Compare your options</Typography>
          <Typography color="text.secondary" variant="body2">
            Attach references, leave notes, and choose what becomes canon.
          </Typography>
        </Box>
        <Button
          startIcon={<AddOutlined />}
          onClick={() =>
            field('candidates', [
              ...draft.candidates,
              {
                id: uid(),
                title: `Option ${draft.candidates.length + 1}`,
                description: '',
                mediaIds: [],
                voiceId: '',
                voiceModel: '',
                archived: false
              }
            ])
          }
        >
          Add option
        </Button>
      </Stack>
      <Box className="candidate-grid">
        {draft.candidates
          .filter((c) => !c.archived)
          .map((c) => (
            <Box
              className={`candidate-card ${draft.finalChoice?.id === c.id && !dirty ? 'chosen' : ''}`}
              key={c.id}
            >
              <Box className="candidate-banner">
                <Typography variant="overline">
                  {draft.finalChoice?.id === c.id && !dirty ? 'FINAL CHOICE' : 'PROPOSED DIRECTION'}
                </Typography>
                <Typography variant="h3">{c.title}</Typography>
              </Box>
              <Stack
                spacing={2}
                sx={{
                  p: 2.5
                }}
              >
                <TextField
                  size="small"
                  label="Option title"
                  value={c.title}
                  onChange={(e) =>
                    candidate(c.id, {
                      title: e.target.value
                    })
                  }
                />
                <TextField
                  label="Design and feedback"
                  multiline
                  minRows={4}
                  value={c.description}
                  onChange={(e) =>
                    candidate(c.id, {
                      description: e.target.value
                    })
                  }
                />
                {draft.kind === 'voice' && (
                  <>
                    <TextField
                      label="ElevenLabs voice ID"
                      value={c.voiceId || ''}
                      onChange={(e) =>
                        candidate(c.id, {
                          voiceId: e.target.value
                        })
                      }
                    />
                    <TextField
                      label="Voice model and delivery settings"
                      value={c.voiceModel || ''}
                      onChange={(e) =>
                        candidate(c.id, {
                          voiceModel: e.target.value
                        })
                      }
                    />
                  </>
                )}
                {!c.mediaIds.length && <ReferencePreview kind={draft.kind} compact />}
                <MediaAttachments
                  ids={c.mediaIds}
                  media={media}
                  disabled={busy}
                  rejectionDisabled={busy || dirty}
                  onRejected={onRejected}
                  rejectionContext={{
                    assetId: draft._id,
                    revision: draft.revision,
                    candidateId: c.id
                  }}
                  onChange={(ids) =>
                    candidate(c.id, {
                      mediaIds: ids
                    })
                  }
                  onUploaded={(file) => {
                    onMedia(file);
                    edit((current) => ({
                      ...current,
                      candidates: current.candidates.map((item) =>
                        item.id === c.id
                          ? {
                              ...item,
                              mediaIds: [...item.mediaIds, file._id]
                            }
                          : item
                      )
                    }));
                  }}
                />
                <Divider />
                <Button
                  variant={draft.finalChoice?.id === c.id && !dirty ? 'outlined' : 'contained'}
                  startIcon={<CheckCircleOutlined />}
                  disabled={
                    busy ||
                    dirty ||
                    !c.mediaIds.length ||
                    (draft.finalChoice?.id === c.id && status !== 'pending-choice')
                  }
                  onClick={() => persist('finalize', c.id)}
                >
                  {draft.finalChoice?.id === c.id && status === 'pending-choice'
                    ? 'Keep current choice'
                    : draft.kind === 'sound'
                      ? 'Approve this sound'
                      : 'Finalize this option'}
                </Button>
                {!c.mediaIds.length && (
                  <Typography variant="caption" color="text.secondary">
                    Upload and save a{' '}
                    {draft.kind === 'sound'
                      ? 'sound option'
                      : draft.kind === 'voice'
                        ? 'voice audition'
                        : 'visual reference'}{' '}
                    before finalizing.
                  </Typography>
                )}
                <Button
                  size="small"
                  color="inherit"
                  disabled={busy}
                  onClick={() =>
                    candidate(c.id, {
                      archived: true
                    })
                  }
                >
                  Archive option
                </Button>
              </Stack>
            </Box>
          ))}
      </Box>
      {!draft.candidates.some((c) => !c.archived) && (
        <Box className="empty-state">
          <Typography variant="h3">Explore the first direction.</Typography>
          <Typography>Add an option and attach a local reference when you’re ready.</Typography>
        </Box>
      )}
      {draft.candidates.some((c) => c.archived) && (
        <Box className="editor-panel">
          <Typography
            variant="h3"
            sx={{
              mb: 2
            }}
          >
            Archived options
          </Typography>
          {draft.candidates
            .filter((c) => c.archived)
            .map((c) => (
              <Stack
                key={c.id}
                direction="row"
                sx={{
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <Typography>{c.title}</Typography>
                <Button
                  onClick={() =>
                    candidate(c.id, {
                      archived: false
                    })
                  }
                >
                  Restore option
                </Button>
              </Stack>
            ))}
        </Box>
      )}
      <Stack
        direction="row"
        sx={{
          gap: 2,
          flexWrap: 'wrap'
        }}
      >
        <Button onClick={() => setShowHistory(!showHistory)}>
          Decision history ({draft.history?.length || 0})
        </Button>
        <Button onClick={() => downloadDraft(draft)}>Export asset record</Button>
      </Stack>
      {comparisons.length > 0 && (
        <Box className="editor-panel">
          <Typography variant="h3">Comparison history</Typography>
          <Typography color="text.secondary">
            Earlier comparisons are retained here with their original options and media.
          </Typography>
          {comparisons.map((a) => (
            <Button key={a._id} onClick={() => onOpenAsset?.(a._id)}>
              View {a.name}
            </Button>
          ))}
        </Box>
      )}
      <Box className="editor-panel">
        <Stack spacing={2}>
          <Typography variant="h3">Library organization</Typography>
          <Button
            sx={{ alignSelf: 'flex-start' }}
            disabled={dirty || busy}
            onClick={() => organize({ archived: !draft.archived })}
          >
            {draft.archived ? 'Restore asset' : 'Archive asset'}
          </Button>
          {!draft.archived &&
            assets.some(
              (a) =>
                a._id !== draft._id && a.kind === draft.kind && !a.archived && !a.relatedAssetId
            ) && (
              <>
                <Typography variant="body2" color="text.secondary">
                  Move comparison options into a main asset. This record becomes archived history;
                  current approved references are preserved.
                </Typography>
                <TextField
                  select
                  label="Main asset"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  <MenuItem value="">Choose a main asset</MenuItem>
                  {assets
                    .filter(
                      (a) =>
                        a._id !== draft._id &&
                        a.kind === draft.kind &&
                        !a.archived &&
                        !a.relatedAssetId
                    )
                    .map((a) => (
                      <MenuItem key={a._id} value={a._id}>
                        {a.name}
                      </MenuItem>
                    ))}
                </TextField>
                <Button disabled={!targetId || dirty || busy} onClick={consolidate}>
                  Consolidate comparison
                </Button>
              </>
            )}
        </Stack>
      </Box>
      {showHistory && (
        <Box className="editor-panel">
          <Typography
            variant="h3"
            sx={{
              mb: 2
            }}
          >
            Saved versions
          </Typography>
          {!draft.history?.length && (
            <Typography color="text.secondary">
              Your first saved change will appear here.
            </Typography>
          )}
          {[...(draft.history || [])].reverse().map((h, i) => (
            <Stack
              key={i}
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
                py: 1,
                borderBottom: 1,
                borderColor: 'divider'
              }}
            >
              <Box>
                <Typography>
                  {h.finalChoice ? `Final choice: ${h.finalChoice.title}` : 'Working draft'}
                </Typography>
                <Typography variant="caption">
                  {new Date(h.savedAt).toLocaleString()} · {h.candidates?.length || 0} options
                </Typography>
              </Box>
              <Button onClick={() => downloadDraft(h, 'roxy-asset-version.json')}>
                Download version
              </Button>
            </Stack>
          ))}
        </Box>
      )}
    </Stack>
  );
}
export default function AssetLibrary({
  assets,
  episodes = [],
  media,
  onSaved,
  onMedia,
  initialId,
  onOpenEpisode,
  onChat,
  onRejected,
  workflowVersion = 0,
  onReload
}) {
  const [selected, setSelected] = useState(initialId || '');
  const [category, setCategory] = useState('all');
  const [collection, setCollection] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [episodeFilter, setEpisodeFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('character');
  const [scope, setScope] = useState('reusable');
  const [episodeId, setEpisodeId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const asset = assets.find((a) => a._id === selected);
  const videoChoices = episodes.flatMap((episode) =>
    pendingVideoChoices(episode, media).map((choice) => ({ ...choice, episode }))
  );
  async function create() {
    setBusy(true);
    setError('');
    try {
      const { asset: next } = await request('/studio/assets', {
        method: 'POST',
        body: {
          name,
          kind,
          scope,
          episodeId: scope === 'episode' ? episodeId : null
        }
      });
      onSaved(next);
      setSelected(next._id);
      setCreating(false);
      setName('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (asset?.clipId)
    return (
      <ShotImageReview
        onChat={onChat}
        asset={asset}
        media={media}
        onSaved={onSaved}
        onRejected={onRejected}
        onBack={() => setSelected('')}
      />
    );
  if (asset)
    return (
      <AssetEditor
        onReload={onReload}
        workflowVersion={workflowVersion}
        onChat={onChat}
        key={asset._id}
        asset={asset}
        assets={assets}
        episodes={episodes}
        media={media}
        onSaved={onSaved}
        onMedia={onMedia}
        onBack={() => setSelected('')}
        onOpenAsset={setSelected}
        onRejected={onRejected}
      />
    );
  const filtered = assets.filter(
    (a) =>
      (collection === 'archive' ? Boolean(a.archived) : !a.archived) &&
      (collection === 'all' ||
        collection === 'archive' ||
        (a.scope || 'reusable') === collection) &&
      (collection !== 'episode' || episodeFilter === 'all' || a.episodeId === episodeFilter) &&
      (statusFilter === 'all' || assetStatus(a) === statusFilter) &&
      (category === 'all' || a.kind === category) &&
      `${a.name} ${a.aliases?.join(' ')} ${a.brief}`.toLowerCase().includes(query.toLowerCase())
  );
  const visibleVideoChoices = videoChoices.filter(
    ({ episode, scene, clip }) =>
      collection !== 'archive' &&
      collection !== 'reusable' &&
      (statusFilter === 'all' || statusFilter === 'pending-choice') &&
      category === 'all' &&
      (collection !== 'episode' || episodeFilter === 'all' || episode._id === episodeFilter) &&
      `${episode.title} ${scene.title} ${clip.title}`.toLowerCase().includes(query.toLowerCase())
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
          <Typography variant="h1">Creative library</Typography>
          <Typography
            color="text.secondary"
            sx={{
              mt: 1
            }}
          >
            Reusable assets, episode-specific details, and choices waiting for your review.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddOutlined />}
          onClick={() => {
            setScope(collection === 'episode' ? 'episode' : 'reusable');
            setCreating(true);
          }}
        >
          New asset
        </Button>
      </Stack>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        {[
          ['all', 'All current assets'],
          ['reusable', 'Reusable'],
          ['episode', 'Episode only'],
          ['archive', 'Archive']
        ].map(([value, label]) => (
          <Chip
            key={value}
            label={label}
            color={collection === value ? 'primary' : 'default'}
            onClick={() => setCollection(value)}
          />
        ))}
        <Chip
          label={`Pending choice (${assets.filter((a) => !a.archived && assetStatus(a) === 'pending-choice').length + videoChoices.length})`}
          color={statusFilter === 'pending-choice' ? 'warning' : 'default'}
          onClick={() => {
            setCollection('all');
            setCategory('all');
            setQuery('');
            setStatusFilter(statusFilter === 'pending-choice' ? 'all' : 'pending-choice');
          }}
        />
      </Stack>
      <Stack
        direction="row"
        sx={{
          flexWrap: 'wrap',
          gap: 1
        }}
      >
        {[['all', 'All assets'], ...Object.entries(categories)].map(([value, label]) => (
          <Chip
            key={value}
            label={label}
            onClick={() => setCategory(value)}
            color={category === value ? 'primary' : 'default'}
          />
        ))}
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          fullWidth
          label="Search assets and aliases"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          size="small"
        />
        <TextField
          select
          fullWidth
          label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          size="small"
        >
          <MenuItem value="all">All statuses</MenuItem>
          {Object.entries(assetStatuses).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        {collection === 'episode' && (
          <TextField
            select
            fullWidth
            label="Filter by episode"
            value={episodeFilter}
            onChange={(e) => setEpisodeFilter(e.target.value)}
            size="small"
          >
            <MenuItem value="all">All episodes</MenuItem>
            {episodes.map((e) => (
              <MenuItem key={e._id} value={e._id}>
                {e.title}
              </MenuItem>
            ))}
          </TextField>
        )}
      </Stack>
      {visibleVideoChoices.length > 0 && (
        <Box
          component="section"
          aria-label="Pending episode video choices"
          className="editor-panel"
        >
          <Typography variant="h2">
            Pending episode video choices ({visibleVideoChoices.length})
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 2 }}>
            These clips are ready to watch and approve in their episode. Script approval is separate
            from choosing the finished video.
          </Typography>
          <Stack spacing={2}>
            {visibleVideoChoices.map(({ episode, scene, clip }) => (
              <Stack key={`${episode._id}-${clip.id}`} spacing={1}>
                <Typography>
                  {episode.title} · {scene.title} · {clip.title}
                </Typography>
                <Button
                  variant="outlined"
                  sx={{ alignSelf: 'flex-start' }}
                  onClick={() => onOpenEpisode?.(episode._id)}
                >
                  Review video: {clip.title}
                </Button>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
      <Box className="asset-grid">
        {filtered.map((a) => {
          const candidate = a.finalChoice || a.candidates.find((c) => !c.archived);
          const file = media.find((m) => m._id === candidate?.mediaIds?.[0]);
          return (
            <Box className="asset-card" key={a._id}>
              <ReferencePreview file={file} kind={a.kind} />
              <Box
                sx={{
                  p: 2.5
                }}
              >
                <Stack
                  direction="row"
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 1
                  }}
                >
                  <Typography variant="overline">{categories[a.kind]}</Typography>
                  <Chip
                    label={assetStatuses[assetStatus(a)]}
                    color={assetStatusColor(a)}
                    size="small"
                  />
                </Stack>
                <Typography
                  variant="h3"
                  sx={{
                    mt: 1
                  }}
                >
                  {a.name}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  className="line-clamp"
                  sx={{
                    my: 1.5
                  }}
                >
                  {a.brief}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 2 }}
                >
                  {a.archived ? 'Archived · ' : ''}
                  {a.scope === 'episode'
                    ? `Episode only · ${episodes.find((e) => e._id === a.episodeId)?.title || 'Episode'}`
                    : 'Reusable across episodes'}
                </Typography>
                <Button fullWidth variant="outlined" onClick={() => setSelected(a._id)}>
                  Review {a.name}
                </Button>
              </Box>
            </Box>
          );
        })}
      </Box>
      {!filtered.length && (
        <Box className="empty-state">
          <Typography variant="h3">No matching assets.</Typography>
          <Typography>Try another category or create a new asset.</Typography>
        </Box>
      )}
      <Dialog open={creating} onClose={() => !busy && setCreating(false)} fullWidth maxWidth="sm">
        <DialogTitle>New asset</DialogTitle>
        <DialogContent>
          <Stack
            spacing={2}
            sx={{
              pt: 1
            }}
          >
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Asset name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <TextField
              select
              label="Category"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {Object.entries(categories).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Asset use"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <MenuItem value="reusable">Reusable across episodes</MenuItem>
              <MenuItem value="episode">Episode only</MenuItem>
            </TextField>
            {scope === 'episode' && (
              <TextField
                select
                required
                label="Episode"
                value={episodeId}
                onChange={(e) => setEpisodeId(e.target.value)}
              >
                <MenuItem value="">Choose an episode</MenuItem>
                {episodes.map((e) => (
                  <MenuItem key={e._id} value={e._id}>
                    {e.title}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setCreating(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={busy || !name.trim() || (scope === 'episode' && !episodeId)}
            onClick={create}
          >
            Create asset
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
