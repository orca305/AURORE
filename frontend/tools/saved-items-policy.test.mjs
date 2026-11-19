import test from 'node:test';
import assert from 'node:assert/strict';
import {positiveId,readingHref,unreadValue,readReceipt,bookmarkReceipt,isBookmarkPage,isNotificationPage} from '../app/_components/list-response.ts';
const date='2026-11-19T00:00:00Z';
test('read and bookmark acknowledgements require exact IDs and requested states',()=>{
 assert.ok(positiveId('9223372036854775807'));for(const id of ['0','01','9223372036854775808',1,null])assert.equal(positiveId(id),false);
 assert.ok(readReceipt({read:true}));assert.equal(readReceipt({read:'true'}),false);assert.equal(readReceipt(null),false);
 assert.ok(bookmarkReceipt({kind:'LEGAL',targetId:'1',saved:true},'LEGAL','1',true));for(const value of [{kind:'PREC',targetId:'1',saved:true},{kind:'LEGAL',targetId:'2',saved:true},{kind:'LEGAL',targetId:'1',saved:false},null])assert.equal(bookmarkReceipt(value,'LEGAL','1',true),false);
});
test('unknown unread counts and unsafe destinations are never treated as valid data',()=>{
 assert.equal(unreadValue({count:0}),0);assert.equal(unreadValue({count:3}),3);for(const value of [null,{count:'3'},{count:-1},{count:NaN},{}])assert.equal(unreadValue(value),null);
 for(const path of ['/legals/1/versions','/precedents?q=synthetic#case-1','/precedents/1/compare?beforeRevisionId=1'])assert.ok(readingHref(path));
 for(const path of ['//evil.example','https://evil.example','javascript:alert(1)','/account','/legals/\\evil.example'])assert.equal(readingHref(path),false);
});
test('saved-item pages validate counts, dates and kinds before rendering',()=>{
 const item={id:'1',kind:'LEGAL',targetId:'1',title:'합성 법령',subtitle:'합성 자료',savedAt:date,href:'/legals/1/versions'},page={items:[item],total:1,offset:0,nextOffset:null};assert.ok(isBookmarkPage(page,20,0));
 for(const patch of [{savedAt:'invalid'},{kind:['LEGAL']},{href:'javascript:alert(1)'},{id:'0'}])assert.equal(isBookmarkPage({...page,items:[{...item,...patch}]},20,0),false);
 const notice={id:'2',targetKind:'PREC',kind:'CORRECTED',scope:'VERSION',title:'합성 판례',content:'합성 정정',baseDate:'2026-11-19',occurredAt:date,deliveredAt:date,readAt:null,href:'/precedents/1/compare'},inbox={items:[notice],total:1,unreadCount:2,readThroughId:'3',nextOffset:null,sync:{failed:false,lastSuccessAt:null}};
 assert.ok(isNotificationPage(inbox,20,0));for(const patch of [{baseDate:'2026-02-30'},{readAt:'invalid'},{targetKind:['PREC']},{href:'//evil.example'}])assert.equal(isNotificationPage({...inbox,items:[{...notice,...patch}]},20,0),false);
 assert.equal(isNotificationPage({...inbox,readThroughId:'1'},20,0),false);
});
