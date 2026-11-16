import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
let developmentUrl;
try {
  developmentUrl = new URL(process.env.DATABASE_URL);
  if (developmentUrl.hostname !== '127.0.0.1' || developmentUrl.port !== '5433' || developmentUrl.pathname !== '/aurore_dev_check') developmentUrl = null;
} catch { developmentUrl = null; }

test('admin APIs require a live session and a current ADMIN role under AURORE/USER_ROLE, and expose only operational metadata', {
  skip: !developmentUrl && 'Run after build with --env-file=../local-dev/.env', timeout: 60000,
}, async () => {
  require('reflect-metadata');
  const { ConfigService } = require('@nestjs/config');
  const { ValidationPipe } = require('@nestjs/common');
  const { Test } = require('@nestjs/testing');
  const { PrismaService } = await import('../dist/prisma/prisma.service.js');
  const { AuthService } = await import('../dist/auth/auth.service.js');
  const { AuthController } = await import('../dist/auth/auth.controller.js');
  const { AdminPrecedentService } = await import('../dist/admin/admin-precedent.service.js');
  const { AdminCorrectionService } = await import('../dist/admin/admin-correction.service.js');
  const { AdminRefreshService } = await import('../dist/admin/admin-refresh.service.js');
  const { AdminGuard } = await import('../dist/admin/admin.guard.js');
  const { AdminService } = await import('../dist/admin/admin.service.js');
  const { AdminController } = await import('../dist/admin/admin.controller.js');
  const name = 'aurore_admin_test_' + randomBytes(6).toString('hex');
  const url = new URL(developmentUrl.href); url.pathname = '/' + name;
  const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { windowsHide: true, encoding: 'utf8', ...options });
    assert.equal(result.status, 0, result.stderr); return result;
  };
  let created = false; let db; let app;
  try {
    run('docker', ['exec', 'aurore-dev-check-postgres', 'createdb', '-U', 'aurore_dev_check', name]); created = true;
    run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', 'prisma7.config.ts'], { cwd: root, env: { ...process.env, DATABASE_URL: url.href } });
    db = new PrismaService(new ConfigService({ DATABASE_URL: url.href })); await db.$connect();
    const module = await Test.createTestingModule({ controllers: [AuthController, AdminController], providers: [AdminPrecedentService, AuthService, AdminGuard, AdminService, AdminRefreshService, AdminCorrectionService, { provide: ConfigService, useValue: new ConfigService({ AURORE_COLLECTION_SCHEDULER_DIR:join(tmpdir(),name,'scheduler'), AURORE_LAW_REFRESH_JOURNAL: join(tmpdir(), name), AURORE_PRECEDENT_COLLECTION_ROOT: join(tmpdir(), name, 'precedents') }) }, { provide: PrismaService, useValue: db }] }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const auth = app.get(AuthService); const base = await app.getUrl();
    const get = (path, token, kind = 'Bearer') => fetch(base + '/admin/' + path, { headers: token ? { Authorization: kind + ' ' + token } : {} });
    const password = 'Synthetic8!';
    await auth.signup('admin_user', '관리검증', password);
    await auth.signup('normal_user', '일반검증', password);
    const token = (await auth.login('admin_user', password)).token;
    const normal = (await auth.login('normal_user', password)).token;
    const member = await auth.session(token, false); const userId = BigInt(member.id);
    assert.equal((await get('overview')).status, 401);
    assert.equal((await get('legal-refresh')).status, 401);
    assert.equal((await get('collection-schedule')).status,401);
    assert.equal((await get('privacy-retention')).status,401);
    assert.equal((await get('precedent-collections')).status, 401);
    assert.equal((await get('precedent-collections/'+'a'.repeat(64)+'/items/1')).status, 401);
    assert.equal((await get('session', randomBytes(32).toString('base64url'))).status, 401);
    assert.equal((await get('overview', (await auth.createGuest()).token, 'Guest')).status, 401);
    assert.equal((await get('overview', normal)).status, 403);
    assert.equal((await get('legal-refresh', normal)).status, 403);
    assert.equal((await get('collection-schedule',normal)).status,403);
    assert.equal((await get('privacy-retention',normal)).status,403);
    assert.equal((await get('precedent-collections', normal)).status, 403);
    assert.equal((await get('overview', token)).status, 403);
    const signup = await fetch(base + '/auth/signup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({loginId:'self_admin',nickname:'위조검증',password,role:'ADMIN'}) });
    assert.equal(signup.status, 400);
    const role = await db.cmmnCd.findFirst({ where: { cd:'ADMIN', parent:{cd:'USER_ROLE'} } });
    const otherGroup = await db.cmmnCd.findFirst({ where:{cd:'USER_AGR'} });
    const wrongCode = await db.cmmnCd.create({data:{cd:'ADMIN',cdNm:'다른 그룹',nodeTypeCd:'VALUE',prntCdId:otherGroup.id}});
    await db.userRole.create({data:{userId,roleCdId:wrongCode.id}});
    assert.equal((await get('overview', token)).status, 403);
    const grant = await db.userRole.create({ data:{userId,roleCdId:role.id} });
    await assert.rejects(db.userRole.create({data:{userId,roleCdId:role.id}}),error=>error.code==='P2002');
    assert.equal((await get('session',token)).status,200);
    const schedule=await get('collection-schedule',token);assert.equal(schedule.status,200);assert.equal((await schedule.json()).enabled,false);
    const collections=await get('precedent-collections',token);assert.equal(collections.status,200);assert.equal((await collections.json()).total,0);
    assert.equal((await get('precedent-collections/'+'a'.repeat(64),token)).status,404);
    const refresh=await get('legal-refresh',token); assert.equal(refresh.status,200); assert.equal((await refresh.json()).initialized,false);
    assert.equal((await get('legal-refresh/reviews/invalid',token)).status,404);
    const canary='SYNTHETIC_PRIVATE_CONTENT_DO_NOT_EXPOSE';
    const roomId=randomUUID(), inputId=randomUUID();
    await db.chatSess.create({data:{id:roomId,userId,sessNm:canary,messages:{create:{id:inputId,msgSeq:1,roleCd:'USER',msgCont:canary}}}});
    const jobId=randomUUID();
    await db.aiJob.create({data:{id:jobId,chatSessId:roomId,inputMsgId:inputId,requestHash:'0'.repeat(64),ownerAuthHash:randomBytes(32),phaseCd:'start',deadlineDttm:new Date(Date.now()+300000)}});
    const snapshot=async()=>createHash('sha256').update(JSON.stringify(await Promise.all([db.appUser.findMany(),db.userAuth.findMany(),db.userSess.findMany(),db.guestSess.findMany(),db.chatSess.findMany(),db.chatMsg.findMany(),db.aiJob.findMany(),db.attachDoc.findMany(),db.caseFact.findMany(),db.caseHist.findMany()]),(_key,value)=>typeof value==='bigint'?value.toString():value)).digest('hex');
    const beforePrivacy=await snapshot();const privacyResponse=await get('privacy-retention',token);assert.equal(privacyResponse.status,200);const privacy=await privacyResponse.json();assert.equal(privacy.readOnly,true);assert.equal(privacy.purgeImplemented,false);assert.ok(!JSON.stringify(privacy).includes(canary));assert.ok(!JSON.stringify(privacy).includes('admin_user'));assert.ok(!JSON.stringify(privacy).includes('pw_hash'));assert.equal(await snapshot(),beforePrivacy);
    const response=await get('overview',token); assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    const data=await response.json();
    assert.equal(data.personalDataAccess,false); assert.equal(data.counts.members,2); assert.equal(data.counts.conversations,1);
    assert.equal(data.jobs.find(row=>row.status==='QUEUED').count,1);
    assert.equal(data.recentJobs[0].id,jobId); assert.equal(JSON.stringify(data).includes(canary),false);
    assert.deepEqual(Object.keys(data.recentJobs[0]).sort(),['attempts','createdAt','errorCode','id','provider','resultCode','status','updatedAt']);
    await db.chatSess.update({where:{id:roomId},data:{delYn:true,delDttm:new Date()}});
    const hidden=await (await get('overview',token)).json(); assert.equal(hidden.counts.conversations,0); assert.equal(hidden.recentJobs.length,0);
    await db.userRole.update({where:{id:grant.id},data:{delYn:true,delDttm:new Date(Date.now()+1000)}});
    assert.equal((await get('overview',token)).status,403);
    await db.userRole.create({data:{userId,roleCdId:role.id}});
    assert.equal(await db.userRole.count({where:{userId,roleCdId:role.id}}),2);
    for (const codeId of [role.id,role.prntCdId]) {
      await db.cmmnCd.update({where:{id:codeId},data:{useYn:false}});
      assert.equal((await get('overview',token)).status,403);
      await db.cmmnCd.update({where:{id:codeId},data:{useYn:true}});
    }
    const user=await db.appUser.findUnique({where:{id:userId}});
    const inactive=await db.cmmnCd.findFirst({where:{cd:'BLOCKED',parent:{cd:'USER_STAT'}}});
    assert.ok(inactive);
    await db.appUser.update({where:{id:userId},data:{statCdId:inactive.id}});
    assert.equal((await get('overview',token)).status,401);
    await db.appUser.update({where:{id:userId},data:{statCdId:user.statCdId}});
    await auth.logoutAll(token); assert.equal((await get('overview',token)).status,401);
    assert.equal((await get('overview',normal)).status,403);
    assert.equal(await db.cmmnCdHist.count({where:{cmmnCdId:role.id}}),1);
  } finally {
    await app?.close(); await db?.$disconnect();
    if(created && /^aurore_admin_test_[0-9a-f]{12}$/.test(name)) run('docker',['exec','aurore-dev-check-postgres','dropdb','--force','-U','aurore_dev_check',name]);
  }
});
