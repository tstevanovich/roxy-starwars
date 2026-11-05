import { defineConfig } from 'vitest/config';

import { vitestVSCodeCompatibility } from '../shared/vitest-vscode-compat.ts';

export default defineConfig({
  plugins: [vitestVSCodeCompatibility()],
  test: {
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    include: ['src/**/*.test.ts'],
    hookTimeout: 180000,
    testTimeout: 30000,
    sequence: { hooks: 'list' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportOnFailure: true,
      thresholds: { 100: true, perFile: true }
    }
  }
});
