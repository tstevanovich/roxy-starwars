import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import testingLibrary from 'eslint-plugin-testing-library';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error'
    }
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] }
  },
  {
    files: ['client/src/**/*.{js,jsx,ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    plugins: {
      ...reactHooks.configs.flat.recommended.plugins,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['client/**/*.{test,spec}.{js,jsx,ts,tsx}', 'client/**/__tests__/**/*.{js,jsx,ts,tsx}'],
    extends: [testingLibrary.configs['flat/react']],
    languageOptions: { globals: globals.browser }
  },
  eslintConfigPrettier
]);
