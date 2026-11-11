import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
let developmentUrl;
try {
  developmentUrl = new URL(process.env.DATABASE_URL);
  if (developmentUrl.hostname !== '127.0.0.1' || developmentUrl.port !== '5433' ||
    developmentUrl.pathname !== '/aurore_dev_check') developmentUrl = null;
} catch { developmentUrl = null; }

test('account security validates API input, revokes sessions atomically, and serializes concurrent login', {
  skip: !developmentUrl && 'Run after build with --env-file=../local-dev/.env', timeout: 60000,
}, async () => {
  require('reflect-metadata');
  const { ConfigService } = require('@nestjs/config');
  const { ValidationPipe } = require('@nestjs/common');
  const { Test } = require('@nestjs/testing');
  const { PrismaService } = await import('../dist/prisma/prisma.service.js');
  const { AuthService } = await import('../dist/auth/auth.service.js');
  const { AuthController } = await import('../dist/auth/auth.controller.js');
  const name = 'aurore_auth_test_' + randomBytes(6).toString('hex');
  const url = new URL(developmentUrl.href);
  url.pathname = '/' + name;
  const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { windowsHide: true, encoding: 'utf8', ...options });
    assert.equal(result.status, 0, result.stderr);
  };
  let created = false;
  let db;
  let app;
  try {
    run('docker', ['exec', 'aurore-dev-check-postgres', 'createdb', '-U', 'aurore_dev_check', name]);
    created = true;
    run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', 'prisma7.config.ts'], {
      cwd: root, env: { ...process.env, DATABASE_URL: url.href },
    });
    db = new PrismaService(new ConfigService({ DATABASE_URL: url.href }));
    await db.$connect();
    const module = await Test.createTestingModule({
      controllers: [AuthController], providers: [AuthService, { provide: PrismaService, useValue: db }],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const auth = app.get(AuthService);
    async function request(path, token, body, method = 'POST') {
      return fetch(base + '/auth/' + path, {
        method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    }
    const password = 'Synthetic8!';
    const nextPassword = 'NewSynthetic9!';
    for (const loginId of ['secure_user', 'other_user']) {
      assert.equal((await request('signup', null, { loginId, nickname: '보안검증', password })).status, 201);
    }
    async function login(loginId = 'secure_user', value = password) {
      const response = await request('login', null, { loginId, password: value });
      assert.equal(response.status, 200);
      return (await response.json()).token;
    }
    const first = await login();
    const second = await login();
    const other = await login('other_user');
    const session = (token) => request('session', token, undefined, 'GET');
    const user = await auth.session(first, false);
    const before = await db.userAuth.findUnique({ where: { userId: BigInt(user.id) } });
    assert.equal((await request('password', null, { currentPassword: password, newPassword: nextPassword })).status, 401);
    assert.equal((await request('password', first, { currentPassword: password, newPassword: 12345678 })).status, 400);
    assert.equal((await request('password', first, { currentPassword: password, newPassword: nextPassword, userId: '2' })).status, 400);
    for (const [currentPassword, newPassword] of [
      ['WrongSecret8!', nextPassword], [password, password], [password, 'password123'], [password, 'short'],
    ]) {
      assert.equal((await request('password', first, { currentPassword, newPassword })).status, 400);
    }
    assert.equal((await session(first)).status, 200);
    assert.equal((await session(second)).status, 200);
    // A failure while revoking sessions must roll back the password update as well.
    const failingDb = new Proxy(db, { get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property);
      return work => db.$transaction(tx => work(new Proxy(tx, { get(transaction, field) {
        if (field !== 'userSess') return Reflect.get(transaction, field);
        return new Proxy(transaction.userSess, { get(sessions, operation) {
          if (operation === 'updateMany') return async () => { throw new Error('synthetic session failure'); };
          return Reflect.get(sessions, operation);
        } });
      } })));
    } });
    await assert.rejects(new AuthService(failingDb).changePassword(first, password, nextPassword), /synthetic session failure/);
    assert.deepEqual((await db.userAuth.findUnique({ where: { userId: BigInt(user.id) } })).pwHash, before.pwHash);
    assert.equal((await session(first)).status, 200);
    assert.equal((await session(second)).status, 200);
    assert.equal((await request('password', first, { currentPassword: password, newPassword: nextPassword })).status, 204);
    assert.equal((await session(first)).status, 401);
    assert.equal((await session(second)).status, 401);
    assert.equal((await session(other)).status, 200);
    assert.equal((await request('login', null, { loginId: 'secure_user', password })).status, 401);
    assert.equal((await request('password', first, { currentPassword: nextPassword, newPassword: password })).status, 401);
    const after = await db.userAuth.findUnique({ where: { userId: BigInt(user.id) } });
    assert.notDeepEqual(after.pwSalt, before.pwSalt);
    assert.notDeepEqual(after.pwHash, before.pwHash);
    const third = await login('secure_user', nextPassword);
    const fourth = await login('secure_user', nextPassword);
    assert.equal((await request('logout-all', third)).status, 204);
    assert.equal((await session(third)).status, 401);
    assert.equal((await session(fourth)).status, 401);
    assert.equal((await session(other)).status, 200);
    assert.equal((await request('logout-all', third)).status, 401);

    // A login that passed password hashing before the change must not survive the change.
    const fifth = await login('secure_user', nextPassword);
    const race = await Promise.all([
      request('login', null, { loginId: 'secure_user', password: nextPassword }),
      request('password', fifth, { currentPassword: nextPassword, newPassword: '🔑'.repeat(8) }),
    ]);
    assert.equal(race[1].status, 204);
    assert.ok([200, 401].includes(race[0].status));
    if (race[0].ok) assert.equal((await session((await race[0].json()).token)).status, 401);
    const unicode = await login('secure_user', '🔑'.repeat(8));
    assert.equal((await session(unicode)).status, 200);

    // Simulate expiry between the initial lookup and the transaction's authorization check.
    const originalSession = auth.session.bind(auth);
    auth.session = async (...args) => {
      const member = await originalSession(...args);
      await db.userSess.updateMany({ where: { userId: BigInt(member.id) }, data: {
        rgstDttm: new Date(Date.now() - 26 * 3600000), lastActDttm: new Date(Date.now() - 25 * 3600000),
      } });
      return member;
    };
    await assert.rejects(auth.logoutAll(unicode), { status: 401 });
    auth.session = originalSession;
    assert.equal((await session(other)).status, 200);

    const failures = new AuthService(db);
    for (let i = 0; i < 8; i++) {
      await assert.rejects(failures.changePassword(other, 'WrongSecret8!', nextPassword), { status: 400 });
    }
    await assert.rejects(failures.changePassword(other, password, nextPassword), { status: 429 });
    assert.equal((await session(other)).status, 200);
  } finally {
    await app?.close();
    await db?.$disconnect();
    if (created && /^aurore_auth_test_[0-9a-f]{12}$/.test(name)) {
      run('docker', ['exec', 'aurore-dev-check-postgres', 'dropdb', '--force', '-U', 'aurore_dev_check', name]);
    }
  }
});
