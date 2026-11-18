import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const postgresContainer = process.env.AURORE_PG_CONTAINER ?? 'aurore-dev-check-postgres';
const require = createRequire(new URL('../package.json', import.meta.url));
let developmentUrl;
try {
  developmentUrl = new URL(process.env.DATABASE_URL);
  if (developmentUrl.hostname !== '127.0.0.1' || developmentUrl.port !== '5433' ||
    developmentUrl.pathname !== '/aurore_dev_check') developmentUrl = null;
} catch { developmentUrl = null; }

test('chat storage preserves ownership, retries, leases, deletion, expiry and pagination', {
  skip: !developmentUrl && 'Run after build with --env-file=../local-dev/.env',
  timeout: 60000,
}, async () => {
  require('reflect-metadata');
  const { ConfigService } = require('@nestjs/config');
  const { PrismaService } = await import('../dist/prisma/prisma.service.js');
  const { AuthService } = await import('../dist/auth/auth.service.js');
  const { ChatService } = await import('../dist/chat/chat.service.js');
  const name = 'aurore_chat_test_' + randomBytes(6).toString('hex');
  const url = new URL(developmentUrl.href);
  url.pathname = '/' + name;
  const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { windowsHide: true, encoding: 'utf8', ...options });
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  let db;
  let created = false;
  let chat;
  async function until(check) {
    for (let i = 0; i < 400; i += 1) {
      if (await check()) return;
      await delay(20);
    }
    throw new Error('Chat operation timed out');
  }
  const idle = () => until(() => !chat.working);
  const answer = { phase: 'start', text: '검증용 답변' };
  function gate() {
    let resolve;
    let started = false;
    const promise = new Promise(finish => { resolve = finish; });
    return { resolve: () => resolve(answer), get started() { return started; }, generate: () => { started = true; return promise; } };
  }
  try {
    run('docker', ['exec', postgresContainer, 'createdb', '-U', 'aurore_dev_check', name]);
    created = true;
    run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', 'prisma7.config.ts'], {
      cwd: root, env: { ...process.env, DATABASE_URL: url.href },
    });
    db = new PrismaService(new ConfigService({ DATABASE_URL: url.href }));
    await db.$connect();
    const auth = new AuthService(db);
    let generate = async () => answer;
    chat = new ChatService(db, auth, { generate: (...args) => generate(...args) });
    await auth.signup('store_user', '검증회원', 'Synthetic8!');
    const memberToken = (await auth.login('store_user', 'Synthetic8!')).token;
    const member = await auth.resolveOwner('Bearer ' + memberToken);
    const guestToken = (await auth.createGuest()).token;
    const guest = await auth.resolveOwner('Guest ' + guestToken);
    const foreign = await auth.resolveOwner('Guest ' + (await auth.createGuest()).token);

    const roomId = randomUUID();
    const requestId = randomUUID();
    await Promise.all([
      chat.submit(roomId, member, requestId, '저장 검증', 0),
      chat.submit(roomId, member, requestId, '저장 검증', 0),
    ]);
    await idle();
    assert.equal((await chat.read(roomId, member)).messages.length, 2);
    assert.equal(await db.aiJob.count({ where: { chatSessId: roomId } }), 1);
    await chat.submit(roomId, member, randomUUID(), '후속 질문', 2);
    await idle();
    const repeated = await chat.submit(roomId, member, requestId, '저장 검증', 0);
    assert.equal(repeated.jobId, requestId);
    assert.equal(repeated.messages.length, 4);
    await assert.rejects(chat.submit(roomId, member, requestId, '다른 질문', 0), { status: 409 });
    await assert.rejects(chat.read(roomId, foreign), { status: 404 });
    await assert.rejects(chat.remove(roomId, foreign, 2), { status: 404 });
    const foreignRoom = randomUUID();
    await assert.rejects(chat.submit(foreignRoom, foreign, requestId, '저장 검증', 0), { status: 404 });
    assert.equal(await db.chatSess.count({ where: { id: foreignRoom } }), 0);

    const guestRoom = randomUUID();
    await chat.submit(guestRoom, guest, randomUUID(), '비회원 대화', 0);
    await idle();
    assert.equal((await chat.list(member)).items.some(row => row.id === guestRoom), false);
    await assert.rejects(chat.read(guestRoom, member), { status: 404 });
    const originalExpiry = (await chat.read(guestRoom, guest)).expiresAt;
    const beforePolling = await db.guestSess.findUnique({ where: { id: guest.guestSessId } });
    await chat.read(guestRoom, guest);
    assert.deepEqual((await db.guestSess.findUnique({ where: { id: guest.guestSessId } })).lastActDttm, beforePolling.lastActDttm);
    await auth.resolveOwner('Guest ' + guestToken, true);
    assert.equal((await chat.read(guestRoom, guest)).expiresAt, originalExpiry);
    const dates = await db.$queryRaw`
      SELECT (('2026-01-31 15:00:00+09'::timestamptz AT TIME ZONE 'Asia/Seoul') + interval '1 month') AT TIME ZONE 'Asia/Seoul' AS value
    `;
    assert.equal(dates[0].value.toISOString(), '2026-02-28T06:00:00.000Z');

    const deleted = randomUUID();
    let pending = gate();
    generate = pending.generate;
    await chat.submit(deleted, member, randomUUID(), '삭제 경합', 0);
    await until(() => pending.started);
    await chat.remove(deleted, member, 1);
    pending.resolve();
    await idle();
    await assert.rejects(chat.read(deleted, member), { status: 404 });
    assert.equal(await db.chatMsg.count({ where: { chatSessId: deleted, roleCd: 'ASSISTANT' } }), 0);
    assert.equal(await db.chatMsg.count({ where: { chatSessId: deleted, delYn: false } }), 0);

    const stale = randomUUID();
    const staleJob = randomUUID();
    pending = gate();
    generate = pending.generate;
    await chat.submit(stale, member, staleJob, '점유 경합', 0);
    await until(() => pending.started);
    await db.aiJob.update({
      where: { id: staleJob },
      data: { leaseToken: randomUUID(), leaseDttm: new Date(Date.now() + 90000) },
    });
    pending.resolve();
    await idle();
    assert.equal(await db.chatMsg.count({ where: { chatSessId: stale, roleCd: 'ASSISTANT' } }), 0);
    await db.aiJob.update({ where: { id: staleJob }, data: { leaseDttm: new Date(Date.now() - 5000) } });
    generate = async () => answer;
    await chat.drain();
    assert.equal((await chat.read(stale, member)).messages.length, 2);
    assert.equal((await db.aiJob.findUnique({ where: { id: staleJob } })).attemptNo, 2);

    const recovering = randomUUID();
    let attempts = 0;
    generate = async () => { if (++attempts < 3) throw new Error('synthetic transient failure'); return answer; };
    await chat.submit(recovering, member, randomUUID(), '일시 실패', 0);
    await idle();
    for (let i = 0; i < 2; i += 1) { await delay(1100); await chat.drain(); }
    assert.equal((await chat.read(recovering, member)).job.status, 'SUCCEEDED');
    assert.equal(attempts, 3);

    pending = gate();
    generate = pending.generate;
    const first = randomUUID();
    const second = randomUUID();
    const excessive = randomUUID();
    await chat.submit(first, member, randomUUID(), '동시 작업 하나', 0);
    await until(() => pending.started);
    await chat.submit(second, member, randomUUID(), '동시 작업 둘', 0);
    await assert.rejects(chat.submit(excessive, member, randomUUID(), '동시 작업 셋', 0), { status: 409 });
    assert.equal(await db.chatSess.count({ where: { id: excessive } }), 0);
    pending.resolve();
    await idle();

    const expiring = randomUUID();
    pending = gate();
    generate = pending.generate;
    await chat.submit(expiring, guest, randomUUID(), '만료 경합', 0);
    await until(() => pending.started);
    await db.chatSess.update({ where: { id: expiring }, data: { exprDttm: new Date(Date.now() - 5000) } });
    pending.resolve();
    await idle();
    await assert.rejects(chat.read(expiring, guest), { status: 404 });
    assert.equal(await db.chatMsg.count({ where: { chatSessId: expiring, roleCd: 'ASSISTANT' } }), 0);

    await chat.expire();
    assert.equal((await db.chatSess.findUnique({ where: { id: expiring } })).delYn, true);
    assert.equal((await db.chatSess.findUnique({ where: { id: roomId } })).delYn, false);

    const overdue = randomUUID();
    const overdueJob = randomUUID();
    pending = gate();
    generate = pending.generate;
    await chat.submit(overdue, member, overdueJob, '전체 처리 제한', 0);
    await until(() => pending.started);
    await db.aiJob.update({ where: { id: overdueJob }, data: { deadlineDttm: new Date(Date.now() - 1000) } });
    pending.resolve();
    await idle();
    assert.equal((await chat.read(overdue, member)).job.status, 'FAILED');
    assert.equal(await db.chatMsg.count({ where: { chatSessId: overdue, roleCd: 'ASSISTANT' } }), 0);
    generate = async () => answer;
    await chat.retry(overdueJob, member);
    await idle();
    assert.equal((await chat.read(overdue, member)).job.status, 'SUCCEEDED');
    assert.equal((await chat.read(overdue, member)).messages.length, 2);

    const longRoom = randomUUID();
    await db.chatSess.create({ data: { id: longRoom, userId: member.userId, sessNm: '긴 대화', nextMsgSeq: 107 } });
    const turns = [];
    for (let sequence = 1; sequence <= 106; sequence += 2) {
      const parent = randomUUID();
      turns.push({ id: parent, chatSessId: longRoom, msgSeq: sequence, roleCd: 'USER', msgCont: '질문 ' + sequence });
      turns.push({ id: randomUUID(), chatSessId: longRoom, prntMsgId: parent, msgSeq: sequence + 1, roleCd: 'ASSISTANT', msgCont: '답변 ' + sequence });
    }
    await db.chatMsg.createMany({ data: turns });
    const recent = await chat.read(longRoom, member);
    const earlier = await chat.read(longRoom, member, recent.nextBeforeSeq);
    assert.equal(recent.messages.length, 100);
    assert.equal(earlier.messages.length, 6);
    assert.equal(earlier.messages[0].sequence, 1);
    assert.equal(recent.messages.at(-1).sequence, 106);
    await assert.rejects(db.chatMsg.create({
      data: { chatSessId: roomId, prntMsgId: turns[0].id, msgSeq: 99, roleCd: 'ASSISTANT', msgCont: '다른 대화 부모' },
    }), error => error.code === 'P2003');

    generate = async () => answer;
    for (let i = 0; i < 15; i += 1) {
      await chat.submit(randomUUID(), member, randomUUID(), '목록 ' + i, 0);
      await idle();
    }
    const page = await chat.list(member);
    assert.equal(page.items.length, 20);
    assert.ok(page.nextCursor);
    const next = await chat.list(member, page.nextCursor);
    assert.ok(next.items.length > 0);
    assert.equal(next.items.some(row => page.items.some(previous => previous.id === row.id)), false);
    await db.chatSess.createMany({ data: Array.from({length:55},(_,i)=>({id:randomUUID(),userId:member.userId,sessNm:'크기 검증 '+i,uptDttm:new Date('2020-01-01')})) });
    for (const size of [10,20,50]) { const a=await chat.list(member,undefined,size);const b=await chat.list(member,a.nextCursor,size);assert.equal(a.items.length,size);assert.ok(a.nextCursor);assert.equal(a.items.some(x=>b.items.some(y=>x.id===y.id)),false);assert.ok(a.items.every(x=>Number.isInteger(x.unreadCorrectionCount))); }
    await assert.rejects(chat.list(member, 'invalid'), { status: 400 });
    const memberRooms = await chat.list(member);
    assert.equal(memberRooms.items.some(row => row.id === guestRoom), false);
    await auth.logout(memberToken);
    await assert.rejects(auth.resolveOwner('Bearer ' + memberToken), { status: 401 });
  } finally {
    await chat?.onModuleDestroy();
    await db?.$disconnect();
    if (created && /^aurore_chat_test_[0-9a-f]{12}$/.test(name)) {
      run('docker', ['exec', postgresContainer, 'dropdb', '--force', '-U', 'aurore_dev_check', name]);
    }
  }
});
