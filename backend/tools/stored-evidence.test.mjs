import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
const require = createRequire(new URL('../package.json', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
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
  'stored evidence verifies snapshot text, version/date/deletion boundaries, separates retrieval from relevance and persists provenance',
  {
    skip: !development,
    timeout: process.env.AURORE_EVIDENCE_UI ? 600000 : 60000,
  },
  async () => {
    require('reflect-metadata');
    const { ConfigService } = require('@nestjs/config');
    const { PrismaService } = await import('../dist/prisma/prisma.service.js');
    const { AuthService } = await import('../dist/auth/auth.service.js');
    const { ChatService } = await import('../dist/chat/chat.service.js');
    const { ChatAnswerService } =
      await import('../dist/chat/answer.service.js');
    const { retrieveStoredEvidence, searchTerms } =
      await import('../dist/chat/stored-evidence.js');
    const name = 'aurore_evidence_test_' + randomBytes(6).toString('hex'),
      url = new URL(development.href);
    url.pathname = '/' + name;
    const run = (cmd, args, opts = {}) => {
      const r = spawnSync(cmd, args, {
        windowsHide: true,
        encoding: 'utf8',
        ...opts,
      });
      assert.equal(r.status, 0, r.stderr);
    };
    let uiApp, uiWeb, uiTemp;
    let created = false,
      db,
      chat,
      server;
    const original = process.env.AURORE_AI_URL;
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
        { cwd: root, env: { ...process.env, DATABASE_URL: url.href } },
      );
      db = new PrismaService(new ConfigService({ DATABASE_URL: url.href }));
      await db.$connect();
      const legal = await db.legal.create({
        data: { srcCd: 'MOLEG', srcKey: 'TST0001', legalNm: '가상 검증법' },
      });
      async function edition(date, text) {
        const key = 'test-' + date;
        const payload = {
          법령: {
            법령키: key,
            기본정보: {
              법령ID: legal.srcKey,
              법령명_한글: legal.legalNm,
              시행일자: date.replaceAll('-', ''),
            },
            조문: {
              조문단위: {
                조문여부: '조문',
                조문번호: '1',
                조문제목: '임차권등기명령',
                조문내용: text,
              },
            },
          },
        };
        const raw = JSON.stringify(payload),
          hash = createHash('sha256').update(raw).digest('hex');
        const snapshot = await db.srcSnapshot.create({
          data: {
            srcCd: 'MOLEG',
            srcKey: legal.srcKey,
            srcUrl: 'https://www.law.go.kr/',
            contType: 'application/json',
            srcCont: raw,
            contHash: hash,
          },
        });
        const version = await db.legalVer.create({
          data: { legalId: legal.id, verKey: key, enfcDt: new Date(date) },
        });
        const revision = await db.legalVerRev.create({
          data: {
            legalVerId: version.id,
            revNo: 1,
            currentYn: true,
            srcSnapshotId: snapshot.id,
          },
        });
        const provision = await db.legalProvi.create({
          data: {
            legalVerRevId: revision.id,
            proviTypeCd: 'ARTICLE',
            dispNo: '제1조',
            normNo: '1',
            sortSeq: 1,
            proviCont: text,
          },
        });
        return { snapshot, version, revision, provision, text };
      }
      const old = await edition(
        '2025-01-01',
        '제1조 임차권등기명령에 관한 이전 가상 검증 문구입니다.',
      );
      const active = await edition(
        '2026-01-01',
        '제1조 임차권등기명령에 관한 현재 가상 검증 문구입니다.',
      );
      await edition(
        '2099-01-01',
        '제1조 임차권등기명령에 관한 미래 가상 검증 문구입니다.',
      );
      let found = await retrieveStoredEvidence(
        db,
        '임차권등기명령 요건',
        '2026-11-16',
      );
      assert.equal(found.length, 1);
      assert.equal(found[0].citation.legalVerId, active.version.id);
      assert.equal(found[0].markdown, active.text);
      const contextHint = await retrieveStoredEvidence(
        db,
        '임차권등기명령',
        '2026-11-16',
        '참고한 사실에는 제9999조라는 표현이 있습니다.',
      );
      assert.equal(contextHint[0].citation.legalVerId, active.version.id);
      const spacedArticle = await retrieveStoredEvidence(
        db,
        '가상 검증법 제 1 조',
        '2026-11-16',
      );
      assert.equal(spacedArticle.length, 1);
      assert.equal(spacedArticle[0].citation.legalVerId, active.version.id);
      assert.equal(
        (await retrieveStoredEvidence(db, '다른가상법 제 1 조', '2026-11-16'))
          .length,
        0,
      );
      assert.equal(
        (await retrieveStoredEvidence(db, '제9999조', '2026-11-16')).length,
        0,
      );

      assert.equal(
        (await retrieveStoredEvidence(db, '임차권등기명령', '2025-06-01'))[0]
          .citation.legalVerId,
        old.version.id,
      );
      assert.equal(
        (await retrieveStoredEvidence(db, '알려주세요', '2026-11-16')).length,
        0,
      );
      assert.deepEqual(searchTerms('세입자는 집주인에게 전세금을 알려주세요'), [
        '임차인',
        '임대인',
        '보증금',
      ]);
      assert.equal(
        (
          await retrieveStoredEvidence(
            db,
            "' OR 1=1 -- 무관한질문",
            '2026-11-16',
          )
        ).length,
        0,
      );
      await db.legalProvi.update({
        where: { id: active.provision.id },
        data: { delYn: true, delDttm: new Date() },
      });
      assert.equal(
        (await retrieveStoredEvidence(db, '임차권등기명령', '2026-11-16'))
          .length,
        0,
      );
      await db.legalProvi.update({
        where: { id: active.provision.id },
        data: { delYn: false, delDttm: null },
      });
      await db.srcSnapshot.update({
        where: { id: active.snapshot.id },
        data: { srcCont: active.snapshot.srcCont + ' ' },
      });
      assert.equal(
        (await retrieveStoredEvidence(db, '임차권등기명령', '2026-11-16'))
          .length,
        0,
      );
      await db.srcSnapshot.update({
        where: { id: active.snapshot.id },
        data: { srcCont: active.snapshot.srcCont },
      });
      const caseText =
        '임차권등기명령에 대한 가상 판결요지입니다. 실제 판결이 아닙니다.';
      const raw = JSON.stringify({
        PrecService: {
          판례정보일련번호: 'TSTCASE',
          사건번호: '2024다12345',
          선고일자: '20240102',
          사건명: '가상 검증사건',
          법원명: '검증법원',
          판결요지: caseText,
          판례내용: caseText,
        },
      });
      const snap = await db.srcSnapshot.create({
        data: {
          srcCd: 'MOLEG',
          srcKey: 'TSTCASE',
          srcUrl: 'https://www.law.go.kr/',
          contType: 'application/json',
          srcCont: raw,
          contHash: createHash('sha256').update(raw).digest('hex'),
        },
      });
      const precedent = await db.legalPrec.create({
        data: { srcCd: 'MOLEG', srcKey: 'TSTCASE' },
      });
      await db.legalPrecRev.create({
        data: {
          legalPrecId: precedent.id,
          srcSnapshotId: snap.id,
          revNo: 1,
          currentYn: true,
          caseNo: '2024다12345',
          caseNm: '가상 검증사건',
          courtNm: '검증법원',
          decisionDt: new Date('2024-01-02'),
          summaryCont: caseText,
          decisionCont: caseText,
        },
      });
      assert.equal(
        (await retrieveStoredEvidence(db, '2024다12345', '2026-11-16'))[0]
          .citation.legalPrecId,
        precedent.id,
      );
      const spacedCase = await retrieveStoredEvidence(
        db,
        '2024 다 12345',
        '2026-11-16',
      );
      assert.equal(spacedCase.length, 1);
      assert.equal(spacedCase[0].citation.legalPrecId, precedent.id);
      assert.equal(
        (await retrieveStoredEvidence(db, '2024 다 9999999', '2026-11-16'))
          .length,
        0,
      );
      await db.legalPrec.update({
        where: { id: precedent.id },
        data: { delYn: true, delDttm: new Date() },
      });
      assert.equal(
        (await retrieveStoredEvidence(db, '2024다12345', '2026-11-16')).length,
        0,
      );
      let ready = false,
        bad = false,
        received = [],
        receivedContext,
        modelGate,
        requestSeen = false;
      server = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/documents/health') {
          res.end(JSON.stringify({ ready }));
          return;
        }
        let body = '';
        for await (const part of req) body += part;
        const payload = JSON.parse(body);
        received = payload.documents;
        receivedContext = payload.context;
        requestSeen = true;
        if (modelGate) await modelGate;
        res.end(
          JSON.stringify({
            supportChecked: true,
            quotes: [
              {
                documentId: received[0].id,
                quote: bad
                  ? '원문에 존재하지 않는 가짜 인용문입니다.'
                  : received[0].markdown,
              },
            ],
          }),
        );
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      process.env.AURORE_AI_URL = 'http://127.0.0.1:' + server.address().port;
      const answers = new ChatAnswerService(db);
      const unreviewed = await answers.generate('임차권등기명령 요건', 'start');
      assert.equal(unreviewed.citation.supportVerifyCd, 'UNREVIEWED');
      assert.equal(unreviewed.providerCd, 'STORED_SEARCH');
      assert.equal(unreviewed.resultCd, 'AI_NOT_READY');
      const auth = new AuthService(db);
      const guest = await auth.resolveOwner(
        'Guest ' + (await auth.createGuest()).token,
      );
      chat = new ChatService(db, auth, answers);
      const room = randomUUID();
      await chat.submit(room, guest, randomUUID(), '임차권등기명령 요건', 0);
      for (let n = 0; n < 300 && chat.working; n++) await delay(20);
      const detail = await chat.read(room, guest);
      assert.equal(detail.messages.at(-1).source.verification, 'UNREVIEWED');
      assert.equal(
        (await db.aiJob.findFirstOrThrow()).providerCd,
        'STORED_SEARCH',
      );
      const clarifyChat = new ChatService(db, auth, answers);
      await clarifyChat.onModuleDestroy();
      const gapQuestion = '가상무관분쟁에 대한 법적 근거를 알려주세요';
      async function gapRoom() {
        const id = randomUUID();
        await clarifyChat.submit(id, guest, randomUUID(), gapQuestion, 0);
        await clarifyChat.drain();
        return clarifyChat.read(id, guest);
      }
      const gap = await gapRoom();
      assert.equal(gap.messages.at(-1).clarification, 'SOURCE_GAP');
      assert.equal(gap.messages.at(-1).source, undefined);
      const gapAnswer = await db.chatMsg.findUniqueOrThrow({
        where: { id: gap.messages.at(-1).id },
      });
      assert.equal(
        (
          await db.aiJob.findFirstOrThrow({
            where: { answerMsgId: gapAnswer.id },
          })
        ).resultCd,
        'SOURCE_GAP',
      );
      const target = gap.messages.at(-1).id;
      const replyId = randomUUID();
      const replyText = '임차권등기명령의 요건을 확인하고 싶어요';
      await clarifyChat.submit(
        gap.id,
        guest,
        replyId,
        replyText,
        gap.revision,
        [],
        undefined,
        target,
      );
      await clarifyChat.drain();
      const supplemented = await clarifyChat.read(gap.id, guest);
      assert.equal(supplemented.messages.at(-2).clarifyReplyTo, target);
      assert.equal(
        supplemented.messages.at(-1).source.verification,
        'UNREVIEWED',
      );
      assert.equal(supplemented.messages.at(-1).clarification, undefined);
      assert.equal(
        (
          await clarifyChat.submit(
            gap.id,
            guest,
            replyId,
            replyText,
            gap.revision,
            [],
            undefined,
            target,
          )
        ).jobId,
        replyId,
      );
      await assert.rejects(
        clarifyChat.submit(
          gap.id,
          guest,
          randomUUID(),
          '다시 보완',
          supplemented.revision,
          [],
          undefined,
          target,
        ),
        { status: 409 },
      );
      const noInfo = await gapRoom();
      await clarifyChat.submit(
        noInfo.id,
        guest,
        randomUUID(),
        '잘 모르겠어요',
        noInfo.revision,
        [],
        undefined,
        noInfo.messages.at(-1).id,
      );
      await clarifyChat.drain();
      const noInfoDetail = await clarifyChat.read(noInfo.id, guest);
      assert.equal(noInfoDetail.messages.at(-1).source, undefined);
      assert.equal(noInfoDetail.messages.at(-1).clarification, undefined);
      assert.match(noInfoDetail.messages.at(-1).text, /추정하지/);
      const stillGap = await gapRoom();
      await clarifyChat.submit(
        stillGap.id,
        guest,
        randomUUID(),
        '여전히가상무관분쟁으로 설명할게요',
        stillGap.revision,
        [],
        undefined,
        stillGap.messages.at(-1).id,
      );
      await clarifyChat.drain();
      const stopped = await clarifyChat.read(stillGap.id, guest);
      assert.equal(stopped.messages.at(-1).clarification, undefined);
      assert.match(stopped.messages.at(-1).text, /추가 설명/);
      const newTopic = await gapRoom();
      await clarifyChat.submit(
        newTopic.id,
        guest,
        randomUUID(),
        '안녕하세요',
        newTopic.revision,
      );
      await clarifyChat.drain();
      const newTopicDetail = await clarifyChat.read(newTopic.id, guest);
      assert.equal(newTopicDetail.messages.at(-2).clarifyReplyTo, undefined);
      assert.equal(newTopicDetail.messages.at(-1).source, undefined);
      await assert.rejects(
        clarifyChat.submit(
          room,
          guest,
          randomUUID(),
          '다른 대화 참조',
          detail.revision,
          [],
          undefined,
          newTopic.messages.at(-1).id,
        ),
        { status: 409 },
      );
      ready = true;
      const reviewed = await answers.generateStored('임차권등기명령 요건');
      assert.equal(reviewed.citation.supportVerifyCd, 'MODEL_REVIEWED');
      assert.equal(reviewed.resultCd, 'EVIDENCE_FOUND');
      assert.equal(reviewed.citation.citeCont, active.text);
      assert.ok(received.every((doc) => doc.markdown !== old.text));
      bad = true;
      await assert.rejects(
        answers.generateStored('임차권등기명령 요건'),
        /DocumentQuoteMismatch/,
      );
      bad = false;
      await chat.onModuleDestroy();
      const { CasesService } = await import('../dist/cases/cases.service.js');
      await auth.signup('context_user', '사건활용검증', 'Synthetic8!');
      await auth.signup('ctx_other', '다른검증회원', 'Synthetic8!');
      const owner = await auth.resolveOwner(
        'Bearer ' + (await auth.login('context_user', 'Synthetic8!')).token,
      );
      const other = await auth.resolveOwner(
        'Bearer ' + (await auth.login('ctx_other', 'Synthetic8!')).token,
      );
      const cases = new CasesService(db, auth),
        caseId = randomUUID();
      await cases.change(owner, {
        action: 'CREATE_CASE',
        requestId: randomUUID(),
        caseId,
        title: '가상 사건 활용 검증',
        typeCode: 'LEASE',
        confirmed: true,
      });
      await cases.change(owner, {
        action: 'CREATE_FACT',
        requestId: randomUUID(),
        caseId,
        revision: 1,
        title: '임차권등기명령 검토',
        content: '계약 종료 의사를 전달했습니다. 연락처 010-1234-5678',
        occurredOn: '2025-05-01',
        confirmed: true,
      });
      await cases.change(owner, {
        action: 'CREATE_FACT',
        requestId: randomUUID(),
        caseId,
        revision: 2,
        title: '선택하지 않은 사실',
        content: '절대로 전달하지 않을 비선택 내용입니다.',
        occurredOn: '2026-11-01',
        confirmed: true,
      });
      const facts = await db.caseFact.findMany({
        where: { userCaseId: caseId },
        orderBy: { id: 'asc' },
      });
      const contextRoom = randomUUID();
      await chat.submit(contextRoom, owner, randomUUID(), '안녕하세요', 0);
      await chat.drain();
      let roomDetail = await chat.read(contextRoom, owner);
      await chat.linkCase(
        contextRoom,
        owner,
        roomDetail.revision,
        caseId,
        true,
      );
      const options = await chat.caseContextOptions(contextRoom, owner, 10, 0);
      assert.equal(options.total, 2);
      assert.ok(!JSON.stringify(options).includes('010-1234-5678'));
      await assert.rejects(chat.caseContextOptions(contextRoom, other), {
        status: 404,
      });
      await assert.rejects(chat.caseContextOptions(contextRoom, guest), {
        status: 403,
      });
      const selection = {
        revision: 3,
        factIds: [facts[0].id.toString()],
        asOf: '2025-06-01',
        confirmed: true,
      };
      const rev = async () => (await chat.read(contextRoom, owner)).revision;
      await assert.rejects(
        chat.submit(contextRoom, owner, randomUUID(), '질문', await rev(), [], {
          ...selection,
          asOf: '2025-02-30',
        }),
        { status: 400 },
      );
      await assert.rejects(
        chat.submit(contextRoom, owner, randomUUID(), '질문', await rev(), [], {
          ...selection,
          factIds: ['999999999'],
        }),
        { status: 409 },
      );
      const contextJob = randomUUID();
      await chat.submit(
        contextRoom,
        owner,
        contextJob,
        '어떤 근거가 있나요?',
        await rev(),
        [],
        selection,
      );
      await chat.drain();
      roomDetail = await chat.read(contextRoom, owner);
      assert.equal(roomDetail.messages.at(-1).caseContext.asOf, '2025-06-01');
      assert.equal(roomDetail.messages.at(-1).source.quote, old.text);
      assert.ok(receivedContext.includes('계약 종료'));
      assert.ok(!receivedContext.includes('010-1234-5678'));
      assert.ok(!receivedContext.includes('비선택'));
      const savedContext = (
        await db.aiJob.findUniqueOrThrow({ where: { id: contextJob } })
      ).caseContext;
      assert.equal(savedContext.hash.length, 64);
      assert.ok(!JSON.stringify(savedContext).includes('계약 종료'));
      const pendingJob = randomUUID();
      await chat.submit(
        contextRoom,
        owner,
        pendingJob,
        '어떤 근거가 있나요?',
        await rev(),
        [],
        selection,
      );
      await cases.change(owner, {
        action: 'UPDATE_FACT',
        requestId: randomUUID(),
        caseId,
        revision: 3,
        factId: facts[0].id.toString(),
        title: '임차권등기명령 검토',
        content: '계약 종료에 관한 변경한 사실입니다.',
        occurredOn: '2025-05-02',
        confirmed: true,
      });
      requestSeen = false;
      await chat.drain();
      assert.equal(requestSeen, false);
      assert.equal(
        (await db.aiJob.findUniqueOrThrow({ where: { id: pendingJob } }))
          .statCd,
        'CANCELLED',
      );
      await assert.rejects(chat.retry(pendingJob, owner), { status: 409 });
      let release;
      modelGate = new Promise((resolve) => {
        release = resolve;
      });
      const raceJob = randomUUID();
      await chat.submit(
        contextRoom,
        owner,
        raceJob,
        '어떤 근거가 있나요?',
        await rev(),
        [],
        { ...selection, revision: 4 },
      );
      requestSeen = false;
      const processing = chat.drain();
      for (let n = 0; n < 200 && !requestSeen; n++) await delay(10);
      assert.ok(requestSeen);
      await cases.change(owner, {
        action: 'DELETE_FACT',
        requestId: randomUUID(),
        caseId,
        revision: 4,
        factId: facts[0].id.toString(),
        confirmed: true,
      });
      release();
      await processing;
      modelGate = null;
      assert.equal(
        (await db.aiJob.findUniqueOrThrow({ where: { id: raceJob } })).statCd,
        'CANCELLED',
      );
      assert.equal(
        await db.chatMsg.count({
          where: { chatSessId: contextRoom, roleCd: 'ASSISTANT' },
        }),
        2,
      );
      await db.aiJob.updateMany({
        where: { chatSessId: contextRoom },
        data: { rgstDttm: new Date('2026-01-01T00:00:00Z') },
      });
      const changedDetail = await chat.read(contextRoom, owner);
      assert.equal(changedDetail.job.id, raceJob);
      assert.equal(changedDetail.job.reason, 'CASE_CONTEXT_CHANGED');
      assert.equal(
        changedDetail.messages.find((row) => row.caseContext)?.caseContext
          .current,
        false,
      );
      const finalOptions = await chat.caseContextOptions(
        contextRoom,
        owner,
        10,
        0,
      );
      assert.equal(finalOptions.total, 1);
      await assert.rejects(
        chat.submit(contextRoom, owner, randomUUID(), '질문', await rev(), [], {
          ...selection,
          revision: 5,
        }),
        { status: 409 },
      );
      await db.legal.update({
        where: { id: legal.id },
        data: { delYn: true, delDttm: new Date() },
      });
      assert.equal(
        (await retrieveStoredEvidence(db, '임차권등기명령', '2026-11-16'))
          .length,
        0,
      );
      assert.equal(
        (await answers.generateStored('임차권등기명령')).citation,
        undefined,
      );
      if (process.env.AURORE_EVIDENCE_UI) {
        await cases.change(owner, {
          action: 'CREATE_FACT',
          requestId: randomUUID(),
          caseId,
          revision: 5,
          title: '임차권등기명령 근거 확인',
          content: '가상의 계약 종료 사실을 검토했습니다.',
          occurredOn: '2025-05-03',
          confirmed: true,
        });
        ready = false;
        await chat.submit(
          contextRoom,
          owner,
          randomUUID(),
          gapQuestion,
          await rev(),
        );
        await chat.drain();
        await db.legal.update({
          where: { id: legal.id },
          data: { delYn: false, delDttm: null },
        });
        const { Test } = require('@nestjs/testing'),
          { ValidationPipe } = require('@nestjs/common');
        const { AppModule } = await import('../dist/app.module.js');
        const module = await Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(ConfigService)
          .useValue(new ConfigService({ DATABASE_URL: url.href }))
          .compile();
        uiApp = module.createNestApplication({ logger: false });
        uiApp.useGlobalPipes(
          new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
          }),
        );
        await uiApp.listen(0, '127.0.0.1');
        const uiBase = await uiApp.getUrl();
        const uiToken = (await auth.login('context_user', 'Synthetic8!')).token;
        const previewApi = await fetch(
          uiBase + '/chat-sessions/' + contextRoom + '/case-context?limit=10',
          { headers: { Authorization: 'Bearer ' + uiToken } },
        );
        assert.equal(previewApi.status, 200);
        assert.equal(previewApi.headers.get('cache-control'), 'no-store');
        assert.equal(
          (
            await fetch(
              uiBase + '/chat-sessions/' + contextRoom + '/case-context',
            )
          ).status,
          401,
        );
        const malformed = await fetch(
          uiBase + '/chat-sessions/' + contextRoom + '/messages',
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + uiToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requestId: randomUUID(),
              question: '질문',
              revision: await rev(),
              caseContext: {
                revision: 6,
                factIds: [facts[1].id.toString()],
                asOf: '2025-06-01',
                confirmed: false,
              },
            }),
          },
        );
        assert.equal(malformed.status, 400);

        uiTemp = await mkdtemp(join(tmpdir(), 'aurore-evidence-ui-'));
        uiWeb = spawn(
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
            env: { ...process.env, BACKEND_URL: await uiApp.getUrl() },
            windowsHide: true,
            stdio: 'ignore',
          },
        );
        for (let n = 0; n < 80; n++) {
          try {
            if ((await fetch('http://127.0.0.1:3002/')).ok) break;
          } catch {}
          await delay(250);
        }
        console.log(
          'UI_READY http://127.0.0.1:3002/ stop=' + join(uiTemp, 'stop'),
        );
        const deadline = Date.now() + 8 * 60000;
        while (!fs.existsSync(join(uiTemp, 'stop')) && Date.now() < deadline)
          await delay(300);
      }
    } finally {
      if (uiWeb) {
        uiWeb.kill();
        if (uiWeb.exitCode === null)
          await new Promise((resolve) => uiWeb.once('exit', resolve));
      }
      await uiApp?.close();
      if (uiTemp) {
        assert.ok(
          fs.realpathSync(uiTemp).startsWith(fs.realpathSync(tmpdir()) + sep),
        );
        await rm(uiTemp, { recursive: true, force: true });
      }
      if (original === undefined) delete process.env.AURORE_AI_URL;
      else process.env.AURORE_AI_URL = original;
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await chat?.onModuleDestroy();
      await db?.$disconnect();
      if (created && /^aurore_evidence_test_[0-9a-f]{12}$/.test(name))
        run('docker', [
          'exec',
          'aurore-dev-check-postgres',
          'dropdb',
          '--force',
          '-U',
          'aurore_dev_check',
          name,
        ]);
    }
  },
);
