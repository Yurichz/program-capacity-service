import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

const declarations = [
  'const',
  'let',
  { selector: 'ExportNamedDeclaration[declaration.type="VariableDeclaration"][declaration.kind=/^(const|let)$/]' },
];
// Stylistic's brace-style rule does not check the closing do...while keyword.
const doWhileSpacing = {
  meta: {
    type: 'layout',
    schema: [],
    fixable: 'whitespace',
    messages: { unexpectedBlankLine: 'Do not insert blank lines before while in do...while.' },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      DoWhileStatement(node) {
        if (node.body.type !== 'BlockStatement') return;

        const close = sourceCode.getLastToken(node.body);
        const keyword = sourceCode.getTokenAfter(node.body);
        const gap = sourceCode.text.slice(close.range[1], keyword.range[0]);

        if (!/\n[ \t]*\n/u.test(gap)) return;

        context.report({
          node: keyword,
          messageId: 'unexpectedBlankLine',
          fix(fixer) {
            return fixer.replaceTextRange([close.range[1], keyword.range[0]], gap.replace(/\n[ \t]*(?=\n)/gu, ''));
          },
        });
      },
    };
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/generated/**',
      '**/*.generated.*',
      'openapi.json',
      'web/test-results/**',
      'web/playwright-report/**',
      '.dev/**',
      '.vs/**',
      '.ci-artifacts/**',
      'work/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: {
      parserOptions: { experimentalDecorators: true, ecmaFeatures: { jsx: true } },
    },
    plugins: {
      '@stylistic': stylistic,
      layout: { rules: { 'do-while-spacing': doWhileSpacing } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
      '@stylistic/no-tabs': 'error',
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/member-delimiter-style': 'error',
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/comma-spacing': ['error', { before: false, after: true }],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/array-bracket-spacing': ['error', 'never'],
      '@stylistic/key-spacing': ['error', { beforeColon: false, afterColon: true }],
      '@stylistic/type-annotation-spacing': 'error',
      '@stylistic/keyword-spacing': 'error',
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/arrow-spacing': 'error',
      '@stylistic/space-before-blocks': 'error',
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      '@stylistic/padded-blocks': ['error', 'never'],
      'layout/do-while-spacing': 'error',
      '@stylistic/function-call-argument-newline': ['error', 'consistent'],
      '@stylistic/lines-between-class-members': ['error', 'always'],
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        { blankLine: 'always', prev: declarations, next: '*' },
        { blankLine: 'never', prev: declarations, next: declarations },
        { blankLine: 'always', prev: ['if', 'for', 'while', 'do', 'switch', 'try'], next: '*' },
      ],
      '@stylistic/max-len': ['error', { code: 150, tabWidth: 2 }],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0, maxBOF: 0 }],
      '@stylistic/linebreak-style': ['error', 'unix'],
      '@stylistic/eol-last': ['error', 'always'],
    },
  },
);
