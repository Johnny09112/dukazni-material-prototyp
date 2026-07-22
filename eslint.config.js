import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    ignores: ['node_modules/**', 'dist/**', 'logs/**', 'content/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
  {
    // UI vrstva běží v prohlížeči (Vite) — browser globals jen tady.
    files: ['src/ui/**/*.js', 'src/main.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Blob: 'readonly',
        HTMLElement: 'readonly',
      },
    },
  },
  {
    // ADR-002: engine je deterministický — žádná náhoda ani hodiny mimo seedované RNG.
    files: ['src/engine/**/*.js'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'V enginu je Math.random zakázán (ADR-002) — použij seedované RNG z rng.js.' },
        { object: 'Date', property: 'now', message: 'V enginu je Date.now zakázán (ADR-002) — engine nezná hodiny.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'V enginu jsou hodiny zakázané (ADR-002).' },
        { name: 'fetch', message: 'Engine nezná síť (ADR-002).' },
        { name: 'window', message: 'Engine nezná DOM (ADR-002).' },
        { name: 'document', message: 'Engine nezná DOM (ADR-002).' },
      ],
    },
  },
];
