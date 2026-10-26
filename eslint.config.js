import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['src/generated/**', 'dist/**'] },
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-explicit-any': 'error' } },
);
