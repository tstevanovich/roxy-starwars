import { defineConfig } from 'vitest/config';

import { vitestVSCodeCompatibility } from './vitest-vscode-compat.ts';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [vitestVSCodeCompatibility()],
  test: {
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['**/*.ts'],
      exclude: ['**/*.test.ts', 'vitest.config.ts'],
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportOnFailure: true,
      thresholds: { 100: true, perFile: true }
    }
  }
});
