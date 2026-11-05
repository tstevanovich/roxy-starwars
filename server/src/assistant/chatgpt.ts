import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createLocalJWKSet, jwtVerify } from 'jose';

import { toError } from '../../../shared/errors.ts';
import { equalSecret, readOwner } from '../owner.ts';
import { fail } from '../studio-validation.ts';
import type { createSecretStore } from './store.ts';

export const chatGPTUsageUrl = 'https://chatgpt.com/settings/usage';
const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const requiredScopes = ['resource.invoke', 'chatgpt.tokens.use.direct'];
const planEnabled = (profile) => requiredScopes.every((scope) => profile?.scopes?.includes(scope));
const randomSecret = () => randomBytes(32).toString('base64url');
const profileFrom = (saved, profileId?) =>
  saved.chatgpt?.profiles?.find((p) => p.id === (profileId ?? saved.chatgpt?.activeProfileId));
const safeError = (message: string, status = 400, code?) =>
  Object.assign(new Error(message), { status, ...(code ? { providerCode: code } : {}) });
function trustedEndpoint(value) {
  const url = new URL(value);
  if (url.origin !== issuer || url.username || url.password)
    throw safeError('OpenAI returned unexpected sign-in settings.', 502);
  return url.toString();
}
function profileView(profile) {
  return {
    id: profile.id,
    label: profile.label,
    email: profile.email,
    signedIn: Boolean(profile.tokens?.access_token && !profile.signingOut),
    planEnabled: planEnabled(profile),
    model: profile.model ?? '',
    models: profile.models ?? [],
    modelsError: profile.modelsError ?? null,
    verifiedAt: profile.verifiedAt ?? null,
    lastError: profile.lastError ?? null,
    welcomeAcknowledged: Boolean(profile.welcomeAcknowledged)
  };
}
export function planError(code, httpStatus?) {
  if (code === 'subscription_sharing_usage_limit_exceeded')
    return safeError(
      'Your ChatGPT plan or this app’s usage limit has been reached. Review Manage usage in ChatGPT settings, then try again when usage is available. No API-billed fallback was used.',
      429,
      code
    );
  if (code === 'subscription_sharing_usage_unavailable')
    return safeError(
      'ChatGPT plan usage is currently unavailable for this account or app. Review Manage usage or reconnect ChatGPT. No API-billed fallback was used.',
      409,
      code
    );
  if (httpStatus === 401 || code === 'invalid_grant' || code === 'invalid_token')
    return safeError(
      'Your ChatGPT connection expired or was revoked. Continue with ChatGPT again on your studio PC.',
      409,
      'sign_in_required'
    );
  if (httpStatus === 403)
    return safeError(
      'This ChatGPT account has not granted eligible plan access for this request. Review the connection and Manage usage.',
      403,
      'plan_access_required'
    );
  if (httpStatus === 429)
    return safeError(
      'ChatGPT is limiting requests. Wait and check Manage usage before trying again. No API-billed fallback was used.',
      429,
      'rate_limit'
    );
  return safeError(
    'ChatGPT could not complete this request. Your saved work is retained. Check Connections and try again; no separately billed API fallback was used.',
    502,
    'chatgpt_request_failed'
  );
}

