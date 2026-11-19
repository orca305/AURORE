import test from 'node:test';
import assert from 'node:assert/strict';
import {passwordLength,passwordChangeProblem,validConsentRevision,consentResultMatches,readAccountPayload,isConsentPage} from '../app/_auth/form-policy.ts';
test('password UX follows NFC/code-point length without storing or echoing the password',()=>{
 assert.equal(passwordLength('e\u0301'.repeat(8)),8);assert.equal(passwordLength('😀'.repeat(16)),16);
 assert.equal(passwordChangeProblem('Synthetic8!','\u1100\u1161\u11a8'.repeat(16),'각'.repeat(16)),null);
 assert.equal(passwordChangeProblem('Synthetic8!','e\u0301'.repeat(8),'é'.repeat(8)),null);assert.equal(passwordChangeProblem('Synthetic8!','😀'.repeat(16),'😀'.repeat(16)),null);
 for(const [current,next,confirmation] of [['short','Synthetic9!','Synthetic9!'],['Synthetic8!','short','short'],['Synthetic8!','a'.repeat(17),'a'.repeat(17)],['Synthetic8!','Synthetic8!','Synthetic8!'],['Synthetic8!','Synthetic9!','Mismatch9!'],['Synthetic8!','\ud800'.repeat(8),'\ud800'.repeat(8)]]){const error=passwordChangeProblem(current,next,confirmation);assert.equal(typeof error,'string');assert.ok(!error.includes(current)&&!error.includes(next));}
});
test('consent response must match the requested choice and a valid persisted revision',()=>{
 assert.ok(validConsentRevision('0'));assert.ok(validConsentRevision('9223372036854775807'));for(const value of ['-1','01','9223372036854775808','x',1,null])assert.equal(validConsentRevision(value),false);
 assert.ok(consentResultMatches({agreed:true,revision:'1',changed:true},true));assert.ok(consentResultMatches({agreed:false,revision:'0',changed:false},false));
 for(const value of [null,[],{}, {agreed:false,revision:'1',changed:true},{agreed:true,revision:'x',changed:true},{agreed:true,revision:'0',changed:true},{agreed:true,revision:'1'}])assert.equal(consentResultMatches(value,true),false);
});
test('auth error handling tolerates empty, null and non-object JSON bodies',async()=>{
 for(const value of ['', 'null','[]','true','42','"text"','not-json'])assert.deepEqual(await readAccountPayload(new Response(value)),{});
 assert.deepEqual(await readAccountPayload(new Response('{"message":"합성 오류"}')),{message:'합성 오류'});
});
test('consent page rejects malformed selection/history rather than showing a default choice',()=>{
 const page={agreed:false,revision:'0',policyVersion:'3.3',total:0,limit:20,offset:0,nextOffset:null,history:[]};assert.ok(isConsentPage(page,20,0));
 for(const patch of [{agreed:'false'},{revision:'bad'},{total:-1},{offset:1},{nextOffset:0},{history:[{id:'1',agreed:true,policyVersion:'3.3',recordedAt:'bad-date'}]}])assert.equal(isConsentPage({...page,...patch},20,0),false);
});
