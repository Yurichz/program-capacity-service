import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';

const options = { overrideConfig: { rules: { '@typescript-eslint/no-unused-vars': 'off' } } };
const checker = new ESLint(options);
const fixer = new ESLint({ ...options, fix: true });
const filePath = 'src/code-style-probe.ts';

async function checkSpacing(broken, expected, rule) {
  const [invalid] = await checker.lintText(broken, { filePath });

  assert.ok(invalid.messages.some((message) => message.ruleId === rule), `Missing ${rule} for:\n${broken}`);

  const [clean] = await checker.lintText(expected, { filePath });
  const [fixed] = await fixer.lintText(broken, { filePath });
  const [unchanged] = await fixer.lintText(expected, { filePath });

  assert.deepEqual(clean.messages, [], expected);
  assert.equal(fixed.errorCount, 0);
  assert.equal(fixed.output, expected);
  assert.equal(unchanged.output, undefined, 'Style fixes must be idempotent');
}

test('style groups const/let declarations, including exports, without reordering them', async () => {
  for (const prefix of ['', 'export ']) {
    await checkSpacing(
      `${prefix}const first = 1;\n\n${prefix}let second = first + 1;\nuse(second++);\n`,
      `${prefix}const first = 1;\n${prefix}let second = first + 1;\n\nuse(second++);\n`,
      '@stylistic/padding-line-between-statements',
    );
  }
});

const blocks = [
  'if (flag) {\n  run();\n}',
  'for (let index = 0; index < 2; index++) {\n  run(index);\n}',
  'for (const value of values) {\n  run(value);\n}',
  'for (const key in values) {\n  run(key);\n}',
  'while (flag) {\n  run();\n}',
  'do {\n  run();\n} while (flag);',
  'switch (flag) {\n  case true:\n    run();\n    break;\n}',
  'try {\n  run();\n} finally {\n  cleanup();\n}',
];

test('style separates declaration groups from operations, controls and return', async () => {
  for (const operation of ['run(value);', ...blocks, 'return value;']) {
    await checkSpacing(
      `export function probe() {\n  const value = 1;\n${operation.split('\n').map((line) => '  ' + line).join('\n')}\n}\n`,
      `export function probe() {\n  const value = 1;\n\n${operation.split('\n').map((line) => '  ' + line).join('\n')}\n}\n`,
      '@stylistic/padding-line-between-statements',
    );
  }
});

test('style separates complete control statements from the next statement', async () => {
  for (const block of blocks) {
    for (const next of ['next();', 'const value = 1;', 'if (other) {\n  next();\n}']) {
      await checkSpacing(`${block}\n${next}\n`, `${block}\n\n${next}\n`, '@stylistic/padding-line-between-statements');
    }
  }
});

test('style keeps else, else if, catch and finally attached to the preceding brace', async () => {
  const continuations = [
    'if (flag) {\n  run();\n} else {\n  next();\n}',
    'if (flag) {\n  run();\n} else if (other) {\n  next();\n}',
    'try {\n  run();\n} catch {\n  next();\n}',
    'try {\n  run();\n} finally {\n  next();\n}',
    'try {\n  run();\n} catch {\n  next();\n} finally {\n  cleanup();\n}',
  ];

  for (const continuation of continuations) {
    await checkSpacing(
      continuation.replace(/\} (?=else|catch|finally)/gu, '}\n\n') + '\n',
      continuation + '\n',
      '@stylistic/brace-style',
    );
  }
});

test('style removes blank lines before the do...while tail and preserves comments', async () => {
  for (const separator of ['\n', '\n// Keep this comment.\n']) {
    await checkSpacing(
      `do {\n  run();\n}\n${separator}\nwhile (flag);\n`,
      `do {\n  run();\n}${separator}while (flag);\n`,
      'layout/do-while-spacing',
    );
  }

  const [sameLine] = await checker.lintText('do {\n  run();\n} while (flag);\n', { filePath });

  assert.deepEqual(sameLine.messages, []);
});

test('style forbids blank lines at block edges while retaining spacing between class members', async () => {
  const sources = [
    'export function probe() {\n  run();\n}\n',
    'export class Probe {\n  first = 1;\n\n  second = 2;\n}\n',
    'switch (flag) {\n  case true:\n    run();\n    break;\n}\n',
  ];

  for (const source of sources) {
    await checkSpacing(source.replace('{\n', '{\n\n').replace('\n}', '\n\n}'), source, '@stylistic/padded-blocks');
  }

  const [onlyReturn] = await checker.lintText('export function probe() {\n  return 1;\n}\n', { filePath });

  assert.deepEqual(onlyReturn.messages, []);
});

test('style indents nested blocks and switch cases by two spaces per level', async () => {
  await checkSpacing(
    'if (flag) {\nrun();\n}\n',
    'if (flag) {\n  run();\n}\n',
    '@stylistic/indent',
  );
  await checkSpacing(
    'switch (flag) {\ncase true:\nrun();\nbreak;\n}\n',
    'switch (flag) {\n  case true:\n    run();\n    break;\n}\n',
    '@stylistic/indent',
  );
});
