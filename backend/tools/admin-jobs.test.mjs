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
} catch {}
test(
  'admin AI job metadata enforces visibility, safe diagnostics, date filters, stable paging and read-only access',
  {
    skip: !development,
    timeout: process.env.AURORE_JOBS_UI ? 600000 : 60000,
  },
  async () => {
    require('reflect-metadata');
    const { ConfigService } = require('@nestjs/config'),
      { Test } = require('@nestjs/testing'),
      { ValidationPipe } = require('@nestjs/common');
    const { AppModule } = await import('../dist/app.module.js'),
      { PrismaService } = await import('../dist/prisma/prisma.service.js'),
      { AuthService } = await import('../dist/auth/auth.service.js'),
      { ChatService } = await import('../dist/chat/chat.service.js');
    const name = 'aurore_jobs_test_' + randomBytes(6).toString('hex'),
      url = new URL(development.href);
    url.pathname = '/' + name;
    const run = (command, args, options = {}) => {
      const result = spawnSync(command, args, {
        encoding: 'utf8',
        windowsHide: true,
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
      // Freeze only this disposable fixture's worker so queued/running examples remain stable during read-only verification.
      await app.get(ChatService).onModuleDestroy();
      const base = await app.getUrl(),
        auth = app.get(AuthService);
      await auth.signup('jobs_admin', '운영검증', 'Synthetic8!');
      await auth.signup('jobs_user', '회원검증', 'Synthetic8!');
      const token = (await auth.login('jobs_admin', 'Synthetic8!')).token,
        normal = (await auth.login('jobs_user', 'Synthetic8!')).token,
        userId = BigInt((await auth.session(normal, false)).id),
        adminId = BigInt((await auth.session(token, false)).id);
      const guest = (await auth.createGuest()).token,
        guestId = (await auth.resolveOwner('Guest ' + guest)).guestSessId;
      const get = (query = '', credential = 'Bearer ' + token) =>
        fetch(base + '/admin/ai-jobs' + query, {
          headers: credential ? { Authorization: credential } : {},
        });
      assert.equal((await get('', null)).status, 401);
      assert.equal((await get('', 'Bearer ' + normal)).status, 403);
      assert.equal((await get('', 'Guest ' + guest)).status, 401);
      assert.equal((await get()).status, 403);
      const role = await db.cmmnCd.findFirstOrThrow({
          where: { cd: 'ADMIN', parent: { cd: 'USER_ROLE' } },
        }),
        grant = await db.userRole.create({
          data: { userId: adminId, roleCdId: role.id },
        });
      assert.equal((await (await get()).json()).total, 0);
      const canary = 'PRIVATE_CHAT_BODY_NEVER_EXPOSE',
        rawError = 'PRIVATE_ERR_DO_NOT_EXPOSE',
        rawProvider = 'PRIVATE_PROVIDER',
        records = [];
      let serial = 0;
      async function fixture(status, errorCode, time, hidden = null) {
        const chatId = randomUUID(),
          inputId = randomUUID(),
          answerId = status === 'SUCCEEDED' ? randomUUID() : null,
          id =
            (++serial).toString(16).padStart(8, '0') +
            '-0000-4000-8000-000000000000';
        const now = Date.now(),
          deadline =
            serial === 4 || status === 'SUCCEEDED'
              ? new Date(now - 60000)
              : new Date(now + 3600000),
          lease =
            status === 'RUNNING'
              ? new Date(now + (serial === 5 ? -60000 : 60000))
              : null;
        await db.chatSess.create({
          data: {
            id: chatId,
            ...(hidden === 'expired'
              ? { guestSessId: guestId, exprDttm: new Date(now - 60000) }
              : { userId }),
            sessNm: canary,
            nextMsgSeq: answerId ? 3 : 2,
            ...(hidden === 'deleted'
              ? { delYn: true, delDttm: new Date() }
              : {}),
            messages: {
              create: [
                {
                  id: inputId,
                  msgSeq: 1,
                  roleCd: 'USER',
                  msgCont: canary,
                  ...(hidden === 'input'
                    ? { delYn: true, delDttm: new Date() }
                    : {}),
                },
                ...(answerId
                  ? [
                      {
                        id: answerId,
                        prntMsgId: inputId,
                        msgSeq: 2,
                        roleCd: 'ASSISTANT',
                        msgCont: canary,
                      },
                    ]
                  : []),
              ],
            },
          },
        });
        const providerCd = serial % 9 === 0 ? rawProvider : 'DEMO';
        await db.aiJob.create({
          data: {
            id,
            chatSessId: chatId,
            inputMsgId: inputId,
            answerMsgId: answerId,
            requestHash: 'a'.repeat(64),
            ownerAuthHash: randomBytes(32),
            phaseCd: 'start',
            statCd: status,
            providerCd,
            errorCd: errorCode,
            attemptNo: status === 'FAILED' ? 3 : status === 'QUEUED' ? 0 : 1,
            leaseToken: lease ? randomUUID() : null,
            leaseDttm: lease,
            deadlineDttm: deadline,
            nextRunDttm: new Date(now + 30000),
            rgstDttm: new Date(time.getTime() - 1000),
            uptDttm: time,
          },
        });
        const row = {
          id,
          status,
          errorCode,
          providerCd,
          chatId,
          inputId,
          hidden,
        };
        records.push(row);
        return row;
      }
      const statuses = [
          'FAILED',
          'FAILED',
          'RETRY_WAIT',
          'QUEUED',
          'RUNNING',
          'SUCCEEDED',
          'CANCELLED',
        ],
        errors = [
          'GENERATION_FAILED',
          'TOTAL_TIMEOUT',
          'ATTEMPTS_EXHAUSTED',
          null,
          rawError,
        ];
      for (let n = 0; n < 55; n++)
        await fixture(
          statuses[n % 7],
          errors[n % 5],
          new Date(
            Date.parse('2026-11-13T00:00:00+09:00') + Math.floor(n / 3) * 1000,
          ),
        );
      for (const value of [
        '2026-11-12T14:59:59Z',
        '2026-11-12T15:00:00Z',
        '2026-11-13T14:59:59Z',
        '2026-11-13T15:00:00Z',
      ])
        await fixture('FAILED', 'TOTAL_TIMEOUT', new Date(value));
      for (const hidden of ['deleted', 'expired', 'input'])
        await fixture('FAILED', 'GENERATION_FAILED', new Date(), hidden);
      const visible = records.filter((row) => !row.hidden),
        failed = visible.filter((row) => row.status === 'FAILED').length;
      const read = async (params) => {
        const response = await get('?' + new URLSearchParams(params));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        return response.json();
      };
      const before = await db.aiJob.findMany({ orderBy: { id: 'asc' } });
      assert.equal((await read({})).total, failed);
      const keys = [
        'attempts',
        'createdAt',
        'errorCode',
        'id',
        'provider',
        'status',
        'updatedAt',
      ];
      for (const limit of [10, 20, 50]) {
        let offset = 0,
          previous = Infinity;
        const seen = new Set();
        do {
          const page = await read({
            status: 'all',
            limit: String(limit),
            offset: String(offset),
          });
          assert.equal(page.total, 59);
          assert.equal(page.items.length, Math.min(limit, 59 - offset));
          for (const row of page.items) {
            assert.equal(seen.has(row.id), false);
            seen.add(row.id);
            assert.deepEqual(Object.keys(row).sort(), keys);
            assert.ok(Date.parse(row.updatedAt) <= previous);
            previous = Date.parse(row.updatedAt);
            assert.ok(['DEMO', 'OTHER'].includes(row.provider));
            assert.ok(
              row.errorCode === null ||
                [
                  'GENERATION_FAILED',
                  'TOTAL_TIMEOUT',
                  'ATTEMPTS_EXHAUSTED',
                  'OTHER',
                ].includes(row.errorCode),
            );
            assert.ok(!JSON.stringify(row).includes(canary));
            assert.ok(!JSON.stringify(row).includes(rawError));
            assert.ok(!JSON.stringify(row).includes(rawProvider));
          }
          offset = page.nextOffset;
        } while (offset !== null);
        assert.equal(seen.size, 59);
      }
      for (const status of statuses) {
        const page = await read({ status, limit: '50' });
        assert.equal(
          page.total,
          visible.filter((row) => row.status === status).length,
        );
        assert.ok(page.items.every((row) => row.status === status));
      }
      for (const error of errors) {
        const key = error === rawError ? 'OTHER' : (error ?? 'NONE');
        const page = await read({ status: 'all', error: key, limit: '50' });
        assert.equal(
          page.total,
          visible.filter((row) => row.errorCode === error).length,
        );
      }
      assert.equal(
        (await read({ status: 'all', from: '2026-11-13', to: '2026-11-13' }))
          .total,
        57,
      );
      assert.equal(
        (await read({ status: 'all', from: '2026-11-14', to: '2026-11-14' }))
          .total,
        1,
      );
      assert.equal((await read({ status: 'all', to: '2026-11-12' })).total, 1);
      const selected = visible[14];
      assert.equal(
        (
          await read({
            status: 'all',
            q: selected.id.slice(0, 8).toUpperCase(),
          })
        ).total,
        1,
      );
      assert.equal((await read({ status: 'all', q: 'ffffffff' })).total, 0);
      assert.equal(
        (await read({ status: 'all', offset: '100000' })).items.length,
        0,
      );
      for (const row of visible) {
        const response = await get('/' + row.id);
        assert.equal(response.status, 200);
        const detail = await response.json();
        assert.deepEqual(
          Object.keys(detail).sort(),
          [
            ...keys,
            'deadlineAt',
            'deadlineExceeded',
            'leaseExpired',
            'leaseExpiresAt',
            'nextAttemptAt',
          ].sort(),
        );
        assert.equal(
          detail.errorCode,
          row.errorCode === rawError ? 'OTHER' : row.errorCode,
        );
        assert.equal(detail.leaseExpiresAt !== null, row.status === 'RUNNING');
        assert.equal(
          detail.nextAttemptAt !== null,
          ['QUEUED', 'RETRY_WAIT'].includes(row.status),
        );
        if (row.status === 'SUCCEEDED')
          assert.equal(detail.deadlineExceeded, false);
        if (row.id === visible[3].id)
          assert.equal(detail.deadlineExceeded, true);
        if (row.id === visible[4].id) assert.equal(detail.leaseExpired, true);
        for (const secret of [
          canary,
          rawError,
          rawProvider,
          'chatSessId',
          'inputMsgId',
          'answerMsgId',
          'ownerAuthHash',
          'leaseToken',
          'requestHash',
        ])
          assert.equal(JSON.stringify(detail).includes(secret), false);
      }
      for (const row of records.filter((row) => row.hidden))
        assert.equal((await get('/' + row.id)).status, 404);
      assert.equal((await get('/' + visible[0].id, null)).status, 401);
      assert.equal(
        (await get('/' + visible[0].id, 'Bearer ' + normal)).status,
        403,
      );
      assert.equal((await get('/invalid')).status, 400);
      assert.equal((await get('/' + randomUUID())).status, 404);
      for (const query of [
        'status=bad',
        'error=bad',
        'q=%25',
        'q=bad_text',
        'q=' + 'a'.repeat(37),
        'limit=21',
        'offset=-1',
        'offset=100001',
        'from=2026-02-30',
        'from=2026-11-14&to=2026-11-13',
        'extra=1',
      ])
        assert.equal((await get('?' + query)).status, 400, query);
      const overview = await (
        await fetch(base + '/admin/overview', {
          headers: { Authorization: 'Bearer ' + token },
        })
      ).json();
      assert.equal(
        overview.jobs.find((row) => row.status === 'FAILED').count,
        failed,
      );
      assert.equal(JSON.stringify(overview).includes(rawError), false);
      assert.equal(JSON.stringify(overview).includes(rawProvider), false);
      assert.deepEqual(
        await db.aiJob.findMany({ orderBy: { id: 'asc' } }),
        before,
      );
      await db.userRole.update({
        where: { id: grant.id },
        data: { delYn: true, delDttm: new Date() },
      });
      assert.equal((await get()).status, 403);
      assert.equal((await get('/' + visible[0].id)).status, 403);
      await db.userRole.create({
        data: { userId: adminId, roleCdId: role.id },
      });
      await auth.logoutAll(token);
      assert.equal((await get()).status, 401);
      assert.equal((await get('/' + visible[0].id)).status, 401);
      if (process.env.AURORE_JOBS_UI) {
        temp = await mkdtemp(join(tmpdir(), 'aurore-jobs-ui-'));
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
        assert.ok(ready);
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
      if (created && /^aurore_jobs_test_[0-9a-f]{12}$/.test(name))
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
