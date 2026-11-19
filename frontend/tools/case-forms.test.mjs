import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as httpServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {validCaseDate,caseFormProblem} from '../app/_cases/form-policy.ts';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
test('case form requires current confirmation and validates real dates and field boundaries',()=>{
 const value={title:'합성 제목',typeCode:'OTHER',content:'합성 사실관계',date:'',confirmed:true};
 for(const date of ['','0001-01-01','9999-12-31','2000-02-29','2024-02-29'])assert.equal(validCaseDate(date),true);
 for(const date of ['0000-01-01','10000-01-01','2026-02-29','1900-02-29','2026-04-31','2026-13-01','26-01-01'])assert.equal(validCaseDate(date),false);
 assert.equal(caseFormProblem('createFact',{...value,title:'가'.repeat(80),content:'나'.repeat(4000)}),null);
 for(const patch of [{title:' '},{title:'가'.repeat(81)},{content:' '},{content:'가'.repeat(4001)},{date:'2026-02-30'},{confirmed:false}])assert.equal(typeof caseFormProblem('createFact',{...value,...patch}),'string');
 assert.equal(caseFormProblem('delete',{...value,title:'',content:'',confirmed:true}),null);assert.equal(typeof caseFormProblem('delete',{...value,confirmed:false}),'string');assert.equal(typeof caseFormProblem('create',{...value,typeCode:'bad-code'}),'string');
});
test('authenticated case pages render target-specific confirmation, counters and disabled initial save',{timeout:60000},async()=>{
 const id='00000000-0000-4000-8000-000000000001',token='A'.repeat(43),now='2026-11-19T00:00:00Z';
 const parent={id,title:'합성 사건 제목',typeCode:'OTHER',typeName:'기타',revision:1,createdAt:now,updatedAt:now},fact={id:'1',title:'합성 사실관계 제목',content:'합성 검증 내용',occurredOn:'2026-11-19',updatedAt:now};let optionsFail=false,web;
 const backend=httpServer((req,res)=>{res.setHeader('Content-Type','application/json');const url=new URL(req.url,'http://localhost');const send=(value,status=200)=>{res.writeHead(status);res.end(JSON.stringify(value));};if(req.headers.authorization!=='Bearer '+token){send({},401);return;}if(url.pathname==='/auth/session'){send({id:'1',nickname:'검증회원',loginId:'synthetic'});return;}if(url.pathname==='/notifications/unread'){send({count:0});return;}if(url.pathname==='/cases/options'){send(optionsFail?{}:{types:[{code:'OTHER',label:'기타'}]},optionsFail?503:200);return;}if(url.pathname==='/cases/'+id){send({case:parent,types:[{code:'OTHER',label:'기타'}],facts:{items:[fact],total:1,offset:0,nextOffset:null},history:{items:[],total:0,offset:0,nextOffset:null}});return;}if(url.pathname==='/cases/'+id+'/chats'){send({items:[],total:0,nextOffset:null});return;}if(url.pathname==='/cases/'+id+'/facts/1'){send({case:parent,fact});return;}if(url.pathname==='/cases/'+id+'/timeline'){send({case:parent,items:[fact],total:1,undatedTotal:0,offset:0,nextOffset:null});return;}send({},404);});
 try{
  const backendPort=await listen(backend),reserve=tcpServer(),port=await listen(reserve);await new Promise(resolve=>reserve.close(resolve));const base='http://127.0.0.1:'+port;
  web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,BACKEND_URL:'http://127.0.0.1:'+backendPort},windowsHide:true,stdio:'ignore'});
  let ready=false;for(let n=0;n<100;n++){assert.equal(web.exitCode,null);try{if((await fetch(base+'/login')).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready);
  const get=path=>fetch(base+path,{headers:{Cookie:'aurore_session='+token},redirect:'manual'});
  for(const path of ['/cases/new','/cases/'+id,'/cases/'+id+'/facts/1','/cases/'+id+'/timeline']){const response=await get(path);assert.equal(response.status,200,path);const html=(await response.text()).replace(/<!--[\s\S]*?-->/g,'');assert.ok(html.includes('저장할 내용')||html.includes('삭제 대상'));if(path==='/cases/new'){assert.match(html,/<button[^>]*disabled[^>]*>사건 저장<\/button>/);assert.ok(html.includes('0/80자'));}if(path==='/cases/'+id){assert.ok(html.includes('삭제 대상 · 합성 사건 제목'));assert.ok(html.includes('삭제 대상 · 합성 사실관계 제목'));}if(path.includes('/facts/')){assert.ok(html.includes('4,000자'));assert.ok(html.includes('내용을 확인한 뒤 확인란에 체크해 주세요.'));}}
  optionsFail=true;const missing=await get('/cases/new');assert.ok((await missing.text()).includes('사건 분류를 불러오지 못했습니다.'));
  assert.equal((await fetch(base+'/cases/new',{redirect:'manual'})).status,307);
  console.log('CASE_FORMS_PASS real calendar validation, field boundaries, initial confirmation, target-specific deletion and authenticated page SSR');
 }finally{if(web){web.kill();if(web.exitCode===null)await new Promise(resolve=>web.once('exit',resolve));}await new Promise(resolve=>backend.close(resolve));}
});
