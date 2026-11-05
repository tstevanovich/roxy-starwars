import { beforeEach, expect, test, vi } from 'vitest';

import { readOwner } from '../owner.ts';
import { createOpenArt, unpack } from './openart.ts';

const sdk = vi.hoisted(() => ({
  wires: [],
  connect: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  finishAuth: vi.fn(async (_code: string) => {}),
  wireClose: vi.fn(async () => {}),
  listTools: vi.fn(async () => ({ tools: [{ name: 'openart_render' }, { name: 'exact' }] })),
  callTool: vi.fn(async () => ({ structuredContent: { id: 'result' } }))
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function () {
    return sdk;
  })
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(function (endpoint, options) {
    const wire = { endpoint, ...options, close: sdk.wireClose, finishAuth: sdk.finishAuth };
    sdk.wires.push(wire);
    return wire;
  })
}));
vi.mock('../owner.ts', async (original) => ({
  ...(await original<typeof import('../owner.ts')>()),
  readOwner: vi.fn()
}));
function setup(value = {}) {
  let saved = value;
  const store = {
    read: vi.fn(async () => saved),
    update: vi.fn(async (change) => {
      saved = await change(saved);
      return saved;
    })
  };
  return { api: createOpenArt(store), store, saved: () => saved };
}
beforeEach(() => {
  sdk.wires.length = 0;
  for (const fn of [sdk.connect, sdk.close, sdk.finishAuth, sdk.wireClose])
    fn.mockReset().mockResolvedValue(undefined);
  sdk.listTools.mockClear();
  sdk.callTool.mockClear();
  vi.mocked(readOwner).mockResolvedValue({ version: 'owner' });
});

test('concurrent tool requests share one connection and resolve exact or namespaced names', async () => {
  let finish: () => void;
  sdk.connect.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const { api } = setup();
  const first = api.tools(),
    second = api.tools();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  finish();
  expect(await first).toEqual(await second);
  expect(sdk.connect).toHaveBeenCalledOnce();
  expect(await api.call('render', { prompt: 'Reviewed prompt' })).toEqual({ id: 'result' });
  expect(sdk.callTool).toHaveBeenLastCalledWith(
    { name: 'openart_render', arguments: { prompt: 'Reviewed prompt' } },
    undefined,
    { timeout: 120000 }
  );
  await api.call('exact', {});
  await expect(api.call('missing', {})).rejects.toThrow('does not provide missing');
  sdk.close.mockRejectedValueOnce(new Error('Already closed'));
  await api.disconnect();
  await api.close();
  expect(sdk.close).toHaveBeenCalledOnce();
});

test('OAuth provider persists registration, token and proof data and invalidates only the requested scope', async () => {
  const { api, saved } = setup({
    openart: { redirectUrl: 'https://studio.test/callback', state: 'saved-state' }
  });
  await api.tools();
  const provider = sdk.wires[0].authProvider;
  expect(provider.redirectUrl).toBe('https://studio.test/callback');
  expect(provider.clientMetadata).toMatchObject({
    redirect_uris: ['https://studio.test/callback'],
    scope: 'full_access'
  });
  expect(provider.state()).toBe('saved-state');
  expect(await provider.clientInformation()).toBeUndefined();
  expect(await provider.tokens()).toBeUndefined();
  await expect(provider.codeVerifier()).rejects.toThrow('Reconnect OpenArt');
  await provider.saveClientInformation({ client_id: 'fixture-client' });
  await provider.saveTokens({ access_token: 'fixture-token' });
  await provider.saveCodeVerifier('fixture-proof');
  await provider.redirectToAuthorization(new URL('https://openart.ai/authorize'));
  expect(await provider.clientInformation()).toEqual({ client_id: 'fixture-client' });
  expect(await provider.tokens()).toEqual({ access_token: 'fixture-token' });
  expect(await provider.codeVerifier()).toBe('fixture-proof');
  expect(saved()).toMatchObject({ openart: { authorizationUrl: 'https://openart.ai/authorize' } });
  await provider.invalidateCredentials('client');
  expect(await provider.clientInformation()).toBeUndefined();
  expect(await provider.tokens()).toEqual({ access_token: 'fixture-token' });
  await provider.invalidateCredentials('tokens');
  expect(await provider.tokens()).toBeUndefined();
  await provider.invalidateCredentials('all');
  expect(saved()).toEqual({ openart: {} });
  await api.disconnect();
  expect(saved()).toEqual({ openart: undefined });
});

