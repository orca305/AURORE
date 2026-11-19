import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {notebookSettings,inspectDatabase,inspectAi,checkNotebook} from './check-notebook.mjs';
const secret='synthetic-private-value';
const env={DATABASE_URL:'postgresql://synthetic:'+secret+'@127.0.0.1:15433/aurore_dev_check?schema=public',AURORE_AI_URL:'http://127.0.0.1:18001',BACKEND_URL:'http://127.0.0.1:3001',AURORE_INTENT_CLASSIFY:'0'};
const expected=readdirSync(new URL('../backend/prisma/migrations/',import.meta.url)).filter(name=>/^\d{14}_/.test(name));
test('notebook mode accepts only the SSH desktop targets and keeps credentials internal',()=>{
 const settings=notebookSettings(env);assert.equal(settings.database.port,15433);assert.equal(settings.database.password,secret);
 for(const patch of [{DATABASE_URL:env.DATABASE_URL.replace('15433','5433')},{DATABASE_URL:env.DATABASE_URL.replace('127.0.0.1','example.com')},{DATABASE_URL:env.DATABASE_URL+'&host=example.com'},{DATABASE_URL:env.DATABASE_URL.replace('public','private')},{DATABASE_URL:env.DATABASE_URL.replace('aurore_dev_check','other_db')},{DATABASE_URL:env.DATABASE_URL.replace(secret,'REPLACE_WITH_DESKTOP_PASSWORD')},{AURORE_AI_URL:'http://127.0.0.1:8001'},{AURORE_AI_URL:'http://user:password@127.0.0.1:18001'},{AURORE_AI_URL:'http://127.0.0.1:18001/?other=true'},{AURORE_AI_URL:'http://external.example'},{BACKEND_URL:'http://external.example:3001'},{AURORE_INTENT_CLASSIFY:'1'},{AURORE_INTENT_ENABLE_ROUTING:'1'}])assert.throws(()=>notebookSettings({...env,...patch}));
});
test('database check reads schema and counts within READ ONLY and closes its connection',async()=>{
 const queries=[];let closed=false,options;
 class Client{constructor(input){options=input;}async connect(){}async query(sql){queries.push(sql);if(sql.includes('current_database'))return {rows:[{name:'aurore_dev_check',version:170009}]};if(sql.includes('_prisma_migrations'))return {rows:expected.map(migration_name=>({migration_name,finished_at:new Date(),rolled_back_at:null}))};if(sql.startsWith('SELECT (SELECT'))return {rows:[{legals:'85',versions:'85',provisions:'10169'}]};return {rows:[]};}async end(){closed=true;}}
 const data=await inspectDatabase(notebookSettings(env),Client);assert.equal(data.migrations,expected.length);assert.equal(data.legals,'85');assert.ok(closed);assert.equal(queries[0],'BEGIN READ ONLY');assert.equal(queries.at(-1),'ROLLBACK');assert.ok(queries.every(q=>/^(SELECT|BEGIN READ ONLY|ROLLBACK)/.test(q)));assert.equal(options.host,'127.0.0.1');assert.equal(options.connectionTimeoutMillis,2000);assert.ok(!JSON.stringify(data).includes(secret));
});
test('schema/version mismatch closes connection and never migrates the remote database',async()=>{
 let closed=0;class WrongVersion{async connect(){}async query(sql){assert.ok(!/ALTER|INSERT|UPDATE|DELETE|CREATE/i.test(sql));return {rows:[{name:'aurore_dev_check',version:180001}]};}async end(){closed++;}}
 await assert.rejects(inspectDatabase(notebookSettings(env),WrongVersion),e=>e.code==='DESKTOP_DATABASE_VERSION_MISMATCH');assert.equal(closed,1);
 class MissingMigrations{async connect(){}async query(sql){return {rows:sql.includes('current_database')?[{name:'aurore_dev_check',version:170001}]:[]};}async end(){closed++;}}
 await assert.rejects(inspectDatabase(notebookSettings(env),MissingMigrations),e=>e.code==='DESKTOP_SCHEMA_MISMATCH');assert.equal(closed,2);
});
test('AI readiness check uses health GETs only, without running inference',async()=>{
 const calls=[];const result=await inspectAi(notebookSettings(env),async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(url.endsWith('/documents/health')?{ready:true}:{status:'ok',service:'aurore-ai'}));});
 assert.equal(result.inferencePerformed,false);assert.deepEqual(calls.map(c=>new URL(c.url).pathname),['/health','/documents/health']);assert.ok(calls.every(c=>!c.init.method&&c.init.redirect==='error'));
 await assert.rejects(inspectAi(notebookSettings(env),async()=>new Response(JSON.stringify({status:'ok',service:'unrelated'}))),e=>e.code==='DESKTOP_AI_SERVICE_MISMATCH');
 await assert.rejects(inspectAi(notebookSettings(env),async(url)=>new Response(JSON.stringify(url.endsWith('/documents/health')?{ready:false}:{status:'ok',service:'aurore-ai'}))),e=>e.code==='DESKTOP_MODEL_NOT_READY');
 await assert.rejects(inspectAi(notebookSettings(env),async()=>new Response('x'.repeat(16385))));
});
test('offline report separates DB and AI failures without echoing connection secrets',async()=>{
 const result=await checkNotebook(env,{database:async()=>{throw Error('postgresql://'+secret);},ai:async()=>({status:'OK',inferencePerformed:false})});assert.equal(result.ready,false);assert.equal(result.database.status,'UNAVAILABLE');assert.equal(result.ai.status,'OK');assert.equal(result.dbWrites,false);assert.ok(!JSON.stringify(result).includes(secret));
 let touched=false;await assert.rejects(checkNotebook({...env,AURORE_AI_URL:'http://bad.example'},{database:async()=>{touched=true;},ai:async()=>{touched=true;}}));assert.equal(touched,false);
 const ok=await checkNotebook(env,{database:async()=>({status:'OK'}),ai:async()=>({status:'OK'})});assert.equal(ok.ready,true);
});
