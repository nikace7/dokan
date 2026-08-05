import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'node_modules', 'playwright-report', 'src/lib/api/schema.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Money/date logic must stay explicit; `any` needs a written justification.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['*.js', '*.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // The app-shell service worker runs in the SW global scope.
    files: ['public/sw.js'],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
);
