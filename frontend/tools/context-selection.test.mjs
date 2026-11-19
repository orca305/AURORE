import test from 'node:test';
import assert from 'node:assert/strict';
import {documentSelectionProblem,factContextLength} from '../app/_conversation/context-selection.ts';
import {loadCaseContext} from '../../backend/dist/chat/case-context.js';
test('attachment selection allows the exact server limit and rejects count, duplicates and unknown lengths',()=>{
 const row=(id,n)=>({id,name:'합성 자료',characterCount:n});
 assert.equal(documentSelectionProblem([]),null);assert.equal(documentSelectionProblem([row('1',6000),row('2',6000)]),null);
 for(const rows of [[row('1',6000),row('2',6001)],[row('1',1),row('2',1),row('3',1),row('4',1)],[row('1',1),row('1',1)],[row('1',NaN)],[row('1',undefined)],[row('1',-1)]])assert.equal(typeof documentSelectionProblem(rows),'string');
});
test('fact length matches the actual backend context including dates and separators',async()=>{
 for(const items of [[{title:'확인한 사실',content:'합성 내용 😀',occurredOn:null}],[{title:'사실 하나',content:'합성 내용',occurredOn:'2026-11-19'},{title:'사실 둘',content:'두번째 합성 내용',occurredOn:null}]]){
  const tx={$queryRaw:async()=>[],userCase:{findFirst:async()=>({revNo:1})},caseFact:{findMany:async()=>items.map((factVal,i)=>({id:BigInt(i+1),factVal}))}};
  const result=await loadCaseContext(tx,'synthetic-case',1n,{revision:1,factIds:items.map((_,i)=>String(i+1)),asOf:'2026-11-19',confirmed:true});assert.equal(factContextLength(items),result.text.length);
 }
 const blank={title:'사실',content:'',occurredOn:null},overhead=factContextLength([blank]),boundary={...blank,content:'가'.repeat(8000-overhead)};assert.equal(factContextLength([boundary]),8000);assert.equal(factContextLength([{...boundary,content:boundary.content+'나'}]),8001);
});
