import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Build output and coverage are machine-generated — never lint them.
  { ignores: ['dist/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // `any` defeats the purpose of the TypeScript migration — ban it outright.
      '@typescript-eslint/no-explicit-any': 'error',
      // Prefer explicit error handling over non-null assertions.
      '@typescript-eslint/no-non-null-assertion': 'error',
      // Allow unused vars prefixed with _ (common in catch blocks / signatures).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
