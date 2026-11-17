import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
const require=createRequire(import.meta.url);let development;
try{development=new URL(process.env.DATABASE_URL);if(development.hostname!=='127.0.0.1'||development.port!=='5433'||development.pathname!=='/aurore_dev_check')development=null;}catch{development=null;}
test('precedent corrections share the inbox, retain exact revisions, ignore whitespace and enforce target visibility',{skip:!development&&'Use --env-file=../local-dev/.env',timeout:1800000},async()=>{
 require('reflect-metadata');const {ConfigService}=require('@nestjs/config'),{Test}=require('@nestjs/testing'),{ValidationPipe}=require('@nestjs/common');
 const {PrismaService}=await import('../dist/prisma/prisma.service.js'),{AppModule}=await import('../dist/app.module.js'),{AuthService}=await import('../dist/auth/auth.service.js'),{NotificationsService}=await import('../dist/notifications/notifications.service.js');
 const name='aurore_prec_ntf_'+randomBytes(6).toString('hex'),url=new URL(development);url.pathname='/'+name;
 const run=(cmd,args,options={})=>{const r=spawnSync(cmd,args,{encoding:'utf8',windowsHide:true,...options});assert.equal(r.status,0,r.stderr);};let db,app,web,created=false;
 try{
  run('docker',['exec','aurore-dev-check-postgres','createdb','-U','aurore_dev_check',name]);created=true;
  run(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--config','prisma7.config.ts'],{env:{...process.env,DATABASE_URL:url.href}});
  db=new PrismaService(new ConfigService({DATABASE_URL:url.href}));await db.$connect();const temp=await mkdtemp(join(tmpdir(),'aurore-refinement-ui-'));
  const config=new ConfigService({DATABASE_URL:url.href,AURORE_COLLECTION_SCHEDULER_DIR:join(temp,'scheduler'),AURORE_LAW_REFRESH_JOURNAL:join(temp,'refresh'),AURORE_PRECEDENT_COLLECTION_ROOT:join(temp,'precedents'),MOLEG_OC:''});
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(db).overrideProvider(ConfigService).useValue(config).compile();app=module.createNestApplication({logger:false});app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');
  const auth=app.get(AuthService),notifications=app.get(NotificationsService),base=await app.getUrl();await notifications.onModuleDestroy();
  await auth.signup('ui_reviewer','화면검증','Synthetic8!');await auth.signup('ui_other','다른회원','Synthetic8!');const token=(await auth.login('ui_reviewer','Synthetic8!')).token,other=(await auth.login('ui_other','Synthetic8!')).token,owner=await auth.resolveOwner('Bearer '+token),otherOwner=await auth.resolveOwner('Bearer '+other);
  const role=await db.cmmnCd.findFirstOrThrow({where:{cd:'ADMIN',parent:{cd:'USER_ROLE'}}});await db.userRole.create({data:{userId:owner.userId,roleCdId:role.id}});
  const law=await db.legal.create({data:{srcCd:'TEST',srcKey:'ui-law',legalNm:'가상 주택임대차보호법'}});
  const type=await db.cmmnCd.findFirstOrThrow({where:{parent:{cd:'CASE_TYPE'},useYn:true,delYn:false}});await db.userCase.create({data:{id:randomUUID(),userId:owner.userId,caseNm:'보증금 반환 사실관계 정리',caseTypeCdId:type.id}});
  const prec=await db.legalPrec.create({data:{srcCd:'TEST',srcKey:'91001'}}),another=await db.legalPrec.create({data:{srcCd:'TEST',srcKey:'91002'}});
  async function revision(p,n,text,stamp){const raw=JSON.stringify({fixture:true,n,text});const snapshot=await db.srcSnapshot.create({data:{srcCd:'TEST',srcKey:'p-'+p.id+'-'+n,srcUrl:'https://www.law.go.kr/LSW/precInfoP.do?precSeq=91001',contType:'application/json',srcCont:raw,contHash:createHash('sha256').update(raw).digest('hex')}});await db.legalPrecRev.updateMany({where:{legalPrecId:p.id},data:{currentYn:false}});return db.legalPrecRev.create({data:{legalPrecId:p.id,srcSnapshotId:snapshot.id,revNo:n,currentYn:true,caseNo:'2026다91001',caseNm:'가상 임대차 보증금 반환 판결',courtNm:'검증법원',decisionDt:new Date('2026-11-01'),issueCont:'임대차 보증금 반환에 관한 가상 쟁점입니다.',summaryCont:text,decisionCont:text,rgstDttm:new Date(stamp)}});}
  const r1=await revision(prec,1,'기존에는 계약 종료 시점을 확인하도록 설명합니다.','2026-11-16T00:00:00Z');
  const r2=await revision(prec,2,'변경 후에는 계약 종료와 보증금 반환 조건을 함께 확인합니다.','2026-11-17T01:00:00Z');
  const r3=await revision(prec,3,'변경 후에는 계약\u00a0종료와 보증금 반환 조건을 함께\n확인합니다.','2026-11-17T02:00:00Z');
  const foreign=await revision(another,1,'다른 판례의 가상 원문입니다.','2026-11-16T00:00:00Z');
  const bmark=await db.userBmark.create({data:{userId:owner.userId,legalPrecId:prec.id,rgstDttm:new Date('2026-11-16T05:00:00Z')}});await db.userBmark.create({data:{userId:otherOwner.userId,legalPrecId:prec.id,rgstDttm:new Date('2026-11-17T03:00:00Z')}});
  const sync=await notifications.sync(new Date('2026-11-17T04:00:00Z'));assert.equal(sync.events,1);assert.equal(sync.delivered,1);assert.equal((await notifications.sync(new Date('2026-11-17T04:00:00Z'))).delivered,0);
  const get=(path,t=token)=>fetch(base+path,{headers:{Authorization:'Bearer '+t}});
  let inbox=await (await get('/notifications')).json();assert.equal(inbox.total,1);assert.equal(inbox.items[0].targetKind,'PREC');assert.ok(inbox.items[0].href.includes('/precedents/'+prec.id+'/compare?'));assert.ok(inbox.items[0].href.includes('beforeRevisionId='+r1.id));assert.ok(inbox.items[0].href.includes('afterRevisionId='+r2.id));assert.equal((await (await get('/notifications',other)).json()).total,0);
  const compare=await get('/legals/precedents/'+prec.id+'/comparison?beforeRevisionId='+r1.id+'&afterRevisionId='+r2.id);assert.equal(compare.status,200);const difference=await compare.json();assert.equal(difference.before.id,String(r1.id));assert.ok(difference.sections.find(s=>s.title==='판결요지').changed);assert.ok(difference.sections.find(s=>s.title==='판결요지').highlights.after.some(p=>p.changed));
  const format=await (await get('/legals/precedents/'+prec.id+'/comparison?beforeRevisionId='+r2.id+'&afterRevisionId='+r3.id)).json();assert.ok(format.sections.every(s=>!s.changed));
  assert.equal((await get('/legals/precedents/'+prec.id+'/comparison?beforeRevisionId='+r1.id+'&afterRevisionId='+foreign.id)).status,404);assert.equal((await get('/legals/precedents/'+prec.id+'/comparison?beforeRevisionId=bad&afterRevisionId=1')).status,400);
  await assert.rejects(db.legalChgEvt.create({data:{evtKey:'BAD_PREC',legalPrecId:prec.id,srcPrecRevId:foreign.id,bfPrecRevId:r1.id,evtTypeCd:'CORRECTED',scopeCd:'VERSION',baseDt:new Date('2026-11-17'),evtDttm:new Date('2026-11-17T01:00:00Z'),evtTitle:'검증',evtCont:'잘못된 판례 연결'}}));
  await db.userBmark.update({where:{id:bmark.id},data:{delYn:true,delDttm:new Date(),delId:owner.userId}});await revision(prec,4,'추가 정정 원문입니다.','2026-11-17T05:00:00Z');await notifications.sync(new Date('2026-11-17T06:00:00Z'));assert.equal((await (await get('/notifications')).json()).total,1);assert.equal((await (await get('/notifications',other)).json()).total,1);
  if(process.env.AURORE_UI_REFINEMENT==='1'||process.env.AURORE_WEB_SMOKE==='1'){
   await db.userBmark.create({data:{userId:owner.userId,legalId:law.id}});await db.userBmark.create({data:{userId:owner.userId,legalPrecId:prec.id}});
   web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3002'],{cwd:'C:/dev/easy-law-ai/frontend',env:{...process.env,BACKEND_URL:base},windowsHide:true,stdio:'ignore'});
   for(let n=0;n<80;n++){try{if((await fetch('http://127.0.0.1:3002/login')).ok)break;}catch{}await delay(250);}
   if(process.env.AURORE_WEB_SMOKE==='1'){
    const headers={Cookie:'aurore_session='+token};
    for(const route of ['/','/cases','/bookmarks','/legals','/precedents','/admin','/admin/members','/admin/activity','/admin/ai-jobs','/notifications',inbox.items[0].href]){
     const response=await fetch('http://127.0.0.1:3002'+route,{headers,redirect:'manual'});assert.equal(response.status,200,route);const html=await response.text();assert.ok(html.includes('우정범. All rights reserved.'),route);if(['/cases','/bookmarks','/legals','/precedents','/admin/members','/admin/activity','/admin/ai-jobs','/notifications'].includes(route))assert.ok(html.includes('aria-label="새로고침"'),route);assert.ok(!html.includes('↗'),route);if(route==='/')assert.ok(html.includes('>첨부파일</button>'));if(route==='/notifications')assert.ok(html.includes('판례 원문 정정'));if(route===inbox.items[0].href){assert.ok(html.includes('판결요지'));assert.ok(html.includes('<ins>')||html.includes('<ins '));}
    }
    console.log('WEB_SMOKE_PASS 11 member/admin/comparison pages');
   }else{
    console.log('UI_READY http://127.0.0.1:3002/login stop='+join(temp,'stop'));
    const deadline=Date.now()+25*60000;while(Date.now()<deadline){try{await access(join(temp,'stop'));break;}catch{}await delay(300);}
   }
  }
  await db.legalPrec.update({where:{id:prec.id},data:{delYn:true,delDttm:new Date(),delId:owner.userId}});assert.equal((await (await get('/notifications')).json()).total,0);assert.equal((await get('/legals/precedents/'+prec.id+'/comparison?beforeRevisionId='+r1.id+'&afterRevisionId='+r2.id)).status,404);
 }finally{if(web){web.kill();if(web.exitCode===null)await new Promise(resolve=>web.once('exit',resolve));}await app?.close();await db?.$disconnect();if(created)run('docker',['exec','aurore-dev-check-postgres','dropdb','-U','aurore_dev_check',name]);}
});
