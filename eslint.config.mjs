import { eslint, defaults, tests, ignores } from '@sap/cds/eslint.config.mjs';

export default [
  eslint.recommended,
  defaults,
  tests,
  ignores,
  {
    ignores: ['app/**', 'target/**', '_out/**', 'gen/**', '.gen/**', '**/*.sqlite'],
  },
];