test.each([undefined, 'existing-project'])(
  'starting OAuth preserves a configured project or supplies its default: %s',
  async (projectId) => {
    const { api, saved } = setup(projectId ? { openart: { projectId } } : {});
    sdk.connect.mockImplementationOnce(async () => {
      await sdk.wires[0].authProvider.redirectToAuthorization(
        new URL('https://openart.ai/authorize?state=provider')
      );
      throw new Error('Authorization required');
    });
    sdk.wireClose.mockRejectedValueOnce(new Error('Closed during redirect'));
    expect(await api.start('https://studio.test', 'owner')).toBe(
      'https://openart.ai/authorize?state=provider'
    );
    expect(saved()).toMatchObject({
      openart: { projectId: projectId ?? 'f6YCUHb5jQKxcO2tP6vm', ownerVersion: 'owner' }
    });
  }
);

test.each([undefined, 'https://foreign.test/authorize'])(
  'OAuth needs a trusted authorization destination: %s',
  async (authorizationUrl) => {
    const { api } = setup();
    sdk.connect.mockImplementationOnce(async () => {
      if (authorizationUrl)
        await sdk.wires[0].authProvider.redirectToAuthorization(new URL(authorizationUrl));
    });
    await expect(api.start('https://studio.test', 'owner')).rejects.toThrow('could not start');
  }
);

const connection = () => ({
  state: 'state',
  expires: Date.now() + 10000,
  ownerVersion: 'owner',
  verifier: 'proof'
});
test.each([
  { label: 'missing state', data: {} },
  { label: 'wrong state', data: { openart: { ...connection(), state: 'other' } } },
  { label: 'expired state', data: { openart: { ...connection(), expires: 0 } } },
  { label: 'changed owner', data: { openart: { ...connection(), ownerVersion: 'old-owner' } } }
])('OAuth callback rejects $label before code exchange', async ({ data }) => {
  const { api } = setup(data);
  await expect(api.finish('state', 'code')).rejects.toThrow('link expired');
  expect(sdk.finishAuth).not.toHaveBeenCalled();
});

test('OAuth consumes state before code exchange, clears temporary data and rejects replay or a missing owner', async () => {
  const { api, saved } = setup({ openart: connection() });
  sdk.finishAuth.mockImplementationOnce(async () => {
    expect(saved()).toMatchObject({ openart: { state: null, expires: 0 } });
  });
  sdk.wireClose.mockRejectedValueOnce(new Error('Already closed'));
  await api.finish('state', 'code');
  expect(sdk.finishAuth).toHaveBeenCalledWith('code');
  expect(saved()).toMatchObject({ openart: { verifier: null, authorizationUrl: null } });
  await expect(api.finish('state', 'code')).rejects.toThrow('link expired');
  vi.mocked(readOwner).mockResolvedValueOnce(null);
  await expect(setup({ openart: connection() }).api.finish('state', 'code')).rejects.toThrow(
    'link expired'
  );
});

test('a rejected code still consumes state and closes its transport', async () => {
  const { api, saved } = setup({ openart: connection() });
  sdk.finishAuth.mockRejectedValueOnce(new Error('Code rejected'));
  await expect(api.finish('state', 'code')).rejects.toThrow('Code rejected');
  expect(sdk.wireClose).toHaveBeenCalledOnce();
  expect(saved()).toMatchObject({ openart: { state: null } });
});

test('provider replies accept structured content, skip unreadable blocks and retain rejection details', () => {
  expect(
    unpack({
      content: [
        { type: 'image' },
        { type: 'text', text: 'bad' },
        { type: 'text', text: '{"id":1}' }
      ]
    })
  ).toEqual({ id: 1 });
  expect(() => unpack({})).toThrow('unreadable response');
  expect(() => unpack({ isError: true })).toThrow('Provider error');
  expect(() =>
    unpack({ isError: true, content: [{ type: 'text', text: 'plain failure' }] })
  ).toThrow('plain failure');
  for (const details of [{ errorDisplayCode: 'DISPLAY' }, { failedCode: 'FAILED' }, {}]) {
    const failure = { status: 'FAILED', historyId: 'submit-failed', ...details };
    expect(() => unpack({ isError: true, structuredContent: failure })).toThrow(/No render ID/);
    expect(() =>
      unpack({ isError: true, content: [{ type: 'text', text: JSON.stringify(failure) }] })
    ).toThrow(/No render ID/);
  }
});
