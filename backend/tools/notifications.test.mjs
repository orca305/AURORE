import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
const require=createRequire(import.meta.url);
let development;
try{development=new URL(process.env.DATABASE_URL);if(development.hostname!=='127.0.0.1'||development.port!=='5433'||development.pathname!=='/aurore_dev_check')development=null;}catch{development=null;}
test('legal notifications respect Korean dates, subscriptions, immutable corrections, ownership, read cutoffs and replay uniqueness',{skip:!development&&'Build and use --env-file=../local-dev/.env',timeout:660000},async()=>{
 require('reflect-metadata');const {ConfigService}=require('@nestjs/config'),{ValidationPipe}=require('@nestjs/common'),{Test}=require('@nestjs/testing');
 const {PrismaService}=await import('../dist/prisma/prisma.service.js'),{AuthService}=await import('../dist/auth/auth.service.js'),{AuthController}=await import('../dist/auth/auth.controller.js');
 const {NotificationsService}=await import('../dist/notifications/notifications.service.js'),{NotificationsController}=await import('../dist/notifications/notifications.controller.js');
 const {BookmarksService}=await import('../dist/bookmarks/bookmarks.service.js'),{BookmarksController}=await import('../dist/bookmarks/bookmarks.controller.js');
 const {ChatService}=await import('../dist/chat/chat.service.js'),{ChatAnswerService}=await import('../dist/chat/answer.service.js'),{ChatController,JobsController}=await import('../dist/chat/chat.controller.js');
 const {LegalService}=await import('../dist/legal/legal.service.js'),{LegalController}=await import('../dist/legal/legal.controller.js'),{IngestGuard}=await import('../dist/legal/ingest.guard.js');
 const name='aurore_ntf_test_'+randomBytes(6).toString('hex'),url=new URL(development);url.pathname='/'+name;
 const run=(cmd,args,options={})=>{const r=spawnSync(cmd,args,{windowsHide:true,encoding:'utf8',...options});assert.equal(r.status,0,r.stderr);};
 let db,app,created=false,web;
 try{
  run('docker',['exec','aurore-dev-check-postgres','createdb','-U','aurore_dev_check',name]);created=true;
  run(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--config','prisma7.config.ts'],{env:{...process.env,DATABASE_URL:url.href}});
  db=new PrismaService(new ConfigService({DATABASE_URL:url.href}));await db.$connect();
  const module=await Test.createTestingModule({controllers:[AuthController,NotificationsController,BookmarksController,ChatController,JobsController,LegalController],providers:[NotificationsService,BookmarksService,AuthService,ChatService,ChatAnswerService,LegalService,IngestGuard,{provide:ConfigService,useValue:new ConfigService()},{provide:PrismaService,useValue:db}]}).compile();
  app=module.createNestApplication({logger:false});app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');
  const auth=app.get(AuthService),service=app.get(NotificationsService),base=await app.getUrl();await service.onModuleDestroy();
  await auth.signup('notice_a','알림검증','Synthetic8!');await auth.signup('notice_b','다른회원','Synthetic8!');
  const token=(await auth.login('notice_a','Synthetic8!')).token,other=(await auth.login('notice_b','Synthetic8!')).token;
  const owner=await auth.resolveOwner('Bearer '+token),otherOwner=await auth.resolveOwner('Bearer '+other);
  const get=(path='',t=token)=>fetch(base+'/notifications'+path,{headers:t?{Authorization:'Bearer '+t}:{}});
  const post=(path,t=token,body={})=>fetch(base+'/notifications'+path,{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await get('',null)).status,401);const guest=(await auth.createGuest()).token;
  assert.equal((await fetch(base+'/notifications',{headers:{Authorization:'Guest '+guest}})).status,403);
  const law=await db.legal.create({data:{srcCd:'TEST',srcKey:'notice-law',legalNm:'가상 주택임대차보호법'}});
  const old=await db.legalVer.create({data:{legalId:law.id,verKey:'OLD',prmlDt:new Date('2026-11-09'),enfcDt:new Date('2026-11-10')}});
  const version=await db.legalVer.create({data:{legalId:law.id,verKey:'NEW',prmlDt:new Date('2026-11-17'),enfcDt:new Date('2026-11-18')}});
  async function revision(v,n,text,stamp,current=true,provisionDate=null){
   const src=JSON.stringify({fixture:true,n,text,version:String(v.id)});
   const snapshot=await db.srcSnapshot.create({data:{srcCd:'TEST',srcKey:'ntf-'+v.id+'-'+n,srcUrl:'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=1',contType:'application/json',srcCont:src,contHash:createHash('sha256').update(src).digest('hex')}});
   if(current)await db.legalVerRev.updateMany({where:{legalVerId:v.id},data:{currentYn:false}});
   return db.legalVerRev.create({data:{legalVerId:v.id,srcSnapshotId:snapshot.id,revNo:n,currentYn:current,rgstDttm:new Date(stamp),provisions:{create:{proviTypeCd:'ARTICLE',dispNo:'제1조',normNo:'1',sortSeq:1,proviNm:'목적',proviCont:text,...(provisionDate?{enfcDt:new Date(provisionDate)}:{})}}}});
  }
  await revision(old,1,'옛 시행본의 내용입니다.','2026-11-01T00:00:00Z');
  const r1=await revision(version,1,'시행본 최초 내용입니다.','2026-11-15T10:00:00Z',true,'2026-11-19');
  const r2=await revision(version,2,'시행본 정정 내용입니다.','2026-11-17T01:00:00Z',true,'2026-11-19');
  await revision(version,3,'시행본\u00a0 정정\n내용입니다.','2026-11-17T02:00:00Z',true,'2026-11-19');
  const bmark=await db.userBmark.create({data:{userId:owner.userId,legalId:law.id,rgstDttm:new Date('2026-11-15T15:00:00Z')}});
  await assert.rejects(db.legalChgEvt.create({data:{evtKey:'BAD_VERSION',legalId:law.id,legalVerId:old.id,srcRevId:r2.id,bfRevId:r1.id,evtTypeCd:'CORRECTED',scopeCd:'VERSION',baseDt:new Date('2026-11-17'),evtDttm:new Date('2026-11-17T01:00:00Z'),evtTitle:'가상 검증',evtCont:'잘못 연결된 판본을 거부해야 합니다.'}}));
  const first=await service.sync(new Date('2026-11-17T03:00:00Z'));assert.equal(first.events,2);assert.equal(first.delivered,2);
  const replay=await Promise.all([service.sync(new Date('2026-11-17T03:00:00Z')),service.sync(new Date('2026-11-17T03:00:00Z'))]);
  assert.equal(replay.reduce((n,r)=>n+r.events,0),0);assert.equal(replay.reduce((n,r)=>n+r.delivered,0),0);
  let list=await (await get()).json();assert.equal(list.total,2);assert.equal(list.unreadCount,2);const cutoff=list.readThroughId;
  const correction=list.items.find(x=>x.kind==='CORRECTED');assert.ok(correction.href.includes('beforeRevisionId='+r1.id));assert.ok(correction.href.includes('afterRevisionId='+r2.id));
  assert.equal((await (await get('',other)).json()).total,0);assert.equal((await post('/'+correction.id+'/read',other)).status,404);
  await db.userBmark.create({data:{userId:otherOwner.userId,legalId:law.id,rgstDttm:new Date('2026-11-17T04:00:00Z')}});
  await service.sync(new Date('2026-11-17T14:59:59Z'));assert.equal((await (await get('',other)).json()).total,0);
  const midnight=await Promise.all([service.sync(new Date('2026-11-17T15:00:00Z')),service.sync(new Date('2026-11-17T15:00:00Z'))]);assert.equal(midnight.reduce((n,r)=>n+r.events,0),1);assert.equal(midnight.reduce((n,r)=>n+r.delivered,0),2);
  list=await (await get()).json();assert.equal(list.total,3);assert.equal(list.items[0].kind,'EFFECTIVE');
  assert.equal((await post('/read-all',token,{throughId:cutoff})).status,200);
  assert.equal((await (await get('/unread')).json()).count,1);
  const unread=await (await get('?filter=UNREAD')).json();assert.equal(unread.items.length,1);
  assert.equal((await post('/'+unread.items[0].id+'/read')).status,200);const readStamp=(await db.userNtf.findUniqueOrThrow({where:{id:BigInt(unread.items[0].id)}})).readDttm;
  await post('/'+unread.items[0].id+'/read');assert.deepEqual((await db.userNtf.findUniqueOrThrow({where:{id:BigInt(unread.items[0].id)}})).readDttm,readStamp);
  await db.userBmark.update({where:{id:bmark.id},data:{delYn:true,delDttm:new Date(),delId:owner.userId}});
  const provisions=await service.sync(new Date('2026-11-18T15:00:00Z'));assert.equal(provisions.events,1);assert.equal(provisions.delivered,1);
  assert.equal((await (await get()).json()).total,3);assert.equal((await (await get('?kind=EFFECTIVE',other)).json()).items.filter(x=>x.scope==='PROVISIONS').length,1);
  await db.userBmark.create({data:{userId:owner.userId,legalId:law.id,rgstDttm:new Date('2026-11-19T01:00:00Z')}});
  await service.sync(new Date('2026-11-19T02:00:00Z'));assert.equal((await (await get()).json()).total,3);
  for(let n=0;n<12;n++){const v=await db.legalVer.create({data:{legalId:law.id,verKey:'PAGE'+n,prmlDt:new Date('2026-11-19'),enfcDt:new Date('2026-11-25')}});await revision(v,1,'페이징 검증 내용입니다.','2026-11-18T01:00:00Z');}
  await service.sync(new Date('2026-11-19T02:00:00Z'));
  const page1=await (await get('?limit=10',other)).json(),page2=await (await get('?limit=10&offset=10',other)).json();assert.equal(page1.items.length,10);assert.equal(page1.nextOffset,10);assert.equal(new Set([...page1.items,...page2.items].map(x=>x.id)).size,page1.total);
  assert.equal((await get('?limit=30')).status,400);assert.equal((await post('/read-all',token,{throughId:'9223372036854775808'})).status,400);
  assert.equal((await post('/read-all',token,{throughId:'1',userId:String(otherOwner.userId)})).status,400);
  const originalTitle=(await (await get()).json()).items[0].title;await db.legal.update({where:{id:law.id},data:{legalNm:'변경된 법령 이름'}});assert.equal((await (await get()).json()).items[0].title,originalTitle);
  await db.legal.update({where:{id:law.id},data:{legalNm:'가상 주택임대차보호법'}});
  await revision(version,4,'새로운 정정 내용이 추가되었습니다.','2026-11-19T03:00:00Z',true,'2026-11-19');await service.sync(new Date('2026-11-19T04:00:00Z'));
  assert.equal(await db.legalChgEvt.count({where:{evtTypeCd:'CORRECTED'}}),2);
  const before=await db.userNtf.findMany();await get();await get('/unread');assert.deepEqual(await db.userNtf.findMany(),before);
  if(process.env.AURORE_NOTIFICATIONS_UI==='1'){
   await db.legal.update({where:{id:law.id},data:{legalNm:'가상 주택임대차보호법'}});
   const previewVersion=await db.legalVer.create({data:{legalId:law.id,verKey:'PREVIEW',prmlDt:new Date('2026-11-20'),enfcDt:new Date('2026-11-25')}});
   await revision(previewVersion,1,'알림 화면 검증용 신규 공포 자료입니다.','2026-11-19T05:00:00Z');await service.sync(new Date('2026-11-20T00:00:00Z'));
   const temp=await mkdtemp(join(tmpdir(),'aurore-notifications-ui-'));
   web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3002'],{cwd:'C:/dev/easy-law-ai/frontend',env:{...process.env,BACKEND_URL:base},windowsHide:true,stdio:'ignore'});
   for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:3002/login')).ok)break;}catch{}await delay(250);}
   console.log('UI_READY http://127.0.0.1:3002/login stop='+join(temp,'stop'));
   const deadline=Date.now()+8*60000;while(Date.now()<deadline){try{await access(join(temp,'stop'));break;}catch{}await delay(300);}
  }
  await db.legal.update({where:{id:law.id},data:{delYn:true,delDttm:new Date(),delId:owner.userId}});assert.equal((await (await get()).json()).total,0);assert.equal((await (await get('/unread')).json()).count,0);
  await auth.logout(token);assert.equal((await get()).status,401);await assert.rejects(service.markRead(owner,1n),e=>e.status===401);
 }finally{if(web){web.kill();if(web.exitCode===null)await new Promise(resolve=>web.once('exit',resolve));}await app?.close();await db?.$disconnect();if(created)run('docker',['exec','aurore-dev-check-postgres','dropdb','-U','aurore_dev_check',name]);}
});
