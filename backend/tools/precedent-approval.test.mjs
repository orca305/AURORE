import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { resumePrecedentCollection } from './resume-precedent-collection.mjs';
import {
  parsePrecedent,
  importPrecedent,
} from './import-precedent-samples.mjs';
const require = createRequire(import.meta.url);
let development;
try {
  development = new URL(process.env.DATABASE_URL);
  if (
    development.host !== '127.0.0.1:5433' ||
    development.pathname !== '/aurore_dev_check'
  )
    development = null;
} catch {}
test(
  'precedent approval rechecks source, current revision and role, rolls back failed receipts and replays requests exactly once',
  {
    skip: !development,
    timeout: process.env.AURORE_PRECEDENT_UI ? 600000 : 90000,
  },
  async () => {
    require('reflect-metadata');
    const { ConfigService } = require('@nestjs/config'),
      { Test } = require('@nestjs/testing'),
      { ValidationPipe } = require('@nestjs/common'),
      { Client } = require('pg');
    const { AppModule } = await import('../dist/app.module.js'),
      { PrismaService } = await import('../dist/prisma/prisma.service.js'),
      { AuthService } = await import('../dist/auth/auth.service.js'),
      { ChatService } = await import('../dist/chat/chat.service.js');
    const name = 'aurore_prec_test_' + randomBytes(6).toString('hex'),
      url = new URL(development.href);
    url.pathname = '/' + name;
    const run = (cmd, args, options = {}) => {
      const result = spawnSync(cmd, args, {
        encoding: 'utf8',
        windowsHide: true,
        ...options,
      });
      assert.equal(result.status, 0, result.stderr);
    };
    const originalFetch = globalThis.fetch;
    let created = false,
      db,
      sql,
      app,
      directory,
      web;
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
      directory = await mkdtemp(join(tmpdir(), 'aurore-prec-approval-'));
      const journal = join(directory, 'batch');
      const queue = ['11', '22', '33'].map((ID) => ({
        ID,
        caseNumber: '2026다' + ID,
      }));
      const payload = (item, text = '검토 원문') =>
        Buffer.from(
          JSON.stringify({
            PrecService: {
              판례정보일련번호: item.ID,
              사건번호: item.caseNumber,
              사건명: '판례 승인 검증',
              법원명: '대법원',
              선고일자: '20260101',
              판시사항: '합성 검증 쟁점',
              판례내용: text + '<br/>둘째 줄',
            },
          }),
        );
      const sources = new Map(queue.map((item) => [item.ID, payload(item)]));
      await resumePrecedentCollection(journal, {
        queue,
        readSource: async (item) => ({ bytes: sources.get(item.ID) }),
      });
      db = new PrismaService(new ConfigService({ DATABASE_URL: url.href }));
      await db.$connect();
      sql = new Client({ connectionString: url.href });
      await sql.connect();
      const config = new ConfigService({
        DATABASE_URL: url.href,
        MOLEG_OC: 'SYNTHETIC_OC_FOR_TEST',
        AURORE_PRECEDENT_COLLECTION_ROOT: directory,
        AURORE_LAW_REFRESH_JOURNAL: join(directory, 'law'),
      });
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(db)
        .overrideProvider(ConfigService)
        .useValue(config)
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
      await app.get(ChatService).onModuleDestroy();
      const base = await app.getUrl(),
        auth = app.get(AuthService);
      await auth.signup('prec_admin', '승인검증', 'Synthetic8!');
      await auth.signup('prec_member', '일반검증', 'Synthetic8!');
      const token = (await auth.login('prec_admin', 'Synthetic8!')).token,
        normal = (await auth.login('prec_member', 'Synthetic8!')).token,
        userId = BigInt((await auth.session(token, false)).id);
      const role = await db.cmmnCd.findFirst({
        where: { cd: 'ADMIN', parent: { cd: 'USER_ROLE' } },
      });
      const grant = await db.userRole.create({
        data: { userId, roleCdId: role.id },
      });
      const get = (path) =>
        originalFetch(base + '/admin/' + path, {
          headers: { Authorization: 'Bearer ' + token },
        });
      const batch = (await (await get('precedent-collections')).json()).items[0]
        .id;
      const review = async (ID) =>
        await (
          await get('precedent-collections/' + batch + '/items/' + ID)
        ).json();
      let calls = 0,
        onOfficial = async () => {};
      globalThis.fetch = async (input, init) => {
        const u = new URL(
          typeof input === 'string' || input instanceof URL ? input : input.url,
        );
        if (u.hostname === 'www.law.go.kr') {
          calls++;
          await onOfficial();
          return new Response(sources.get(u.searchParams.get('ID')), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return originalFetch(input, init);
      };
      const post = (ID, body, credential = token) =>
        originalFetch(
          base +
            '/admin/precedent-collections/' +
            batch +
            '/items/' +
            ID +
            '/approve',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(credential ? { Authorization: 'Bearer ' + credential } : {}),
            },
            body: JSON.stringify(body),
          },
        );
      const input = (row) => ({
        requestId: randomUUID(),
        beforeHash: row.beforeHash,
        afterHash: row.afterHash,
        confirmed: true,
      });
      const first = await review('11');
      assert.equal(first.beforeHash, null);
      assert.equal(first.status, 'NEW');
      assert.equal((await post('11', input(first), null)).status, 401);
      assert.equal((await post('11', input(first), normal)).status, 403);
      assert.equal(
        (await post('11', { ...input(first), confirmed: false })).status,
        400,
      );
      assert.equal(
        (
          await post('11', {
            requestId: randomUUID(),
            afterHash: first.afterHash,
            confirmed: true,
          })
        ).status,
        400,
      );
      sources.set('11', payload(queue[0], '새 공식 원문'));
      const bad = input(first);
      const failed = await (await post('11', bad)).json();
      assert.equal(failed.resultCode, 'SOURCE_VERIFY_FAILED');
      assert.equal(await db.legalPrec.count(), 0);
      const beforeReplay = calls;
      assert.deepEqual(await (await post('11', bad)).json(), failed);
      assert.equal(calls, beforeReplay);
      sources.set('11', payload(queue[0]));
      const good = input(first),
        success = await (await post('11', good)).json();
      assert.equal(success.status, 'SUCCEEDED');
      assert.equal(success.resultCode, 'APPLIED');
      assert.equal(await db.legalPrecRev.count(), 1);
      const doneCalls = calls;
      assert.deepEqual(await (await post('11', good)).json(), success);
      assert.equal(calls, doneCalls);
      assert.equal(
        (await post('11', { ...good, beforeHash: 'f'.repeat(64) })).status,
        409,
      );
      const same = input(await review('11'));
      const concurrent = await Promise.all([
        post('11', same),
        post('11', same),
      ]);
      const receipts = await Promise.all(concurrent.map((r) => r.json()));
      assert.deepEqual(receipts[0], receipts[1]);
      assert.equal(receipts[0].resultCode, 'UNCHANGED');
      assert.equal(await db.legalPrecRev.count(), 1);
      const seed = async (item, text) => {
        await sql.query('BEGIN');
        try {
          await sql.query(
            "SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-precedent-import'))",
          );
          await importPrecedent(
            sql,
            parsePrecedent({ target: 'prec', ...item }, payload(item, text)),
          );
          await sql.query('COMMIT');
        } catch (e) {
          await sql.query('ROLLBACK');
          throw e;
        }
      };
      await seed(queue[1], '이전 판본');
      const stale = input(await review('22'));
      onOfficial = async () => {
        onOfficial = async () => {};
        await seed(queue[1], '다른 작업이 먼저 반영한 판본');
      };
      assert.equal(
        (await (await post('22', stale)).json()).resultCode,
        'REVIEW_CHANGED',
      );
      assert.equal(
        (await review('22')).current.decision,
        '다른 작업이 먼저 반영한 판본<br/>둘째 줄',
      );
      const third = await review('33');
      onOfficial = async () => {
        onOfficial = async () => {};
        await db.userRole.update({
          where: { id: grant.id },
          data: { delYn: true, delDttm: new Date() },
        });
      };
      assert.equal(
        (await (await post('33', input(third))).json()).resultCode,
        'PERMISSION_CHANGED',
      );
      await db.userRole.update({
        where: { id: grant.id },
        data: { delYn: false, delDttm: null },
      });
      await sql.query(
        "CREATE FUNCTION reject_test_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_key='33' AND NEW.stat_cd='SUCCEEDED' THEN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_WRITE_ERROR'; END IF; RETURN NEW; END $$",
      );
      await sql.query(
        'CREATE TRIGGER test_receipt_failure BEFORE INSERT ON legal_prec_ingest_hist FOR EACH ROW EXECUTE FUNCTION reject_test_receipt()',
      );
      assert.equal(
        (await (await post('33', input(third))).json()).resultCode,
        'APPLY_FAILED',
      );
      assert.equal(await db.legalPrec.count({ where: { srcKey: '33' } }), 0);
      assert.equal(
        await db.srcSnapshot.count({ where: { srcKey: 'prec:33' } }),
        0,
      );
      await sql.query(
        'DROP TRIGGER test_receipt_failure ON legal_prec_ingest_hist',
      );
      const historyResponse = await get(
        'precedent-collections/history?limit=10',
      );
      assert.equal(historyResponse.status, 200);
      const history = await historyResponse.json();
      assert.ok(history.total >= 6);
      assert.ok(history.items.some((row) => row.status === 'FAILED'));
      assert.ok(history.items.every((row) => row.operator === 'pr***'));
      assert.ok(!JSON.stringify(history).includes(directory));
      assert.ok(
        !JSON.stringify(history).includes('SYNTHETIC_PRIVATE_WRITE_ERROR'),
      );
      if (process.env.AURORE_PRECEDENT_UI) {
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
              fs.openSync(join(directory, 'web.out'), 'w'),
              fs.openSync(join(directory, 'web.err'), 'w'),
            ],
          },
        );
        let ready = false;
        for (let i = 0; i < 80; i++) {
          try {
            if ((await originalFetch('http://127.0.0.1:3002/login')).ok) {
              ready = true;
              break;
            }
          } catch {}
          await delay(250);
        }
        assert.ok(ready);
        console.log(
          'UI_READY http://127.0.0.1:3002/login stop=' +
            join(directory, 'stop'),
        );
        const deadline = Date.now() + 8 * 60000;
        while (!fs.existsSync(join(directory, 'stop')) && Date.now() < deadline)
          await delay(300);
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (web) {
        web.kill();
        await new Promise((resolve) => {
          if (web.exitCode !== null) resolve();
          else web.once('exit', resolve);
        });
      }
      await app?.close();
      await db?.$disconnect();
      await sql?.end();
      if (created && /^aurore_prec_test_[a-f0-9]{12}$/.test(name))
        run('docker', [
          'exec',
          'aurore-dev-check-postgres',
          'dropdb',
          '--force',
          '-U',
          'aurore_dev_check',
          name,
        ]);
      if (directory) {
        assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
);
