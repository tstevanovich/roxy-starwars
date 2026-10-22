import { randomUUID } from 'node:crypto';

import { json, Router } from 'express';

import { StudioAsset, StudioEpisode, StudioMedia } from '../models/Studio.js';
import { hashToken, readOwner } from '../owner.js';
import { fail, id, text } from '../studio-validation.js';
import { createChatEngine } from './chat.js';
import { createChatGPT } from './chatgpt.js';
import { Chat, Job, Message, Proposal, Run, SourceGrant } from './models.js';
import { createOpenArt } from './openart.js';
import { createProduction, defaultMediaDirectory } from './production.js';
import { referenceSharing } from './reference-sharing.js';
import { createSecretStore } from './store.js';

function jobView(job) {
  const {
    _id,
    chatId,
    kind,
    title,
    target,
    status,
    quote,
    receipt,
    historyId,
    resultMediaIds,
    resultAssetId,
    error,
    createdAt
  } = job;
  return {
    _id,
    chatId,
    kind,
    title,
    target,
    status,
    quote,
    receipt,
    historyId,
    resultMediaIds,
    resultAssetId,
    error,
    createdAt
  };
}
export function createAssistant({
  mediaDirectory = defaultMediaDirectory,
  ownerPath,
  remotePath,
  secretDirectory,
  store = createSecretStore(secretDirectory),
  openart = createOpenArt(store, { ownerPath }),
  chatgpt,
  fetcher = fetch
} = {}) {
  const router = Router(),
    publicRouter = Router();
  router.use(json({ limit: '128kb' }));
  const shutdown = new AbortController();
  const workerFetch = (url, options = {}) =>
    fetcher(url, {
      ...options,
      signal: AbortSignal.any([shutdown.signal, ...(options.signal ? [options.signal] : [])])
    });
  const production = createProduction({
    openart,
    store,
    mediaDirectory,
    ownerPath,
    remotePath,
    fetcher: workerFetch
  });
  const planClient = chatgpt ?? createChatGPT({ store, ownerPath, fetcher: workerFetch });
  const engine = createChatEngine({
    chatgpt: planClient,
    production,
    mediaDirectory,
    signal: shutdown.signal
  });
  let timer,
    busy = false,
    stopped = false,
    currentTick = Promise.resolve();
  publicRouter.get('/oauth/openart/callback', async (req, res) => {
    try {
      if (typeof req.query.code !== 'string' || typeof req.query.state !== 'string')
        fail('OpenArt connection was cancelled or invalid.');
      await openart.finish(req.query.state, req.query.code);
      res
        .type('html')
        .send(
          '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenArt connected</title><body style="font:18px system-ui;padding:32px"><h1>OpenArt connected</h1><p>You can request renders from your studio chat.</p><a href="/?chat=1">Return to production chat</a></body></html>'
        );
    } catch {
      res
        .status(400)
        .type('text')
        .send(
          'OpenArt could not connect. Return to Production chat → Connections and start again.'
        );
    }
  });
  publicRouter.get('/source/:token', async (req, res, next) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(req.params.token)) return res.sendStatus(404);
    const grant = await SourceGrant.findOne({
      tokenHash: hashToken(req.params.token),
      expires: { $gt: new Date() }
    }).lean();
    if (!grant || grant.ownerVersion !== (await readOwner(ownerPath))?.version)
      return res.sendStatus(404);
    const media = await StudioMedia.findById(grant.mediaId).lean();
    if (!media) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').type(media.mime);
    res.sendFile(media.filename, { root: mediaDirectory, dotfiles: 'deny' }, (error) => {
      if (error && !res.headersSent) next(error);
    });
  });
  router.get('/connections', async (_req, res) => {
    const secrets = await store.read();
    res.json({
      chatgpt: await planClient.status(),
      openart: {
        connected: Boolean(secrets.openart?.tokens),
        referenceSharing: await referenceSharing({
          redirectUrl: secrets.openart?.redirectUrl,
          remotePath
        }),
        projectId: secrets.openart?.projectId ?? 'f6YCUHb5jQKxcO2tP6vm'
      },
      elevenlabs: { configured: Boolean(process.env.ELEVENLABS_API_KEY) }
    });
  });
  router.put('/connections/openai', (_req, res) => {
    res.status(410).json({
      message:
        'Studio chat now uses your ChatGPT plan. Continue with ChatGPT in Connections; API-key billing is disabled.'
    });
  });
  router.delete('/connections/openai', async (_req, res) => {
    await store.update((s) => ({ ...s, openai: undefined }));
    res.json({ disconnected: true });
  });
  router.post('/connections/chatgpt/connect', async (req, res) => {
    const origin = req.get('origin');
    if (
      req.secure ||
      !origin ||
      !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin) ||
      !['127.0.0.1', 'localhost'].includes(req.hostname)
    )
      fail(
        'Connect ChatGPT on the studio PC: open http://127.0.0.1:5000, then Production chat → Connections. After setup, chat works from your phone.',
        400
      );
    res.json(
      await planClient.start({
        origin,
        ownerVersion: req.studioSession?.owner.version ?? (await readOwner(ownerPath))?.version,
        profileId: req.body.profileId
          ? text(req.body.profileId, 'ChatGPT account ID', 100, true)
          : undefined
      })
    );
  });
  router.post('/connections/chatgpt/cancel', async (_req, res) => {
    await planClient.cancel();
    res.json({ cancelled: true });
  });
  router.put('/connections/chatgpt/active', async (req, res) => {
    await planClient.select(text(req.body.profileId, 'ChatGPT account ID', 100, true));
    res.json({ selected: true });
  });
  router.post('/connections/chatgpt/models', async (_req, res) => {
    res.json({ models: await planClient.models() });
  });
  router.put('/connections/chatgpt/model', async (req, res) => {
    const { activeProfileId } = await planClient.status();
    if (!activeProfileId) fail('Connect a ChatGPT account first.');
    await planClient.model(activeProfileId, text(req.body.model, 'ChatGPT model', 100, true));
    res.json({ saved: true });
  });
  router.post('/connections/chatgpt/test', async (_req, res) => {
    const connection = await planClient.ready();
    await planClient.respond({
      ...connection,
      instructions: 'This is a connection check. Reply with exactly: Connected.',
      input: [
        {
          role: 'user',
          content: 'Confirm that this ChatGPT plan connection can complete a request.'
        }
      ],
      signal: shutdown.signal
    });
    res.json({ verified: true });
  });
  router.post('/connections/chatgpt/welcome', async (_req, res) => {
    const { activeProfileId } = await planClient.status();
    if (!activeProfileId) fail('Connect a ChatGPT account first.');
    await planClient.acknowledge(activeProfileId);
    res.json({ acknowledged: true });
  });
  router.post('/connections/chatgpt/disconnect', async (req, res) => {
    const profileId = req.body.profileId || (await planClient.status()).activeProfileId;
    res.json(await planClient.disconnect(text(profileId, 'ChatGPT account ID', 100, true)));
  });
  router.post('/connections/openart', async (req, res) => {
    const origin = req.get('origin');
    if (
      !origin ||
      !(origin.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
    )
      fail('Open the studio on its HTTPS remote address before connecting.');
    res.json({
      authorizationUrl: await openart.start(
        new URL(origin).origin,
        req.studioSession?.owner.version
      )
    });
  });
  router.post('/connections/openart/test', async (_req, res) => {
    await openart.call('openart_model_form_get', { model: 'wan3-0', mode: 'image2video' });
    const secrets = await store.read();
    const sharing = await referenceSharing({
      redirectUrl: secrets.openart?.redirectUrl,
      remotePath
    });
    res.json({
      verified: true,
      referenceSharing: sharing,
      message: sharing.ready
        ? 'OpenArt responded successfully. Secure local-reference sharing is configured.'
        : 'OpenArt responded successfully. ' + sharing.message
    });
  });
  router.put('/connections/openart', async (req, res) => {
    const projectId = text(req.body.projectId, 'OpenArt project ID', 100, true);
    if (!/^[\w-]+$/.test(projectId)) fail('Enter a valid OpenArt project ID.');
    await store.update((s) => ({ ...s, openart: { ...s.openart, projectId } }));
    res.json({ saved: true });
  });
  router.delete('/connections/openart', async (_req, res) => {
    await openart.disconnect();
    await SourceGrant.deleteMany({});
    res.json({ disconnected: true });
  });
  router.get('/sound/jobs', async (req, res) => {
    const jobs = await Job.find({
      kind: { $in: ['sound', 'mix'] },
      'target.episodeId': id(req.query.episodeId),
      ...(req.query.sceneId
        ? { 'target.sceneId': text(req.query.sceneId, 'Scene', 100, true) }
        : {})
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ jobs: jobs.map(jobView) });
  });
  for (const [action, method] of [
    ['generate', 'queueSound'],
    ['import', 'importSound'],
    ['mix', 'queueMix']
  ])
    router.post('/sound/' + action, async (req, res) => {
      const result = await production.sound[method](req.body);
      res
        .status(action === 'import' ? 200 : 202)
        .json({ ...result, job: result.job ? jobView(result.job) : undefined });
      void kick();
    });
  router.get('/chats', async (_req, res) => {
    res.json({ chats: await Chat.find().sort({ updatedAt: -1 }).limit(100).lean() });
  });
  router.post('/chats', async (req, res) => {
    const context = req.body.context ?? {};
    if (context.assetId && !(await StudioAsset.exists({ _id: id(context.assetId) })))
      fail('Asset not found.');
    if (context.episodeId && !(await StudioEpisode.exists({ _id: id(context.episodeId) })))
      fail('Episode not found.');
    const chat = await Chat.create({
      title: text(req.body.title || 'Production conversation', 'Title', 160, true),
      context: {
        assetId: context.assetId,
        episodeId: context.episodeId,
        sceneId: context.sceneId,
        clipId: context.clipId
      }
    });
    res.status(201).json({ chat: chat.toObject() });
  });
  router.get('/chats/:id', async (req, res) => {
    const chat = await Chat.findById(id(req.params.id)).lean();
    if (!chat) fail('Conversation not found.', 404);
    const [messages, runs, jobs, proposals] = await Promise.all([
      Message.find({ chatId: chat._id }).sort({ createdAt: 1, _id: 1 }).limit(500).lean(),
      Run.find({ chatId: chat._id }).sort({ createdAt: -1 }).limit(10).lean(),
      Job.find({ chatId: chat._id }).sort({ createdAt: -1 }).limit(100).lean(),
      Proposal.find({ chatId: chat._id }).sort({ createdAt: -1 }).limit(100).lean()
    ]);
    res.json({ chat, messages, runs, jobs: jobs.map(jobView), proposals });
  });
  router.post('/chats/:id/messages', async (req, res) => {
    const chatId = id(req.params.id),
      requestId = text(req.body.requestId, 'Message request ID', 100, true);
    const previous = await Message.findOne({ requestId }).lean();
    if (previous) {
      if (String(previous.chatId) !== chatId) fail('Message request ID already used.', 409);
      return res.json({ runId: previous.runId });
    }
    const messageText = text(req.body.text, 'Message', 16000, true);
    const mediaIds = req.body.mediaIds ?? [];
    if (!Array.isArray(mediaIds) || mediaIds.length > 4) fail('Attach up to four saved files.');
    mediaIds.forEach(id);
    if (
      (await StudioMedia.countDocuments({ _id: { $in: [...new Set(mediaIds)] } })) !==
      new Set(mediaIds).size
    )
      fail('An attached file no longer exists.');
    const connection = await planClient.ready();
    const run = await Run.create({
      chatId,
      status: 'preparing',
      provider: 'chatgpt-plan',
      ...connection
    });
    const chat = await Chat.findOneAndUpdate(
      { _id: chatId, activeRun: null },
      { $set: { activeRun: String(run._id) } }
    );
    if (!chat) {
      await Run.deleteOne({ _id: run._id });
      fail('This conversation is busy or no longer exists.', 409);
    }
    try {
      await Message.create({
        chatId,
        role: 'user',
        text: messageText,
        mediaIds,
        requestId,
        runId: String(run._id)
      });
      await Run.updateOne({ _id: run._id }, { $set: { status: 'queued' } });
    } catch (error) {
      await Chat.updateOne(
        { _id: chatId, activeRun: String(run._id) },
        { $set: { activeRun: null } }
      );
      await Run.deleteOne({ _id: run._id });
      throw error;
    }
    res.status(202).json({ runId: String(run._id) });
    void kick();
  });
  router.post('/proposals/:id/apply', async (req, res) => {
    const proposal = await Proposal.findById(id(req.params.id)).lean();
    if (!proposal || proposal.status !== 'pending') fail('This draft is no longer pending.', 409);
    const episode = await StudioEpisode.findById(proposal.episodeId).lean();
    if (!episode || episode.revision !== proposal.baseRevision)
      fail(
        'The episode changed. Ask the assistant to revise this draft against the latest saved episode.',
        409
      );
    const old = { ...episode };
    delete old.history;
    let fields;
    if (proposal.scene) {
      fields = {
        scenes: episode.scenes.some((s) => s.id === proposal.scene.id)
          ? episode.scenes.map((s) =>
              s.id === proposal.scene.id ? { ...proposal.scene, approval: null } : s
            )
          : [...episode.scenes, { ...proposal.scene, approval: null }]
      };
    } else
      fields = {
        notes: text(
          `${episode.notes ?? ''}\n\n${proposal.title}\n${proposal.text}`.trim(),
          'Episode notes',
          12000
        )
      };
    const result = await StudioEpisode.updateOne(
      { _id: episode._id, revision: proposal.baseRevision },
      {
        $set: fields,
        $inc: { revision: 1 },
        $push: { history: { $each: [{ ...old, savedAt: new Date() }], $slice: -30 } }
      }
    );
    if (!result.modifiedCount) fail('The episode changed while applying this draft.', 409);
    if (proposal.scene) {
      // A revised scene's previous images need an explicit fresh decision before another video.
      const shots = await StudioAsset.find({
        episodeId: episode._id,
        sceneId: proposal.scene.id,
        clipId: { $ne: null },
        finalChoice: { $ne: null }
      }).lean();
      for (const shot of shots) {
        const snapshot = { ...shot };
        delete snapshot.history;
        await StudioAsset.updateOne(
          { _id: shot._id, revision: shot.revision },
          {
            $set: {
              finalChoice: null,
              reviewStatus: 'pending-choice',
              referenceRevision: shot.revision + 1
            },
            $inc: { revision: 1 },
            $push: { history: { $each: [{ ...snapshot, savedAt: new Date() }], $slice: -30 } }
          }
        );
      }
    }
    await Proposal.updateOne({ _id: proposal._id }, { $set: { status: 'applied' } });
    res.json({ applied: true, episodeId: proposal.episodeId });
  });
  router.post('/proposals/:id/dismiss', async (req, res) => {
    await Proposal.updateOne(
      { _id: id(req.params.id), status: 'pending' },
      { $set: { status: 'dismissed' } }
    );
    res.json({ dismissed: true });
  });
  router.post('/jobs/:id/cancel', async (req, res) => {
    const result = await Job.updateOne(
      { _id: id(req.params.id), status: 'queued' },
      { $set: { status: 'cancelled' } }
    );
    if (!result.modifiedCount)
      fail('This job has already started. Review its result when ready.', 409);
    res.json({ cancelled: true });
  });
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const run = await Run.findOneAndUpdate(
        { status: 'queued' },
        { $set: { status: 'running' } },
        { sort: { createdAt: 1 }, returnDocument: 'after' }
      ).lean();
      if (run) await engine.run(run);
      // Due polls must not continually outrank newer, unsubmitted requests.
      const job =
        (await Job.findOne({ status: { $in: ['queued', 'importing'] } })
          .sort({ createdAt: 1 })
          .lean()) ??
        (await Job.findOne({ status: 'rendering', nextPollAt: { $lte: new Date() } })
          .sort({ nextPollAt: 1, createdAt: 1 })
          .lean());
      if (job) await production.processJob(job);
    } catch {
      /* Keep the worker alive; errors are recorded on individual runs/jobs. */
    } finally {
      busy = false;
    }
  }
  function kick() {
    if (busy || stopped) return currentTick;
    currentTick = tick();
    return currentTick;
  }
  router.use((error, _req, res, next) => {
    if (error.status && error.status < 600)
      return res.status(error.status).json({ message: error.message });
    next(error);
  });
  return {
    router,
    publicRouter,
    production,
    engine,
    chatgpt: planClient,
    store,
    async start() {
      stopped = false;
      for (const run of await Run.find({ status: 'preparing' }).lean()) {
        const saved = await Message.exists({ runId: String(run._id) });
        await Run.updateOne(
          { _id: run._id },
          {
            $set: {
              status: saved ? 'queued' : 'failed',
              ...(saved
                ? {}
                : { error: 'The server restarted before this message was saved. Send it again.' })
            }
          }
        );
      }
      await Run.updateMany(
        { status: 'running' },
        {
          $set: {
            status: 'failed',
            error:
              'The server restarted during this reply. Your message and any queued jobs were retained.'
          }
        }
      );
      const active = await Run.find({ status: { $in: ['queued', 'running'] } }).distinct('_id');
      await Chat.updateMany(
        { activeRun: { $nin: active.map(String) } },
        { $set: { activeRun: null } }
      );
      await Job.updateMany(
        { status: 'submitting' },
        {
          $set: {
            status: 'uncertain',
            error:
              'The server restarted while submitting. Check provider history before requesting another render.'
          }
        }
      );
      await Job.updateMany({ status: 'preparing' }, { $set: { status: 'queued' } });
      timer = setInterval(() => void kick(), 2500);
      timer.unref();
      void kick();
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      shutdown.abort();
      await planClient.close();
      await openart.close();
      let deadline;
      await Promise.race([
        currentTick,
        new Promise((resolve) => {
          deadline = setTimeout(resolve, 5000);
        })
      ]);
      clearTimeout(deadline);
    },
    tick: kick,
    instanceId: randomUUID()
  };
}
