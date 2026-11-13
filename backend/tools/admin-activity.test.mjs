import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
const require = createRequire(import.meta.url),
  hash = (value) => createHash('sha256').update(value).digest('hex');
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
  'unified administrator activity filters and pages in SQL with Korean date boundaries, immutable evidence and redacted identities',
  {
    skip: !development,
    timeout: process.env.AURORE_ACTIVITY_UI ? 600000 : 60000,
  },
  async () => {
    require('reflect-metadata');
    const { ConfigService } = require('@nestjs/config'),
      { Test } = require('@nestjs/testing'),
      { ValidationPipe } = require('@nestjs/common');
    const { AppModule } = await import('../dist/app.module.js'),
      { PrismaService } = await import('../dist/prisma/prisma.service.js'),
      { AuthService } = await import('../dist/auth/auth.service.js');
    const name = 'aurore_activity_test_' + randomBytes(6).toString('hex'),
      url = new URL(development.href);
    url.pathname = '/' + name;
    url.searchParams.set('options', '-c statement_timeout=20000 -c timezone=America/New_York');
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
      const base = await app.getUrl(),
        auth = app.get(AuthService);
      await auth.signup('audit_admin', '운영검증', 'Synthetic8!');
      await auth.signup('audit_user', '회원검증', 'Synthetic8!');
      const token = (await auth.login('audit_admin', 'Synthetic8!')).token,
        normal = (await auth.login('audit_user', 'Synthetic8!')).token;
      const actorId = BigInt((await auth.session(token, false)).id),
        targetId = BigInt((await auth.session(normal, false)).id);
      const get = (query = '', credential = 'Bearer ' + token) =>
        fetch(base + '/admin/activity' + query, {
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
        }),
        grant = await db.userRole.create({
          data: { userId: actorId, roleCdId: role.id },
        });
      const empty = await (await get()).json();
      assert.equal(empty.total, 0);
      assert.deepEqual(empty.items, []);
      assert.equal(empty.nextOffset, null);
      const canary = 'PRIVATE_BODY_NEVER_IN_ACTIVITY';
      const law = await db.legal.create({
          data: {
            srcCd: 'MOLEG',
            srcKey: '000001',
            legalNm: '통합검증 임대차법',
          },
        }),
        version = await db.legalVer.create({
          data: {
            legalId: law.id,
            verKey: 'ACTIVITY-2026',
            enfcDt: new Date('2026-01-01'),
          },
        });
      const snapshot = async (raw) =>
        db.srcSnapshot.create({
          data: {
            srcCd: 'MOLEG',
            srcKey: '000001',
            srcUrl: 'https://www.law.go.kr/',
            contType: 'application/json',
            srcCont: canary + raw,
            contHash: hash(raw),
          },
        });
      const lawSource = await snapshot('law'),
        lawRevision = await db.legalVerRev.create({
          data: {
            legalVerId: version.id,
            srcSnapshotId: lawSource.id,
            revNo: 1,
            currentYn: true,
          },
        });
      const provision = await db.legalProvi.create({
        data: {
          legalVerRevId: lawRevision.id,
          proviTypeCd: 'ARTICLE',
          dispNo: '제1조',
          normNo: '1',
          sortSeq: 1,
          proviCont: canary,
        },
      });
      const precedent = await db.legalPrec.create({
          data: { srcCd: 'MOLEG', srcKey: '100' },
        }),
        revisions = [];
      for (let i = 0; i < 2; i++) {
        const source = await snapshot('case' + i);
        revisions.push(
          await db.legalPrecRev.create({
            data: {
              legalPrecId: precedent.id,
              srcSnapshotId: source.id,
              revNo: i + 1,
              currentYn: i === 1,
              caseNo: '2026다100',
              caseNm: '통합검증 보증금 판례',
              courtNm: '검증법원',
              decisionDt: new Date('2026-01-01'),
              decisionCont: canary,
            },
          }),
        );
      }
      const when = (i) =>
        new Date(
          Date.parse('2026-11-13T00:00:00+09:00') + Math.floor(i / 3) * 1000,
        );
      const correction = async (i, time, failed) =>
        db.legalCorrHist.create({
          data: {
            id: randomUUID(),
            reviewKey: hash('review' + i),
            userId: actorId,
            legalVerId: version.id,
            beforeHash: hash('before' + i),
            afterHash: hash('after' + i),
            statCd: failed ? 'FAILED' : 'SUCCEEDED',
            resultCd: failed ? 'SOURCE_VERIFY_FAILED' : 'APPLIED',
            revNo: failed ? null : 1,
            affectedCnt: failed ? 0 : 2,
            rgstDttm: time,
            endDttm: time,
          },
        });
      for (let i = 0; i < 18; i++) await correction(i, when(i), i % 3 === 0);
      for (let i = 0; i < 16; i++) {
        const prior = await db.legalPrecProvi.create({
          data: {
            legalPrecRevId: revisions[0].id,
            refKey: '제' + i + '조',
            statCd: 'UNVERIFIED',
            evidenceDesc: canary,
            delYn: true,
            delDttm: when(i),
          },
        });
        const next = await db.legalPrecProvi.create({
          data: {
            legalPrecRevId: revisions[1].id,
            refKey: '제' + i + '조',
            statCd: i % 2 ? 'UNVERIFIED' : 'VERIFIED',
            legalProviId: i % 2 ? null : provision.id,
            evidenceDesc: canary,
          },
        });
        await db.legalPrecReviewHist.create({
          data: {
            id: randomUUID(),
            requestHash: hash('prec' + i),
            userId: actorId,
            priorRefId: prior.id,
            nextRefId: next.id,
            decision: i % 2 ? 'UNVERIFIED' : 'VERIFIED',
            reason: '통합검증 연결 검토 ' + i,
            rgstDttm: when(i),
          },
        });
      }
      const codes = await db.cmmnCd.findMany({
          where: { parent: { cd: 'USER_STAT' } },
        }),
        statusId = (code) => codes.find((row) => row.cd === code).id;
      for (let i = 0; i < 18; i++)
        await db.userStatHist.create({
          data: {
            userId: targetId,
            actorUserId: actorId,
            prevStatCdId: statusId(i % 2 ? 'BLOCKED' : 'ACTIVE'),
            statCdId: statusId(i % 2 ? 'ACTIVE' : 'BLOCKED'),
            requestId: randomUUID(),
            requestHash: hash('member' + i),
            reason: '통합검증 회원 처리 ' + i,
            rgstDttm: when(i),
          },
        });
      for (const [i, value] of [
        '2026-11-12T14:59:59Z',
        '2026-11-12T15:00:00Z',
        '2026-11-13T14:59:59Z',
        '2026-11-13T15:00:00Z',
      ].entries())
        await correction('boundary' + i, new Date(value), true);
      const read = async (params) => {
        const response = await get('?' + new URLSearchParams(params));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        return response.json();
      };
      const counts = async () => ({
        law: await db.legalCorrHist.count(),
        precedent: await db.legalPrecReviewHist.count(),
        member: await db.userStatHist.count(),
      });
      assert.equal(
        (await db.$queryRaw`SELECT current_setting('TimeZone') AS zone`)[0]
          .zone,
        'UTC',
      );
      assert.equal((await db.$queryRaw`SELECT current_setting('statement_timeout') AS value`)[0].value,'20s');
      const before = await counts();
      for (const limit of [10, 20, 50]) {
        const seen = new Set();
        let offset = 0,
          previousTime = Infinity;
        do {
          const page = await read({
            limit: String(limit),
            offset: String(offset),
          });
          assert.equal(page.total, 56);
          assert.deepEqual(page.counts, { succeeded: 46, failed: 10 });
          assert.equal(page.items.length, Math.min(limit, 56 - offset));
          for (const row of page.items) {
            const time = Date.parse(row.occurredAt);
            assert.ok(time <= previousTime);
            previousTime = time;
            assert.equal(seen.has(row.id), false);
            seen.add(row.id);
            assert.deepEqual(Object.keys(row).sort(), [
              'action',
              'href',
              'id',
              'kind',
              'occurredAt',
              'operatorMasked',
              'reason',
              'result',
              'subject',
            ]);
            assert.equal(row.operatorMasked.includes('audit_admin'), false);
            assert.ok(!JSON.stringify(row).includes(canary));
            assert.ok(!JSON.stringify(row).includes('audit_user'));
          }
          offset = page.nextOffset;
        } while (offset !== null);
        assert.equal(seen.size, 56);
      }
      for (const [kind, total] of [
        ['LAW_CORRECTION', 22],
        ['PRECEDENT_REVIEW', 16],
        ['MEMBER_STATUS', 18],
      ]) {
        const page = await read({ kind, limit: '50' });
        assert.equal(page.total, total);
        assert.ok(page.items.every((row) => row.kind === kind));
      }
      const completed = await read({
        kind: 'PRECEDENT_REVIEW',
        result: 'SUCCEEDED',
        limit: '50',
      });
      assert.equal(completed.counts.failed, 0);
      assert.equal(
        completed.items.filter((row) => row.action === 'UNVERIFIED').length,
        8,
      );
      assert.equal((await read({ result: 'FAILED' })).total, 10);
      assert.equal(
        (await read({ from: '2026-11-13', to: '2026-11-13', limit: '50' }))
          .total,
        54,
      );
      const boundaryPage = await read({ from: '2026-11-14', to: '2026-11-14' });
      assert.equal(boundaryPage.total, 1);
      assert.equal((await read({ to: '2026-11-12' })).total, 1);
      assert.equal(
        (await read({ kind: 'MEMBER_STATUS', q: '  회원 처리 17  ' })).total,
        1,
      );
      assert.equal((await read({ q: '통합검증' })).total, 56);
      for (const q of [
        '%',
        '_',
        String.fromCharCode(92),
        "' OR 1=1 --",
        canary,
        'audit_admin',
        'audit_user',
      ])
        assert.equal((await read({ q })).total, 0);
      assert.equal(
        (await read({ from: '9999-12-31', to: '9999-12-31' })).total,
        0,
      );
      assert.equal(
        (await read({ from: '0001-01-01', to: '0001-01-01' })).total,
        0,
      );
      const missing = await read({ q: '없는 작업' });
      assert.equal(missing.total, 0);
      assert.deepEqual(missing.counts, { succeeded: 0, failed: 0 });
      assert.equal(missing.nextOffset, null);
      assert.equal((await read({ offset: '100000' })).items.length, 0);
      for (const query of [
        'limit=21',
        'offset=-1',
        'offset=100001',
        'kind=bad',
        'result=bad',
        'from=2026-02-30',
        'to=2026-13-01',
        'from=0000-01-01',
        'from=2026-11-14&to=2026-11-13',
        'q=' + 'a'.repeat(201),
        'extra=1',
      ])
        assert.equal((await get('?' + query)).status, 400, query);
      // DST in the database session must not shift Korea's inclusive end date.
      await correction('dst1', new Date('2026-03-08T14:30:00Z'), true);
      await correction('dst2', new Date('2026-03-08T15:00:00Z'), true);
      assert.equal(
        (await read({ from: '2026-03-08', to: '2026-03-08' })).total,
        1,
      );
      await db.appUser.update({
        where: { id: targetId },
        data: { delYn: true, delDttm: new Date() },
      });
      const hidden = await read({ kind: 'MEMBER_STATUS', limit: '50' });
      assert.equal(hidden.total, 18);
      assert.ok(
        hidden.items.every(
          (row) => row.subject === '탈퇴한 회원' && row.href === null,
        ),
      );
      await db.appUser.update({
        where: { id: targetId },
        data: { delYn: false, delDttm: null },
      });
      await db.legal.update({
        where: { id: law.id },
        data: { delYn: true, delDttm: new Date() },
      });
      assert.ok(
        (await read({ kind: 'LAW_CORRECTION', limit: '50' })).items.every(
          (row) => row.subject === '삭제된 법령' && row.href === null,
        ),
      );
      await db.legal.update({
        where: { id: law.id },
        data: { delYn: false, delDttm: null },
      });
      await db.legalPrec.update({
        where: { id: precedent.id },
        data: { delYn: true, delDttm: new Date() },
      });
      assert.ok(
        (await read({ kind: 'PRECEDENT_REVIEW', limit: '50' })).items.every(
          (row) => row.subject === '삭제된 판례' && row.href === null,
        ),
      );
      await db.legalPrec.update({
        where: { id: precedent.id },
        data: { delYn: false, delDttm: null },
      });
      const after = await counts();
      assert.deepEqual(after, { ...before, law: before.law + 2 });
      await db.userRole.update({
        where: { id: grant.id },
        data: { delYn: true, delDttm: new Date() },
      });
      assert.equal((await get()).status, 403);
      await db.userRole.create({
        data: { userId: actorId, roleCdId: role.id },
      });
      await auth.logoutAll(token);
      assert.equal((await get()).status, 401);
      if (process.env.AURORE_ACTIVITY_UI) {
        temp = await mkdtemp(join(tmpdir(), 'aurore-activity-ui-'));
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
      if (created && /^aurore_activity_test_[0-9a-f]{12}$/.test(name))
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
