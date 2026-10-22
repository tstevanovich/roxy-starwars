import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, afterEach, before, beforeEach, test } from 'node:test';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { completedResponse, createChatGPT } from '../src/assistant/chatgpt.js';
import { createSecretStore } from '../src/assistant/store.js';

let directory,
  ownerPath,
  key,
  publicJwk,
  store,
  service,
  calls,
  authorization,
  claims,
  fetchOverride,
  tokenFailure,
  scopes,
  time,
  modelResult,
  refreshResult;
const issuer = 'https://auth.openai.com';
const owner = { username: 'test', version: 'owner-1', hash: '0'.repeat(128), salt: '0'.repeat(48) };
const allowedScopes =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const metadata = {
  issuer,
  authorization_endpoint: issuer + '/api/accounts/authorize',
  token_endpoint: issuer + '/api/accounts/oauth/token',
  jwks_uri: issuer + '/.well-known/jwks.json',
  revocation_endpoint: issuer + '/api/accounts/oauth/revoke'
};
function sse(events) {
  return new Response(events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''), {
    headers: { 'content-type': 'text/event-stream' }
  });
}
const reply = () =>
  sse([
    {
      type: 'response.completed',
      response: {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Connected.' }] }]
      }
    }
  ]);
async function identity(overrides = {}) {
  return new SignJWT({
    iss: issuer,
    aud:
      authorization?.searchParams.get('client_id') === 'dynamic_agent_client'
        ? 'oaiapp_test'
        : (authorization?.searchParams.get('client_id') ?? 'oaiapp_test'),
    sub: 'user-1',
    email: 'owner@example.com',
    nonce: authorization?.searchParams.get('nonce'),
    iat: Math.floor(time / 1000),
    exp: Math.floor(time / 1000) + 3600,
    ...overrides
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .sign(key.privateKey);
}
async function fetcher(url, options = {}) {
  calls.push({ url: String(url), method: options.method ?? 'GET', options });
  if (fetchOverride) {
    const overridden = await fetchOverride(String(url), options);
    if (overridden) return overridden;
  }
  if (url === issuer + '/.well-known/openid-configuration') return Response.json(metadata);
  if (url === metadata.jwks_uri) return Response.json({ keys: [publicJwk] });
  if (url === metadata.revocation_endpoint) return new Response(null, { status: 200 });
  if (url === metadata.token_endpoint) {
    if (tokenFailure) return Response.json({ error: tokenFailure }, { status: 400 });
    if (options.body.get('grant_type') === 'refresh_token')
      return Response.json(
        refreshResult ?? {
          access_token: 'plan-refreshed-access',
          refresh_token: 'rotated-refresh',
          token_type: 'Bearer',
          expires_in: 3600
        }
      );
    assert.equal(
      createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'),
      authorization.searchParams.get('code_challenge')
    );
    assert.equal(options.body.get('redirect_uri'), authorization.searchParams.get('redirect_uri'));
    assert.equal(options.body.get('client_id'), 'oaiapp_test');
    return Response.json({
      access_token: 'plan-access-secret',
      refresh_token: 'plan-refresh-secret',
      id_token: await identity(claims),
      token_type: 'Bearer',
      expires_in: 3600,
      scope: scopes
    });
  }
  if (url === 'https://api.openai.com/v1/models') return Response.json(modelResult);
  if (url === 'https://api.openai.com/v1/responses') return reply();
  throw new Error('Test refused unexpected external request');
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'roxy-plan-auth-test-'));
  ownerPath = join(directory, 'owner.json');
  key = await generateKeyPair('RS256');
  publicJwk = { ...(await exportJWK(key.publicKey)), kid: 'test-key', alg: 'RS256' };
});
beforeEach(async () => {
  await writeFile(ownerPath, JSON.stringify(owner));
  store = createSecretStore(join(directory, randomUUID()));
  calls = [];
  authorization = null;
  claims = {};
  fetchOverride = null;
  tokenFailure = null;
  scopes = allowedScopes;
  time = Date.now();
  refreshResult = null;
  modelResult = {
    models: [
      { slug: 'plan-model', display_name: 'Plan model', visibility: 'list' },
      { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' }
    ]
  };
  service = createChatGPT({ store, ownerPath, fetcher, clock: () => time });
});
afterEach(async () => {
  await service.close();
});
after(async () => {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true });
});
async function start(profileId) {
  const beginning = await service.start({
    origin: 'http://127.0.0.1:5000',
    ownerVersion: owner.version,
    profileId
  });
  const redirect = await fetch(beginning.signInUrl, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  authorization = new URL(redirect.headers.get('location'));
  return beginning;
}
async function callback(parameters = {}) {
  const url = new URL(authorization.searchParams.get('redirect_uri'));
  url.search = new URLSearchParams({
    state: authorization.searchParams.get('state'),
    code: 'test-code',
    client_id: 'oaiapp_test',
    ...parameters
  });
  return fetch(url);
}
async function connected() {
  await start();
  const result = await callback();
  assert.equal(result.status, 200, await result.text());
  return (await service.status()).activeProfileId;
}
async function respond() {
  const ready = await service.ready();
  return service.respond({
    ...ready,
    instructions: 'Test only.',
    input: [{ role: 'user', content: 'Hello.' }],
    tools: [{ type: 'function', name: 'test_tool', parameters: { type: 'object', properties: {} } }]
  });
}

test('local PKCE registration validates identity, protects secrets, uses the account catalog and persists one host ID', async () => {
  await start();
  assert.equal(authorization.origin, issuer);
  assert.equal(authorization.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(authorization.searchParams.get('agent_name_hint'), 'Roxy Kane Studio');
  assert.equal(authorization.searchParams.get('resource'), 'https://api.openai.com/v1');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authorization.searchParams.get('ext_agent_host_id'), /^urn:uuid:/);
  const host = authorization.searchParams.get('ext_agent_host_id');
  const result = await callback();
  assert.equal(result.status, 200);
  const state = await service.status();
  assert.equal(state.canChat, true);
  assert.equal(state.profiles[0].email, 'owner@example.com');
  assert.deepEqual(state.profiles[0].models, [{ id: 'plan-model', name: 'Plan model' }]);
  assert.equal(state.profiles[0].verifiedAt, null);
  assert.doesNotMatch(
    JSON.stringify(state),
    /plan-access-secret|plan-refresh-secret|id_token|code_verifier/
  );
  await start(state.activeProfileId);
  assert.equal(authorization.searchParams.get('client_id'), 'oaiapp_test');
  assert.equal(authorization.searchParams.has('agent_name_hint'), false);
  assert.equal(authorization.searchParams.get('ext_agent_host_id'), host);
});
test('bad OAuth state cannot exchange a code or consume the genuine pending sign-in', async () => {
  await start();
  assert.equal((await callback({ state: 'forged-state' })).status, 400);
  assert.equal(
    calls.some((c) => c.url === metadata.token_endpoint),
    false
  );
  assert.ok((await service.status()).pending);
  assert.equal((await callback()).status, 200);
  assert.equal(calls.filter((c) => c.url === metadata.token_endpoint).length, 1);
});
test('callback listener rejects a non-loopback Host and requires a one-time launch token', async () => {
  const beginning = await service.start({
    origin: 'http://127.0.0.1:5000',
    ownerVersion: owner.version
  });
  const forgedHost = await new Promise((resolve, reject) => {
    const req = httpRequest(
      beginning.signInUrl,
      { headers: { Host: 'attacker.example' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      }
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(forgedHost, 400);
  assert.equal((await fetch(beginning.signInUrl + 'bad', { redirect: 'manual' })).status, 404);
  assert.equal((await fetch(beginning.signInUrl, { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(beginning.signInUrl, { redirect: 'manual' })).status, 404);
});
test('cancelled or expired sign-in never creates a connection or exchanges a code', async () => {
  await start();
  assert.equal((await callback({ error: 'access_denied' })).status, 400);
  assert.equal((await service.status()).connected, false);
  assert.equal(
    calls.some((c) => c.url === metadata.token_endpoint),
    false
  );
  await start();
  time += 600001;
  assert.equal((await callback()).status, 400);
  assert.equal(
    calls.some((c) => c.url === metadata.token_endpoint),
    false
  );
});
test('owner credential change invalidates an in-progress ChatGPT sign-in', async () => {
  await start();
  await writeFile(ownerPath, JSON.stringify({ ...owner, version: 'reset-owner' }));
  assert.equal((await callback()).status, 400);
  assert.equal(
    calls.some((c) => c.url === metadata.token_endpoint),
    false
  );
  assert.equal((await service.status()).connected, false);
});
for (const [label, wrong] of [
  ['nonce', { nonce: 'wrong' }],
  ['issuer', { iss: 'https://attacker.example' }],
  ['audience', { aud: 'oaiapp_wrong' }],
  ['expiration', { exp: 1 }]
]) {
  test(`ID token ${label} must match before any ChatGPT profile becomes active`, async () => {
    await start();
    claims = wrong;
    assert.equal((await callback()).status, 400);
    assert.equal((await service.status()).connected, false);
    assert.equal((await service.status()).profiles.length, 0);
  });
}
test('sign-in without plan scope is shown as identity-only and cannot use an API key as fallback', async () => {
  scopes = 'openid profile email';
  await connected();
  const existingKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'billed-api-key-must-not-be-used';
  await store.update((s) => ({ ...s, openai: { key: 'another-billed-api-key' } }));
  try {
    const state = await service.status();
    assert.equal(state.connected, true);
    assert.equal(state.planEnabled, false);
    assert.equal(state.canChat, false);
    assert.equal(state.apiKeyFallback, false);
    await assert.rejects(service.ready(), /Connect your ChatGPT plan/);
    await assert.rejects(
      service.respond({ profileId: state.activeProfileId, model: 'plan-model', input: [] }),
      /not granted/
    );
    assert.equal(
      calls.some((c) => c.url.endsWith('/responses')),
      false
    );
  } finally {
    if (existingKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = existingKey;
  }
});
test('issued client ID is retained before a failed code exchange and reused on the next sign-in', async () => {
  await start();
  const host = authorization.searchParams.get('ext_agent_host_id');
  tokenFailure = 'invalid_grant';
  assert.equal((await callback()).status, 400);
  assert.equal((await store.read()).chatgpt.pendingClientId, 'oaiapp_test');
  assert.equal((await service.status()).profiles.length, 0);
  tokenFailure = null;
  await start();
  assert.equal(authorization.searchParams.get('client_id'), 'oaiapp_test');
  assert.equal(authorization.searchParams.has('agent_name_hint'), false);
  assert.equal(authorization.searchParams.get('ext_agent_host_id'), host);
  assert.equal((await callback()).status, 200);
});
test('reauthorization cannot silently replace a saved account with a different identity', async () => {
  const profileId = await connected();
  await start(profileId);
  claims = { sub: 'user-2', email: 'different@example.com' };
  assert.equal((await callback()).status, 400);
  const state = await service.status();
  assert.equal(state.activeProfileId, profileId);
  assert.equal(state.profiles[0].email, 'owner@example.com');
  assert.equal(state.profiles.length, 1);
});
test('plan inference uses the OAuth token, streaming, namespaced tools and no billed-only fields', async () => {
  await connected();
  await respond();
  const request = calls.find((c) => c.url.endsWith('/responses'));
  assert.equal(request.options.headers.authorization, 'Bearer plan-access-secret');
  const body = JSON.parse(request.options.body);
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.tools[0].type, 'namespace');
  assert.equal(body.tools[0].name, 'studio');
  for (const unsupported of [
    'max_output_tokens',
    'previous_response_id',
    'conversation',
    'background',
    'temperature',
    'tool_search'
  ])
    assert.equal(unsupported in body, false);
  assert.ok((await service.status()).profiles[0].verifiedAt);
});
test('concurrent expired-token requests rotate refresh credentials once without mixing identities', async () => {
  const profileId = await connected();
  await store.update((s) => ({
    ...s,
    chatgpt: {
      ...s.chatgpt,
      profiles: s.chatgpt.profiles.map((p) => ({
        ...p,
        tokens: { ...p.tokens, expiresAt: time - 1 }
      }))
    }
  }));
  refreshResult = {
    access_token: 'plan-refreshed-access',
    refresh_token: 'rotated-refresh',
    token_type: 'Bearer',
    expires_in: 3600,
    id_token: await identity({ nonce: undefined })
  };
  await Promise.all([respond(), respond()]);
  assert.equal(
    calls.filter(
      (c) =>
        c.url === metadata.token_endpoint && c.options.body.get('grant_type') === 'refresh_token'
    ).length,
    1
  );
  const profile = (await store.read()).chatgpt.profiles.find((p) => p.id === profileId);
  assert.equal(profile.tokens.refresh_token, 'rotated-refresh');
  for (const c of calls.filter((c) => c.url.endsWith('/responses')))
    assert.equal(c.options.headers.authorization, 'Bearer plan-refreshed-access');
});
test('revoked refresh permission clears credentials and never makes an inference request', async () => {
  await connected();
  await store.update((s) => ({
    ...s,
    chatgpt: {
      ...s.chatgpt,
      profiles: s.chatgpt.profiles.map((p) => ({
        ...p,
        tokens: { ...p.tokens, expiresAt: time - 1 }
      }))
    }
  }));
  tokenFailure = 'invalid_grant';
  await assert.rejects(respond(), /expired or was revoked/);
  assert.equal((await service.status()).connected, false);
  assert.equal(
    calls.some((c) => c.url.endsWith('/responses')),
    false
  );
});
test('disconnect clears renewable credentials but retains the exact registration for later sign-in', async () => {
  const profileId = await connected();
  const result = await service.disconnect(profileId);
  assert.equal(result.revoked, true);
  const profile = (await store.read()).chatgpt.profiles[0];
  assert.equal(profile.clientId, 'oaiapp_test');
  assert.equal(profile.tokens, null);
  assert.equal((await service.status()).canChat, false);
  const revoke = calls.find((c) => c.url === metadata.revocation_endpoint);
  assert.equal(revoke.options.body.get('token'), 'plan-refresh-secret');
  assert.equal(revoke.options.body.get('client_id'), 'oaiapp_test');
  await start(profileId);
  assert.equal(authorization.searchParams.has('id_token_hint'), false);
});
test('failed remote revocation still signs out locally and reports its verification boundary', async () => {
  const profileId = await connected();
  fetchOverride = async (url) =>
    url === metadata.revocation_endpoint ? new Response(null, { status: 503 }) : null;
  const result = await service.disconnect(profileId);
  assert.equal(result.revoked, false);
  assert.match(result.message, /could not be confirmed/);
  assert.equal((await service.status()).connected, false);
});
test('model choices are restricted to the account catalog and an API-key catalog is rejected', async () => {
  const profileId = await connected();
  await assert.rejects(service.model(profileId, 'unlisted-model'), /current catalog/);
  modelResult = { data: [{ id: 'billed-only-model' }] };
  await assert.rejects(service.models(), /No API-key catalog|no API-key catalog/);
  assert.equal((await service.status()).model, 'plan-model');
});
test('usage-limit error after visible text stops the turn without retrying or changing billing routes', async () => {
  await connected();
  fetchOverride = async (url) =>
    url.endsWith('/responses')
      ? sse([
          { type: 'response.output_text.delta', delta: 'Partial text' },
          {
            type: 'response.failed',
            response: {
              error: {
                code: 'subscription_sharing_usage_limit_exceeded',
                message: 'private upstream details'
              }
            }
          }
        ])
      : null;
  await assert.rejects(
    respond(),
    (error) =>
      error.status === 429 &&
      error.providerCode === 'subscription_sharing_usage_limit_exceeded' &&
      !error.message.includes('private upstream')
  );
  assert.equal(calls.filter((c) => c.url.endsWith('/responses')).length, 1);
  assert.equal(
    (await service.status()).profiles[0].lastError,
    'subscription_sharing_usage_limit_exceeded'
  );
});
test('SSE decoding preserves UTF-8 and chunk boundaries and requires response.completed', async () => {
  const events =
    ': keepalive\r\n\r\ndata: ' +
    JSON.stringify({ type: 'response.output_text.delta', delta: 'Roxy’s café' }) +
    '\r\n\r\ndata: ' +
    JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [] } }) +
    '\r\n\r\n';
  const encoded = new TextEncoder().encode(events);
  let index = 0,
    text;
  const body = new ReadableStream({
    pull(controller) {
      if (index >= encoded.length) return controller.close();
      controller.enqueue(encoded.slice(index, index + 3));
      index += 3;
    }
  });
  const result = await completedResponse(
    new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    {
      onText: (value) => {
        text = value;
      }
    }
  );
  assert.equal(result.status, 'completed');
  assert.equal(text, 'Roxy’s café');
  await assert.rejects(
    completedResponse(sse([{ type: 'response.output_text.delta', delta: 'Unfinished' }])),
    /before the reply completed/
  );
  await assert.rejects(
    completedResponse(sse([{ type: 'response.incomplete' }])),
    /incomplete reply/
  );
});

test('a plan event stream without Content-Type completes only after a valid terminal event', async () => {
  const events = [
    { type: 'response.output_text.delta', delta: 'Connected.' },
    {
      type: 'response.completed',
      response: {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Connected.' }] }]
      }
    }
  ];
  const noHeader = (items) =>
    new Response(
      new TextEncoder().encode(
        items.map((item) => `event: ${item.type}\r\ndata: ${JSON.stringify(item)}\r\n\r\n`).join('')
      )
    );
  assert.equal(noHeader(events).headers.get('content-type'), null);
  const completed = await completedResponse(noHeader(events));
  assert.equal(completed.status, 'completed');
  assert.equal(completed.output[0].content[0].text, 'Connected.');
  await assert.rejects(
    completedResponse(noHeader(events.slice(0, 1))),
    /before the reply completed/
  );
  await assert.rejects(
    completedResponse(
      noHeader([
        ...events.slice(0, 1),
        {
          type: 'response.failed',
          response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } }
        }
      ])
    ),
    (error) => error.status === 429
  );
  await assert.rejects(
    completedResponse(new Response(new TextEncoder().encode('<html>Upstream failure</html>'))),
    /before the reply completed/
  );
  await assert.rejects(
    completedResponse(
      new Response(JSON.stringify(events[1]), { headers: { 'content-type': 'application/json' } })
    ),
    /unexpected response format/
  );
});

test('completed output items survive an empty terminal output and are released in output order', async () => {
  const call = {
    type: 'function_call',
    call_id: 'call-1',
    name: 'studio.get_context',
    arguments: '{}'
  };
  const message = {
    type: 'message',
    content: [{ type: 'output_text', text: 'Check saved approvals.' }]
  };
  const items = [
    { type: 'response.output_item.done', output_index: 1, item: message },
    { type: 'response.output_item.done', output_index: 0, item: call }
  ];
  const terminal = { type: 'response.completed', response: { status: 'completed', output: [] } };
  const result = await completedResponse(sse([...items, terminal]));
  assert.deepEqual(result.output, [call, message]);
  await assert.rejects(completedResponse(sse(items)), /before the reply completed/);
  await assert.rejects(
    completedResponse(sse([...items, { type: 'response.incomplete' }])),
    /incomplete reply/
  );
  await assert.rejects(
    completedResponse(
      sse([
        ...items,
        {
          type: 'response.failed',
          response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } }
        }
      ])
    ),
    (error) => error.status === 429
  );
  const canonical = await completedResponse(
    sse([...items, { ...terminal, response: { status: 'completed', output: [message] } }])
  );
  assert.deepEqual(canonical.output, [message]);
});
