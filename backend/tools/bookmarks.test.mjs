import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
const require=createRequire(import.meta.url);
let development;
try {development=new URL(process.env.DATABASE_URL); if(development.hostname!=='127.0.0.1'||development.port!=='5433'||development.pathname!=='/aurore_dev_check')development=null;}catch{development=null;}
test('member bookmarks preserve ownership, active uniqueness, history, visibility, validation and paging', {skip:!development&&'Run after build with --env-file=../local-dev/.env',timeout:660000},async()=>{
  require('reflect-metadata');
  const {ConfigService}=require('@nestjs/config'); const {ValidationPipe}=require('@nestjs/common'); const {Test}=require('@nestjs/testing');
  const {PrismaService}=await import('../dist/prisma/prisma.service.js'); const {AuthService}=await import('../dist/auth/auth.service.js'); const {AuthController}=await import('../dist/auth/auth.controller.js');
  const {BookmarksService}=await import('../dist/bookmarks/bookmarks.service.js'); const {BookmarksController}=await import('../dist/bookmarks/bookmarks.controller.js');
  const {LegalService}=await import('../dist/legal/legal.service.js'); const {LegalController}=await import('../dist/legal/legal.controller.js'); const {IngestGuard}=await import('../dist/legal/ingest.guard.js');
  const name='aurore_bmark_test_'+randomBytes(6).toString('hex'),url=new URL(development);url.pathname='/'+name;
  const run=(cmd,args,options={})=>{const r=spawnSync(cmd,args,{windowsHide:true,encoding:'utf8',...options});assert.equal(r.status,0,r.stderr);return r;};
  let db,app,created=false,web;
  try{
    run('docker',['exec','aurore-dev-check-postgres','createdb','-U','aurore_dev_check',name]);created=true;
    run(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--config','prisma7.config.ts'],{env:{...process.env,DATABASE_URL:url.href}});
    db=new PrismaService(new ConfigService({DATABASE_URL:url.href}));await db.$connect();
    const {ChatController,JobsController}=await import('../dist/chat/chat.controller.js'); const {ChatService}=await import('../dist/chat/chat.service.js'); const {ChatAnswerService}=await import('../dist/chat/answer.service.js');
    const module=await Test.createTestingModule({controllers:[AuthController,BookmarksController,LegalController,ChatController,JobsController],providers:[AuthService,BookmarksService,LegalService,IngestGuard,ChatService,ChatAnswerService,{provide:ConfigService,useValue:new ConfigService()},{provide:PrismaService,useValue:db}]}).compile();
    app=module.createNestApplication({logger:false});app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');
    const base=await app.getUrl(),auth=app.get(AuthService); const password='Synthetic8!';
    await auth.signup('bookmark_a','관심검증',password);await auth.signup('bookmark_b','다른회원',password);
    const token=(await auth.login('bookmark_a',password)).token,other=(await auth.login('bookmark_b',password)).token;
    const owner=await auth.resolveOwner('Bearer '+token),otherOwner=await auth.resolveOwner('Bearer '+other);
    const get=(path='',bearer=token)=>fetch(base+'/bookmarks'+path,{headers:bearer?{Authorization:'Bearer '+bearer}:{}});
    const set=(kind,id,saved,bearer=token,extra={})=>fetch(base+'/bookmarks/'+kind+'/'+id,{method:'PUT',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:JSON.stringify({saved,...extra})});
    const laws=[];for(let n=0;n<14;n++)laws.push(await db.legal.create({data:{srcCd:'TEST',srcKey:'bmark'+n,legalNm:n===0?'가상 주택임대차보호법':'가상 관심 법령 '+String(n).padStart(2,'0')}}));
    const prec=await db.legalPrec.create({data:{srcCd:'TEST',srcKey:'90001'}});
    const snapshot=await db.srcSnapshot.create({data:{srcCd:'TEST',srcKey:'bmark-prec',srcUrl:'https://www.law.go.kr/LSW/precInfoP.do?precSeq=90001',contType:'application/json',srcCont:'{}',contHash:'a'.repeat(64)}});
    await db.legalPrecRev.create({data:{legalPrecId:prec.id,srcSnapshotId:snapshot.id,revNo:1,currentYn:true,caseNo:'2026다90001',caseNm:'가상 임대차 보증금 반환 판결',courtNm:'검증법원',decisionDt:new Date('2026-01-01'),decisionCont:'관심 기능 검증을 위한 가상 본문입니다.'}});
    assert.equal((await get('',null)).status,401);
    const guest=(await auth.createGuest()).token;assert.equal((await fetch(base+'/bookmarks',{headers:{Authorization:'Guest '+guest}})).status,403);
    assert.equal((await set('LEGAL',laws[0].id,true,token,{userId:String(otherOwner.userId)})).status,400);
    assert.equal((await set('LEGAL',laws[0].id,true)).status,200);
    for(const response of await Promise.all(Array.from({length:5},()=>set('LEGAL',laws[0].id,true))))assert.equal(response.status,200);
    assert.equal(await db.userBmark.count({where:{userId:owner.userId,legalId:laws[0].id,delYn:false}}),1);
    assert.equal((await (await get('',other)).json()).total,0);
    assert.equal((await (await get('/state?kind=LEGAL&ids='+laws[0].id,other)).json()).savedIds.length,0);
    await set('LEGAL',laws[0].id,false,other);assert.equal(await db.userBmark.count({where:{userId:owner.userId,delYn:false}}),1);
    await set('LEGAL',laws[0].id,false);await set('LEGAL',laws[0].id,false);
    const removed=await db.userBmark.findFirstOrThrow({where:{userId:owner.userId,legalId:laws[0].id}});assert.equal(removed.delYn,true);assert.equal(removed.delId,owner.userId);assert.ok(removed.delDttm);
    await set('LEGAL',laws[0].id,true);assert.equal(await db.userBmark.count({where:{userId:owner.userId,legalId:laws[0].id}}),2);
    await assert.rejects(db.userBmark.create({data:{userId:owner.userId,legalId:laws[0].id}}),e=>e.code==='P2002');
    await assert.rejects(db.userBmark.create({data:{userId:owner.userId}}));
    await assert.rejects(db.userBmark.create({data:{userId:owner.userId,legalId:laws[1].id,legalPrecId:prec.id}}));
    await assert.rejects(db.userBmark.create({data:{userId:owner.userId,legalId:laws[1].id,delYn:true,delDttm:new Date()}}));
    assert.equal((await set('PREC',prec.id,true)).status,200);
    for(const row of laws.slice(1))assert.equal((await set('LEGAL',row.id,true)).status,200);
    const page1=await (await get('?limit=10')).json(),page2=await (await get('?limit=10&offset=10')).json();
    assert.equal(page1.total,15);assert.equal(page1.items.length,10);assert.equal(page1.nextOffset,10);assert.equal(page2.items.length,5);
    assert.equal(new Set([...page1.items,...page2.items].map(x=>x.id)).size,15);
    assert.equal((await (await get('?limit=50&kind=PREC')).json()).items[0].title,'가상 임대차 보증금 반환 판결');
    assert.equal((await (await get('?q='+encodeURIComponent('주택임대차'))).json()).total,1);
    assert.equal((await (await get('?q=%25')).json()).total,0);
    assert.equal((await get('?limit=30')).status,400);assert.equal((await get('/state?kind=LEGAL&ids='+Array(51).fill('1').join(','))).status,400);
    assert.equal((await set('LEGAL','9223372036854775808',true)).status,400);assert.equal((await set('WRONG','1',true)).status,400);
    await db.legal.update({where:{id:laws[1].id},data:{delYn:true,delDttm:new Date(),delId:owner.userId}});await db.legalPrec.update({where:{id:prec.id},data:{delYn:true,delDttm:new Date(),delId:owner.userId}});
    assert.equal((await set('LEGAL',laws[1].id,true)).status,404);assert.equal((await set('PREC',prec.id,true)).status,404);
    assert.equal((await (await get('?limit=50')).json()).total,13);
    assert.deepEqual((await (await get('/state?kind=LEGAL&ids='+laws[1].id)).json()).savedIds,[]);
    const readBefore=await db.userBmark.findMany();await get('?limit=50');assert.deepEqual(await db.userBmark.findMany(),readBefore);
    if(process.env.AURORE_BOOKMARKS_UI==='1'){
      await db.legalPrec.update({where:{id:prec.id},data:{delYn:false,delDttm:null,delId:null}});
      const temp=await mkdtemp(join(tmpdir(),'aurore-bookmarks-ui-'));
      web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3002'],{cwd:'C:/dev/easy-law-ai/frontend',env:{...process.env,BACKEND_URL:base},windowsHide:true,stdio:'ignore'});
      for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:3002/login')).ok)break;}catch{}await delay(250);}
      console.log('UI_READY http://127.0.0.1:3002/login stop='+join(temp,'stop'));
      const deadline=Date.now()+8*60000;while(Date.now()<deadline){try{await access(join(temp,'stop'));break;}catch{}await delay(300);}
    }
    await auth.logout(token);assert.equal((await get()).status,401);assert.equal((await set('LEGAL',laws[0].id,true)).status,401);
  }finally{
    if(web){web.kill();if(web.exitCode===null)await new Promise(resolve=>web.once('exit',resolve));}
    await app?.close();await db?.$disconnect();
    if(created)run('docker',['exec','aurore-dev-check-postgres','dropdb','-U','aurore_dev_check',name]);
  }
});
