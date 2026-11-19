import {createRequire} from 'node:module';
import {readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const requireBackend=createRequire(new URL('../backend/package.json',import.meta.url));
const failure=code=>Object.assign(new Error(code),{code});
export function notebookSettings(env){
 let database,ai,backend;
 try{database=new URL(env.DATABASE_URL);ai=new URL(env.AURORE_AI_URL);backend=new URL(env.BACKEND_URL||'http://127.0.0.1:3001');}catch{throw failure('NOTEBOOK_SETTINGS_REQUIRED');}
 if(!['postgres:','postgresql:'].includes(database.protocol)||database.hostname!=='127.0.0.1'||database.port!=='15433'||database.pathname!=='/aurore_dev_check'||!database.username||!database.password||database.hash||[...database.searchParams].some(([key,value])=>key!=='schema'||value!=='public'))throw failure('NOTEBOOK_DATABASE_TARGET_INVALID');
 if(decodeURIComponent(database.password)==='REPLACE_WITH_DESKTOP_PASSWORD')throw failure('DESKTOP_PASSWORD_REQUIRED');
 if(ai.href!=='http://127.0.0.1:18001/')throw failure('NOTEBOOK_AI_TARGET_INVALID');
 if(backend.href!=='http://127.0.0.1:3001/')throw failure('NOTEBOOK_BACKEND_TARGET_INVALID');
 if((env.AURORE_INTENT_CLASSIFY||'0')!=='0'||(env.AURORE_INTENT_ENABLE_ROUTING||'0')!=='0')throw failure('NOTEBOOK_INTENT_MUST_REMAIN_DISABLED');
 return {database:{host:'127.0.0.1',port:15433,database:'aurore_dev_check',user:decodeURIComponent(database.username),password:decodeURIComponent(database.password)},ai:ai.origin};
}
export async function inspectDatabase(settings,Client=requireBackend('pg').Client){
 const client=new Client({...settings.database,connectionTimeoutMillis:2000,statement_timeout:2000,query_timeout:3000,application_name:'aurore-notebook-check'});
 try{
  await client.connect();await client.query('BEGIN READ ONLY');
  const {rows:[metadata]}=await client.query("SELECT current_database() AS name,current_setting('server_version_num')::int AS version");
  if(metadata.name!=='aurore_dev_check'||metadata.version<170000||metadata.version>=180000)throw failure('DESKTOP_DATABASE_VERSION_MISMATCH');
  const {rows:applied}=await client.query('SELECT migration_name,finished_at,rolled_back_at FROM public._prisma_migrations');
  const expected=readdirSync(new URL('../backend/prisma/migrations/',import.meta.url)).filter(name=>/^\d{14}_/.test(name)).sort();
  if(applied.some(row=>!row.finished_at&&!row.rolled_back_at)||expected.some(name=>!applied.some(row=>row.migration_name===name&&row.finished_at))||applied.some(row=>row.finished_at&&!expected.includes(row.migration_name)))throw failure('DESKTOP_SCHEMA_MISMATCH');
  const {rows:[counts]}=await client.query('SELECT (SELECT count(*)::text FROM public.legal WHERE NOT del_yn) AS legals,(SELECT count(*)::text FROM public.legal_ver WHERE NOT del_yn) AS versions,(SELECT count(*)::text FROM public.legal_provi WHERE NOT del_yn) AS provisions');
  await client.query('ROLLBACK');
  return {status:'OK',port:15433,serverMajor:17,migrations:expected.length,latestMigration:expected.at(-1),...counts};
 }finally{await client.end().catch(()=>{});}
}
export async function inspectAi(settings,fetchImpl=fetch){
 async function get(path){
  const response=await fetchImpl(settings.ai+path,{redirect:'error',signal:AbortSignal.timeout(4000)});
  if(!response.ok||!response.body)throw failure('DESKTOP_AI_UNAVAILABLE');
  const reader=response.body.getReader();const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw failure('DESKTOP_AI_RESPONSE_INVALID');}chunks.push(value);}}finally{reader.releaseLock();}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
 }
 const health=await get('/health');if(health.status!=='ok'||health.service!=='aurore-ai')throw failure('DESKTOP_AI_SERVICE_MISMATCH');
 const model=await get('/documents/health');if(model.ready!==true)throw failure('DESKTOP_MODEL_NOT_READY');
 return {status:'OK',port:18001,modelConfigured:true,inferencePerformed:false};
}
export async function checkNotebook(env,{database=inspectDatabase,ai=inspectAi}={}){
 const settings=notebookSettings(env),results=await Promise.allSettled([database(settings),ai(settings)]);
 const labels=['database','ai'],report={ready:results.every(r=>r.status==='fulfilled'),dbWrites:false,inferencePerformed:false};
 for(let i=0;i<results.length;i++){const item=results[i];report[labels[i]]=item.status==='fulfilled'?item.value:{status:'UNAVAILABLE',reason:labels[i]==='database'?'Check SSH, database credentials and matching migrations.':'Check SSH, desktop AI and model readiness.'};}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==2)throw failure('NO_ARGUMENTS_EXPECTED');const report=await checkNotebook(process.env);console.log(JSON.stringify(report,null,2));if(!report.ready)process.exitCode=2;}catch(error){const known=['NOTEBOOK_SETTINGS_REQUIRED','NOTEBOOK_DATABASE_TARGET_INVALID','DESKTOP_PASSWORD_REQUIRED','NOTEBOOK_AI_TARGET_INVALID','NOTEBOOK_BACKEND_TARGET_INVALID','NOTEBOOK_INTENT_MUST_REMAIN_DISABLED','NO_ARGUMENTS_EXPECTED'];console.error(known.includes(error?.code)?error.code:'NOTEBOOK_CHECK_FAILED');process.exitCode=1;}
}
