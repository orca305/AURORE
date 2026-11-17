import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
const require=createRequire(import.meta.url);let development;
try{development=new URL(process.env.DATABASE_URL);if(development.hostname!=='127.0.0.1'||development.port!=='5433'||development.pathname!=='/aurore_dev_check')development=null;}catch{development=null;}
test('member preferences validate consent revisions, keep immutable history, sort stored queries and render the revised UI',{skip:!development&&'Use --env-file=../local-dev/.env',timeout:180000},async()=>{
 require('reflect-metadata');const {ConfigService}=require('@nestjs/config'),{Test}=require('@nestjs/testing'),{ValidationPipe}=require('@nestjs/common');
 const {PrismaService}=await import('../dist/prisma/prisma.service.js'),{AppModule}=await import('../dist/app.module.js'),{AuthService}=await import('../dist/auth/auth.service.js'),{AccountRetentionService}=await import('../dist/auth/account-retention.service.js'),{ChatService}=await import('../dist/chat/chat.service.js'),{NotificationsService}=await import('../dist/notifications/notifications.service.js');
 const {auditPrivacyRetention}=await import('./privacy-retention.mjs');
 const name='aurore_preferences_'+randomBytes(6).toString('hex'),url=new URL(development);url.pathname='/'+name;
 const run=(cmd,args,options={})=>{const p=spawnSync(cmd,args,{encoding:'utf8',windowsHide:true,...options});assert.equal(p.status,0,p.stderr);};let db,app,web,created=false;
 try{
  run('docker',['exec','aurore-dev-check-postgres','createdb','-U','aurore_dev_check',name]);created=true;
  run(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--config','prisma7.config.ts'],{env:{...process.env,DATABASE_URL:url.href}});
  db=new PrismaService(new ConfigService({DATABASE_URL:url.href}));await db.$connect();const temp=await mkdtemp(join(tmpdir(),'aurore-withdrawal-'));
  const config=new ConfigService({DATABASE_URL:url.href,AURORE_COLLECTION_SCHEDULER_DIR:join(temp,'scheduler'),AURORE_LAW_REFRESH_JOURNAL:join(temp,'refresh'),AURORE_PRECEDENT_COLLECTION_ROOT:join(temp,'precedents'),MOLEG_OC:''});
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(db).overrideProvider(ConfigService).useValue(config).compile();app=module.createNestApplication({logger:false});app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');
  const auth=app.get(AuthService),retention=app.get(AccountRetentionService),base=await app.getUrl();await app.get(ChatService).onModuleDestroy();await app.get(NotificationsService).onModuleDestroy();await retention.onModuleDestroy();

  const password='Synthetic8!',tokens={},users={};
  for(const login of ['pref_owner','pref_other','pref_future']){await auth.signup(login,'설정검증',password);tokens[login]=(await auth.login(login,password)).token;users[login]=BigInt((await auth.session(tokens[login],false)).id);}
  const token=tokens.pref_owner,uid=users.pref_owner;
  const get=(path,t=token)=>fetch(base+path,{headers:t?{Authorization:'Bearer '+t}:{}});
  const post=(path,body,t=token)=>fetch(base+path,{method:'POST',headers:{...(t?{Authorization:'Bearer '+t}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)});
  const consent=async(t=token)=>{const response=await get('/auth/learning-consent',t);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);return response.json();};
  const initial=await consent(),otherInitial=await consent(tokens.pref_other);assert.equal(initial.agreed,false);assert.equal(initial.total,1);assert.equal(initial.learningPipelineAvailable,false);
  assert.equal((await get('/auth/learning-consent',null)).status,401);
  for(const body of [{agreed:true,revision:initial.revision,confirmed:false},{agreed:'true',revision:initial.revision,confirmed:true},{agreed:true,revision:initial.revision,confirmed:true,userId:String(users.pref_other)},{agreed:true,revision:'bad',confirmed:true}])assert.equal((await post('/auth/learning-consent',body)).status,400);
  for(const query of ['?limit=7','?offset=-1','?offset=100001','?userId=2'])assert.equal((await get('/auth/learning-consent'+query)).status,400);
  assert.equal((await consent()).total,1);
  const unchanged=await(await post('/auth/learning-consent',{agreed:false,revision:initial.revision,confirmed:true})).json();assert.equal(unchanged.changed,false);assert.equal((await consent()).total,1);
  const race=await Promise.all([post('/auth/learning-consent',{agreed:true,revision:initial.revision,confirmed:true}),post('/auth/learning-consent',{agreed:true,revision:initial.revision,confirmed:true})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const optedIn=await consent();assert.equal(optedIn.agreed,true);assert.equal(optedIn.total,2);assert.equal((await consent(tokens.pref_other)).revision,otherInitial.revision);
  assert.equal((await post('/auth/learning-consent',{agreed:false,revision:initial.revision,confirmed:true})).status,409);
  assert.equal((await post('/auth/learning-consent',{agreed:false,revision:optedIn.revision,confirmed:true})).status,200);const optedOut=await consent();assert.equal(optedOut.agreed,false);assert.equal(optedOut.total,3);assert.equal(optedOut.history.find(h=>h.id===optedIn.revision).agreed,true);
  const fail=new Proxy(db,{get(target,p){if(p!=='$transaction')return Reflect.get(target,p);return(work,options)=>db.$transaction(tx=>work(new Proxy(tx,{get(t,k){if(k!=='userAgrYnHist')return Reflect.get(t,k);return new Proxy(t.userAgrYnHist,{get(hist,op){return op==='create'?async()=>{throw new Error('synthetic consent failure');}:Reflect.get(hist,op);}});}})),options);}});
  await assert.rejects(new AuthService(fail).setLearningConsent(token,true,optedOut.revision),/synthetic consent failure/);assert.equal((await consent()).revision,optedOut.revision);
  const learning=await db.cmmnCd.findFirstOrThrow({where:{cd:'LEARNING',parent:{cd:'USER_AGR'}}});
  await db.cmmnCd.update({where:{id:learning.id},data:{useYn:false}});assert.equal((await get('/auth/learning-consent')).status,503);assert.equal((await post('/auth/learning-consent',{agreed:true,revision:optedOut.revision,confirmed:true})).status,503);await db.cmmnCd.update({where:{id:learning.id},data:{useYn:true}});
  await db.userAgrYnHist.createMany({data:Array.from({length:20},(_,i)=>({userId:uid,agrCdId:learning.id,agrYn:i%2===0,polVer:'3.3',rgstDttm:new Date(Date.now()-86400000-i*1000)}))});
  const page1=await(await get('/auth/learning-consent?limit=10')).json(),page2=await(await get('/auth/learning-consent?limit=10&offset=10')).json();assert.equal(page1.total,23);assert.equal(page1.history.length,10);assert.equal(page2.history.length,10);assert.equal(new Set([...page1.history,...page2.history].map(x=>x.id)).size,20);assert.equal(page1.agreed,false);
  await db.userAgrYnHist.create({data:{userId:users.pref_future,agrCdId:learning.id,agrYn:true,polVer:'3.3',rgstDttm:new Date(Date.now()+3600000)}});const future=await consent(tokens.pref_future);assert.equal(future.agreed,false);assert.equal(future.total,1);assert.equal((await post('/auth/learning-consent',{agreed:true,revision:future.revision,confirmed:true},tokens.pref_future)).status,409);
  const role=await db.cmmnCd.findFirstOrThrow({where:{cd:'ADMIN',parent:{cd:'USER_ROLE'}}});await db.userRole.create({data:{userId:uid,roleCdId:role.id}});
  const type=await db.cmmnCd.findFirstOrThrow({where:{cd:'LEASE',parent:{cd:'CASE_TYPE'}}});
  const laws=[],versions=[];
  for(let i=0;i<3;i++){
   const day=[11,15,13][i],stamp=new Date('2026-11-'+day+'T01:00:00Z');
   const law=await db.legal.create({data:{srcCd:'TEST',srcKey:'pref-law-'+i,legalNm:'가상 법규 검색 화면에서 긴 제목이 삼십자를 넘으면 줄임표로 표시하는 검증 법령 '+i,rgstDttm:stamp}});laws.push(law);
   const version=await db.legalVer.create({data:{legalId:law.id,verKey:'pref-version-'+i,enfcDt:stamp}});versions.push(version);
   const snapshot=await db.srcSnapshot.create({data:{srcCd:'TEST',srcKey:'pref-source-'+i,srcUrl:'https://www.law.go.kr',contType:'application/json',srcCont:'{}',contHash:createHash('sha256').update('{}').digest('hex')}});
   const revision=await db.legalVerRev.create({data:{legalVerId:version.id,srcSnapshotId:snapshot.id,revNo:1,currentYn:true}});
   const precedent=await db.legalPrec.create({data:{srcCd:'TEST',srcKey:'9300'+i}});await db.legalPrecRev.create({data:{legalPrecId:precedent.id,srcSnapshotId:snapshot.id,revNo:1,currentYn:true,caseNo:'2026다9300'+i,caseNm:'가상 판례 검색 화면에서 긴 제목이 삼십자를 넘으면 줄임표로 표시하는 검증 판례 '+i,courtNm:'검증법원',decisionDt:stamp,decisionCont:'가상 문서 내용입니다.'}});
   await db.userCase.create({data:{id:randomUUID(),userId:uid,caseNm:'가상 사건 '+i,caseTypeCdId:type.id,uptDttm:stamp}});
   await db.userBmark.create({data:{userId:uid,legalId:law.id,rgstDttm:stamp}});
   const event=await db.legalChgEvt.create({data:{evtKey:'PREF_EVENT:'+i,legalId:law.id,legalVerId:version.id,srcRevId:revision.id,evtTypeCd:'EFFECTIVE',scopeCd:'VERSION',baseDt:stamp,evtDttm:stamp,evtTitle:'가상 알림 '+i,evtCont:'가상 시행 알림'}});await db.userNtf.create({data:{userId:uid,evtId:event.id}});
   const room=await db.chatSess.create({data:{id:randomUUID(),userId:uid,sessNm:'가상 대화 '+i}}),msg=await db.chatMsg.create({data:{id:randomUUID(),chatSessId:room.id,msgSeq:1,roleCd:'USER',msgCont:'가상 질문입니다.'}});
   await db.aiJob.create({data:{id:randomUUID(),chatSessId:room.id,inputMsgId:msg.id,requestHash:'a'.repeat(64),ownerAuthHash:createHash('sha256').update(token).digest(),phaseCd:'start',statCd:'QUEUED',providerCd:'DEMO',deadlineDttm:new Date(Date.now()+300000),uptDttm:stamp}});
  }
  for(const day of [10,12])await db.legalVer.create({data:{legalId:laws[0].id,verKey:'more-version-'+day,enfcDt:new Date('2026-11-'+day)}});
  for(const [i,login] of ['pref_owner','pref_other','pref_future'].entries())await db.appUser.update({where:{id:users[login]},data:{rgstDttm:new Date('2026-11-'+(10+i))}});
  const active=await db.cmmnCd.findFirstOrThrow({where:{cd:'ACTIVE',parent:{cd:'USER_STAT'}}}),blocked=await db.cmmnCd.findFirstOrThrow({where:{cd:'BLOCKED',parent:{cd:'USER_STAT'}}});
  for(let i=0;i<2;i++)await db.userStatHist.create({data:{userId:users.pref_other,statCdId:i?active.id:blocked.id,prevStatCdId:i?blocked.id:active.id,actorUserId:uid,reason:'가상 상태 변경',requestId:randomUUID(),requestHash:'b'.repeat(64),rgstDttm:new Date('2026-11-'+(11+i))}});
  const paths=['/legals','/legals/precedents','/cases','/bookmarks','/notifications','/admin/members','/admin/ai-jobs?status=all','/admin/activity','/legals/'+laws[0].id+'/versions'];
  for(const path of paths){
   const prefix=path.includes('?')?'&':'?';const asc=await get(path+prefix+'sort=oldest&limit=10'),desc=await get(path+prefix+'sort=newest&limit=10');assert.equal(asc.status,200,path);assert.equal(desc.status,200,path);const unpack=async response=>{const data=await response.json();return Array.isArray(data)?data:data.items;};const old=await unpack(asc),recent=await unpack(desc);assert.ok(old.length>=2,path);assert.deepEqual(old.map(x=>x.id),recent.map(x=>x.id).reverse(),path);assert.equal((await get(path+prefix+'sort=DROP_TABLE')).status,400,path);
  }
  const oldest=await(await get('/legals?sort=oldest&limit=1&offset=0')).json(),next=await(await get('/legals?sort=oldest&limit=1&offset=1')).json();assert.equal(oldest[0].id,String(laws[0].id));assert.equal(next[0].id,String(laws[2].id));
  const audit=await auditPrivacyRetention({query:async(sql,args)=>({rows:await db.$queryRawUnsafe(sql,...args)})});assert.equal(audit.counts.learningOptInUsers,0);
  if(process.env.AURORE_WEB_SMOKE==='1'||process.env.AURORE_UI_PREVIEW==='1'){
   web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3002'],{cwd:'C:/dev/easy-law-ai/frontend',env:{...process.env,BACKEND_URL:base},windowsHide:true,stdio:'ignore'});
   for(let n=0;n<80;n++){try{if((await fetch('http://127.0.0.1:3002/login')).ok)break;}catch{}await delay(250);}
   const searchRoutes=['/legals','/precedents','/cases','/bookmarks','/notifications','/admin/members','/admin/activity','/admin/ai-jobs','/legals/'+laws[0].id+'/versions'];
   for(const route of [...searchRoutes,'/','/account']){const response=await fetch('http://127.0.0.1:3002'+route+'?sort=oldest&limit=10',{headers:{Cookie:'aurore_session='+token},redirect:'manual'});assert.equal(response.status,200,route);const html=await response.text();const aside=html.slice(html.indexOf('<aside'),html.indexOf('</aside>'));assert.ok(!aside.includes('href="/notifications"'),route);assert.ok(html.includes('알림 · 읽지 않은 알림 3개'),route);assert.equal((html.match(/aria-label="새로고침"/g)||[]).length,searchRoutes.includes(route)?1:0,route);if(searchRoutes.includes(route)){assert.ok(html.includes('name="sort"'),route);assert.ok(html.includes('value="oldest" selected='),route);}if(route==='/account'){assert.ok(html.includes('동의 변경 이력'));assert.ok(html.includes('학습 활용 동의'));}if(route==='/legals'){assert.ok(html.includes(Array.from(laws[0].legalNm).slice(0,30).join('')+'...'));}}
   console.log('WEB_SMOKE_PASS 11 search/account/chat pages; bell location, local refresh, ordering and consent history');
   if(process.env.AURORE_UI_PREVIEW==='1'){console.log('UI_READY http://127.0.0.1:3002/login fixture=pref_owner stop='+join(temp,'stop'));const {access}=await import('node:fs/promises');const until=Date.now()+15*60000;while(Date.now()<until){try{await access(join(temp,'stop'));break;}catch{}await delay(300);}}
  }
  const beforeClose=await consent(tokens.pref_other);assert.equal((await post('/auth/withdrawal',{currentPassword:password,confirmed:true},tokens.pref_other)).status,202);assert.equal((await post('/auth/learning-consent',{agreed:true,revision:beforeClose.revision,confirmed:true},tokens.pref_other)).status,401);assert.equal((await get('/auth/learning-consent',tokens.pref_other)).status,401);
 }finally{if(web){web.kill();if(web.exitCode===null)await new Promise(resolve=>web.once('exit',resolve));}await app?.close();await db?.$disconnect();if(created)run('docker',['exec','aurore-dev-check-postgres','dropdb','-U','aurore_dev_check',name]);}
});