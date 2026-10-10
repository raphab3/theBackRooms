import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/dist/', 'node_modules/', 'data/', '.wrangler/'] },
  js.configs.recommended,
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Regex com \x00-\x1f é usada de propósito para limpar nomes e mensagens.
      'no-control-regex': 'off',
      'no-unused-vars': ['warn', { caughtErrors: 'none' }],
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['apps/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['worker/**/*.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
];
