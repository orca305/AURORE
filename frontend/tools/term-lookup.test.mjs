import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as httpServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
test('conversation term search proxies only published data, preserves paging and returns safe failures without DB or AI',{timeout:60000},async()=>{
 let web;const received=[];
 const backend=httpServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');if(url.pathname!=='/terms'){response.writeHead(404);response.end('{}');return;}
  received.push({url,headers:request.headers});const q=url.searchParams.get('q'),limit=Number(url.searchParams.get('limit')),offset=Number(url.searchParams.get('offset'));
  response.setHeader('Content-Type','application/json');
  if(q==='failure'){response.writeHead(500);response.end(JSON.stringify({error:'private-upstream-value'}));return;}
  if(q==='malformed'){response.end('not json');return;}
  const total=q==='empty'?0:13,count=Math.max(0,Math.min(limit,total-offset));
  const items=Array.from({length:count},(_,i)=>({id:String(offset+i+1),termName:'합성 보증금',definition:'합성 정의입니다. 실제 법률 자료가 아닙니다.',sourceName:'합성 출처',sourceReference:'합성 법령 기준',sourceUrl:q==='unsafe'?'https://www.law.go.kr/LSW/?OC=private-upstream-value':'https://www.law.go.kr/LSW/lsTrmInfoR.do?trmSeqs=1',state:q==='draft'?'DRAFT':'PUBLISHED',deleted:q==='deleted',actorUserId:'private-upstream-value',history:['private-upstream-value']}));
  response.end(JSON.stringify({items,total,limit,offset,nextOffset:offset+limit<total?offset+limit:null}));
 });
 try{
  const backendPort=await listen(backend),reserved=tcpServer(),port=await listen(reserved);await new Promise(resolve=>reserved.close(resolve));
  web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,BACKEND_URL:'http://127.0.0.1:'+backendPort},windowsHide:true,stdio:'ignore'});
  const base='http://127.0.0.1:'+port;let ready=false;
  for(let n=0;n<100;n++){assert.equal(web.exitCode,null);try{if((await fetch(base+'/login')).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready,'frontend did not start');
  const home=await fetch(base+'/'),html=await home.text();assert.equal(home.status,200);assert.ok(html.includes('용어 찾기'));assert.ok(html.includes('aria-controls="conversation-terms"'));
  const lookup=query=>fetch(base+'/api/terms/lookup?'+new URLSearchParams(query),{headers:{Cookie:'aurore_session='+'A'.repeat(43)}});
  const before=received.length;
  for(const query of [{q:''},{q:'x'.repeat(101)},{q:'보증금',limit:'7'},{q:'보증금',offset:'-1'},{q:'보증금',offset:'100001'},{q:'보증금',state:'ALL'}])assert.equal((await lookup(query)).status,400);
  assert.equal(received.length,before);
  const response=await lookup({q:' 보증금 ',limit:'10'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const data=await response.json();assert.equal(data.q,'보증금');assert.equal(data.items.length,10);assert.equal(data.nextOffset,10);assert.ok(!JSON.stringify(data).includes('private-upstream-value'));
  const next=await(await lookup({q:'보증금',limit:'10',offset:'10'})).json();assert.equal(next.items.length,3);assert.equal(next.nextOffset,null);assert.equal(new Set([...data.items,...next.items].map(i=>i.id)).size,13);
  for(const size of ['20','50'])assert.equal((await(await lookup({q:'보증금',limit:size})).json()).items.length,13);
  const empty=await(await lookup({q:'empty'})).json();assert.equal(empty.total,0);assert.deepEqual(empty.items,[]);
  for(const q of ['draft','deleted','unsafe','malformed'])assert.equal((await lookup({q})).status,502);
  const failed=await lookup({q:'failure'});assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('private-upstream-value'));
  assert.ok(received.every(r=>!r.headers.authorization&&!r.headers.cookie&&r.url.searchParams.get('sort')==='newest'));
  assert.equal((await fetch(base+'/api/terms/lookup',{method:'POST'})).status,405);
  console.log('CONVERSATION_TERMS_PASS toolbar SSR, published-only boundary, source URL checks, 10/20/50 paging, no credential forwarding, empty and error handling');
 }finally{if(web){web.kill();if(web.exitCode===null)await new Promise(resolve=>web.once('exit',resolve));}await new Promise(resolve=>backend.close(resolve));}
});
