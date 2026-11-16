import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
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
      let refreshJournal, collectionRoot, schedulerDirectory;
      if (process.env.AURORE_JOBS_UI) {
        temp = await mkdtemp(join(tmpdir(), 'aurore-jobs-ui-'));
        refreshJournal = join(temp, 'journal');
        schedulerDirectory = join(temp, 'scheduler');
        await mkdir(schedulerDirectory);
        const { disabledSchedulerConfig, runSchedulerOnce } =
          await import('./collection-scheduler.mjs');
        const scheduled = {
          ...disabledSchedulerConfig(),
          enabled: true,
          law: {
            enabled: true,
            dailyAt: '03:00',
            journal: join(temp, 'scheduled-law'),
            fromDate: '20261115',
          },
          precedent: { enabled: false, dailyAt: '04:00', directories: [] },
          backup: {
            enabled: true,
            dailyAt: '02:00',
            root: join(temp, 'backup-fixture'),
          },
        };
        await writeFile(
          join(schedulerDirectory, 'config.json'),
          JSON.stringify(scheduled),
        );
        const tickDate = new Date();
        tickDate.setUTCHours(5, 0, 0, 0);
        for (let attempt = 0; attempt < 3; attempt++)
          await runSchedulerOnce(schedulerDirectory, {
            now: () => new Date(tickDate.valueOf() + attempt * 61 * 60000),
            runLaw: async () => {
              throw new Error('PRIVATE_SCHEDULER_CANARY');
            },
            runBackup: async () => ({
              processed: 1,
              hasBacklog: false,
              retentionRemoved: 2,
            }),
          });

        collectionRoot = join(temp, 'collections');
        const { resumePrecedentCollection } =
          await import('./resume-precedent-collection.mjs');
        await resumePrecedentCollection(join(collectionRoot, 'sample'), {
          queue: [
            { ID: '11', caseNumber: '2026다11' },
            { ID: '22', caseNumber: '2026다22' },
          ],
          limit: 1,
          readSource: async (item) => ({
            bytes: Buffer.from(
              JSON.stringify({
                PrecService: {
                  판례정보일련번호: item.ID,
                  사건번호: item.caseNumber,
                  사건명: '보증금 반환 검토 예제',
                  법원명: '대법원',
                  선고일자: '20260101',
                  판시사항: '임대차 종료 후 보증금 반환에 관한 가상 쟁점',
                  판결요지: '검증용 요지입니다.',
                  판례내용:
                    '가상 판례 원문입니다.<br/>검토 화면의 줄바꿈을 확인합니다.',
                  private: 'PRIVATE_COLLECTION_CANARY',
                },
              }),
            ),
          }),
        });
        await mkdir(refreshJournal);
        await writeFile(
          join(refreshJournal, 'start.json'),
          JSON.stringify({ fromDate: '20261101' }),
        );
        await writeFile(
          join(refreshJournal, '20261101.json'),
          JSON.stringify({
            status: 'staged',
            report: {
              date: '20261101',
              candidates: [],
              prepared: { editions: [] },
              corrections: [],
            },
          }),
        );
        await writeFile(
          join(refreshJournal, '20261102.failed-' + randomUUID() + '.json'),
          JSON.stringify({
            status: 'failed',
            date: '20261102',
            attemptedAt: new Date().toISOString(),
            code: 'PREVIEW_FAILED',
            message: 'PRIVATE_BATCH_CANARY',
          }),
        );
        const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
          windowsHide: true,
        });
        assert.equal(exited.status, 0);
        await writeFile(
          join(refreshJournal, 'run.lock.json'),
          JSON.stringify({
            pid: exited.pid,
            host: hostname(),
            token: randomUUID(),
            startedAt: new Date().toISOString(),
          }),
        );
      }
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(db)
        .overrideProvider(ConfigService)
        .useValue(
          new ConfigService({
            DATABASE_URL: url.href,
            ...(refreshJournal
              ? {
                  AURORE_LAW_REFRESH_JOURNAL: refreshJournal,
                  AURORE_PRECEDENT_COLLECTION_ROOT: collectionRoot,
                  AURORE_COLLECTION_SCHEDULER_DIR: schedulerDirectory,
                }
              : {}),
          }),
        )
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
      const resultCodes = [
        'EVIDENCE_FOUND',
        'SOURCE_GAP',
        'RELEVANCE_GAP',
        'DOCUMENT_GAP',
        'AI_NOT_READY',
        'FACTS_UNCONFIRMED',
        'SOURCE_CHANGED',
        'GUIDANCE',
      ];
      let successSerial = 0;
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
        const resultCode =
          status === 'SUCCEEDED'
            ? resultCodes[successSerial++ % resultCodes.length]
            : null;
        const providerCd =
          serial % 9 === 0
            ? rawProvider
            : resultCode === 'AI_NOT_READY'
              ? 'STORED_SEARCH'
              : resultCode === 'DOCUMENT_GAP'
                ? 'LOCAL_DOC'
                : resultCode
                  ? 'LOCAL_RAG'
                  : 'DEMO';
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
            resultCd: resultCode,
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
          resultCode,
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
          'CASE_CONTEXT_CHANGED',
          'AI_UNAVAILABLE',
          'AI_CONFIGURATION',
          'EVIDENCE_INVALID',
          'SOURCE_UNAVAILABLE',
          'AI_UPSTREAM_FAILURE',
        ];
      for (let n = 0; n < 55; n++)
        await fixture(
          statuses[n % 7],
          errors[n % errors.length],
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
        'resultCode',
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
            assert.ok(
              [
                'DEMO',
                'OTHER',
                'LOCAL_DOC',
                'LOCAL_RAG',
                'STORED_SEARCH',
              ].includes(row.provider),
            );
            assert.ok(
              row.errorCode === null ||
                [
                  'GENERATION_FAILED',
                  'TOTAL_TIMEOUT',
                  'ATTEMPTS_EXHAUSTED',
                  'OTHER',
                  'CASE_CONTEXT_CHANGED',
                  'AI_UNAVAILABLE',
                  'AI_CONFIGURATION',
                  'EVIDENCE_INVALID',
                  'SOURCE_UNAVAILABLE',
                  'AI_UPSTREAM_FAILURE',
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
      for (const result of ['NONE', ...resultCodes]) {
        const page = await read({ status: 'all', result, limit: '50' });
        assert.equal(
          page.total,
          visible.filter((row) =>
            result === 'NONE'
              ? row.resultCode === null
              : row.resultCode === result,
          ).length,
        );
        assert.ok(
          page.items.every(
            (row) => row.resultCode === (result === 'NONE' ? null : result),
          ),
        );
      }
      const allResults = await read({ status: 'all', limit: '50' });
      assert.equal(allResults.counts.needsEvidence, 3);
      assert.equal(allResults.counts.aiNotReady, 1);
      assert.equal(
        allResults.counts.evidenceInvalid,
        visible.filter((row) => row.errorCode === 'EVIDENCE_INVALID').length,
      );
      assert.equal(
        (await read({ status: 'FAILED', result: 'AI_NOT_READY' })).total,
        0,
      );

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
          'caseContext',
          'documentLinks',
          'factIds',
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
        'result=PRIVATE_RESULT',
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
        if (!temp) temp = await mkdtemp(join(tmpdir(), 'aurore-jobs-ui-'));
        const uiToken = (await auth.login('jobs_admin', 'Synthetic8!')).token;
        const refresh = await fetch(base + '/admin/legal-refresh', {
          headers: { Authorization: 'Bearer ' + uiToken },
        });
        assert.equal(refresh.status, 200);
        const refreshData = await refresh.json();
        assert.equal(refreshData.execution.status, 'RECOVERY_REQUIRED');
        assert.equal(
          refreshData.history.find((row) => row.status === 'FAILED').errorCode,
          'PREVIEW_FAILED',
        );
        assert.ok(
          !JSON.stringify(refreshData).includes('PRIVATE_BATCH_CANARY'),
        );
        assert.ok(!JSON.stringify(refreshData).includes('run.lock'));
        const privacyResponse = await fetch(base + '/admin/privacy-retention', {
          headers: { Authorization: 'Bearer ' + uiToken },
        });
        assert.equal(privacyResponse.status, 200);
        const privacyData = await privacyResponse.json();
        assert.equal(privacyData.contentAccess, false);
        assert.equal(privacyData.purgeImplemented, false);
        assert.ok(!JSON.stringify(privacyData).includes('PRIVATE_'));
        assert.ok(!JSON.stringify(privacyData).includes(temp));
        assert.ok(!JSON.stringify(privacyData).includes('jobs_admin'));
        const scheduleResponse = await fetch(
          base + '/admin/collection-schedule',
          { headers: { Authorization: 'Bearer ' + uiToken } },
        );
        assert.equal(scheduleResponse.status, 200);
        const scheduleData = await scheduleResponse.json();
        assert.equal(scheduleData.jobs[0].attempts, 3);
        assert.equal(scheduleData.jobs[0].code, 'RUN_FAILED');
        assert.equal(scheduleData.jobs[2].kind, 'backup');
        assert.equal(scheduleData.jobs[2].status, 'SUCCEEDED');
        assert.equal(scheduleData.jobs[2].retentionRemoved, 2);
        assert.ok(
          !JSON.stringify(scheduleData).includes('PRIVATE_SCHEDULER_CANARY'),
        );
        assert.ok(!JSON.stringify(scheduleData).includes(temp));
        const listResponse = await fetch(
          base + '/admin/precedent-collections',
          { headers: { Authorization: 'Bearer ' + uiToken } },
        );
        assert.equal(listResponse.status, 200);
        const collectionList = await listResponse.json();
        assert.equal(collectionList.items[0].collected, 1);
        const sourceResponse = await fetch(
          base +
            '/admin/precedent-collections/' +
            collectionList.items[0].id +
            '/items/11',
          { headers: { Authorization: 'Bearer ' + uiToken } },
        );
        assert.equal(sourceResponse.status, 200);
        const sourceData = await sourceResponse.json();
        assert.equal(sourceData.status, 'NEW');
        assert.ok(
          !JSON.stringify(sourceData).includes('PRIVATE_COLLECTION_CANARY'),
        );
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
