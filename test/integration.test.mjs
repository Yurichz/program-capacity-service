import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const database = process.env.TEST_DATABASE_URL;
test('production HTTP contracts, Auth/Users and real transactions', async (t) => {
  assert.ok(database, 'Run npm run test:core to provision an isolated TEST_DATABASE_URL');
  const url = new URL(database);
  assert.ok(
    decodeURIComponent(url.pathname).slice(1).startsWith('app_test_'),
    'Only a dedicated app_test_* database may be used',
  );
  process.env.DATABASE_URL = database;
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = randomUUID() + randomUUID();
  process.env.JWT_REFRESH_SECRET = randomUUID() + randomUUID();
  const { Controller, Get, HttpCode, Module, StreamableFile } = await import('@nestjs/common');
  const { createApplication } = await import('../dist/core/app/create-application.js');
  const { AppModule } = await import('../dist/core/app/app.module.js');
  const { SkipAuth } = await import('../dist/guards/skip-auth.guard.js');
  const { Serialize } = await import('../dist/decorators/serialize.decorator.js');
  const { UserEntity } = await import('../dist/core/routes/user/entities/user.entity.js');
  const { ApiResult } = await import('../dist/interfaces/api-result.js');
  const { PrismaService } = await import('../dist/core/providers/prisma/prisma.service.js');
  const { UserRepository } =
    await import('../dist/core/routes/user/layers/user-da/user.repository.js');
  const { SessionRepository } =
    await import('../dist/core/routes/auth/layers/auth-da/session.repository.js');
  const meta = { total: 1, lastPage: 1, currentPage: 1, perPage: 10, prev: null, next: null };
  class Probe {
    falsy() {
      return false;
    }
    zero() {
      return 0;
    }
    empty() {
      return '';
    }
    nil() {
      return null;
    }
    missing() {
      return undefined;
    }
    domain() {
      return { data: false };
    }
    publicData() {
      return new ApiResult(
        [
          {
            id: 1,
            email: 'public@test.dev',
            firstName: null,
            lastName: null,
            roles: ['USER'],
            passwordHash: 'must-not-leak',
          },
        ],
        meta,
      );
    }
    noContent() {
      return { ignored: true };
    }
    file() {
      return new StreamableFile(Buffer.from('file-content'), { type: 'text/plain' });
    }
    crash() {
      throw new Error('private-stack-and-secret');
    }
  }
  Controller('probe')(Probe);
  SkipAuth()(Probe);
  for (const name of Object.getOwnPropertyNames(Probe.prototype).filter((x) => x !== 'constructor'))
    Get(name)(Probe.prototype, name, Object.getOwnPropertyDescriptor(Probe.prototype, name));
  Serialize(UserEntity)(
    Probe.prototype,
    'publicData',
    Object.getOwnPropertyDescriptor(Probe.prototype, 'publicData'),
  );
  HttpCode(204)(
    Probe.prototype,
    'noContent',
    Object.getOwnPropertyDescriptor(Probe.prototype, 'noContent'),
  );
  class ProbeModule {}
  Module({ imports: [AppModule], controllers: [Probe] })(ProbeModule);
  const app = await createApplication(ProbeModule);
  app.useLogger(false);
  t.after(() => app.close());
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const prisma = app.get(PrismaService),
    users = app.get(UserRepository),
    sessions = app.get(SessionRepository);
  const request = async (path, { body, token, method = 'GET' } = {}) => {
    const response = await fetch(origin + '/api/v1/' + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      text,
      json:
        text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null,
    };
  };
  const suffix = randomUUID(),
    email = `a-${suffix}@test.dev`,
    password = 'StrongPassword123';
  let user, pair;
  await t.test('DTO 422, numeric errors, role injection and no internal fields', async () => {
    const invalid = await request('auth/sign-up', {
      method: 'POST',
      body: { email: 'bad', password: 'short', roles: ['APP_ADMIN'] },
    });
    assert.equal(invalid.status, 422);
    assert.equal(invalid.json.error.code, 422000);
    assert.ok(invalid.json.error.details.email);
    assert.ok(invalid.json.error.details.roles);
    const created = await request('auth/sign-up', {
      method: 'POST',
      body: { email: ' ' + email.toUpperCase() + ' ', password, firstName: 'First' },
    });
    assert.equal(created.status, 201);
    user = created.json.data;
    assert.equal(user.email, email);
    assert.deepEqual(user.roles, ['USER']);
    assert.deepEqual(Object.keys(user).sort(), ['email', 'firstName', 'id', 'lastName', 'roles']);
    const duplicate = await request('auth/sign-up', { method: 'POST', body: { email, password } });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.json.error.code, 409001);
    const unknown = await request('does-not-exist');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.json.success, false);
  });
  await t.test('sign-in, token purpose, profile and hashed session', async () => {
    const denied = await request('auth/sign-in', {
      method: 'POST',
      body: { email, password: 'WrongPassword123' },
    });
    assert.equal(denied.status, 401);
    assert.equal(denied.json.error.code, 401001);
    const signed = await request('auth/sign-in', { method: 'POST', body: { email, password } });
    assert.equal(signed.status, 200);
    pair = signed.json.data;
    assert.deepEqual(Object.keys(pair).sort(), ['accessToken', 'refreshToken']);
    const stored = await prisma.root.session.findFirst({ where: { userId: user.id } });
    assert.equal(stored.refreshTokenHash.length, 64);
    assert.notEqual(stored.refreshTokenHash, pair.refreshToken);
    assert.equal((await request('users/me')).status, 401);
    assert.equal((await request('users/me', { token: pair.refreshToken })).status, 401);
    assert.equal(
      (
        await request('auth/token/refresh', {
          method: 'POST',
          body: { refreshToken: pair.accessToken },
        })
      ).status,
      401,
    );
    const me = await request('users/me', { token: pair.accessToken });
    assert.equal(me.status, 200);
    assert.equal(me.json.data.id, user.id);
    assert.ok(!me.text.includes('password'));
    const patched = await request('users/me', {
      method: 'PATCH',
      token: pair.accessToken,
      body: { firstName: null, lastName: 'Changed' },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.data.firstName, null);
    assert.equal(
      (
        await request('users/me', {
          method: 'PATCH',
          token: pair.accessToken,
          body: { roles: ['APP_ADMIN'] },
        })
      ).status,
      422,
    );
    await prisma.root.user.update({ where: { id: user.id }, data: { roles: [] } });
    assert.equal((await request('users/me', { token: pair.accessToken })).status, 403);
    await prisma.root.user.update({ where: { id: user.id }, data: { roles: ['USER'] } });
  });
  await t.test('refresh is single-use under race, logout revokes access/refresh', async () => {
    const refreshed = await request('auth/token/refresh', {
      method: 'POST',
      body: { refreshToken: pair.refreshToken },
    });
    assert.equal(refreshed.status, 200);
    assert.equal(
      (
        await request('auth/token/refresh', {
          method: 'POST',
          body: { refreshToken: pair.refreshToken },
        })
      ).status,
      401,
    );
    pair = refreshed.json.data;
    const race = await Promise.all(
      [0, 1].map(() =>
        request('auth/token/refresh', {
          method: 'POST',
          body: { refreshToken: pair.refreshToken },
        }),
      ),
    );
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 401]);
    pair = race.find((r) => r.status === 200).json.data;
    const out = await request('auth/logout', { method: 'POST', token: pair.accessToken });
    assert.equal(out.status, 204);
    assert.equal(out.text, '');
    assert.equal((await request('users/me', { token: pair.accessToken })).status, 401);
    assert.equal(
      (
        await request('auth/token/refresh', {
          method: 'POST',
          body: { refreshToken: pair.refreshToken },
        })
      ).status,
      401,
    );
  });
  await t.test('falsy, explicit pagination, public entity, 204, stream and safe 500', async () => {
    for (const [name, value] of [
      ['falsy', false],
      ['zero', 0],
      ['empty', ''],
      ['nil', null],
      ['missing', null],
      ['domain', { data: false }],
    ]) {
      const result = await request('probe/' + name);
      assert.equal(result.status, 200);
      assert.deepEqual(result.json, { success: true, data: value });
    }
    const response = await request('probe/publicData');
    assert.deepEqual(response.json.meta, meta);
    assert.ok(!response.text.includes('passwordHash'));
    assert.equal(response.json.data[0].id, 1);
    const empty = await request('probe/noContent');
    assert.equal(empty.status, 204);
    assert.equal(empty.text, '');
    const file = await request('probe/file');
    assert.equal(file.text, 'file-content');
    const crash = await request('probe/crash');
    assert.equal(crash.status, 500);
    assert.equal(crash.json.error.code, 500000);
    assert.ok(!crash.text.includes('private-stack'));
    assert.equal((await fetch(origin + '/docs-json')).status, 401);
    const docsPair = await request('auth/sign-in', { method: 'POST', body: { email, password } });
    const swagger = await fetch(origin + '/docs-json', {
      headers: { authorization: 'Bearer ' + docsPair.json.data.accessToken },
    }).then((r) => r.json());
    assert.ok(swagger.paths['/api/v1/auth/sign-in']);
  });
  await t.test('ambient rollback, nested reuse and commit use the same real client', async () => {
    const failed = `rollback-${suffix}@test.dev`;
    await assert.rejects(
      prisma.$tx(async (tx) => {
        assert.equal(prisma.client, tx);
        const created = await users.createAccount({ email: failed, passwordHash: 'test-only' });
        await prisma.$txe(async (inner) => {
          assert.equal(inner, tx);
          await sessions.createSession({
            id: randomUUID(),
            userId: created.id,
            refreshTokenHash: 'x',
            expiresAt: new Date(Date.now() + 10000),
          });
        });
        throw new Error('force rollback');
      }),
      /force rollback/,
    );
    assert.equal(await prisma.root.user.findUnique({ where: { email: failed } }), null);
    await prisma.$tx(async () => {
      await assert.rejects(
        prisma.$tx(async () => {}),
        /Nested/,
      );
    });
  });
  await t.test(
    'explicit-client view works outside ambient context without mutating singleton',
    async () => {
      const email = `explicit-${suffix}@test.dev`;
      await assert.rejects(
        prisma.root.$transaction(async (client) => {
          assert.equal(prisma.currentTransaction, undefined);
          const view = users.tx(client);
          assert.equal(view.$, client.user);
          assert.notEqual(users.$, client.user);
          await view.createAccount({ email, passwordHash: 'test-only' });
          assert.ok(await view.findCredentials(email));
          throw new Error('explicit rollback');
        }),
        /explicit rollback/,
      );
      assert.equal(await users.findCredentials(email), null);
    },
  );
  await t.test('concurrent transactions remain isolated', async () => {
    const emails = [`parallel-ok-${suffix}@test.dev`, `parallel-fail-${suffix}@test.dev`];
    const result = await Promise.allSettled(
      emails.map((email, index) =>
        prisma.$tx(async () => {
          const client = prisma.client;
          await users.createAccount({ email, passwordHash: 'test-only' });
          await new Promise((resolve) => setTimeout(resolve, 15));
          assert.equal(prisma.client, client);
          if (index) throw new Error('isolated failure');
        }),
      ),
    );
    assert.deepEqual(
      result.map((x) => x.status),
      ['fulfilled', 'rejected'],
    );
    assert.ok(await users.findCredentials(emails[0]));
    assert.equal(await users.findCredentials(emails[1]), null);
  });
});
