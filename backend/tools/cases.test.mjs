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
  'member cases require confirmation and ownership, preserve atomic histories, paginate and soft-delete dependent facts',
  {
    skip: !development,
    timeout: process.env.AURORE_CASES_UI ? 600000 : 90000,
  },
  async () => {
    require('reflect-metadata');
    const { ConfigService } = require('@nestjs/config'),
      { Test } = require('@nestjs/testing'),
      { ValidationPipe } = require('@nestjs/common');
    const { AppModule } = await import('../dist/app.module.js'),
      { PrismaService } = await import('../dist/prisma/prisma.service.js'),
      { AuthService } = await import('../dist/auth/auth.service.js'),
      { ChatService } = await import('../dist/chat/chat.service.js'),
      { CasesService } = await import('../dist/cases/cases.service.js');
    const name = 'aurore_cases_test_' + randomBytes(6).toString('hex'),
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
      app.useBodyParser('json', { limit: '256kb' });
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
        auth = app.get(AuthService),
        cases = app.get(CasesService);
      for (const [id, nick] of [
        ['case_owner', '사건검증'],
        ['case_other', '다른회원'],
        ['case_admin', '관리검증'],
      ])
        await auth.signup(id, nick, 'Synthetic8!');
      const token = (await auth.login('case_owner', 'Synthetic8!')).token,
        foreign = (await auth.login('case_other', 'Synthetic8!')).token,
        admin = (await auth.login('case_admin', 'Synthetic8!')).token,
        guest = (await auth.createGuest()).token;
      const ownerId = BigInt((await auth.session(token, false)).id),
        otherId = BigInt((await auth.session(foreign, false)).id),
        adminId = BigInt((await auth.session(admin, false)).id);
      const role = await db.cmmnCd.findFirstOrThrow({
        where: { cd: 'ADMIN', parent: { cd: 'USER_ROLE' } },
      });
      await db.userRole.create({
        data: { userId: adminId, roleCdId: role.id },
      });
      const get = (path = '', credential = 'Bearer ' + token) =>
        fetch(base + '/cases' + path, {
          headers: credential ? { Authorization: credential } : {},
        });
      const post = (path, body, credential = 'Bearer ' + token) =>
        fetch(base + '/cases' + path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(credential ? { Authorization: credential } : {}),
          },
          body: JSON.stringify(body),
        });
      const read = async (path = '', credential) => {
        const response = await get(path, credential);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        return response.json();
      };
      const options = await read('/options');
      assert.deepEqual(
        options.types.map((row) => row.code),
        ['LEASE', 'EMPLOYMENT', 'CONTRACT', 'OTHER'],
      );
      assert.equal((await get('', null)).status, 401);
      assert.equal((await get('', 'Guest ' + guest)).status, 403);
      assert.equal((await get('/options', 'Guest ' + guest)).status, 403);
      const requestId = randomUUID(),
        privateTitle = '개인사건_PRIVATE_TITLE',
        privateFact = 'PRIVATE_FACT_BODY_ONLY_OWNER';
      const create = {
        requestId: requestId.toUpperCase(),
        title: privateTitle,
        typeCode: 'LEASE',
        confirmed: true,
      };
      assert.equal((await post('', create, null)).status, 401);
      assert.equal((await post('', create, 'Guest ' + guest)).status, 403);
      for (const patch of [
        { confirmed: false },
        { title: ' ' },
        { title: 'x'.repeat(81) },
        { userId: otherId.toString() },
        { requestId: 'bad' },
      ])
        assert.equal((await post('', { ...create, ...patch })).status, 400);
      assert.equal(await db.userCase.count(), 0);
      assert.equal(
        (await post('', { ...create, typeCode: 'ACTIVE' })).status,
        409,
      );
      const copies = await Promise.all([post('', create), post('', create)]);
      for (const response of copies) assert.equal(response.status, 201);
      const receipts = await Promise.all(
        copies.map((response) => response.json()),
      );
      assert.equal(receipts[0].id, receipts[1].id);
      const id = receipts[0].id;
      assert.equal(id, requestId);
      assert.equal(await db.userCase.count(), 1);
      assert.equal(await db.caseHist.count(), 1);
      assert.equal(
        (
          await post('', {
            confirmed: true,
            typeCode: 'LEASE',
            title: privateTitle,
            requestId,
          })
        ).status,
        201,
      );
      assert.equal(
        (await post('', { ...create, title: '다른 제목' })).status,
        409,
      );
      assert.equal((await post('', create, 'Bearer ' + foreign)).status, 404);
      for (const credential of ['Bearer ' + foreign, 'Bearer ' + admin]) {
        assert.equal((await get('/' + id, credential)).status, 404);
        assert.equal(
          (
            await post(
              '/' + id + '/update',
              {
                requestId: randomUUID(),
                revision: 1,
                title: '탈취',
                typeCode: 'OTHER',
                confirmed: true,
              },
              credential,
            )
          ).status,
          404,
        );
      }
      assert.equal((await read('', 'Bearer ' + foreign)).total, 0);
      assert.equal((await read('', 'Bearer ' + admin)).total, 0);
      let detail = await read('/' + id);
      assert.equal(detail.case.revision, 1);
      assert.equal(detail.facts.total, 0);
      assert.equal(detail.history.total, 1);
      const editCase = {
        requestId: randomUUID(),
        revision: 1,
        title: '개인사건_수정',
        typeCode: 'OTHER',
        confirmed: true,
      };
      assert.equal((await post('/' + id + '/update', editCase)).status, 200);
      assert.equal(
        (
          await post('/' + id + '/update', {
            ...editCase,
            requestId: randomUUID(),
            revision: 2,
          })
        ).status,
        409,
      );
      const factBody = {
        requestId: randomUUID(),
        revision: 2,
        title: '계약 종료 통지',
        content: privateFact,
        occurredOn: '2026-11-08',
        confirmed: true,
      };
      for (const patch of [
        { confirmed: false },
        { occurredOn: '2026-02-30' },
        { occurredOn: '0000-01-01' },
        { content: ' ' },
        { content: 'x'.repeat(4001) },
        { unknownSourceId: randomUUID() },
        { verifyStatCd: 'AI_CONFIRMED' },
      ])
        assert.equal(
          (await post('/' + id + '/facts', { ...factBody, ...patch })).status,
          400,
        );
      const add = await Promise.all([
        post('/' + id + '/facts', factBody),
        post('/' + id + '/facts', factBody),
      ]);
      for (const response of add) assert.equal(response.status, 201);
      detail = await read('/' + id);
      assert.equal(detail.case.revision, 3);
      assert.equal(detail.facts.total, 1);
      assert.equal(detail.history.total, 3);
      const fact = detail.facts.items[0];
      assert.equal(fact.content, privateFact);
      assert.equal(
        (await get('/' + id + '/facts/' + fact.id, 'Bearer ' + foreign)).status,
        404,
      );
      assert.equal(
        (await get('/' + id + '/facts/' + fact.id, 'Bearer ' + admin)).status,
        404,
      );
      const otherCreate = await post(
        '',
        {
          requestId: randomUUID(),
          title: '다른 회원 사건',
          typeCode: 'OTHER',
          confirmed: true,
        },
        'Bearer ' + foreign,
      );
      const otherCase = (await otherCreate.json()).id;
      await post(
        '/' + otherCase + '/facts',
        {
          requestId: randomUUID(),
          revision: 1,
          title: '다른 사실',
          content: '다른 회원 전용',
          confirmed: true,
        },
        'Bearer ' + foreign,
      );
      const otherFact = (await read('/' + otherCase, 'Bearer ' + foreign)).facts
        .items[0];
      assert.equal(
        (await get('/' + id + '/facts/' + otherFact.id)).status,
        404,
      );
      assert.equal(
        (
          await post('/' + id + '/facts/' + otherFact.id + '/update', {
            ...factBody,
            requestId: randomUUID(),
            revision: 3,
          })
        ).status,
        404,
      );
      const beforeParent = await db.userCase.findUniqueOrThrow({
          where: { id },
        }),
        beforeFact = await db.caseFact.findUniqueOrThrow({
          where: { id: BigInt(fact.id) },
        }),
        transaction = db.$transaction.bind(db);
      db.$transaction = (work, options) =>
        transaction(
          typeof work !== 'function'
            ? work
            : (tx) =>
                work(
                  new Proxy(tx, {
                    get(object, key) {
                      if (key !== 'caseHist') return Reflect.get(object, key);
                      return new Proxy(object.caseHist, {
                        get(model, operation) {
                          if (operation === 'create')
                            return async () => {
                              throw Error('Synthetic case history failure');
                            };
                          return Reflect.get(model, operation);
                        },
                      });
                    },
                  }),
                ),
          options,
        );
      const updateFact = {
        requestId: randomUUID(),
        revision: 3,
        title: '수정한 사실',
        content: '수정한 사실\n계약이 끝났습니다.',
        confirmed: true,
      };
      try {
        assert.equal(
          (await post('/' + id + '/facts/' + fact.id + '/update', updateFact))
            .status,
          500,
        );
      } finally {
        db.$transaction = transaction;
      }
      assert.deepEqual(
        await db.userCase.findUniqueOrThrow({ where: { id } }),
        beforeParent,
      );
      assert.deepEqual(
        await db.caseFact.findUniqueOrThrow({ where: { id: BigInt(fact.id) } }),
        beforeFact,
      );
      assert.equal((await read('/' + id)).history.total, 3);
      assert.equal(
        (await post('/' + id + '/facts/' + fact.id + '/update', updateFact))
          .status,
        200,
      );
      detail = await read('/' + id);
      assert.equal(detail.facts.items[0].content, updateFact.content);
      assert.equal(detail.facts.items[0].occurredOn, null);
      assert.equal(detail.history.items[0].before.content, privateFact);
      assert.equal(detail.history.items[0].before.occurredOn, '2026-11-08');
      assert.equal(
        (
          await post('/' + id + '/facts/' + fact.id + '/update', {
            ...updateFact,
            requestId: randomUUID(),
            revision: 4,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await post('/' + id + '/facts/' + fact.id + '/update', {
            ...updateFact,
            requestId: randomUUID(),
            revision: 3,
            title: '오래된 화면',
          })
        ).status,
        409,
      );
      const removeFact = {
        requestId: randomUUID(),
        revision: 4,
        confirmed: true,
      };
      assert.equal(
        (await post('/' + id + '/facts/' + fact.id + '/delete', removeFact))
          .status,
        200,
      );
      assert.equal(
        (await post('/' + id + '/facts/' + fact.id + '/delete', removeFact))
          .status,
        200,
      );
      detail = await read('/' + id);
      assert.equal(detail.facts.total, 0);
      assert.equal(detail.history.items[0].action, 'DELETE_FACT');
      assert.equal(detail.history.items[0].after.deleted, true);
      assert.equal(detail.history.items[0].before.content, updateFact.content);
      assert.equal((await get('/' + id + '/facts/' + fact.id)).status, 404);
      assert.equal(
        (
          await db.caseFact.findUniqueOrThrow({
            where: { id: BigInt(fact.id) },
          })
        ).delYn,
        true,
      );
      let revision = detail.case.revision;
      for (let n = 0; n < 24; n++) {
        const response = await post('/' + id + '/facts', {
          requestId: randomUUID(),
          revision,
          title: '확인 사실 ' + n,
          content: '가상 검증 내용 ' + n,
          confirmed: true,
        });
        assert.equal(response.status, 201);
        revision = (await response.json()).revision;
      }
      for (const limit of [10, 20, 50]) {
        const page = await read('/' + id + '?limit=' + limit);
        assert.equal(page.facts.items.length, Math.min(limit, 24));
        assert.equal(page.history.items.length, Math.min(limit, revision));
        if (limit < 24) {
          const next = await read(
            '/' +
              id +
              '?limit=' +
              limit +
              '&offset=' +
              limit +
              '&historyOffset=' +
              limit,
          );
          assert.equal(
            page.facts.items.some((a) =>
              next.facts.items.some((b) => a.id === b.id),
            ),
            false,
          );
          assert.equal(
            page.history.items.some((a) =>
              next.history.items.some((b) => a.id === b.id),
            ),
            false,
          );
        }
      }
      const factType = await db.cmmnCd.findFirstOrThrow({
          where: { cd: 'STATEMENT', parent: { cd: 'CASE_FACT_TYPE' } },
        }),
        caseType = await db.cmmnCd.findFirstOrThrow({
          where: { cd: 'OTHER', parent: { cd: 'CASE_TYPE' } },
        });
      await assert.rejects(
        db.caseHist.create({
          data: {
            id: randomUUID(),
            userCaseId: id,
            userId: otherId,
            revNo: revision + 1,
            actTypeCd: 'UPDATE_CASE',
            requestHash: 'f'.repeat(64),
            bfData: { title: 'before' },
            afData: { title: 'after' },
          },
        }),
      );
      await assert.rejects(
        db.caseHist.create({
          data: {
            id: randomUUID(),
            userCaseId: id,
            userId: ownerId,
            factId: BigInt(otherFact.id),
            revNo: revision + 1,
            actTypeCd: 'UPDATE_FACT',
            requestHash: 'f'.repeat(64),
            bfData: { title: 'before' },
            afData: { title: 'after' },
          },
        }),
      );
      await assert.rejects(
        db.caseFact.create({
          data: {
            userCaseId: id,
            factTypeCdId: factType.id,
            factVal: {
              title: '제목',
              content: '내용',
              occurredOn: null,
              extra: '금지',
            },
          },
        }),
      );
      await db.cmmnCd.update({
        where: { id: factType.id },
        data: { useYn: false },
      });
      assert.equal(
        (
          await post('/' + id + '/facts', {
            requestId: randomUUID(),
            revision,
            title: '설정 변경',
            content: '새 사실',
            confirmed: true,
          })
        ).status,
        409,
      );
      await db.cmmnCd.update({
        where: { id: factType.id },
        data: { useYn: true },
      });
      await db.userCase.createMany({
        data: Array.from({ length: 55 }, (_, n) => ({
          id: randomUUID(),
          userId: ownerId,
          caseNm: '목록 가상 사건 ' + n,
          caseTypeCdId: caseType.id,
          rgstDttm: new Date('2020-01-01'),
          uptDttm: new Date('2020-01-01'),
        })),
      });
      for (const limit of [10, 20, 50]) {
        let offset = 0;
        const seen = new Set();
        do {
          const page = await read('?limit=' + limit + '&offset=' + offset);
          assert.equal(page.total, 56);
          assert.equal(page.items.length, Math.min(limit, 56 - offset));
          for (const row of page.items) {
            assert.equal(seen.has(row.id), false);
            seen.add(row.id);
            assert.equal('userId' in row, false);
          }
          offset = page.nextOffset;
        } while (offset !== null);
        assert.equal(seen.size, 56);
      }
      assert.equal((await read('?q=_')).total, 1);
      assert.equal((await read('?q=%25')).total, 0);
      assert.equal((await read('?q=없는사건')).total, 0);
      assert.equal((await read('', 'Bearer ' + foreign)).total, 1);
      for (const suffix of [
        '?limit=21',
        '?offset=-1',
        '?historyOffset=-1',
        '?extra=1',
      ])
        assert.equal((await get('/' + id + suffix)).status, 400);
      assert.equal(
        (await get('/' + id + '/facts/9223372036854775808')).status,
        400,
      );
      const race = await Promise.all([
        post('/' + id + '/update', {
          requestId: randomUUID(),
          revision,
          title: '동시 수정 A',
          typeCode: 'OTHER',
          confirmed: true,
        }),
        post('/' + id + '/update', {
          requestId: randomUUID(),
          revision,
          title: '동시 수정 B',
          typeCode: 'OTHER',
          confirmed: true,
        }),
      ]);
      assert.deepEqual(
        race.map((response) => response.status).sort(),
        [200, 409],
      );
      revision = (await read('/' + id)).case.revision;
      // Link only already-saved, owned conversations; never copy private facts into AI jobs.
      const chatIds = Array.from({ length: 26 }, () => randomUUID());
      await db.chatSess.createMany({
        data: chatIds.map((chatId, index) => ({
          id: chatId,
          userId: ownerId,
          sessNm: index === 0 ? '가상 임대차 대화' : '연결 대화 ' + index,
        })),
      });
      const foreignChat = randomUUID();
      await db.chatSess.create({
        data: { id: foreignChat, userId: otherId, sessNm: '다른 회원 대화' },
      });
      const link = (
        chatId,
        caseId,
        rev = 0,
        credential = 'Bearer ' + token,
        extra = {},
      ) =>
        fetch(base + '/chat-sessions/' + chatId + '/case', {
          method: 'POST',
          headers: {
            Authorization: credential,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            caseId,
            revision: rev,
            confirmed: true,
            ...extra,
          }),
        });
      assert.equal((await link(chatIds[0], id, 0, '')).status, 401);
      assert.equal(
        (await link(chatIds[0], id, 0, 'Guest ' + guest)).status,
        403,
      );
      for (const credential of ['Bearer ' + foreign, 'Bearer ' + admin])
        assert.equal((await link(chatIds[0], id, 0, credential)).status, 404);
      assert.equal((await link(foreignChat, id)).status, 404);
      assert.equal((await link(chatIds[0], otherCase)).status, 404);
      assert.equal(
        (await link(chatIds[0], id, 0, undefined, { confirmed: false })).status,
        400,
      );
      assert.equal(
        (await link(chatIds[0], id, 0, undefined, { caseId: undefined }))
          .status,
        400,
      );
      assert.equal(
        (await link(chatIds[0], id, 0, undefined, { userId: String(ownerId) }))
          .status,
        400,
      );
      const firstLinks = await Promise.all([
        link(chatIds[0], id.toUpperCase()),
        link(chatIds[0], id),
      ]);
      for (const response of firstLinks) {
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.linkedCase.id, id);
        assert.equal(body.revision, 1);
        assert.equal(JSON.stringify(body).includes(privateFact), false);
      }
      assert.equal((await link(chatIds[0], null, 0)).status, 409);
      assert.equal((await link(chatIds[0], null, 1)).status, 200);
      assert.equal((await link(chatIds[0], id, 2)).status, 200);
      await assert.rejects(
        db.chatSess.update({
          where: { id: foreignChat },
          data: { userCaseId: id },
        }),
      );
      const linkJob = randomUUID();
      const linkInput = await db.chatMsg.create({
        data: {
          chatSessId: chatIds[1],
          msgSeq: 1,
          roleCd: 'USER',
          msgCont: '가상 연결 검증',
        },
      });
      await db.chatSess.update({
        where: { id: chatIds[1] },
        data: { nextMsgSeq: 2 },
      });

      await db.aiJob.create({
        data: {
          id: linkJob,
          chatSessId: chatIds[1],
          requestHash: 'a'.repeat(64),
          inputMsgId: linkInput.id,
          ownerAuthHash: (await auth.resolveOwner('Bearer ' + token)).authHash,
          phaseCd: 'start',
          deadlineDttm: new Date(Date.now() + 60000),
          statCd: 'QUEUED',
        },
      });
      assert.equal((await link(chatIds[1], id)).status, 409);
      await db.aiJob.update({
        where: { id: linkJob },
        data: { statCd: 'CANCELLED' },
      });
      for (const chatId of chatIds.slice(1))
        assert.equal((await link(chatId, id)).status, 200);
      for (const size of [10, 20, 50]) {
        const seen = new Set();
        let offset = 0;
        do {
          const page = await read(
            '/' + id + '/chats?limit=' + size + '&offset=' + offset,
          );
          assert.equal(page.total, 26);
          assert.equal(page.items.length, Math.min(size, 26 - offset));
          for (const row of page.items) {
            assert.ok(!seen.has(row.id));
            seen.add(row.id);
          }
          offset = page.nextOffset;
        } while (offset !== null);
        assert.equal(seen.size, 26);
      }
      for (const credential of ['Bearer ' + foreign, 'Bearer ' + admin])
        assert.equal((await get('/' + id + '/chats', credential)).status, 404);
      assert.equal((await get('/' + id + '/chats?limit=21')).status, 400);
      const deletion = { requestId: randomUUID(), revision, confirmed: true };
      const deleted = await Promise.all([
        post('/' + id + '/delete', deletion),
        post('/' + id + '/delete', deletion),
      ]);
      for (const response of deleted) assert.equal(response.status, 200);
      assert.equal((await get('/' + id)).status, 404);
      assert.equal((await get('/' + id + '/facts/' + fact.id)).status, 404);
      assert.equal(
        (await db.userCase.findUniqueOrThrow({ where: { id } })).delYn,
        true,
      );
      assert.equal(
        await db.caseFact.count({ where: { userCaseId: id, delYn: false } }),
        0,
      );
      assert.equal(await db.caseFact.count({ where: { userCaseId: id } }), 25);
      const deletedHistory = await db.caseHist.findUniqueOrThrow({
        where: { id: deletion.requestId },
      });
      assert.equal(deletedHistory.afData.deletedFactCount, 24);
      assert.equal(await db.chatSess.count({ where: { userCaseId: id } }), 0);
      assert.equal(
        await db.chatSess.count({
          where: { id: { in: chatIds }, delYn: false },
        }),
        26,
      );
      assert.equal((await link(chatIds[0], id, 4)).status, 404);
      const unlinked = await (
        await fetch(base + '/chat-sessions/' + chatIds[0], {
          headers: { Authorization: 'Bearer ' + token },
        })
      ).json();
      assert.equal(unlinked.linkedCase, null);
      assert.equal(unlinked.revision, 4);

      assert.equal((await read()).total, 55);
      assert.equal(
        (await read('/' + otherCase, 'Bearer ' + foreign)).facts.total,
        1,
      );
      const racingCase = randomUUID();
      assert.equal(
        (
          await post('', {
            requestId: racingCase,
            title: '연결과 삭제 경합',
            typeCode: 'OTHER',
            confirmed: true,
          })
        ).status,
        201,
      );
      const concurrent = await Promise.all([
        link(chatIds[2], racingCase, 2),
        post('/' + racingCase + '/delete', {
          requestId: randomUUID(),
          revision: 1,
          confirmed: true,
        }),
      ]);
      assert.ok([200, 404].includes(concurrent[0].status));
      assert.equal(concurrent[1].status, 200);
      assert.equal(
        (await db.chatSess.findUniqueOrThrow({ where: { id: chatIds[2] } }))
          .userCaseId,
        null,
      );

      // Drafting is read-only; only a confirmed, owned USER message can become a fact.
      const importCase = randomUUID();
      assert.equal(
        (
          await post('', {
            requestId: importCase,
            title: '가상 사실관계 가져오기',
            typeCode: 'LEASE',
            confirmed: true,
          })
        ).status,
        201,
      );
      const importChat = chatIds[3];
      assert.equal((await link(importChat, importCase, 2)).status, 200);
      const sourceMsg = await db.chatMsg.create({
        data: {
          chatSessId: importChat,
          msgSeq: 1,
          roleCd: 'USER',
          msgCont: '임차인이 계약 종료를 알렸습니다. 가상 검증 메시지입니다.',
        },
      });
      const aiMsg = await db.chatMsg.create({
        data: {
          chatSessId: importChat,
          msgSeq: 2,
          roleCd: 'ASSISTANT',
          prntMsgId: sourceMsg.id,
          msgCont: '가상의 AI 답변은 사실로 가져올 수 없습니다.',
        },
      });
      const foreignMsg = await db.chatMsg.create({
        data: {
          chatSessId: foreignChat,
          msgSeq: 1,
          roleCd: 'USER',
          msgCont: '다른 회원의 비공개 메시지',
        },
      });
      await db.chatSess.update({
        where: { id: importChat },
        data: { nextMsgSeq: 3 },
      });
      const draftPath = '/' + importCase + '/drafts/' + sourceMsg.id;
      const draft = await read(draftPath);
      assert.equal(draft.content, sourceMsg.msgCont);
      assert.equal(draft.source.messageId, sourceMsg.id);
      assert.equal(draft.case.revision, 1);
      assert.equal(
        await db.caseFact.count({ where: { userCaseId: importCase } }),
        0,
      );
      for (const credential of ['Bearer ' + foreign, 'Bearer ' + admin])
        assert.equal((await get(draftPath, credential)).status, 404);
      assert.equal((await get(draftPath, 'Guest ' + guest)).status, 403);
      assert.equal(
        (await get('/' + importCase + '/drafts/' + aiMsg.id)).status,
        404,
      );
      assert.equal(
        (await get('/' + importCase + '/drafts/' + foreignMsg.id)).status,
        404,
      );
      const imported = {
        requestId: randomUUID(),
        revision: 1,
        title: '계약 종료 통지',
        content: '계약 종료 통지를 확인했습니다.',
        srcMsgId: sourceMsg.id.toUpperCase(),
        confirmed: true,
      };
      assert.equal(
        (
          await post('/' + importCase + '/facts', {
            ...imported,
            confirmed: false,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await post('/' + importCase + '/facts', {
            ...imported,
            srcMsgId: aiMsg.id,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await post('/' + importCase + '/facts', {
            ...imported,
            srcMsgId: foreignMsg.id,
          })
        ).status,
        404,
      );
      assert.equal((await link(importChat, null, 3)).status, 200);
      assert.equal((await get(draftPath)).status, 404);
      assert.equal(
        (await post('/' + importCase + '/facts', imported)).status,
        404,
      );
      assert.equal((await link(importChat, importCase, 4)).status, 200);
      const imports = await Promise.all([
        post('/' + importCase + '/facts', imported),
        post('/' + importCase + '/facts', imported),
      ]);
      for (const response of imports) assert.equal(response.status, 201);
      let importedDetail = await read('/' + importCase);
      let importedFact = importedDetail.facts.items[0];
      assert.equal(importedDetail.facts.total, 1);
      assert.equal(importedFact.imported, true);
      assert.equal(importedFact.source.chatId, importChat);
      assert.equal(importedFact.content, imported.content);
      assert.equal(
        importedDetail.history.items[0].after.sourceMessageId,
        sourceMsg.id,
      );
      assert.equal(
        (
          await post('/' + importCase + '/facts', {
            ...imported,
            content: '같은 번호로 다른 내용',
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await post('/' + importCase + '/facts', {
            ...imported,
            requestId: randomUUID(),
            revision: 2,
          })
        ).status,
        409,
      );
      assert.equal((await get(draftPath)).status, 409);
      const editImported = {
        requestId: randomUUID(),
        revision: 2,
        title: imported.title,
        content: '확인한 수정 내용',
        confirmed: true,
      };
      assert.equal(
        (
          await post(
            '/' + importCase + '/facts/' + importedFact.id + '/update',
            { ...editImported, srcMsgId: foreignMsg.id },
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await post(
            '/' + importCase + '/facts/' + importedFact.id + '/update',
            editImported,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await db.caseFact.findUniqueOrThrow({
            where: { id: BigInt(importedFact.id) },
          })
        ).srcMsgId,
        sourceMsg.id,
      );
      assert.equal(
        (
          await post(
            '/' + importCase + '/facts/' + importedFact.id + '/delete',
            { requestId: randomUUID(), revision: 3, confirmed: true },
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await post('/' + importCase + '/facts', {
            ...imported,
            requestId: randomUUID(),
            revision: 4,
          })
        ).status,
        201,
      );
      const removeSourceChat = await fetch(
        base + '/chat-sessions/' + importChat + '/delete',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ revision: 5 }),
        },
      );
      assert.equal(removeSourceChat.status, 204);
      importedDetail = await read('/' + importCase);
      assert.equal(importedDetail.facts.total, 1);
      assert.equal(importedDetail.facts.items[0].source, null);
      assert.equal(importedDetail.facts.items[0].imported, true);
      assert.equal(importedDetail.facts.items[0].content, imported.content);
      const importedTimeline = await read('/' + importCase + '/timeline');
      assert.equal(importedTimeline.items[0].imported, true);
      assert.equal(importedTimeline.items[0].source, null);
      assert.equal(importedTimeline.undatedTotal, 1);
      assert.equal((await get(draftPath)).status, 404);
      assert.equal(
        (
          await post('/' + importCase + '/delete', {
            requestId: randomUUID(),
            revision: 5,
            confirmed: true,
          })
        ).status,
        200,
      );
      assert.equal(
        await db.caseFact.count({ where: { userCaseId: importCase } }),
        2,
      );

      // Chronology uses the entered date, with stable order for ties and undated facts last.
      const timelineCase = randomUUID();
      assert.equal(
        (
          await post('', {
            requestId: timelineCase,
            title: '가상 보증금 사건 타임라인',
            typeCode: 'LEASE',
            confirmed: true,
          })
        ).status,
        201,
      );
      const emptyTimeline = await read('/' + timelineCase + '/timeline');
      assert.equal(emptyTimeline.total, 0);
      assert.equal(emptyTimeline.undatedTotal, 0);
      assert.deepEqual(emptyTimeline.items, []);
      for (let n = 0; n < 28; n++) {
        const occurredOn =
          n % 6 === 0
            ? undefined
            : '2026-11-' + String(1 + ((27 - n) % 9)).padStart(2, '0');
        assert.equal(
          (
            await post('/' + timelineCase + '/facts', {
              requestId: randomUUID(),
              revision: n + 1,
              title: '순서 검증 ' + n,
              content: '가상의 확인한 내용 ' + n,
              occurredOn,
              confirmed: true,
            })
          ).status,
          201,
        );
      }
      const rawFacts = await db.caseFact.findMany({
        where: { userCaseId: timelineCase, delYn: false },
        orderBy: { id: 'asc' },
      });
      const expected = [...rawFacts].sort((a, b) => {
        const left = a.factVal.occurredOn,
          right = b.factVal.occurredOn;
        return (
          (left ?? '9999-99-99').localeCompare(right ?? '9999-99-99') ||
          (a.id < b.id ? -1 : 1)
        );
      });
      for (const limit of [10, 20, 50]) {
        const actual = [];
        let offset = 0;
        do {
          const page = await read(
            '/' +
              timelineCase +
              '/timeline?limit=' +
              limit +
              '&offset=' +
              offset,
          );
          assert.equal(page.total, 28);
          assert.equal(page.undatedTotal, 5);
          assert.equal(page.items.length, Math.min(limit, 28 - offset));
          for (const row of page.items) {
            actual.push(row.id);
            assert.equal('srcMsgId' in row, false);
            assert.equal('userId' in row, false);
          }
          offset = page.nextOffset;
        } while (offset !== null);
        assert.deepEqual(
          actual,
          expected.map((row) => String(row.id)),
        );
      }
      assert.equal((await read('/' + timelineCase)).history.total, 29);
      for (const credential of ['Bearer ' + foreign, 'Bearer ' + admin])
        assert.equal(
          (await get('/' + timelineCase + '/timeline', credential)).status,
          404,
        );
      assert.equal(
        (await get('/' + timelineCase + '/timeline', 'Guest ' + guest)).status,
        403,
      );
      assert.equal(
        (await get('/' + timelineCase + '/timeline', null)).status,
        401,
      );
      for (const suffix of [
        '?limit=21',
        '?offset=-1',
        '?offset=100001',
        '?extra=1',
      ])
        assert.equal(
          (await get('/' + timelineCase + '/timeline' + suffix)).status,
          400,
        );
      assert.deepEqual(
        (await read('/' + timelineCase + '/timeline?offset=100000')).items,
        [],
      );
      const moving = rawFacts[0];
      assert.equal(
        (
          await post('/' + timelineCase + '/facts/' + moving.id + '/update', {
            requestId: randomUUID(),
            revision: 29,
            title: moving.factVal.title,
            content: moving.factVal.content,
            occurredOn: '2025-01-01',
            confirmed: true,
          })
        ).status,
        200,
      );
      let chronology = await read('/' + timelineCase + '/timeline?limit=50');
      assert.equal(chronology.items[0].id, String(moving.id));
      assert.equal(chronology.items[0].occurredOn, '2025-01-01');
      assert.equal(chronology.undatedTotal, 4);
      assert.equal(
        (
          await post('/' + timelineCase + '/facts/' + moving.id + '/update', {
            requestId: randomUUID(),
            revision: 30,
            title: moving.factVal.title,
            content: moving.factVal.content,
            confirmed: true,
          })
        ).status,
        200,
      );
      chronology = await read('/' + timelineCase + '/timeline?limit=50');
      assert.equal(
        chronology.items.filter((row) => row.occurredOn === null)[0].id,
        String(moving.id),
      );
      assert.equal(chronology.undatedTotal, 5);
      assert.equal(
        (
          await post('/' + timelineCase + '/facts/' + moving.id + '/delete', {
            requestId: randomUUID(),
            revision: 31,
            confirmed: true,
          })
        ).status,
        200,
      );
      chronology = await read('/' + timelineCase + '/timeline?limit=50');
      assert.equal(chronology.total, 27);
      assert.equal(chronology.undatedTotal, 4);
      assert.ok(chronology.items.every((row) => row.id !== String(moving.id)));
      if (!process.env.AURORE_CASES_UI) {
        assert.equal(
          (
            await post('/' + timelineCase + '/delete', {
              requestId: randomUUID(),
              revision: 32,
              confirmed: true,
            })
          ).status,
          200,
        );
        assert.equal((await get('/' + timelineCase + '/timeline')).status, 404);
      }

      const exportCase = randomUUID();
      assert.equal(
        (
          await post('', {
            requestId: exportCase,
            title: '가상 사건 정리본',
            typeCode: 'LEASE',
            confirmed: true,
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await post('/' + exportCase + '/facts', {
            requestId: randomUUID(),
            revision: 1,
            title: '확인한 계약 종료',
            content:
              '계약 종료일 2026-11-08\n전화 010-1234-5678\n이메일 synthetic@example.test\n진단명: 가상 건강정보\n<script>alert(1)</script>',
            occurredOn: '2026-11-08',
            confirmed: true,
          })
        ).status,
        201,
      );
      const exported = await read('/' + exportCase + '/export');
      assert.ok(exported.filename.endsWith('.md'));
      assert.ok(exported.markdown.includes('2026-11-08'));
      for (const secret of [
        '010-1234-5678',
        'synthetic@example.test',
        '가상 건강정보',
        '<script>',
      ])
        assert.ok(!exported.markdown.includes(secret));
      for (const credential of ['Bearer ' + foreign, 'Bearer ' + admin])
        assert.equal(
          (await get('/' + exportCase + '/export', credential)).status,
          404,
        );
      assert.equal(
        (await get('/' + exportCase + '/export', 'Guest ' + guest)).status,
        403,
      );
      const documentChat = randomUUID();
      const documentText =
        '이름: 가상인\n주소: 가상의 주소\n계약 종료일: 2026-11-08\n연락처 010-1234-5678\n회신 synthetic@example.test\n주민등록번호 900101-1234567\n진단명: 가상 건강정보\n보증금 반환을 요청한 사실을 확인했습니다.';
      const upload = async (
        chatId,
        content = documentText,
        name = '가상인_계약서.txt',
        credential = 'Bearer ' + token,
      ) => {
        const form = new FormData();
        form.set(
          'file',
          new Blob([content], { type: 'application/octet-stream' }),
          name,
        );
        return fetch(base + '/chat-sessions/' + chatId + '/documents/preview', {
          method: 'POST',
          headers: credential ? { Authorization: credential } : {},
          body: form,
        });
      };
      const docPost = (chatId, body, credential = 'Bearer ' + token) =>
        fetch(base + '/chat-sessions/' + chatId + '/documents', {
          method: 'POST',
          headers: {
            Authorization: credential,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      const docGet = (chatId, suffix = '', credential = 'Bearer ' + token) =>
        fetch(base + '/chat-sessions/' + chatId + '/documents' + suffix, {
          headers: { Authorization: credential },
        });
      const docDelete = (chatId, docId, credential = 'Bearer ' + token) =>
        fetch(
          base + '/chat-sessions/' + chatId + '/documents/' + docId + '/delete',
          { method: 'POST', headers: { Authorization: credential } },
        );
      assert.equal(
        (await upload(documentChat, documentText, 'x.txt', null)).status,
        401,
      );
      assert.equal(
        (await upload(documentChat, documentText, 'x.txt', 'Guest ' + guest))
          .status,
        403,
      );
      assert.equal((await upload(foreignChat)).status, 404);
      assert.equal(
        (await upload(documentChat, 'fake', 'fake.exe')).status,
        400,
      );
      assert.equal(
        (await upload(documentChat, '%PDF-fake', 'fake.txt')).status,
        400,
      );
      assert.equal(
        (await upload(documentChat, 'fake', 'fake.pdf')).status,
        400,
      );
      assert.equal(
        (await upload(documentChat, 'x'.repeat(5 * 1024 * 1024 + 1))).status,
        413,
      );
      const beforeDocuments = await db.attachDoc.count();
      const previewResponse = await upload(documentChat);
      assert.equal(
        previewResponse.status,
        200,
        await previewResponse.clone().text(),
      );
      const preview = await previewResponse.json();
      assert.equal(preview.partial, false);
      assert.ok(preview.markdown.includes('2026-11-08'));
      for (const secret of [
        '가상인',
        '가상의 주소',
        '010-1234-5678',
        'synthetic@example.test',
        '900101-1234567',
        '가상 건강정보',
      ])
        assert.ok(!preview.markdown.includes(secret));
      assert.equal(await db.attachDoc.count(), beforeDocuments);
      assert.equal(await db.chatSess.count({ where: { id: documentChat } }), 0);
      const registration = {
        receipt: preview.receipt,
        markdown: preview.markdown + '\n회신 다시입력한사람@example.test',
        confirmed: true,
      };
      assert.equal(
        (await docPost(documentChat, { ...registration, confirmed: false }))
          .status,
        400,
      );
      assert.equal(
        (
          await docPost(documentChat, {
            ...registration,
            receipt: preview.receipt + 'bad',
          })
        ).status,
        400,
      );
      assert.equal(
        (await docPost(documentChat, registration, 'Bearer ' + foreign)).status,
        400,
      );
      const registrations = await Promise.all([
        docPost(documentChat, registration),
        docPost(documentChat, registration),
      ]);
      for (const response of registrations) assert.equal(response.status, 201);
      assert.equal(
        (
          await docPost(documentChat, {
            ...registration,
            markdown: '같은 처리 번호로 다른 내용',
          })
        ).status,
        409,
      );
      const documentList = await (await docGet(documentChat)).json();
      assert.equal(documentList.total, 1);
      const documentId = documentList.items[0].id;
      const original = await db.attachDoc.findUniqueOrThrow({
        where: { id: documentId },
      });
      assert.equal(
        original.mdCont.includes('다시입력한사람@example.test'),
        false,
      );
      assert.equal(original.docNm.includes('가상인'), false);
      assert.equal(original.userId, ownerId);
      assert.equal(original.srcSha.length, 64);
      assert.equal(
        await db.aiJob.count({ where: { chatSessId: documentChat } }),
        0,
      );
      const savedMd = await (
        await docGet(documentChat, '/' + documentId)
      ).json();
      assert.equal(savedMd.markdown, original.mdCont);
      assert.equal('original' in savedMd, false);
      for (const credential of ['Bearer ' + foreign, 'Bearer ' + admin]) {
        assert.equal((await docGet(documentChat, '', credential)).status, 404);
        assert.equal(
          (await docGet(documentChat, '/' + documentId, credential)).status,
          404,
        );
        assert.equal(
          (await docDelete(documentChat, documentId, credential)).status,
          404,
        );
      }
      assert.equal(
        (await docGet(documentChat, '', 'Guest ' + guest)).status,
        403,
      );
      for (let n = 0; n < 11; n++) {
        const draftResponse = await upload(
          documentChat,
          '가상의 첨부자료 ' + n,
          'fixture.md',
        );
        assert.equal(draftResponse.status, 200);
        const draft = await draftResponse.json();
        assert.equal(
          (
            await docPost(documentChat, {
              receipt: draft.receipt,
              markdown: draft.markdown,
              confirmed: true,
            })
          ).status,
          201,
        );
      }
      for (const limit of [10, 20, 50]) {
        const ids = [];
        let offset = 0;
        do {
          const page = await (
            await docGet(documentChat, '?limit=' + limit + '&offset=' + offset)
          ).json();
          assert.equal(page.total, 12);
          assert.equal(page.items.length, Math.min(limit, 12 - offset));
          ids.push(...page.items.map((row) => row.id));
          offset = page.nextOffset;
        } while (offset !== null);
        assert.equal(new Set(ids).size, 12);
      }
      assert.equal((await docGet(documentChat, '?limit=21')).status, 400);
      assert.equal((await docDelete(documentChat, documentId)).status, 200);
      assert.equal((await docGet(documentChat, '/' + documentId)).status, 404);
      assert.equal(
        (await db.attachDoc.findUniqueOrThrow({ where: { id: documentId } }))
          .delYn,
        true,
      );
      const documentRoom = await db.chatSess.findUniqueOrThrow({
        where: { id: documentChat },
      });
      assert.equal(
        (
          await fetch(base + '/chat-sessions/' + documentChat + '/delete', {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ revision: documentRoom.revNo }),
          })
        ).status,
        204,
      );
      assert.equal(
        await db.attachDoc.count({
          where: { chatSessId: documentChat, delYn: false },
        }),
        0,
      );
      assert.equal(
        await db.attachDoc.count({ where: { chatSessId: documentChat } }),
        12,
      );
      assert.equal((await docGet(documentChat)).status, 404);
      const overview = await (
        await fetch(base + '/admin/overview', {
          headers: { Authorization: 'Bearer ' + admin },
        })
      ).json();
      assert.equal(JSON.stringify(overview).includes(privateFact), false);
      assert.equal(JSON.stringify(overview).includes(privateTitle), false);
      assert.equal(
        (
          await (
            await fetch(base + '/admin/activity', {
              headers: { Authorization: 'Bearer ' + admin },
            })
          ).json()
        ).total,
        0,
      );
      const staleOwner = await auth.resolveOwner('Bearer ' + token);
      await auth.logoutAll(token);
      const count = await db.userCase.count();
      assert.equal(
        (await post('', { ...create, requestId: randomUUID() })).status,
        401,
      );
      await assert.rejects(
        cases.change(staleOwner, {
          action: 'CREATE_CASE',
          confirmed: true,
          requestId: randomUUID(),
          caseId: randomUUID(),
          title: '폐기된 인증',
          typeCode: 'OTHER',
        }),
        { status: 401 },
      );
      assert.equal(await db.userCase.count(), count);
      if (process.env.AURORE_CASES_UI) {
        temp = await mkdtemp(join(tmpdir(), 'aurore-cases-ui-'));
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

        const browserToken = (await auth.login('case_owner', 'Synthetic8!'))
          .token;
        const browserHeaders = {
          Cookie: 'aurore_session=' + browserToken,
          Origin: 'http://127.0.0.1:3002',
        };
        const downloadExport = await fetch(
          'http://127.0.0.1:3002/cases/' + exportCase + '/export',
          { headers: browserHeaders },
        );
        assert.equal(downloadExport.status, 200);
        assert.match(
          downloadExport.headers.get('content-disposition'),
          /attachment; filename="aurore-case-/,
        );
        assert.match(
          downloadExport.headers.get('content-type'),
          /text\/markdown/,
        );
        assert.ok(!(await downloadExport.text()).includes('010-1234-5678'));
        assert.equal(
          (await fetch('http://127.0.0.1:3002/cases/' + exportCase + '/export'))
            .status,
          401,
        );
        const browserChat = randomUUID(),
          browserForm = new FormData();
        browserForm.set(
          'file',
          new Blob(['가상의 첨부자료\n연락처 010-1234-5678']),
          'browser-fixture.txt',
        );
        const browserPreviewResponse = await fetch(
          'http://127.0.0.1:3002/api/chat-documents/' +
            browserChat +
            '/preview',
          { method: 'POST', headers: browserHeaders, body: browserForm },
        );
        assert.equal(
          browserPreviewResponse.status,
          200,
          await browserPreviewResponse.clone().text(),
        );
        const browserPreview = await browserPreviewResponse.json();
        assert.equal(
          (
            await docPost(
              browserChat,
              {
                receipt: browserPreview.receipt,
                markdown: browserPreview.markdown,
                confirmed: true,
              },
              'Bearer ' + browserToken,
            )
          ).status,
          201,
        );
        const browserDocument = (
          await (await docGet(browserChat, '', 'Bearer ' + browserToken)).json()
        ).items[0];
        const browserDownload = await fetch(
          'http://127.0.0.1:3002/api/chat-documents/' +
            browserChat +
            '/' +
            browserDocument.id +
            '/download',
          { headers: browserHeaders },
        );
        assert.equal(browserDownload.status, 200);
        assert.match(
          browserDownload.headers.get('content-disposition'),
          /attachment/,
        );
        assert.ok(!(await browserDownload.text()).includes('010-1234-5678'));
        assert.equal(
          (
            await fetch(
              'http://127.0.0.1:3002/api/chat-documents/' +
                browserChat +
                '/' +
                browserDocument.id +
                '/download',
            )
          ).status,
          401,
        );
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
      if (created && /^aurore_cases_test_[0-9a-f]{12}$/.test(name))
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
