import AddOutlined from '@mui/icons-material/AddOutlined';
import AttachFileOutlined from '@mui/icons-material/AttachFileOutlined';
import ChatOutlined from '@mui/icons-material/ChatOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';

import { proposalStageLabel } from '../../shared/production-proposals.js';
import { request, uploadMedia } from './api.js';
import ChatGPTConnection from './ChatGPTConnection.jsx';
import { DraftSupportingNotes, ProposalContent } from './ProductionDrafts.jsx';
import { studioUrl } from './project-url.js';
import { reviewHref } from './review-navigation.js';
import { ReferencePreview } from './StudioMedia.jsx';

const base = '/studio/assistant';
const emptyContext = {};
const statusLabels = {
  queued: 'Queued',
  preparing: 'Preparing references',
  submitting: 'Submitting to provider',
  rendering: 'Rendering',
  importing: 'Saving locally',
  ready: 'Ready for your review',
  failed: 'Needs attention',
  uncertain: 'Check provider history',
  cancelled: 'Cancelled'
};
function Connections({ onClose, initial, refresh }) {
  const [connections, setConnections] = useState(initial);
  const [projectId, setProjectId] = useState(initial?.openart.projectId ?? '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  async function act(action) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      const next = await refresh();
      setConnections(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Production connections</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {notice && <Alert severity="success">{notice}</Alert>}
          <ChatGPTConnection
            connection={connections?.chatgpt}
            busy={busy}
            act={act}
            notify={setNotice}
          />
          <Typography variant="h3" sx={{ pt: 2 }}>
            OpenArt · images and video
          </Typography>
          <Typography variant="body2">
            Connect the same OpenArt account you use for this project. Requested renders use your
            OpenArt credits. Existing approved references stay in control.
          </Typography>
          <Chip
            label={connections?.openart.connected ? 'OpenArt connected' : 'OpenArt sign-in needed'}
            color={connections?.openart.connected ? 'success' : 'warning'}
            sx={{ alignSelf: 'flex-start' }}
          />
          {connections?.openart.connected && connections.openart.referenceSharing && (
            <Alert severity={connections.openart.referenceSharing.ready ? 'info' : 'warning'}>
              {connections.openart.referenceSharing.ready
                ? 'Reference files are uploaded to OpenArt and verified before rendering. Reference delivery works independently of the remote studio address.'
                : connections.openart.referenceSharing.message}
            </Alert>
          )}
          {connections?.openart.connected && (
            <Button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const result = await request(base + '/connections/openart/test', {
                    method: 'POST',
                    body: {}
                  });
                  setNotice(result.message);
                })
              }
            >
              Test OpenArt connection
            </Button>
          )}
          <Button
            variant="contained"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const result = await request(base + '/connections/openart', {
                  method: 'POST',
                  body: {}
                });
                window.location.assign(result.authorizationUrl);
              })
            }
          >
            {connections?.openart.connected ? 'Reconnect OpenArt' : 'Connect OpenArt'}
          </Button>
          <TextField
            label="OpenArt project ID"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          />
          <Button
            disabled={busy || !projectId}
            onClick={() =>
              act(() =>
                request(base + '/connections/openart', { method: 'PUT', body: { projectId } })
              )
            }
          >
            Save render project
          </Button>
          {connections?.openart.connected && (
            <Button
              color="error"
              disabled={busy}
              onClick={() =>
                act(() => request(base + '/connections/openart', { method: 'DELETE' }))
              }
            >
              Disconnect OpenArt
            </Button>
          )}
          <Typography variant="h3" sx={{ pt: 2 }}>
            ElevenLabs · finalized voices
          </Typography>
          <Typography variant="body2">
            {connections?.elevenlabs.configured
              ? 'Your server’s ElevenLabs key is configured. Dialogue uses the finalized Eleven v3 voice for its speaker.'
              : 'Add ELEVENLABS_API_KEY to server/.env and restart the studio to generate dialogue.'}
          </Typography>
          {busy && <CircularProgress size={24} aria-label="Checking connection" />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
function Composer({ chatId, disabled, onSent, data, onMedia }) {
  const draftKey = 'roxy-chat-draft-' + chatId;
  const [initialDraft] = useState(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (!saved) return {};
      try {
        return JSON.parse(saved);
      } catch {
        return { text: saved };
      }
    } catch {
      return {};
    }
  });
  const [text, setText] = useState(initialDraft.text ?? '');
  const [mediaIds, setMediaIds] = useState(initialDraft.mediaIds ?? []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const requestId = useRef(initialDraft.requestId ?? crypto.randomUUID());
  useEffect(() => {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ text, mediaIds, requestId: requestId.current })
      );
    } catch {
      /* Draft stays in this tab. */
    }
  }, [draftKey, text, mediaIds]);
  async function send() {
    if (!text.trim() || busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      await request(`${base}/chats/${chatId}/messages`, {
        method: 'POST',
        body: { text, mediaIds, requestId: requestId.current }
      });
      setText('');
      setMediaIds([]);
      requestId.current = crypto.randomUUID();
      await onSent();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Box className="chat-composer">
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      <TextField
        fullWidth
        multiline
        minRows={2}
        maxRows={8}
        label="Message your production assistant"
        slotProps={{ inputLabel: { shrink: true } }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Revise this exchange, make a new image option, or suggest the next shot…"
        onKeyDown={(e) => {
          if (
            e.key === 'Enter' &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            window.matchMedia('(pointer:fine)').matches
          ) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <TextField
        select
        fullWidth
        label="Attach saved media (up to four)"
        value={mediaIds}
        sx={{ mt: 1.5 }}
        slotProps={{ select: { multiple: true } }}
        onChange={(e) => {
          if (e.target.value.length <= 4) setMediaIds(e.target.value);
        }}
      >
        {data.media.map((m) => (
          <MenuItem key={m._id} value={m._id}>
            {m.originalName}
          </MenuItem>
        ))}
      </TextField>
      <Stack
        direction="row"
        sx={{ mt: 1.5, gap: 1, justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Button
          component="label"
          startIcon={<AttachFileOutlined />}
          disabled={busy || mediaIds.length >= 4}
        >
          Upload reference
          <input
            hidden
            type="file"
            accept="image/*,audio/*,video/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              setError('');
              try {
                const media = await uploadMedia(file);
                onMedia(media);
                setMediaIds((ids) => [...ids, media._id].slice(0, 4));
              } catch (error) {
                setError(error.message);
              } finally {
                setBusy(false);
              }
              e.target.value = '';
            }}
          />
        </Button>
        <Button
          variant="contained"
          endIcon={busy ? <CircularProgress size={18} /> : <SendOutlined />}
          disabled={busy || disabled || !text.trim()}
          onClick={send}
        >
          Send message
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Paste a public webpage link for the assistant to read and cite. Attached images can be
        viewed by the assistant. Audio and video attachments supply file details; use feedback to
        describe what you hear or see. Requests keep running when you close this page.
      </Typography>
    </Box>
  );
}
function Conversation({ chatId, data, onMedia, onReview, configured, onChanged }) {
  const [detail, setDetail] = useState(null),
    [error, setError] = useState(''),
    [mutation, setMutation] = useState(null);
  const bottom = useRef(null),
    scroller = useRef(null),
    lastCount = useRef(0);
  async function refresh() {
    const next = await request(`${base}/chats/${chatId}`);
    setDetail((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    return next;
  }
  useEffect(() => {
    let active = true,
      loading = false;
    async function poll() {
      if (loading) return;
      loading = true;
      try {
        const next = await request(`${base}/chats/${chatId}`);
        if (active) {
          setDetail((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
          setError('');
        }
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        loading = false;
      }
    }
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [chatId]);
  useEffect(() => {
    if (!detail || lastCount.current === detail.messages.length) return;
    const element = scroller.current;
    if (
      element &&
      (!lastCount.current || element.scrollHeight - element.scrollTop - element.clientHeight < 250)
    )
      bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    lastCount.current = detail.messages.length;
  }, [detail]);
  async function action(path) {
    if (mutation?.busy) return;
    setMutation({ path, busy: true });
    try {
      const result = await request(base + path, { method: 'POST', body: {} });
      setMutation({ path, busy: false, result });
      await refresh();
      onChanged();
    } catch (e) {
      setMutation({ path, busy: false, error: e.message });
    }
  }
  if (!detail)
    return error ? (
      <Alert severity="error">{error}</Alert>
    ) : (
      <CircularProgress aria-label="Loading conversation" />
    );
  const activeRun = detail.runs.find((r) => r._id === detail.chat.activeRun);
  const latestFailure = detail.runs[0]?.status === 'failed' ? detail.runs[0].error : '';
  const focus = detail.chat.context;
  const episode = data.episodes.find((item) => item._id === focus?.episodeId);
  const scene = episode?.scenes.find((item) => item.id === focus?.sceneId);
  const shot = scene?.clips.find((item) => item.id === focus?.clipId);
  return (
    <Stack spacing={2}>
      {shot && (
        <Alert
          severity="info"
          action={
            <Button
              component="a"
              color="inherit"
              href={
                studioUrl(`/?episode=${encodeURIComponent(episode._id)}`) +
                `#picture-prerequisites-${shot.id}`
              }
            >
              Back to shot
            </Button>
          }
        >
          Discussing: {episode.title} / {scene.title} / {shot.title}. Changes are scoped to this
          shot unless you ask otherwise. Chat reads the latest saved shot, prompts and selections;
          media generation still uses the Generate buttons.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {mutation?.error && !mutation.path.startsWith('/proposals/') && (
        <Alert severity="error">{mutation.error}</Alert>
      )}
      <Box
        className="chat-transcript"
        ref={scroller}
        role="log"
        aria-label="Production conversation"
        aria-live="polite"
      >
        {!detail.messages.length && (
          <Box className="chat-welcome">
            <ChatOutlined sx={{ fontSize: 36 }} />
            <Typography variant="h2">Your next creative decision starts here.</Typography>
            <Typography>
              Ask for a story revision, give feedback on a take, or request new image options. The
              assistant reads the saved studio records. Apply story drafts and review each new asset
              before moving on to video.
            </Typography>
          </Box>
        )}
        {detail.messages.map((m) => (
          <Box key={m._id} className={`chat-message chat-${m.role}`}>
            <Typography variant="overline">
              {m.role === 'user' ? 'You' : 'Production assistant'}
            </Typography>
            <Typography component="div" className="chat-message-text">
              {m.text}
            </Typography>
            {m.mediaIds?.map((mid) => {
              const file =
                detail.media?.find((m) => m._id === mid) ?? data.media.find((m) => m._id === mid);
              return file ? (
                <Box key={mid} sx={{ maxWidth: 340, mt: 1 }}>
                  {file.sourceFrame && (
                    <Typography variant="caption">
                      Source {Math.floor(file.sourceFrame.requestedSeconds / 60)}:
                      {String(Math.floor(file.sourceFrame.requestedSeconds % 60)).padStart(2, '0')}{' '}
                      · {file.sourceFrame.view === 'subtitle-crop' ? 'Subtitle crop' : 'Full frame'}
                    </Typography>
                  )}
                  <ReferencePreview file={file} kind={file.kind} />
                </Box>
              ) : (
                <Typography key={mid} variant="caption">
                  Reference deleted
                </Typography>
              );
            })}
          </Box>
        ))}
        {activeRun && (
          <Stack sx={{ gap: 1, p: 2 }}>
            {activeRun.preview && (
              <Typography className="chat-message-text">{activeRun.preview}</Typography>
            )}
            <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
              <CircularProgress size={18} />
              <Typography>Working on your request…</Typography>
            </Stack>
          </Stack>
        )}
        <Box ref={bottom} />
      </Box>
      {latestFailure && (
        <Alert severity="warning">
          {latestFailure} Your message is saved; any jobs already created are listed below.
        </Alert>
      )}
      <Composer
        key={chatId}
        chatId={chatId}
        data={data}
        onMedia={onMedia}
        disabled={!configured || Boolean(detail.chat.activeRun)}
        onSent={refresh}
      />
      {detail.proposals
        .filter((p) => !['dismissed', 'superseded'].includes(p.status))
        .map((p) => (
          <Box key={p._id} className="editor-panel chat-result">
            <Chip
              label={
                p.status === 'applied'
                  ? p.render
                    ? 'Video revision approved'
                    : 'Draft applied'
                  : `${proposalStageLabel(p)} draft · review before applying`
              }
              color={p.status === 'applied' ? 'success' : 'warning'}
              size="small"
            />
            <Typography variant="h3" sx={{ mt: 1 }}>
              {p.title}
            </Typography>
            <Typography className="chat-message-text" sx={{ my: 1 }}>
              {p.production ? p.text?.split('\n\n{')[0] : p.text}
            </Typography>
            {(p.production || p.render) && <ProposalContent proposal={p} />}
            {!p.production && !p.render && <DraftSupportingNotes notes={p.supportingNotes} />}
            {p.scene && (
              <details>
                <summary>Read proposed scene and clips</summary>
                <Typography className="chat-message-text" sx={{ my: 2 }}>
                  {p.scene.script}
                </Typography>
                {p.scene.clips.map((c) => (
                  <Box key={c.id} sx={{ my: 2 }}>
                    <Typography fontWeight={700}>
                      {c.title} · {c.duration}s
                    </Typography>
                    <Typography className="chat-message-text">
                      {[c.action, c.dialogue, c.camera, c.soundEffects]
                        .filter(Boolean)
                        .join('\n\n')}
                    </Typography>
                  </Box>
                ))}
              </details>
            )}
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 2 }}>
              {p.status === 'pending' && (
                <>
                  <Button
                    variant="contained"
                    disabled={Boolean(mutation?.busy) || p.application?.canApply === false}
                    onClick={() =>
                      action(`/proposals/${p._id}/${p.render ? 'approve-render' : 'apply'}`)
                    }
                  >
                    {mutation?.busy && mutation.path.startsWith(`/proposals/${p._id}/`)
                      ? 'Applying draft…'
                      : p.render
                        ? 'Approve revision & generate video'
                        : 'Apply draft'}
                  </Button>
                  <Button
                    disabled={Boolean(mutation?.busy)}
                    onClick={() => action(`/proposals/${p._id}/dismiss`)}
                  >
                    Dismiss draft
                  </Button>
                </>
              )}
              <Button
                onClick={() =>
                  onReview(p.assetId ? 'library' : 'episodes', p.assetId || p.episodeId)
                }
              >
                Open {p.assetId ? 'asset' : 'episode'}
              </Button>
            </Stack>
            {mutation?.path.startsWith(`/proposals/${p._id}/`) && mutation.error && (
              <Alert severity="error">{mutation.error}</Alert>
            )}
            {mutation?.path.startsWith(`/proposals/${p._id}/`) && mutation.result?.applied && (
              <Alert severity="success">
                Draft applied. Your revised directions are saved; no approval or render was started.
                {mutation.result.nextReview && (
                  <Button
                    component="a"
                    href={reviewHref(
                      mutation.result.nextReview.target,
                      mutation.result.nextReview.stage
                    )}
                  >
                    Review revision directions
                  </Button>
                )}
              </Alert>
            )}
            <Typography variant="caption">
              Applying a scene draft keeps saved takes and selections. Changed creative inputs
              require review again before production continues.
            </Typography>
            {p.status === 'pending' && p.application?.canApply === false && (
              <Alert severity="warning">{p.application.reason}</Alert>
            )}
          </Box>
        ))}
      {detail.jobs.map((job) => (
        <Box key={job._id} className="editor-panel chat-result">
          <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="h3">{job.title}</Typography>
            <Chip
              label={statusLabels[job.status] ?? job.status}
              color={
                job.status === 'ready'
                  ? 'success'
                  : ['failed', 'uncertain'].includes(job.status)
                    ? 'warning'
                    : 'default'
              }
              size="small"
            />
          </Stack>
          <Typography variant="body2" sx={{ my: 1 }}>
            {job.kind === 'image'
              ? 'GPT Image 2.5 Sunburst · 2K · high quality'
              : job.kind === 'video'
                ? 'Wan 3.0 Standard · 1080p · 16:9 · no music'
                : job.kind === 'sound'
                  ? 'ElevenLabs sound effects - review audio before mixing'
                  : job.kind === 'mix'
                    ? 'Local sound mix - no generation credits'
                    : 'Eleven v3 - finalized speaker voice'}
          </Typography>
          {job.quote?.items?.[0] && (
            <Typography variant="caption">
              Quoted: {job.quote.items[0].totalCredits} OpenArt credits. {job.quote.pricingNote}
            </Typography>
          )}
          {job.error && (
            <Alert severity="warning" sx={{ my: 1 }}>
              {job.error}
            </Alert>
          )}
          <Stack direction="row" sx={{ mt: 1, gap: 1, flexWrap: 'wrap' }}>
            {job.status === 'queued' && (
              <Button onClick={() => action(`/jobs/${job._id}/cancel`)}>
                Cancel queued request
              </Button>
            )}
            {job.resultAssetId && (
              <Button variant="contained" onClick={() => onReview('library', job.resultAssetId)}>
                Review image options
              </Button>
            )}
            {job.target.episodeId && (
              <Button
                variant={job.status === 'ready' && job.kind !== 'image' ? 'contained' : 'text'}
                onClick={() => onReview('episodes', job.target.episodeId)}
              >
                Open episode for review
              </Button>
            )}
            {job.resultMediaIds?.length > 0 && (
              <Button onClick={() => onReview('media')}>Open media library</Button>
            )}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
export default function ProductionChat({
  data,
  initialContext = emptyContext,
  onMedia,
  onReview,
  onChanged
}) {
  const [chats, setChats] = useState([]),
    [selected, setSelected] = useState('');
  const [connections, setConnections] = useState(null),
    [showConnections, setShowConnections] = useState(false);
  const [context, setContext] = useState(initialContext),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [welcomeError, setWelcomeError] = useState('');
  async function refreshConnections() {
    const result = await request(base + '/connections');
    setConnections(result);
    return result;
  }
  useEffect(() => {
    let active = true;
    Promise.all([request(base + '/chats'), request(base + '/connections')])
      .then(async ([list, settings]) => {
        const address = new URL(window.location.href);
        const focusedContext = initialContext.clipId
          ? initialContext
          : {
              episodeId: address.searchParams.get('episode'),
              sceneId: address.searchParams.get('scene'),
              clipId: address.searchParams.get('shot')
            };
        if (focusedContext.clipId && focusedContext.episodeId && focusedContext.sceneId) {
          const { chat } = await request(base + '/chats', {
            method: 'POST',
            body: { context: focusedContext, reuseShot: true }
          });
          if (!active) return;
          setContext(chat.context);
          setChats([chat, ...list.chats.filter((item) => item._id !== chat._id)]);
          setConnections(settings);
          setSelected(chat._id);
          address.searchParams.set('chat', chat._id);
          for (const key of ['episode', 'scene', 'shot']) address.searchParams.delete(key);
          window.history.replaceState({}, '', address.pathname + address.search + address.hash);
          return;
        }
        if (active) {
          setChats(list.chats);
          setConnections(settings);
          if (!Object.keys(initialContext).length) {
            const requested = new URLSearchParams(window.location.search).get('chat');
            setSelected(
              list.chats.find((c) => c._id === requested)?._id ?? list.chats[0]?._id ?? ''
            );
          }
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [initialContext]);
  useEffect(() => {
    let active = true,
      loading = false;
    async function refreshVisible() {
      if (loading || document.visibilityState === 'hidden') return;
      loading = true;
      try {
        const next = await request(base + '/connections');
        if (active)
          setConnections((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
      } catch {
        /* The active conversation displays request failures without discarding a draft. */
      } finally {
        loading = false;
      }
    }
    const timer = setInterval(refreshVisible, 15000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, []);
  const activeProfile = connections?.chatgpt?.profiles?.find(
    (p) => p.id === connections.chatgpt.activeProfileId
  );
  async function acknowledgePlan() {
    try {
      await request(base + '/connections/chatgpt/welcome', { method: 'POST', body: {} });
      await refreshConnections();
      setWelcomeError('');
    } catch (e) {
      setWelcomeError(e.message);
    }
  }
  async function create() {
    setBusy(true);
    setError('');
    try {
      const title =
        data.assets.find((a) => a._id === context.assetId)?.name ??
        data.episodes.find((e) => e._id === context.episodeId)?.title ??
        'Production conversation';
      const { chat } = await request(base + '/chats', { method: 'POST', body: { title, context } });
      setChats((old) => [chat, ...old]);
      setSelected(chat._id);
      const address = new URL(window.location.href);
      address.searchParams.set('chat', chat._id);
      window.history.replaceState({}, '', address.pathname + address.search + address.hash);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const episode = data.episodes.find((e) => e._id === context.episodeId);
  const scene = episode?.scenes.find((s) => s.id === context.sceneId);
  return (
    <Stack spacing={3} className="production-chat">
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}
      >
        <Box>
          <Typography variant="overline">STORY AND PRODUCTION</Typography>
          <Typography variant="h1">Production chat</Typography>
          <Typography color="text.secondary">
            Discuss the story. Request assets. Keep your creative choices in one place.
          </Typography>
        </Box>
        <Button
          startIcon={<SettingsOutlined />}
          variant="outlined"
          onClick={() => setShowConnections(true)}
        >
          Connections
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {connections && !connections.chatgpt?.canChat && (
        <Alert
          severity="info"
          action={
            <Button color="inherit" onClick={() => setShowConnections(true)}>
              Set up
            </Button>
          }
        >
          Connect your ChatGPT plan on the studio PC to start chatting. Connect OpenArt to request
          images and videos.
        </Alert>
      )}
      {connections?.chatgpt?.canChat && (
        <Stack direction="row" sx={{ gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip label="Using ChatGPT plan" color="success" size="small" />
          <Typography variant="caption">
            {activeProfile?.models?.find((m) => m.id === activeProfile.model)?.name ??
              activeProfile?.model}
          </Typography>
          <Button
            size="small"
            component="a"
            href="https://chatgpt.com/settings/usage"
            target="_blank"
            rel="noopener noreferrer"
          >
            Manage usage
          </Button>
        </Stack>
      )}
      <Box className="chat-controls">
        <TextField
          select
          fullWidth
          label="Conversation"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            const address = new URL(window.location.href);
            address.searchParams.set('chat', e.target.value || '1');
            window.history.replaceState({}, '', address.pathname + address.search + address.hash);
          }}
        >
          <MenuItem value="">Start a new conversation</MenuItem>
          {chats.map((c) => (
            <MenuItem key={c._id} value={c._id}>
              {c.title}
            </MenuItem>
          ))}
        </TextField>
        <Button startIcon={<AddOutlined />} variant="outlined" onClick={() => setSelected('')}>
          New conversation
        </Button>
      </Box>
      {!selected ? (
        <Box className="editor-panel">
          <Stack spacing={2}>
            <Typography variant="h2">What are we working on?</Typography>
            <TextField
              select
              label="Creative context"
              value={
                context.assetId
                  ? `asset:${context.assetId}`
                  : context.episodeId
                    ? `episode:${context.episodeId}`
                    : ''
              }
              onChange={(e) => {
                const [type, value] = e.target.value.split(':');
                setContext(
                  type === 'asset'
                    ? { assetId: value }
                    : type === 'episode'
                      ? { episodeId: value }
                      : {}
                );
              }}
            >
              <MenuItem value="">Whole series · story and creative planning</MenuItem>
              {data.episodes.map((e) => (
                <MenuItem key={e._id} value={`episode:${e._id}`}>
                  {e.title}
                </MenuItem>
              ))}
              {data.assets
                .filter((a) => !a.archived)
                .map((a) => (
                  <MenuItem key={a._id} value={`asset:${a._id}`}>
                    {a.name}
                  </MenuItem>
                ))}
            </TextField>
            {episode && (
              <TextField
                select
                label="Scene (optional)"
                value={context.sceneId ?? ''}
                onChange={(e) => setContext({ episodeId: episode._id, sceneId: e.target.value })}
              >
                <MenuItem value="">Entire episode</MenuItem>
                {episode.scenes.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.title}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {scene && (
              <TextField
                select
                label="Clip (optional)"
                value={context.clipId ?? ''}
                onChange={(e) => setContext({ ...context, clipId: e.target.value })}
              >
                <MenuItem value="">Entire scene</MenuItem>
                {scene.clips.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.title}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <Button disabled={busy} variant="contained" onClick={create}>
              Start conversation
            </Button>
          </Stack>
        </Box>
      ) : (
        <Conversation
          key={selected}
          chatId={selected}
          data={data}
          onMedia={onMedia}
          onReview={onReview}
          configured={connections?.chatgpt?.canChat}
          onChanged={onChanged}
        />
      )}
      {showConnections && (
        <Connections
          initial={connections}
          onClose={() => setShowConnections(false)}
          refresh={refreshConnections}
        />
      )}
      <Dialog
        open={Boolean(
          activeProfile?.signedIn &&
          activeProfile?.planEnabled &&
          !activeProfile?.welcomeAcknowledged
        )}
        onClose={acknowledgePlan}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>You’re using your ChatGPT plan</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography>
              Eligible studio conversations use your ChatGPT plan or credits balance according to
              your ChatGPT usage settings. Studio chat does not switch to separately billed API-key
              usage.
            </Typography>
            <Typography>
              OpenArt renders and ElevenLabs recordings continue to use their own subscriptions or
              credits.
            </Typography>
            <Button
              component="a"
              href="https://chatgpt.com/settings/usage"
              target="_blank"
              rel="noopener noreferrer"
            >
              Manage usage
            </Button>
            {welcomeError && <Alert severity="error">{welcomeError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={acknowledgePlan} variant="contained">
            Got it
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
