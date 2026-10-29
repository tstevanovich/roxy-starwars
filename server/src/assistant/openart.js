import { randomBytes } from 'node:crypto';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { equalSecret, readOwner } from '../owner.js';
import { fail } from '../studio-validation.js';

const endpoint = new URL('https://mcp.openart.ai/mcp');
export function unpack(result) {
  if (result.isError) {
    const message = result.content?.find((x) => x.type === 'text')?.text ?? 'Provider error.';
    let details = result.structuredContent;
    if (!details) {
      try {
        details = JSON.parse(message);
      } catch {
        /* Not every provider error is structured. */
      }
    }
    const rejected = details?.status === 'FAILED' && details.historyId === 'submit-failed';
    throw Object.assign(
      new Error(
        rejected
          ? `OpenArt rejected this render (${details.errorDisplayCode ?? details.failedCode ?? 'provider error'}). No render ID was issued. Review the failure before requesting a retry.`
          : 'OpenArt rejected the request: ' + message
      ),
      {
        status: 502,
        ...(rejected
          ? {
              providerRejection: {
                status: details.status,
                error: details.error,
                failedCode: details.failedCode,
                errorDisplayCode: details.errorDisplayCode
              }
            }
          : {})
      }
    );
  }
  if (result.structuredContent) return result.structuredContent;
  for (const item of result.content ?? []) {
    if (item.type === 'text') {
      try {
        return JSON.parse(item.text);
      } catch {
        /* Try the next text block. */
      }
    }
  }
  fail('OpenArt returned an unreadable response.', 502);
}
export function createOpenArt(store, { ownerPath } = {}) {
  let client, connecting;
  async function provider() {
    const saved = (await store.read()).openart ?? {};
    return {
      get redirectUrl() {
        return saved.redirectUrl;
      },
      get clientMetadata() {
        return {
          client_name: 'Roxy Kane Studio',
          redirect_uris: [saved.redirectUrl],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: 'full_access'
        };
      },
      state: () => saved.state,
      clientInformation: async () => (await store.read()).openart?.client,
      saveClientInformation: (value) =>
        store.update((s) => ({ ...s, openart: { ...s.openart, client: value } })),
      tokens: async () => (await store.read()).openart?.tokens,
      saveTokens: (value) =>
        store.update((s) => ({ ...s, openart: { ...s.openart, tokens: value } })),
      redirectToAuthorization: (url) =>
        store.update((s) => ({
          ...s,
          openart: { ...s.openart, authorizationUrl: url.toString() }
        })),
      saveCodeVerifier: (value) =>
        store.update((s) => ({ ...s, openart: { ...s.openart, verifier: value } })),
      codeVerifier: async () => {
        const value = (await store.read()).openart?.verifier;
        if (!value) fail('Reconnect OpenArt.');
        return value;
      },
      invalidateCredentials: (scope) =>
        store.update((s) => ({
          ...s,
          openart:
            scope === 'all'
              ? {}
              : {
                  ...s.openart,
                  ...(scope === 'client' ? { client: undefined } : { tokens: undefined })
                }
        }))
    };
  }
  async function connect() {
    if (client) return client;
    if (connecting) return connecting;
    connecting = (async () => {
      const candidate = new Client({ name: 'roxy-kane-studio', version: '1.0.0' });
      const wire = new StreamableHTTPClientTransport(endpoint, { authProvider: await provider() });
      try {
        await candidate.connect(wire);
        client = candidate;
        return client;
      } catch (error) {
        await wire.close().catch(() => {});
        throw error;
      }
    })();
    try {
      return await connecting;
    } finally {
      connecting = null;
    }
  }
  async function close() {
    const old = client;
    client = null;
    await old?.close().catch(() => {});
  }
  return {
    close,
    async start(origin, ownerVersion) {
      await close();
      const redirectUrl = origin + '/api/assistant/oauth/openart/callback';
      await store.update((s) => ({
        ...s,
        openart: {
          redirectUrl,
          state: randomBytes(32).toString('base64url'),
          expires: Date.now() + 600000,
          ownerVersion,
          projectId: s.openart?.projectId ?? 'f6YCUHb5jQKxcO2tP6vm'
        }
      }));
      try {
        await connect();
      } catch {
        /* OAuth intentionally returns a redirect instead of a connected client. */
      }
      const url = (await store.read()).openart?.authorizationUrl;
      if (!url || new URL(url).origin !== 'https://openart.ai')
        fail('OpenArt connection could not start. Try again.', 502);
      return url;
    },
    async finish(state, code) {
      const saved = (await store.read()).openart;
      const owner = await readOwner(ownerPath);
      if (
        !saved ||
        !equalSecret(state, saved.state) ||
        saved.expires < Date.now() ||
        saved.ownerVersion !== owner?.version
      )
        fail('This OpenArt connection link expired. Start again inside the studio.', 400);
      // Consume state before exchanging the code; never permit callback replay.
      await store.update((s) => ({ ...s, openart: { ...s.openart, state: null, expires: 0 } }));
      const wire = new StreamableHTTPClientTransport(endpoint, { authProvider: await provider() });
      try {
        await wire.finishAuth(code);
      } finally {
        await wire.close().catch(() => {});
      }
      await connect();
      await store.update((s) => ({
        ...s,
        openart: { ...s.openart, verifier: null, authorizationUrl: null }
      }));
    },
    async tools() {
      return (await (await connect()).listTools()).tools;
    },
    async call(name, args) {
      const mcp = await connect();
      const catalog = (await mcp.listTools()).tools;
      const tool = catalog.find((t) => t.name === name || t.name.endsWith('_' + name));
      if (!tool) fail('This OpenArt connection does not provide ' + name + '.', 502);
      return unpack(
        await mcp.callTool({ name: tool.name, arguments: args }, undefined, { timeout: 120000 })
      );
    },
    async disconnect() {
      await close();
      await store.update((s) => ({ ...s, openart: undefined }));
    }
  };
}
