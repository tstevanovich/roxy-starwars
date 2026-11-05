import type { Plugin } from 'vite';

/** Vitest extension 1.52.2 still publishes the pre-5.0 cache opt-out flag. */
export function vitestVSCodeCompatibility(): Plugin {
  return {
    name: 'studio:vitest-vscode-compatibility',
    configResolved(config) {
      const extension = config.plugins.find((plugin) => plugin.name === 'vitest:vscode-extension');
      const api = extension?.api as
        | {
            vitest?: {
              ignoreFsModuleCache?: boolean;
              experimental?: { ignoreFsModuleCache?: boolean };
            };
          }
        | undefined;
      if (api?.vitest?.experimental?.ignoreFsModuleCache === true)
        api.vitest.ignoreFsModuleCache = true;
    }
  };
}
