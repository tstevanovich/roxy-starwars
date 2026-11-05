import type { Plugin, ResolvedConfig } from 'vite';
import { expect, test } from 'vitest';

import { vitestVSCodeCompatibility } from './vitest-vscode-compat.ts';

test.each([
  { api: { vitest: { experimental: { ignoreFsModuleCache: true } } }, expected: true },
  { api: { vitest: { experimental: { ignoreFsModuleCache: false } } }, expected: undefined },
  { api: { vitest: { ignoreFsModuleCache: true } }, expected: true },
  { api: { vitest: {} }, expected: undefined },
  { api: {}, expected: undefined },
  { api: undefined, expected: undefined }
])('normalizes only the extension legacy opt-out: $api', async ({ api, expected }) => {
  const plugin = vitestVSCodeCompatibility();
  const config = {
    plugins: [{ name: 'vitest:vscode-extension', api }]
  } as unknown as ResolvedConfig;
  const hook = plugin.configResolved as (config: ResolvedConfig) => void;
  await hook(config);
  expect(api?.vitest?.ignoreFsModuleCache).toBe(expected);
});

test('leaves unrelated plugins and configurations without the extension alone', async () => {
  const other: Plugin = {
    name: 'other',
    api: { vitest: { experimental: { ignoreFsModuleCache: true } } }
  };
  const hook = vitestVSCodeCompatibility().configResolved as (config: ResolvedConfig) => void;
  hook({ plugins: [other] } as unknown as ResolvedConfig);
  expect(other.api.vitest.ignoreFsModuleCache).toBeUndefined();
  hook({ plugins: [] } as unknown as ResolvedConfig);
});
