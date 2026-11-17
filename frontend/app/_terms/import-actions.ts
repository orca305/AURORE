"use server";
import {revalidatePath} from 'next/cache';
import {trustedOrigin} from '../_auth/session';
import {requestTerms,validTermId} from './requests';
import type {ImportState,ImportOutcome} from './import-types';
export async function importTerms(_previous:ImportState,form:FormData):Promise<ImportState>{
 if(!await trustedOrigin())return {error:'요청을 확인할 수 없습니다.',uncertain:false};
 const raw=form.get('items');let items:{sourceId:string;requestId:string}[];
 try{if(typeof raw!=='string'||raw.length>8192)throw Error();items=JSON.parse(raw);if(!Array.isArray(items)||items.length<1||items.length>20||items.some(i=>!i||typeof i.sourceId!=='string'||!/^\d{1,12}$/.test(i.sourceId)||i.sourceId.startsWith('0')||typeof i.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(i.requestId))||new Set(items.map(i=>i.sourceId)).size!==items.length||new Set(items.map(i=>i.requestId)).size!==items.length)throw Error();}catch{return {error:'가져올 용어를 1~20개 선택해 주세요.',uncertain:false};}
 const response=await requestTerms('/import',true,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items,confirmed:true}),signal:AbortSignal.timeout(90000)});
 if(!response?.ok)return {error:response?.status===409?'다른 수집이 진행 중입니다. 잠시 후 다시 시도해 주세요.':'처리 결과를 확인하지 못했습니다. 같은 선택으로 다시 시도해 주세요.',uncertain:!response||response.status!==409};
 const result=await response.json().catch(()=>null) as {results?:ImportOutcome[]}|null;
 if(!result||!Array.isArray(result.results)||result.results.length!==items.length||result.results.some(r=>!items.some(i=>i.sourceId===r.sourceId)||typeof r.status!=='string'||(r.termId!==null&&(typeof r.termId!=='string'||!validTermId(r.termId)))))return {error:'결과를 확인하지 못했습니다. 다시 시도해 주세요.',uncertain:true};
 revalidatePath('/admin/terms');revalidatePath('/terms');for(const row of result.results)if(row.termId){revalidatePath('/terms/'+row.termId);revalidatePath('/admin/terms/'+row.termId);}
 return {results:result.results,uncertain:false};
}
