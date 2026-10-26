import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../dist/helpers/paginate.js';
import { ApiResult } from '../dist/interfaces/api-result.js';
import { validateEnvironment } from '../dist/config/environment.config.js';

test('pagination uses consistent bounds and explicit result', async () => {
  const result = await paginate(
    async (skip, take) => {
      assert.equal(skip, 10);
      assert.equal(take, 10);
      return [{ id: 11 }];
    },
    async () => 21,
    2,
    10,
  );
  assert.ok(result instanceof ApiResult);
  assert.deepEqual(result.meta, {
    total: 21,
    lastPage: 3,
    currentPage: 2,
    perPage: 10,
    prev: 1,
    next: 3,
  });
  const empty = await paginate(
    async () => [],
    async () => 0,
  );
  assert.deepEqual(empty.meta, {
    total: 0,
    lastPage: 1,
    currentPage: 1,
    perPage: 10,
    prev: null,
    next: null,
  });
  await assert.rejects(
    paginate(
      async () => [],
      async () => 0,
      0,
      10,
    ),
    RangeError,
  );
  await assert.rejects(
    paginate(
      async () => [],
      async () => 0,
      1,
      101,
    ),
    RangeError,
  );
});

test('configuration fails without valid distinct secrets and has typed defaults', () => {
  assert.throws(() => validateEnvironment({}), /Invalid environment/);
  const env = {
    DATABASE_URL: 'postgresql://local/db',
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
  };
  assert.equal(validateEnvironment({ ...env, PORT: '3001' }).PORT, 3001);
  assert.equal(validateEnvironment(env).ACCESS_TOKEN_TTL_SECONDS, 900);
  assert.throws(
    () => validateEnvironment({ ...env, JWT_REFRESH_SECRET: env.JWT_ACCESS_SECRET }),
    /differ/,
  );
  assert.throws(() => validateEnvironment({ ...env, PORT: 'no' }), /PORT/);
});
