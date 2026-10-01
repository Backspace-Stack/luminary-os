import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['backend/src/memory/providers/SqliteMemoryProvider.ts'],
    // Native better-sqlite3 is deliberately loaded through CommonJS;
    // the local structural interface types its small synchronous API.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['frontend/src/**/*.tsx', 'frontend/src/**/*.ts'],
    plugins: { 'react-hooks': hooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
);