// Consume only a completed response. Tool calls in an interrupted/failed stream must never run.
export async function completedResponse(
  response: Response,
  { onText }: { onText?: (text: string) => void } = {}
) {
  if (!response.ok) {
    let code;
    try {
      code = (await response.json()).error?.code;
    } catch {
      /* Do not expose raw provider bodies. */
    }
    throw planError(code, response.status);
  }
  // Some plan responses omit this header even though the body is valid SSE.
  // The parser below still requires a valid response.completed event before any tool can run.
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType && contentType !== 'text/event-stream')
    throw safeError(
      'ChatGPT returned an unexpected response format. No production actions were taken.',
      502
    );
  const decoder = new TextDecoder();
  const completedItems = new Map();
  let buffer = '',
    data = [],
    total = 0,
    preview = '';
  function event() {
    if (!data.length) return;
    const value = data.join('\n');
    data = [];
    if (value === '[DONE]') return;
    let item;
    try {
      item = JSON.parse(value);
    } catch {
      throw safeError(
        'ChatGPT’s response stream was interrupted. No new tool actions were taken.',
        502
      );
    }
    if (item.type === 'response.failed' || item.type === 'error')
      throw planError(item.response?.error?.code ?? item.error?.code ?? item.code);
    if (item.type === 'response.incomplete')
      throw safeError(
        'ChatGPT returned an incomplete reply. Saved work remains available; ask for a smaller scene or fewer changes.',
        502,
        'incomplete_response'
      );
    if (item.type === 'response.output_text.delta' && typeof item.delta === 'string') {
      preview = (preview + item.delta).slice(0, 24000);
      onText?.(preview);
    }
    if (item.type === 'response.output_item.done') {
      if (
        !Number.isSafeInteger(item.output_index) ||
        item.output_index < 0 ||
        item.output_index > 1000 ||
        !item.item ||
        typeof item.item.type !== 'string'
      )
        throw safeError('ChatGPT returned an invalid completed output item.', 502);
      completedItems.set(item.output_index, item.item);
    }
    if (item.type === 'response.completed') {
      if (item.response?.status !== 'completed' || !Array.isArray(item.response.output))
        throw safeError('ChatGPT did not confirm a completed reply.', 502);
      // The live plan stream can finish with output: [] after sending complete items separately.
      // Retain those items, but release them only after the successful terminal response.
      return item.response.output.length || !completedItems.size
        ? item.response
        : {
            ...item.response,
            output: [...completedItems.entries()]
              .sort(([a], [b]) => a - b)
              .map(([, value]) => value)
          };
    }
  }
  if (!response.body) throw safeError('ChatGPT returned an empty stream.', 502);
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > 25 * 1024 * 1024)
      throw safeError(
        'ChatGPT’s reply exceeded the studio’s response limit. Ask for a smaller change.',
        502
      );
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 2 * 1024 * 1024)
      throw safeError('ChatGPT returned an oversized stream event.', 502);
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      else if (!line) {
        const done = event();
        if (done) return done;
      }
    }
  }
  // A terminal JSON line without the final blank separator is still a complete SSE event.
  buffer += decoder.decode();
  if (buffer.startsWith('data:')) data.push(buffer.slice(5).trim());
  const done = event();
  if (done) return done;
  throw safeError(
    'The ChatGPT connection ended before the reply completed. Your message is saved; no tools from this incomplete reply were executed.',
    502,
    'interrupted_response'
  );
}

