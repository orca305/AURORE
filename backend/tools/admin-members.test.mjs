import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
let development;
try {
  development = new URL(process.env.DATABASE_URL);
  if (
    development.hostname !== '127.0.0.1' ||
    development.port !== '5433' ||
    development.pathname !== '/aurore_dev_check'
  )
    development = null;
} catch {
  /* The integration check requires the explicitly named local development database. */
}

test(
  'admin members preserve masked search, transactional status changes, session revocation, history and live roles',
  {
    skip: !development,
    timeout: process.env.AURORE_MEMBERS_UI ? 600000 : 60000,
  },
  async () => {
    require('reflect-metadata');
    const { ConfigService } = require('@nestjs/config');
    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { AppModule } = await import('../dist/app.module.js');
    const { PrismaService } = await import('../dist/prisma/prisma.service.js');
    const { AuthService } = await import('../dist/auth/auth.service.js');
    const name = 'aurore_members_test_' + randomBytes(6).toString('hex');
    const url = new URL(development.href);
    url.pathname = '/' + name;
    const run = (command, args, options = {}) => {
      const result = spawnSync(command, args, {
        windowsHide: true,
        encoding: 'utf8',
        ...options,
      });
      assert.equal(result.status, 0, result.stderr);
    };
    let created = false,
      db,
      app,
      web,
      temp;
    try {
      run('docker', [
        'exec',
        'aurore-dev-check-postgres',
        'createdb',
        '-U',
        'aurore_dev_check',
        name,
      ]);
      created = true;
      run(
        process.execPath,
        [
          'node_modules/prisma/build/index.js',
          'migrate',
          'deploy',
          '--config',
          'prisma7.config.ts',
        ],
        { env: { ...process.env, DATABASE_URL: url.href } },
      );
      db = new PrismaService(new ConfigService({ DATABASE_URL: url.href }));
      await db.$connect();
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(db)
        .overrideProvider(ConfigService)
        .useValue(new ConfigService({ DATABASE_URL: url.href }))
        .compile();
      app = module.createNestApplication({ logger: false });
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl(),
        auth = app.get(AuthService);
      await auth.signup('members_adm', '운영검증', 'Synthetic8!');
      await auth.signup('members_user', '일반검증', 'Synthetic8!');
      let token = (await auth.login('members_adm', 'Synthetic8!')).token;
      const normal = (await auth.login('members_user', 'Synthetic8!')).token;
      const userId = BigInt((await auth.session(token, false)).id);
      const get = (query = '', credential = 'Bearer ' + token) =>
        fetch(base + '/admin/members' + query, {
          headers: credential ? { Authorization: credential } : {},
        });
      assert.equal((await get('', null)).status, 401);
      assert.equal((await get('', 'Bearer ' + normal)).status, 403);
      assert.equal(
        (await get('', 'Guest ' + (await auth.createGuest()).token)).status,
        401,
      );
      assert.equal((await get()).status, 403);
      const role = await db.cmmnCd.findFirstOrThrow({
        where: { cd: 'ADMIN', parent: { cd: 'USER_ROLE' } },
      });
      const grant = await db.userRole.create({
        data: { userId, roleCdId: role.id },
      });
      const statuses = await db.cmmnCd.findMany({
        where: { parent: { cd: 'USER_STAT' } },
      });
      const statusId = (code) => statuses.find((row) => row.cd === code).id;
      await db.appUser.createMany({
        data: Array.from({ length: 55 }, (_, i) => ({
          loginId: 'roster_' + String(i).padStart(3, '0'),
          nickNm: '검증회원' + i,
          statCdId: statusId(i % 2 ? 'BLOCKED' : 'ACTIVE'),
          rgstDttm: new Date('2026-01-01'),
        })),
      });
      await db.appUser.createMany({
        data: [
          {
            loginId: 'rosterx999',
            nickNm: '구분검증',
            statCdId: statusId('ACTIVE'),
          },
          {
            loginId: 'deleted_user',
            nickNm: '삭제검증',
            statCdId: statusId('ACTIVE'),
            delYn: true,
            delDttm: new Date(),
          },
          {
            loginId: 'withdrawn',
            nickNm: '탈퇴검증',
            statCdId: statusId('WITHDRAWN'),
          },
        ],
      });
      const before = await db.appUser.findMany({ orderBy: { id: 'asc' } });
      const response = await get();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const data = await response.json();
      assert.equal(data.total, 58);
      assert.equal(data.items.length, 20);
      assert.equal(data.nextOffset, 20);
      assert.deepEqual(data.counts, { members: 58, active: 31, blocked: 27 });
      for (const size of [10, 20, 50]) {
        const seen = new Set();
        let offset = 0;
        do {
          const page = await (
            await get('?limit=' + size + '&offset=' + offset)
          ).json();
          assert.equal(page.limit, size);
          assert.equal(page.offset, offset);
          assert.equal(page.total, 58);
          assert.equal(page.items.length, Math.min(size, 58 - offset));
          for (const row of page.items) {
            assert.equal(seen.has(row.id), false);
            seen.add(row.id);
            assert.deepEqual(Object.keys(row).sort(), [
              'id',
              'joinedAt',
              'loginIdMasked',
              'nicknameMasked',
              'status',
            ]);
            assert.ok(row.loginIdMasked.includes('*'));
            assert.ok(row.nicknameMasked.includes('*'));
            assert.ok(['ACTIVE', 'BLOCKED'].includes(row.status));
          }
          offset = page.nextOffset;
        } while (offset !== null);
        assert.equal(seen.size, 58);
      }
      const search = async (q) =>
        await (await get('?' + new URLSearchParams({ q }))).json();
      assert.equal((await search('  ROSTER_005  ')).total, 1);
      assert.equal((await search('검증회원54')).total, 1);
      assert.equal((await search('roster_')).total, 55);
      for (const q of [
        '%',
        '_999',
        String.fromCharCode(92),
        '없는회원',
        'deleted_user',
        'withdrawn',
        "' OR 1=1 --",
      ])
        assert.equal((await search(q)).total, 0);
      const raw = JSON.stringify(data);
      assert.equal(raw.includes('roster_'), false);
      assert.equal(raw.includes('검증회원'), false);
      assert.equal(raw.includes('pwHash'), false);
      const active = await (await get('?status=ACTIVE&limit=50')).json();
      assert.equal(active.total, 31);
      assert.ok(active.items.every((row) => row.status === 'ACTIVE'));
      const blocked = await (await get('?status=BLOCKED&limit=50')).json();
      assert.equal(blocked.total, 27);
      assert.ok(blocked.items.every((row) => row.status === 'BLOCKED'));
      assert.equal(
        (await (await get('?status=BLOCKED&q=roster_004')).json()).total,
        0,
      );
      const end = await (await get('?offset=100000')).json();
      assert.equal(end.items.length, 0);
      assert.equal(end.nextOffset, null);
      for (const bad of [
        'limit=21',
        'limit=0',
        'limit=100',
        'offset=-1',
        'offset=1.5',
        'offset=100001',
        'status=WITHDRAWN',
        'status=unknown',
        'q=' + 'a'.repeat(201),
        'extra=1',
      ])
        assert.equal((await get('?' + bad)).status, 400, bad);
      assert.deepEqual(
        await db.appUser.findMany({ orderBy: { id: 'asc' } }),
        before,
      );
      // Status changes use the existing append-only status history as the revision.
      const target = await db.appUser.findUniqueOrThrow({
        where: { loginId: 'members_user' },
      });
      const detail = async (
        id = target.id.toString(),
        credential = 'Bearer ' + token,
        query = '',
      ) => {
        const response = await get('/' + id + query, credential);
        assert.equal(response.status, 200);
        return response.json();
      };
      const post = (
        body,
        id = target.id.toString(),
        credential = 'Bearer ' + token,
      ) =>
        fetch(base + '/admin/members/' + id + '/status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(credential ? { Authorization: credential } : {}),
          },
          body: JSON.stringify(body),
        });
      const inputFor = (member, status, reason = '운영 정책 검증') => ({
        requestId: randomUUID(),
        revision: member.revision,
        previousStatus: member.status,
        status,
        reason,
        confirmed: true,
      });
      const original = (await detail()).member;
      const authBefore = await db.userAuth.findUniqueOrThrow({
        where: { userId: target.id },
      });
      assert.equal(original.canChange, true);
      assert.ok(original.revision !== '0');
      assert.equal((await detail(userId.toString())).member.canChange, false);
      assert.equal((await get('/' + target.id, null)).status, 401);
      assert.equal(
        (await get('/' + target.id, 'Bearer ' + normal)).status,
        403,
      );
      const command = inputFor(original, 'BLOCKED');
      assert.equal((await post(command, undefined, null)).status, 401);
      assert.equal(
        (await post(command, undefined, 'Bearer ' + normal)).status,
        403,
      );
      const own = inputFor((await detail(userId.toString())).member, 'BLOCKED');
      assert.equal((await post(own, userId.toString())).status, 409);
      for (const patch of [
        { confirmed: false },
        { reason: '' },
        { reason: '   ' },
        { reason: 'x'.repeat(1001) },
        { reason: 'bad' + String.fromCharCode(0) },
        { revision: '-1' },
        { status: 'WITHDRAWN' },
        { extra: 1 },
      ])
        assert.equal((await post({ ...command, ...patch })).status, 400);
      assert.equal((await post({ ...command, status: 'ACTIVE' })).status, 409);
      const deleted = await db.appUser.findUniqueOrThrow({
          where: { loginId: 'deleted_user' },
        }),
        withdrawn = await db.appUser.findUniqueOrThrow({
          where: { loginId: 'withdrawn' },
        });
      for (const row of [deleted, withdrawn]) {
        assert.equal((await post(command, row.id.toString())).status, 404);
        assert.equal((await get('/' + row.id)).status, 404);
      }
      assert.equal((await get('/0')).status, 400);
      assert.equal((await get('/' + target.id + '?limit=21')).status, 400);
      await auth.login('members_user', 'Synthetic8!');
      const sessionsBefore = await db.userSess.findMany({
        where: { userId: target.id },
        orderBy: { rgstDttm: 'asc' },
      });
      const transaction = db.$transaction.bind(db);
      db.$transaction = (work, options) =>
        transaction(
          typeof work !== 'function'
            ? work
            : (tx) =>
                work(
                  new Proxy(tx, {
                    get(object, key) {
                      if (key !== 'userStatHist')
                        return Reflect.get(object, key);
                      return new Proxy(object.userStatHist, {
                        get(model, operation) {
                          if (operation === 'create')
                            return async () => {
                              throw Error('Synthetic history write failure');
                            };
                          return Reflect.get(model, operation);
                        },
                      });
                    },
                  }),
                ),
          options,
        );
      try {
        assert.equal((await post(command)).status, 500);
      } finally {
        db.$transaction = transaction;
      }
      assert.equal((await detail()).member.status, 'ACTIVE');
      assert.deepEqual(
        await db.userSess.findMany({
          where: { userId: target.id },
          orderBy: { rgstDttm: 'asc' },
        }),
        sessionsBefore,
      );
      assert.equal(
        await db.userStatHist.count({
          where: { userId: target.id, actorUserId: { not: null } },
        }),
        0,
      );
      const concurrent = await Promise.all([post(command), post(command)]);
      for (const result of concurrent) assert.equal(result.status, 200);
      const receipts = await Promise.all(
        concurrent.map((result) => result.json()),
      );
      assert.equal(receipts[0].revision, receipts[1].revision);
      const blockedDetail = await detail();
      assert.equal(blockedDetail.member.status, 'BLOCKED');
      assert.equal(blockedDetail.history.total, 1);
      assert.equal(
        await db.userSess.count({
          where: { userId: target.id, revokeDttm: null },
        }),
        0,
      );
      await assert.rejects(auth.session(normal, false), { status: 401 });
      await assert.rejects(auth.login('members_user', 'Synthetic8!'), {
        status: 401,
      });
      assert.equal(
        (await post({ ...command, reason: '다른 사유' })).status,
        409,
      );
      const release = inputFor(
        blockedDetail.member,
        'ACTIVE',
        '검증 완료 후 차단 해제',
      );
      assert.equal((await post(release)).status, 200);
      assert.equal((await detail()).member.status, 'ACTIVE');
      await assert.rejects(auth.session(normal, false), { status: 401 });
      const freshToken = (await auth.login('members_user', 'Synthetic8!'))
        .token;
      assert.equal(
        (await auth.session(freshToken, false)).id,
        target.id.toString(),
      );
      assert.equal((await post(command)).status, 200);
      assert.equal((await detail()).member.status, 'ACTIVE');
      assert.equal(
        (await post({ ...command, requestId: randomUUID() })).status,
        409,
      );
      assert.deepEqual(
        await db.userAuth.findUniqueOrThrow({ where: { userId: target.id } }),
        authBefore,
      );
      // Distinct concurrent commands for the same revision cannot both commit.
      const same = (await detail()).member;
      const race = await Promise.all([
        post(inputFor(same, 'BLOCKED', '동시 검증 A')),
        post(inputFor(same, 'BLOCKED', '동시 검증 B')),
      ]);
      assert.deepEqual(race.map((result) => result.status).sort(), [200, 409]);
      assert.equal(
        (await post(inputFor((await detail()).member, 'ACTIVE'))).status,
        200,
      );
      for (let n = 0; n < 21; n++) {
        const current = (await detail()).member;
        assert.equal(
          (
            await post(
              inputFor(
                current,
                current.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE',
                '이력 페이징 검증 ' + n,
              ),
            )
          ).status,
          200,
        );
      }
      if ((await detail()).member.status === 'BLOCKED')
        assert.equal(
          (
            await post(
              inputFor((await detail()).member, 'ACTIVE', '최종 차단 해제'),
            )
          ).status,
          200,
        );
      for (const size of [10, 20, 50]) {
        const page = await detail(undefined, undefined, '?limit=' + size);
        assert.equal(
          page.history.items.length,
          Math.min(size, page.history.total),
        );
        if (page.history.total > size) {
          const next = await detail(
            undefined,
            undefined,
            '?limit=' + size + '&offset=' + page.history.nextOffset,
          );
          assert.equal(
            page.history.items.some((a) =>
              next.history.items.some((b) => a.id === b.id),
            ),
            false,
          );
        }
        for (const row of page.history.items) {
          assert.deepEqual(Object.keys(row).sort(), [
            'changedAt',
            'id',
            'operatorMasked',
            'previousStatus',
            'reason',
            'status',
          ]);
          assert.equal(row.operatorMasked.includes('members_adm'), false);
        }
      }
      const badGroup = await db.cmmnCd.findFirstOrThrow({
        where: { cd: 'USER_AGR' },
      });
      const wrongStatus = await db.cmmnCd.create({
        data: {
          prntCdId: badGroup.id,
          cd: 'ACTIVE',
          cdNm: '다른 그룹 상태',
          nodeTypeCd: 'VALUE',
        },
      });
      const currentStatus = (
        await db.appUser.findUniqueOrThrow({ where: { id: target.id } })
      ).statCdId;
      await db.appUser.update({
        where: { id: target.id },
        data: { statCdId: wrongStatus.id },
      });
      assert.equal((await detail()).member.canChange, false);
      assert.equal(
        (await post(inputFor((await detail()).member, 'BLOCKED'))).status,
        400,
      );
      await db.appUser.update({
        where: { id: target.id },
        data: { statCdId: currentStatus },
      });
      await assert.rejects(
        db.userStatHist.create({
          data: {
            userId: target.id,
            statCdId: statusId('ACTIVE'),
            actorUserId: userId,
          },
        }),
      );
      // Two administrators trying to block each other leave one administrator active.
      await auth.signup('other_admin', '교차검증', 'Synthetic8!');
      const otherToken = (await auth.login('other_admin', 'Synthetic8!')).token;
      const otherId = BigInt((await auth.session(otherToken, false)).id);
      await db.userRole.create({
        data: { userId: otherId, roleCdId: role.id },
      });
      const first = (await detail(userId.toString(), 'Bearer ' + otherToken))
          .member,
        second = (await detail(otherId.toString())).member;
      const cross = await Promise.all([
        post(inputFor(second, 'BLOCKED', '교차 차단 A'), otherId.toString()),
        post(
          inputFor(first, 'BLOCKED', '교차 차단 B'),
          userId.toString(),
          'Bearer ' + otherToken,
        ),
      ]);
      assert.deepEqual(cross.map((result) => result.status).sort(), [200, 401]);
      if (cross[1].status === 200) {
        const blockedAdmin = (
          await detail(userId.toString(), 'Bearer ' + otherToken)
        ).member;
        assert.equal(
          (
            await post(
              inputFor(blockedAdmin, 'ACTIVE', '운영 검증 계정 복구'),
              userId.toString(),
              'Bearer ' + otherToken,
            )
          ).status,
          200,
        );
        token = (await auth.login('members_adm', 'Synthetic8!')).token;
      }
      assert.ok(
        (await db.appUser.count({
          where: {
            delYn: false,
            status: { cd: 'ACTIVE' },
            roles: { some: { delYn: false, roleCdId: role.id } },
          },
        })) >= 1,
      );
      await db.userRole.update({
        where: { id: grant.id },
        data: { delYn: true, delDttm: new Date() },
      });
      assert.equal((await get()).status, 403);
      await db.userRole.create({ data: { userId, roleCdId: role.id } });
      const overview = await (
        await fetch(base + '/admin/overview', {
          headers: { Authorization: 'Bearer ' + token },
        })
      ).json();
      assert.equal(overview.counts.members, 59);
      await auth.logoutAll(token);
      assert.equal((await get()).status, 401);
      if (process.env.AURORE_MEMBERS_UI) {
        temp = await mkdtemp(join(tmpdir(), 'aurore-members-ui-'));
        web = spawn(
          process.execPath,
          [
            'node_modules/next/dist/bin/next',
            'start',
            '--hostname',
            '127.0.0.1',
            '--port',
            '3002',
          ],
          {
            cwd: 'C:/dev/easy-law-ai/frontend',
            env: { ...process.env, BACKEND_URL: base },
            windowsHide: true,
            stdio: [
              'ignore',
              fs.openSync(join(temp, 'out'), 'w'),
              fs.openSync(join(temp, 'err'), 'w'),
            ],
          },
        );
        let ready = false;
        for (let n = 0; n < 80; n++) {
          try {
            if ((await fetch('http://127.0.0.1:3002/login')).ok) {
              ready = true;
              break;
            }
          } catch {}
          await delay(250);
        }
        assert.equal(ready, true);
        console.log(
          'UI_READY http://127.0.0.1:3002/login stop=' + join(temp, 'stop'),
        );
        const deadline = Date.now() + 8 * 60000;
        while (!fs.existsSync(join(temp, 'stop')) && Date.now() < deadline)
          await delay(300);
      }
    } finally {
      if (web) {
        web.kill();
        await new Promise((resolve) => {
          if (web.exitCode !== null) resolve();
          else web.once('exit', resolve);
        });
      }
      await app?.close();
      await db?.$disconnect();
      if (created && /^aurore_members_test_[0-9a-f]{12}$/.test(name))
        run('docker', [
          'exec',
          'aurore-dev-check-postgres',
          'dropdb',
          '--force',
          '-U',
          'aurore_dev_check',
          name,
        ]);
      if (temp) {
        assert.ok(
          fs.realpathSync(temp).startsWith(fs.realpathSync(tmpdir()) + sep),
        );
        await rm(temp, { recursive: true, force: true });
      }
    }
  },
);
