/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard', 'stylelint-config-recess-order'],
  overrides: [
    {
      files: ['**/*.scss'],
      extends: ['stylelint-config-standard-scss']
    }
  ],
  ignoreFiles: [
    '.data/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/*.min.{css,scss}'
  ]
};