export function createChatGPT({
  store,
  ownerPath,
  fetcher = fetch,
  clock = Date.now
}: {
  store?: ReturnType<typeof createSecretStore>;
  ownerPath?: string;
  fetcher?: typeof fetch;
  clock?: () => number;
} = {}) {
  let pending,
    metadata,
    keys,
    keysAt = 0;
  const refreshes = new Map();
  async function discovery() {
    if (metadata) return metadata;
    const response = await fetcher(issuer + '/.well-known/openid-configuration', {
      redirect: 'error',
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok)
      throw safeError(
        'OpenAI sign-in is temporarily unavailable. Try again from your studio PC.',
        502
      );
    const result = await response.json();
    if (result.issuer !== issuer)
      throw safeError('OpenAI sign-in identity could not be verified.', 502);
    metadata = {
      issuer,
      authorization_endpoint: trustedEndpoint(result.authorization_endpoint),
      token_endpoint: trustedEndpoint(result.token_endpoint),
      jwks_uri: trustedEndpoint(result.jwks_uri),
      revocation_endpoint: trustedEndpoint(result.revocation_endpoint)
    };
    return metadata;
  }
  async function verifyIdentity(token: string, clientId, nonce, requireNonce = true) {
    const config = await discovery();
    async function loadKeys() {
      const response = await fetcher(config.jwks_uri, {
        redirect: 'error',
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw safeError('OpenAI sign-in keys could not be verified.', 502);
      keys = createLocalJWKSet(await response.json());
      keysAt = clock();
    }
    if (!keys || clock() - keysAt > 3600000) await loadKeys();
    let result;
    try {
      result = await jwtVerify(token, keys, {
        issuer,
        audience: clientId,
        requiredClaims: ['sub', 'exp', 'iat'],
        algorithms: ['RS256', 'ES256'],
        clockTolerance: 5,
        currentDate: new Date(clock())
      });
    } catch (caughtError) {
      const error = toError(caughtError);
      if (error.code !== 'ERR_JWKS_NO_MATCHING_KEY')
        throw safeError('ChatGPT sign-in identity could not be verified. Start again.', 400);
      await loadKeys();
      try {
        result = await jwtVerify(token, keys, {
          issuer,
          audience: clientId,
          requiredClaims: ['sub', 'exp', 'iat'],
          algorithms: ['RS256', 'ES256'],
          clockTolerance: 5,
          currentDate: new Date(clock())
        });
      } catch {
        throw safeError('ChatGPT sign-in identity could not be verified. Start again.', 400);
      }
    }
    if (
      ((requireNonce || result.payload.nonce !== undefined) &&
        !equalSecret(result.payload.nonce, nonce)) ||
      typeof result.payload.sub !== 'string' ||
      !result.payload.sub
    )
      throw safeError('ChatGPT sign-in nonce or account did not match. Start again.', 400);
    return result.payload;
  }
  function tokens(value, previous?) {
    if (
      typeof value.access_token !== 'string' ||
      !value.access_token ||
      value.access_token.length > 32768 ||
      (value.refresh_token !== undefined &&
        (typeof value.refresh_token !== 'string' || !value.refresh_token)) ||
      value.token_type?.toLowerCase() !== 'bearer' ||
      !(value.expires_in > 0 && value.expires_in <= 604800)
    )
      throw safeError('ChatGPT returned invalid connection credentials. Start sign-in again.', 502);
    return {
      access_token: value.access_token,
      refresh_token: value.refresh_token || previous?.refresh_token,
      id_token: value.id_token || previous?.id_token,
      expiresAt: clock() + value.expires_in * 1000
    };
  }
  async function tokenRequest(parameters) {
    const config = await discovery();
    const response = await fetcher(config.token_endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) {
      let code;
      try {
        code = (await response.json()).error;
      } catch {
        /* Never print the response body. */
      }
      throw planError(code, response.status);
    }
    return response.json();
  }
  async function updateProfile(profileId, change) {
    return store.update((s) => ({
      ...s,
      chatgpt: {
        ...s.chatgpt,
        profiles: (s.chatgpt?.profiles ?? []).map((p) => (p.id === profileId ? change(p) : p))
      }
    }));
  }
  async function access(profileId) {
    const saved = await store.read(),
      profile = profileFrom(saved, profileId);
    if (!profile?.tokens?.access_token || profile.signingOut)
      throw safeError(
        'Connect your ChatGPT account from Production chat → Connections on your studio PC.',
        409,
        'sign_in_required'
      );
    if (!planEnabled(profile))
      throw safeError(
        'You signed in, but ChatGPT plan usage was not granted. Enable it in Manage usage before chatting.',
        403,
        'plan_access_required'
      );
    if (profile.tokens.expiresAt > clock() + 60000) return profile;
    if (refreshes.has(profile.id)) return refreshes.get(profile.id);
    const task = (async () => {
      if (!profile.tokens.refresh_token) throw planError('invalid_grant');
      let value;
      try {
        value = await tokenRequest({
          grant_type: 'refresh_token',
          client_id: profile.clientId,
          refresh_token: profile.tokens.refresh_token,
          resource
        });
      } catch (caughtError) {
        const error = toError(caughtError);
        if (error.providerCode === 'sign_in_required')
          await updateProfile(profile.id, (p) =>
            p.tokenVersion === profile.tokenVersion
              ? { ...p, tokens: null, lastError: 'sign_in_required' }
              : p
          );
        throw error;
      }
      const refreshed = tokens(value, profile.tokens);
      const scopes = typeof value.scope === 'string' ? value.scope.split(/\s+/) : profile.scopes;
      if (value.id_token) {
        // Refresh tokens do not establish a new login nonce; verify issuer/audience/subject with the retained nonce.
        const claims = await verifyIdentity(value.id_token, profile.clientId, profile.nonce, false);
        if (claims.sub !== profile.subject)
          throw safeError('The refreshed ChatGPT account did not match. Sign in again.', 409);
      }
      let next;
      await updateProfile(profile.id, (p) => {
        if (p.tokenVersion !== profile.tokenVersion || !p.tokens)
          throw safeError(
            'The ChatGPT connection changed. Try again using the current account.',
            409
          );
        next = { ...p, tokens: refreshed, scopes, tokenVersion: randomUUID() };
        return next;
      });
      if (!planEnabled(next))
        throw safeError(
          'ChatGPT plan permission was removed. Review Manage usage.',
          403,
          'plan_access_required'
        );
      return next;
    })();
    refreshes.set(profile.id, task);
    try {
      return await task;
    } finally {
      refreshes.delete(profile.id);
    }
  }
  async function models(profileId?) {
    const profile = await access(profileId);
    const response = await fetcher(resource + '/models', {
      headers: { authorization: `Bearer ${profile.tokens.access_token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw planError(undefined, response.status);
    const result = await response.json();
    if (!Array.isArray(result.models))
      throw safeError(
        'ChatGPT did not return its plan model catalog. Reconnect ChatGPT; no API-key catalog will be used.',
        502
      );
    const catalog = result.models
      .filter(
        (m) =>
          m.visibility === 'list' && typeof m.slug === 'string' && /^[\w.:-]{1,100}$/.test(m.slug)
      )
      .slice(0, 100)
      .map((m) => ({
        id: m.slug,
        name: typeof m.display_name === 'string' ? m.display_name.slice(0, 160) : m.slug
      }));
    if (!catalog.length)
      throw safeError(
        'No eligible ChatGPT models are currently available to this connection. Check Manage usage or reconnect.',
        409
      );
    await updateProfile(profile.id, (p) => {
      if (!p.tokens || p.clientId !== profile.clientId)
        throw safeError('The ChatGPT connection changed. Refresh Connections.', 409);
      return {
        ...p,
        models: catalog,
        modelsError: null,
        model: p.model ? (catalog.some((m) => m.id === p.model) ? p.model : '') : catalog[0].id
      };
    });
    return catalog;
  }
  async function closePending() {
    const attempt = pending;
    pending = undefined;
    if (attempt) {
      clearTimeout(attempt.timer);
      attempt.server.close();
      attempt.server.closeAllConnections();
    }
  }
  async function finish(attempt, url: URL) {
    pending = undefined;
    clearTimeout(attempt.timer);
    const owner = await readOwner(ownerPath);
    if (!owner || owner.version !== attempt.ownerVersion)
      throw safeError('Your studio login changed. Start ChatGPT sign-in again.', 400);
    if (url.searchParams.has('error'))
      throw safeError(
        'ChatGPT sign-in was cancelled or plan permission was declined. You can try again from Connections.',
        400
      );
    const code = url.searchParams.get('code');
    const returnedClient = url.searchParams.get('client_id');
    const expectedClient = attempt.clientId === 'dynamic_agent_client' ? null : attempt.clientId;
    const clientId = expectedClient || returnedClient;
    if (
      !code ||
      code.length > 6000 ||
      !/^oaiapp_[\w-]{1,200}$/.test(clientId ?? '') ||
      (expectedClient && returnedClient && returnedClient !== clientId)
    )
      throw safeError('ChatGPT did not return the expected app registration. Start again.', 400);
    if (!attempt.profile)
      await store.update((s) => ({ ...s, chatgpt: { ...s.chatgpt, pendingClientId: clientId } }));
    const value = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: attempt.verifier,
      redirect_uri: attempt.redirectUri,
      resource
    });
    if (!value.id_token)
      throw safeError('ChatGPT did not return a verifiable identity. Start again.', 400);
    const claims = await verifyIdentity(value.id_token, clientId, attempt.nonce);
    if (attempt.profile && claims.sub !== attempt.profile.subject)
      throw safeError(
        'A different ChatGPT account was returned. Use Add account to connect it separately.',
        400
      );
    if ((await readOwner(ownerPath))?.version !== attempt.ownerVersion)
      throw safeError('Your studio login changed during sign-in. Start again.', 400);
    const credential = tokens(value);
    const scopes = typeof value.scope === 'string' ? value.scope.split(/\s+/) : [];
    let connected;
    await store.update((s) => {
      const same = (s.chatgpt?.profiles ?? []).find(
        (p) => p.clientId === clientId && p.subject === claims.sub
      );
      if (
        attempt.profile &&
        profileFrom(s, attempt.profile.id)?.tokenVersion !== attempt.profile.tokenVersion
      )
        throw safeError('This connection changed while signing in. Start again.', 409);
      connected = {
        ...same,
        id: same?.id ?? randomUUID(),
        clientId,
        subject: claims.sub,
        issuer,
        email: typeof claims.email === 'string' ? claims.email.slice(0, 254) : '',
        label: same?.label ?? `ChatGPT account ${(s.chatgpt?.profiles?.length ?? 0) + 1}`,
        tokens: credential,
        scopes,
        nonce: attempt.nonce,
        tokenVersion: randomUUID(),
        verifiedAt: null,
        signingOut: false,
        lastError: null
      };
      return {
        ...s,
        chatgpt: {
          ...s.chatgpt,
          activeProfileId: connected.id,
          pendingClientId: null,
          profiles: [...(s.chatgpt?.profiles ?? []).filter((p) => p.id !== connected.id), connected]
        }
      };
    });
    if (planEnabled(connected)) {
      try {
        await models(connected.id);
      } catch {
        await updateProfile(connected.id, (p) => ({
          ...p,
          modelsError:
            'Sign-in succeeded, but model discovery could not finish. Choose Refresh models in Connections.'
        }));
      }
    }
    return connected;
  }
  return {
    async status() {
      const saved = await store.read(),
        profile = profileFrom(saved);
      return {
        activeProfileId: saved.chatgpt?.activeProfileId ?? null,
        profiles: (saved.chatgpt?.profiles ?? []).map(profileView),
        connected: Boolean(profile?.tokens?.access_token && !profile.signingOut),
        planEnabled: planEnabled(profile),
        canChat: Boolean(
          profile?.tokens?.access_token &&
          !profile.signingOut &&
          planEnabled(profile) &&
          profile.model &&
          profile.models?.some((m) => m.id === profile.model)
        ),
        model: profile?.model ?? '',
        usageUrl: chatGPTUsageUrl,
        pending: pending ? { expiresAt: pending.expires } : null,
        apiKeyFallback: false,
        legacyApiKeyIgnored: Boolean(process.env.OPENAI_API_KEY || saved.openai?.key)
      };
    },
    async start({ origin, ownerVersion, profileId = undefined }) {
      await closePending();
      const config = await discovery();
      const saved = await store.update((s) => ({
        ...s,
        chatgpt: {
          profiles: [],
          ...s.chatgpt,
          hostId: s.chatgpt?.hostId ?? 'urn:uuid:' + randomUUID()
        }
      }));
      const profile = profileId ? profileFrom(saved, profileId) : null;
      if (profileId && !profile) fail('Choose a saved ChatGPT account.');
      if (profile?.signingOut) fail('ChatGPT sign-out is still finishing. Try again in a moment.');
      if (!ownerVersion || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
        throw safeError('Start ChatGPT sign-in from the studio PC’s local web address.', 400);
      const attempt = {
        redirectUri: undefined as string | undefined,
        launched: false,
        authorizationUrl: undefined as string | undefined,
        server: undefined as ReturnType<typeof createServer> | undefined,
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
        origin,
        ownerVersion,
        profile,
        clientId: profile?.clientId ?? saved.chatgpt.pendingClientId ?? 'dynamic_agent_client',
        state: randomSecret(),
        nonce: randomSecret(),
        verifier: randomSecret(),
        launchToken: randomSecret(),
        expires: clock() + 600000
      };
      const server = createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        );
        if (
          req.method !== 'GET' ||
          req.headers.host !== `127.0.0.1:${(server.address() as AddressInfo | null)?.port}`
        ) {
          res.writeHead(400);
          res.end('Invalid local sign-in request.');
          return;
        }
        const url = new URL(req.url, attempt.redirectUri);
        if (
          url.pathname === '/auth/start/' + attempt.launchToken &&
          pending === attempt &&
          !attempt.launched &&
          attempt.expires > clock()
        ) {
          attempt.launched = true;
          res.writeHead(302, { Location: attempt.authorizationUrl });
          res.end();
          return;
        }
        if (url.pathname !== '/auth/callback') {
          res.writeHead(404);
          res.end('Route not found.');
          return;
        }
        // Invalid state does not consume the legitimate pending attempt.
        if (
          pending !== attempt ||
          attempt.expires <= clock() ||
          !equalSecret(url.searchParams.get('state'), attempt.state)
        ) {
          res.writeHead(400);
          res.end('This sign-in link is invalid or expired. Start again in the studio.');
          return;
        }
        try {
          const connected = await finish(attempt, url);
          const heading = planEnabled(connected)
            ? 'ChatGPT connected'
            : 'ChatGPT signed in — plan access needed';
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(
            `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title><h1>${heading}</h1><p>Return to Production chat to choose your model and test the connection.</p><a href="${origin}/?chat=1">Return to production chat</a></html>`
          );
        } catch (caughtError) {
          const error = toError(caughtError);
          const message = error.status
            ? error.message
            : 'ChatGPT sign-in could not complete. Start again from Connections.';
          res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(message);
        } finally {
          server.close();
        }
      });
      attempt.server = server;
      server.headersTimeout = 10000;
      server.requestTimeout = 15000;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(undefined));
      });
      attempt.redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/callback`;
      const authorization = new URL(config.authorization_endpoint);
      authorization.search = new URLSearchParams({
        client_id: attempt.clientId,
        ...(attempt.clientId === 'dynamic_agent_client'
          ? { agent_name_hint: 'Roxy Kane Studio' }
          : {}),
        ext_agent_host_id: saved.chatgpt.hostId,
        response_type: 'code',
        redirect_uri: attempt.redirectUri,
        resource,
        scope:
          'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' as const,
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
        ...(profile?.tokens?.id_token ? { id_token_hint: profile.tokens.id_token } : {}),
        ...(profile?.email ? { login_hint: profile.email } : {})
      }).toString();
      attempt.authorizationUrl = authorization.toString();
      pending = attempt;
      attempt.timer = setTimeout(() => {
        void closePending();
      }, 600000).unref();
      return {
        signInUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/start/${attempt.launchToken}`,
        expiresAt: attempt.expires
      };
    },
    cancel: closePending,
    models,
    async ready() {
      const saved = await store.read(),
        profile = profileFrom(saved);
      if (
        !profile?.tokens?.access_token ||
        profile.signingOut ||
        !planEnabled(profile) ||
        !profile.model ||
        !profile.models?.some((m) => m.id === profile.model)
      )
        throw safeError(
          'Connect your ChatGPT plan and choose an available model in Connections first. API keys are not used by studio chat.',
          409
        );
      return { profileId: profile.id, model: profile.model };
    },
    async select(profileId) {
      if (!profileFrom(await store.read(), profileId)) fail('ChatGPT account not found.');
      await store.update((s) => ({ ...s, chatgpt: { ...s.chatgpt, activeProfileId: profileId } }));
    },
    async model(profileId, model) {
      await updateProfile(profileId, (p) => {
        if (!p.models?.some((m) => m.id === model))
          fail('Choose a model from this ChatGPT account’s current catalog.');
        return { ...p, model, verifiedAt: null, lastError: null };
      });
    },
    async acknowledge(profileId) {
      await updateProfile(profileId, (p) => ({ ...p, welcomeAcknowledged: true }));
    },
    async respond({
      profileId,
      model,
      input,
      instructions = '',
      tools = [],
      signal = undefined,
      onText = undefined
    }) {
      const saved = await store.read();
      if (saved.chatgpt?.activeProfileId !== profileId)
        throw safeError(
          'The active ChatGPT account changed while this reply was running. Send a new message using the current account.',
          409
        );
      const profile = await access(profileId);
      if (!profile.models?.some((m) => m.id === model))
        throw safeError('Choose an available ChatGPT model in Connections.', 409);
      const requestSignal = AbortSignal.any([
        AbortSignal.timeout(180000),
        ...(signal ? [signal] : [])
      ]);
      try {
        const response = await fetcher(resource + '/responses', {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${profile.tokens.access_token}`,
            'content-type': 'application/json',
            accept: 'text/event-stream'
          },
          body: JSON.stringify({
            model,
            store: false,
            stream: true,
            // Interactive production edits should not silently inherit the
            // model's slower default reasoning level.
            ...(/^gpt-6(?:\.|-)/.test(model) ? { reasoning: { effort: 'low' } } : {}),
            instructions,
            input,
            include: ['reasoning.encrypted_content'],
            ...(tools.length
              ? {
                  tools: [
                    {
                      type: 'namespace',
                      name: 'studio',
                      description:
                        'The owner’s Roxy Kane story, creative library and production job tools.',
                      tools
                    }
                  ]
                }
              : {})
          }),
          signal: requestSignal
        });
        const result = await completedResponse(response, { onText });
        const current = await store.read();
        if (
          current.chatgpt?.activeProfileId !== profile.id ||
          profileFrom(current, profile.id)?.tokenVersion !== profile.tokenVersion
        )
          throw safeError(
            'The ChatGPT connection changed while replying. Your message is saved; send a new message using the current connection.',
            409
          );
        await updateProfile(profile.id, (p) =>
          p.tokenVersion === profile.tokenVersion && p.model === model
            ? { ...p, verifiedAt: new Date(clock()).toISOString(), lastError: null }
            : p
        );
        return result;
      } catch (caughtError) {
        const error = toError(caughtError);
        let failure = error;
        if (
          !error.status &&
          (error.name === 'TimeoutError' || requestSignal.reason?.name === 'TimeoutError')
        )
          failure = safeError(
            'ChatGPT took longer than three minutes to complete this reply. Your message is saved. Try the request again; reconnecting is not required for a timeout. Any earlier completed actions remain listed below.',
            504,
            'response_timeout'
          );
        else if (!error.status && (error.name === 'AbortError' || signal?.aborted))
          failure = safeError(
            'This reply was interrupted while the studio was stopping. Your message is saved; try again when the studio is available.',
            503,
            'request_interrupted'
          );
        else if (!error.status && error instanceof TypeError)
          failure = safeError(
            'The connection to ChatGPT was interrupted. Your message is saved. Try again; check Connections only if the interruption continues.',
            502,
            'transport_error'
          );
        if (failure.providerCode)
          await updateProfile(profile.id, (p) =>
            p.tokenVersion === profile.tokenVersion ? { ...p, lastError: failure.providerCode } : p
          );
        throw failure;
      }
    },
    async disconnect(profileId) {
      const saved = await store.read(),
        profile = profileFrom(saved, profileId);
      if (!profile) fail('ChatGPT account not found.');
      const signingOutVersion = randomUUID();
      await updateProfile(profile.id, (p) => ({
        ...p,
        signingOut: true,
        tokenVersion: signingOutVersion
      }));
      let revoked = !profile.tokens?.refresh_token;
      if (!revoked) {
        for (let attempt = 0; attempt < 2 && !revoked; attempt++) {
          try {
            const config = await discovery();
            const response = await fetcher(config.revocation_endpoint, {
              method: 'POST',
              redirect: 'error',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                token: profile.tokens.refresh_token,
                token_type_hint: 'refresh_token',
                client_id: profile.clientId
              }),
              signal: AbortSignal.timeout(15000)
            });
            revoked = response.ok;
            if (!response.ok && response.status < 500) break;
          } catch {
            /* Clear locally even when the remote revoke endpoint is unreachable. */
          }
          if (!revoked && !attempt) await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      await updateProfile(profile.id, (p) =>
        p.tokenVersion !== signingOutVersion
          ? p
          : {
              ...p,
              tokens: null,
              tokenVersion: randomUUID(),
              signingOut: false,
              verifiedAt: null,
              lastError: null
            }
      );
      await closePending();
      return {
        disconnected: true,
        revoked,
        ...(revoked
          ? {}
          : {
              message:
                'Signed out locally. Remote revocation could not be confirmed; disconnect this app in ChatGPT Settings → Usage.'
            })
      };
    },
    close: closePending
  };
}
