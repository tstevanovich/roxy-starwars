import { mergeConfig } from 'vite';
import { defineConfig } from 'vitest/config';

import { vitestVSCodeCompatibility } from '../shared/vitest-vscode-compat.ts';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    plugins: [vitestVSCodeCompatibility()],
    test: {
      environment: 'jsdom',
      maxWorkers: 2,
      testTimeout: 10000,
      setupFiles: ['./src/test/setup.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
        reporter: ['text', 'json', 'json-summary', 'html'],
        reportOnFailure: true,
        thresholds: { 100: true, perFile: true }
      }
    }
  })
);
