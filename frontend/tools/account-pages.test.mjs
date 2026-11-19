import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as httpServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
test('account SSR distinguishes saved choices, empty history pages and unavailable consent without writing user data',{timeout:60000},async()=>{
 const token='A'.repeat(43);let agreed=false,broken=false,web;const methods=[];
 const backend=httpServer((req,res)=>{methods.push(req.method);res.setHeader('Content-Type','application/json');const url=new URL(req.url,'http://localhost');const send=(data,status=200)=>{res.writeHead(status);res.end(JSON.stringify(data));};if(req.headers.authorization!=='Bearer '+token){send({},401);return;}if(url.pathname==='/auth/session'){send({id:'1',nickname:'검증회원',loginId:'synthetic'});return;}if(url.pathname==='/notifications/unread'){send({count:0});return;}if(url.pathname==='/auth/learning-consent'){if(broken){send({agreed:'broken'});return;}const limit=Number(url.searchParams.get('limit')),offset=Number(url.searchParams.get('offset'));send({agreed,revision:'2',policyVersion:'3.3',total:2,limit,offset,nextOffset:null,history:offset?[]:[{id:'2',agreed,policyVersion:'3.3',recordedAt:'2026-11-19T00:00:00Z'},{id:'1',agreed:!agreed,policyVersion:'3.3',recordedAt:'2026-11-18T00:00:00Z'}]});return;}send({},404);});
 try{
  const backendPort=await listen(backend),reserve=tcpServer(),port=await listen(reserve);await new Promise(resolve=>reserve.close(resolve));const base='http://127.0.0.1:'+port;
  web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,BACKEND_URL:'http://127.0.0.1:'+backendPort},windowsHide:true,stdio:'ignore'});
  let ready=false;for(let n=0;n<100;n++){assert.equal(web.exitCode,null);try{if((await fetch(base+'/login')).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready);
  const html=async(path)=>{const response=await fetch(base+path,{headers:{Cookie:'aurore_session='+token},redirect:'manual'});assert.equal(response.status,200);return (await response.text()).replace(/<!--[\s\S]*?-->/g,'');};
  let page=await html('/account?consentSaved=withdrawn');assert.ok(page.includes('학습 활용 미동의·철회를 저장했습니다.'));assert.ok(page.includes('모든 기기에서 다시 로그인해야 함을 확인했습니다.'));assert.match(page,/<button[^>]*disabled[^>]*>모든 기기에서 로그아웃<\/button>/);assert.ok(page.includes('현재 사용자 자료를 학습하는 기능은 연결되어 있지 않습니다.'));
  agreed=true;page=await html('/account?consentSaved=withdrawn');assert.ok(!page.includes('학습 활용 미동의·철회를 저장했습니다.'));assert.ok(page.includes('현재 선택 <strong>동의함</strong>'));
  page=await html('/account?offset=20&limit=10');assert.ok(page.includes('이 페이지에 표시할 변경 이력이 없습니다.'));assert.ok(!page.includes('변경 이력이 없으면 기본 미동의로 처리합니다.'));assert.ok(page.includes('최근 이력부터 보기'));
  broken=true;page=await html('/account');assert.ok(page.includes('동의 상태를 불러오지 못했습니다.'));assert.ok(!page.includes('name="agreed"'));assert.ok(!page.includes('동의함</strong>'));
  assert.ok(methods.every(method=>method==='GET'));console.log('ACCOUNT_PAGES_PASS confirmation, saved-choice verification, empty-page distinction and invalid-consent fail closed; no user mutation');
 }finally{if(web){web.kill();if(web.exitCode===null)await new Promise(resolve=>web.once('exit',resolve));}await new Promise(resolve=>backend.close(resolve));}
});
