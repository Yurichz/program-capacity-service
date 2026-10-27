import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';

const image =
  'postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3';
const cluster = await new PostgreSqlContainer(image)
  .withDatabase('app_test_core')
  .withUsername('test')
  .withPassword('test')
  .start();
try {
  const url = cluster.getConnectionUri();
  if (!new URL(url).pathname.startsWith('/app_test_')) throw new Error('Unexpected test database');
  const env = { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url, LOG_LEVEL: 'silent' };
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env,
    stdio: 'inherit',
  });
  const suites = (await readdir('test'))
    .filter((file) => file.endsWith('.test.mjs'))
    .map((file) => 'test/' + file);
  execFileSync(process.execPath, ['--test', '--test-concurrency=1', ...suites], {
    env,
    stdio: 'inherit',
  });
} finally {
  await cluster.stop();
}
if (!process.argv.includes('--core'))
  execFileSync(
    process.execPath,
    ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--runInBand'],
    { stdio: 'inherit' },
  );
