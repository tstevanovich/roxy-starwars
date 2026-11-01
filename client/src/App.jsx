import ArrowForwardOutlined from '@mui/icons-material/ArrowForwardOutlined';
import AutoStoriesOutlined from '@mui/icons-material/AutoStoriesOutlined';
import ChatOutlined from '@mui/icons-material/ChatOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import CollectionsOutlined from '@mui/icons-material/CollectionsOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import MovieCreationOutlined from '@mui/icons-material/MovieCreationOutlined';
import RocketLaunchOutlined from '@mui/icons-material/RocketLaunchOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { lazy, Suspense, useEffect, useState } from 'react';

import { removeMediaReferences } from '../../shared/media-rejection.js';
import { imageGenerationDefaults } from '../../shared/production-defaults.js';
import { request } from './api.js';
import { AccountControls } from './AuthGate.jsx';
import { studioUrl } from './project-url.js';
import { reviewAnchor, reviewHref } from './review-navigation.js';
import SeriesBible from './SeriesBible.jsx';
import {
  assetStatus,
  assetStatusColor,
  assetStatuses,
  forgetRejectedMedia,
  pendingVideoChoices
} from './studio-utils.js';
import MediaLibrary, { ReferencePreview } from './StudioMedia.jsx';
const AssetLibrary = lazy(() => import('./AssetLibrary.jsx'));
const Episodes = lazy(() => import('./Episodes.jsx'));
const ProductionChat = lazy(() => import('./ProductionChat.jsx'));
const navigation = [
  ['overview', 'Overview', DashboardOutlined],
  ['library', 'Creative library', CollectionsOutlined],
  ['episodes', 'Episodes', MovieCreationOutlined],
  ['chat', 'Production chat', ChatOutlined],
  ['media', 'Media library', TuneOutlined],
  ['bible', 'Series bible', AutoStoriesOutlined]
];
function Overview({ data, navigate }) {
  const active = data.assets.filter((a) => !a.archived);
  const finalized = active.filter((a) => assetStatus(a) === 'finalized');
  const pending = active.filter((a) => assetStatus(a) === 'pending-choice');
  const pendingVideos = data.episodes.reduce(
    (count, episode) => count + pendingVideoChoices(episode, data.media).length,
    0
  );
  const featured = ['fortune', 'al', 'roxy-voice']
    .map((key) => active.find((a) => a.seedKey === key))
    .filter(Boolean);
  return (
    <Stack spacing={4}>
      <Box className="studio-hero">
        <Box
          sx={{
            position: 'relative',
            zIndex: 1,
            maxWidth: 590
          }}
        >
          <Typography
            variant="overline"
            sx={{
              color: '#e4ce92'
            }}
          >
            ROXY KANE / SERIES DEVELOPMENT
          </Typography>
          <Typography component="h1" className="hero-title">
            A galaxy of choices.
            <br />
            <span>One consistent world.</span>
          </Typography>
          <Typography
            sx={{
              maxWidth: 470,
              color: '#d2d4c8',
              lineHeight: 1.8,
              my: 3
            }}
          >
            {data.project?.cinematicOnly
              ? 'Develop Roxy as the Sith Inquisitor. Review the source chapter, audition her British voice, and approve the wardrobe and weapons for a faithful cinematic adaptation.'
              : 'Shape the Fortune, meet AL, and build the creative library behind Roxy’s next job. Every final choice has a place to live.'}
          </Typography>
          <Stack
            direction="row"
            sx={{
              gap: 1.5,
              flexWrap: 'wrap'
            }}
          >
            <Button
              variant="contained"
              color="secondary"
              endIcon={<ArrowForwardOutlined />}
              onClick={() => navigate('library')}
            >
              Explore the library
            </Button>
            <Button
              variant="outlined"
              sx={{
                color: '#f5f1e6',
                borderColor: '#727b66'
              }}
              onClick={() => navigate('episodes', '', true)}
            >
              Start an episode
            </Button>
          </Stack>
        </Box>
        <Box className="hero-orbit orbit-one" />
        <Box className="hero-orbit orbit-two" />
        <RocketLaunchOutlined className="hero-ship" />
      </Box>
      <Box className="stats-grid">
        {[
          [
            active.filter((a) => a.scope !== 'episode').length,
            'Reusable assets',
            `${active.filter((a) => a.scope === 'episode').length} episode-only assets`
          ],
          [
            pending.length +
              pendingVideos +
              (data.workflowReviews ?? []).filter(
                (row) =>
                  (row.target.scope !== 'asset' ||
                    !pending.some((a) => a._id === row.target.recordId)) &&
                  !(
                    row.stage === 'visual' &&
                    data.episodes.some(
                      (e) =>
                        e._id === row.target.recordId &&
                        pendingVideoChoices(e, data.media).some(
                          ({ clip }) => clip.id === row.target.clipId
                        )
                    )
                  )
              ).length,
            'Pending choices',
            'Results ready for approval; production can still be incomplete'
          ],
          [data.episodes.length, 'Episodes', 'Stories taking shape'],
          [data.media.length, 'Local files', 'Originals kept on this computer']
        ].map(([value, title, subtitle]) => (
          <Box component="section" aria-label={title} className="stat-card" key={title}>
            <Typography className="stat-number">{String(value).padStart(2, '0')}</Typography>
            <Typography
              sx={{
                fontWeight: 600
              }}
            >
              {title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          </Box>
        ))}
      </Box>
      {!pending.length &&
        !pendingVideos &&
        !data.workflowReviews?.length &&
        data.episodes.some(
          (episode) => episode.workflowVersion === 1 && !episode.workflowReady
        ) && (
          <Alert severity="info" role="status">
            No results are ready for approval. Production is still incomplete. Missing work is
            prepared automatically; the episode board shows its progress, required reviews and
            provider errors.
            {data.episodes
              .filter((episode) => episode.workflowVersion === 1 && !episode.workflowReady)
              .map((episode) => (
                <Button
                  component="a"
                  key={episode._id}
                  href={studioUrl('/?episode=' + episode._id) + '#production-approval-board'}
                >
                  Open production status for {episode.title}
                </Button>
              ))}
          </Alert>
        )}
      {data.workflowReviews?.length > 0 && (
        <Box className="editor-panel">
          <Typography variant="h2">Production reviews waiting for you</Typography>
          <Stack spacing={1} sx={{ mt: 2 }}>
            {data.workflowReviews.map((row) => (
              <Button
                component="a"
                href={
                  row.stage === 'story-draft'
                    ? studioUrl('/?episode=' + row.target.recordId) + '#' + row.key
                    : reviewHref(row.target, row.stage)
                }
                key={row.key}
                sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={(event) => {
                  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  navigate(
                    row.target.scope === 'asset' ? 'library' : 'episodes',
                    row.target.recordId
                  );
                  const url = new URL(window.location.href);
                  url.hash =
                    row.stage === 'story-draft' ? row.key : reviewAnchor(row.target, row.stage);
                  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
                }}
              >
                {row.name} · {row.title} ·{' '}
                {row.status === 'draft' ? 'Needs your review' : row.status.replaceAll('-', ' ')}
              </Button>
            ))}
          </Stack>
        </Box>
      )}
      <Stack
        direction="row"
        sx={{
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <Box>
          <Typography variant="overline">THE RECURRING CAST AND WORLD</Typography>
          <Typography variant="h2">On the drawing board</Typography>
        </Box>
        <Button onClick={() => navigate('library')} endIcon={<ArrowForwardOutlined />}>
          All assets
        </Button>
      </Stack>
      <Box className="featured-grid">
        {featured.map((asset) => {
          const candidate = asset.finalChoice;
          return (
            <Box className="asset-card" key={asset._id}>
              <ReferencePreview
                kind={asset.kind}
                file={data.media.find((m) => m._id === candidate?.mediaIds?.[0])}
              />
              <Box
                sx={{
                  p: 2.5
                }}
              >
                <Chip
                  size="small"
                  label={assetStatuses[assetStatus(asset)]}
                  color={assetStatusColor(asset)}
                />
                <Typography
                  variant="h3"
                  sx={{
                    mt: 2,
                    mb: 1
                  }}
                >
                  {asset.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" className="line-clamp">
                  {asset.brief}
                </Typography>
                <Button
                  onClick={() => navigate('library', asset._id)}
                  endIcon={<ArrowForwardOutlined />}
                  sx={{
                    mt: 2
                  }}
                >
                  Review options
                </Button>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Box className="bottom-grid">
        <Box className="editor-panel">
          <Typography variant="overline">CREATIVE READINESS</Typography>
          <Typography
            variant="h2"
            sx={{
              my: 1.5
            }}
          >
            {finalized.length} of {active.length} current assets finalized
          </Typography>
          <LinearProgress
            variant="determinate"
            value={active.length ? (finalized.length / active.length) * 100 : 0}
            sx={{
              height: 7,
              borderRadius: 2,
              my: 2
            }}
          />
          <Typography variant="body2" color="text.secondary">
            Upload references, compare directions, then finalize the version that belongs in the
            series.
          </Typography>
          {finalized.slice(-3).map((a) => (
            <Stack
              key={a._id}
              direction="row"
              sx={{
                alignItems: 'center',
                gap: 1,
                mt: 2
              }}
            >
              <CheckCircleOutlined color="success" fontSize="small" />
              <Typography variant="body2">
                {a.name} · {a.finalChoice.title}
              </Typography>
            </Stack>
          ))}
        </Box>
        <Box className="editor-panel">
          <Typography variant="overline">THE PRODUCTION APPROACH</Typography>
          <Typography
            variant="h2"
            sx={{
              my: 1.5
            }}
          >
            Story first. Scenes set the pace.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {data.settings.vlogPercent === 0
              ? 'Fully cinematic dialogue and action. Faithful to the recorded source, with no audience-facing vlog dialogue.'
              : `Roughly ${data.settings.vlogPercent}% personal vlog, with cinematic dialogue and action filling the rest.`}{' '}
            Flexible clips, native sound effects, and separate music reviews.
          </Typography>
          <Divider
            sx={{
              my: 2
            }}
          />
          <Typography variant="body2">
            {imageGenerationDefaults.displayName} · Wan 3.0 · ElevenLabs
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Review locally. Assemble and add music in CapCut.
          </Typography>
        </Box>
      </Box>
    </Stack>
  );
}
export default function App({ account }) {
  const [chatContext, setChatContext] = useState({});
  const [mobileMenu, setMobileMenu] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState(() =>
    new URLSearchParams(window.location.search).has('chat')
      ? 'chat'
      : new URLSearchParams(window.location.search).has('asset')
        ? 'library'
        : new URLSearchParams(window.location.search).has('episode')
          ? 'episodes'
          : 'overview'
  );
  const [initialId, setInitialId] = useState(
    () =>
      new URLSearchParams(window.location.search).get('asset') ||
      new URLSearchParams(window.location.search).get('episode') ||
      ''
  );
  const [createEpisode, setCreateEpisode] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    async function refresh() {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const next = await request('/studio', { signal: controller.signal });
        if (!controller.signal.aborted) {
          setData((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(e.message);
      } finally {
        inFlight = false;
      }
    }
    const refreshVisible = () => {
      if (!document.hidden) void refresh();
    };
    void refresh();
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    const timer = window.setInterval(refreshVisible, 30000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [reload]);
  function navigate(next, id = '', create = false) {
    const address = new URL(window.location.href);
    for (const key of ['asset', 'episode', 'chat']) address.searchParams.delete(key);
    if (next === 'chat') address.searchParams.set('chat', '1');
    if (next === 'library' && id) address.searchParams.set('asset', id);
    if (next === 'episodes' && id) address.searchParams.set('episode', id);
    window.history.replaceState({}, '', address.pathname + address.search + address.hash);
    if (next !== 'chat') setChatContext({});
    setMobileMenu(false);
    setPage(next);
    setInitialId(id);
    setCreateEpisode(create);
    window.scrollTo?.({
      top: 0,
      behavior: 'instant'
    });
  }
  function updateRecord(collection, record) {
    setData((old) => ({
      ...old,
      [collection]: old[collection].some((x) => x._id === record._id)
        ? old[collection].map((x) => (x._id === record._id ? record : x))
        : [...old[collection], record]
    }));
    if (collection === 'assets')
      request('/studio')
        .then((next) =>
          setData((old) => ({
            ...old,
            episodes: next.episodes
          }))
        )
        .catch(() => {});
  }
  const onMedia = (file) =>
    setData((old) => ({
      ...old,
      media: old.media.some((m) => m._id === file._id) ? old.media : [file, ...old.media]
    }));
  async function onRejected({ deletedMediaId }) {
    forgetRejectedMedia(deletedMediaId);
    setData((old) => ({
      ...old,
      media: old.media.filter((file) => file._id !== deletedMediaId),
      assets: old.assets.map((asset) => removeMediaReferences(asset, deletedMediaId)),
      episodes: old.episodes.map((episode) => removeMediaReferences(episode, deletedMediaId))
    }));
    try {
      setData(await request('/studio'));
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <Box className="studio-shell">
      <Box className="mobile-app-bar" component="header">
        <IconButton aria-label="Open studio menu" onClick={() => setMobileMenu(true)}>
          <MenuOutlined />
        </IconButton>
        <Box>
          <Typography fontWeight={700}>ROXY KANE</Typography>
          <Typography variant="caption">
            {navigation.find(([value]) => value === page)?.[1]}
          </Typography>
        </Box>
      </Box>
      <Drawer
        open={mobileMenu}
        onClose={() => setMobileMenu(false)}
        slotProps={{
          paper: {
            sx: { width: 280, maxWidth: '85vw', bgcolor: '#202b22', color: '#faf9f1', p: 2 }
          }
        }}
      >
        <Typography variant="h2" sx={{ p: 2 }}>
          Your studio
        </Typography>
        <Box component="nav" aria-label="Mobile studio navigation">
          {navigation.map(([value, label, Icon]) => (
            <Button
              key={value}
              fullWidth
              startIcon={<Icon />}
              aria-current={page === value ? 'page' : undefined}
              onClick={() => navigate(value)}
              sx={{
                justifyContent: 'flex-start',
                minHeight: 52,
                color: page === value ? '#fff' : '#c4cbbf',
                bgcolor: page === value ? '#3a4b38' : 'transparent',
                mb: 1
              }}
            >
              {label}
            </Button>
          ))}
        </Box>
        <Button onClick={() => setMobileMenu(false)} sx={{ color: '#dfcc93', mt: 2 }}>
          Close menu
        </Button>
      </Drawer>
      <Box component="aside" className="sidebar">
        <Box className="brand">
          <Box className="brand-mark">RK</Box>
          <Box>
            <Typography
              sx={{
                fontWeight: 700
              }}
            >
              ROXY KANE
            </Typography>
            <Typography
              variant="caption"
              sx={{
                letterSpacing: '0.13em',
                color: '#b9c0ac'
              }}
            >
              PRODUCTION STUDIO
            </Typography>
          </Box>
        </Box>
        <Typography
          variant="overline"
          sx={{
            color: '#9da891',
            px: 2,
            mt: 4,
            mb: 1
          }}
        >
          YOUR WORKSPACE
        </Typography>
        <Box component="nav" aria-label="Studio navigation">
          {navigation.map(([value, label, Icon]) => (
            <Button
              key={value}
              className={`nav-button ${page === value ? 'active' : ''}`}
              startIcon={<Icon />}
              aria-current={page === value ? 'page' : undefined}
              onClick={() => navigate(value)}
            >
              {label}
            </Button>
          ))}
        </Box>
        <Box className="sidebar-bottom">
          <Chip
            label="LOCAL WORKSPACE"
            size="small"
            sx={{
              bgcolor: '#344330',
              color: '#d8e6c5',
              mb: 2
            }}
          />
          <Typography
            variant="body2"
            sx={{
              color: '#d1d7c8'
            }}
          >
            Your world stays with you.
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: '#a4b098',
              display: 'block',
              mt: 1
            }}
          >
            Creative records and original media saved on this computer.
          </Typography>
        </Box>
      </Box>
      <Box className="studio-main">
        <Box component="header" className="topbar">
          <Typography variant="body2" color="text.secondary">
            Roxy Star Wars <span className="breadcrumb-separator">/</span>{' '}
            {navigation.find(([value]) => value === page)?.[1]}
          </Typography>
          <Button size="small" onClick={() => setReload((n) => n + 1)}>
            Refresh workspace
          </Button>
          <Chip
            size="small"
            label={data ? 'Workspace connected' : 'Connecting…'}
            color={data ? 'success' : 'default'}
            variant="outlined"
          />
          {account && (
            <AccountControls
              username={account.session.username}
              onSignedOut={account.onSignedOut}
              onSession={account.onSession}
            />
          )}
        </Box>
        <Box component="main" className="workspace-content">
          <Suspense fallback={<CircularProgress aria-label="Opening workspace" />}>
            {error && (
              <Alert
                severity="error"
                action={
                  <Button
                    color="inherit"
                    onClick={() => {
                      setError('');
                      setReload((n) => n + 1);
                    }}
                  >
                    Retry connection
                  </Button>
                }
              >
                {error} Check that the local server and database are running.
              </Alert>
            )}
            {!data && !error && (
              <Stack
                spacing={2}
                sx={{
                  alignItems: 'center',
                  py: 12
                }}
              >
                <CircularProgress aria-label="Loading studio" />
                <Typography>Opening your production studio…</Typography>
              </Stack>
            )}
            {data?.projects?.length > 1 && (
              <Stack spacing={1} sx={{ mb: 3 }}>
                <TextField
                  select
                  fullWidth
                  label="Project / class storyline"
                  value={data.project?.key ?? 'imperial-smuggler'}
                  onChange={(e) => {
                    const address = new URL(window.location.href);
                    address.search = '';
                    address.searchParams.set('project', e.target.value);
                    window.location.assign(address.href);
                  }}
                >
                  {data.projects.map((project) => (
                    <MenuItem key={project.key} value={project.key} sx={{ whiteSpace: 'normal' }}>
                      {project.name}
                    </MenuItem>
                  ))}
                </TextField>
                <Typography variant="caption" color="text.secondary">
                  Each storyline has its own episodes, creative choices, voice and continuity. Saved
                  editor drafts stay in this browser when switching.
                </Typography>
              </Stack>
            )}
            {data && page === 'overview' && (
              <Overview
                {...{
                  data,
                  navigate
                }}
              />
            )}
            {data && page === 'library' && (
              <AssetLibrary
                workflowVersion={data.settings?.workflowVersion}
                key={`library-${initialId}`}
                assets={data.assets}
                episodes={data.episodes}
                media={data.media}
                initialId={initialId}
                onOpenEpisode={(id) => navigate('episodes', id)}
                onChat={(context) => {
                  setChatContext(context);
                  navigate('chat');
                }}
                onRejected={onRejected}
                onReload={() => setReload((v) => v + 1)}
                onSaved={(a) => {
                  updateRecord('assets', a);
                  if (data.settings?.workflowVersion === 1) setReload((v) => v + 1);
                }}
                onMedia={onMedia}
              />
            )}
            {data && page === 'chat' && (
              <ProductionChat
                data={data}
                initialContext={chatContext}
                onMedia={onMedia}
                onReview={async (target, recordId) => {
                  try {
                    setData(await request('/studio'));
                    navigate(target, recordId);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
                onChanged={() => setReload((n) => n + 1)}
              />
            )}
            {data && page === 'episodes' && (
              <Episodes
                key={`episodes-${initialId}-${createEpisode}`}
                initialId={initialId}
                episodes={data.episodes}
                assets={data.assets}
                media={data.media}
                settings={data.settings}
                initialCreate={createEpisode}
                onReload={() => setReload((n) => n + 1)}
                onSaved={(e) => updateRecord('episodes', e)}
                onAssetSaved={(a) => updateRecord('assets', a)}
                onChat={(context) => {
                  setChatContext(context);
                  navigate('chat');
                }}
                onRejected={onRejected}
                onMedia={onMedia}
              />
            )}
            {data && page === 'media' && (
              <MediaLibrary media={data.media} onMedia={onMedia} onRejected={onRejected} />
            )}
            {data && page === 'bible' && (
              <SeriesBible
                settings={data.settings}
                onSaved={(settings) =>
                  setData((old) => ({
                    ...old,
                    settings
                  }))
                }
              />
            )}
          </Suspense>
        </Box>
        <Box component="footer" className="studio-footer">
          <Typography variant="caption">Roxy Kane / Independent series production</Typography>
          <Typography variant="caption">Develop · Review · Finalize</Typography>
        </Box>
      </Box>
    </Box>
  );
}
