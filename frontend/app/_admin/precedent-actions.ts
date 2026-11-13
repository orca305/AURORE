"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {currentToken,trustedOrigin} from "../_auth/session";
export type ReviewState={error:string;terminal:boolean}|null;
export async function resolvePrecedent(id:string,reviewHash:string,form:FormData):Promise<ReviewState>{
 if(!await trustedOrigin())return {error:"요청을 확인할 수 없습니다.",terminal:true};
 const token=await currentToken();if(!token)redirect('/login');
 const requestId=form.get('requestId'),decision=form.get('decision'),reason=form.get('reason');
 if(!/^[1-9]\d{0,18}$/.test(id)||!/^[a-f0-9]{64}$/.test(reviewHash)||typeof requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(requestId)||!['verified','unverified'].includes(String(decision))||typeof reason!=='string'||!reason.trim()||reason.length>2000||form.get('confirmed')!=='yes')return {error:'원문 확인과 검토 사유를 입력해 주세요.',terminal:true};
 let response:Response;try{response=await fetch(new URL('/admin/precedent-reviews/'+id+'/resolve',process.env.BACKEND_URL||'http://127.0.0.1:3001'),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({requestId,reviewHash,decision,reason,confirmed:true}),cache:'no-store',signal:AbortSignal.timeout(40000)});}catch{return {error:'결과를 확인하지 못했습니다. 다시 누르면 같은 처리 번호로 확인합니다.',terminal:false};}
 if(response.status===401)redirect('/login?expired=1');
 if(!response.ok){let message='요청을 처리하지 못했습니다. 다시 확인해 주세요.';if([400,403,404,409].includes(response.status)){const body=await response.json().catch(()=>null) as {message?:unknown}|null;if(typeof body?.message==='string')message=body.message;}return {error:message,terminal:[400,403,404,409].includes(response.status)};}
 revalidatePath('/admin/activity');revalidatePath('/admin/precedent-reviews');revalidatePath('/precedents');redirect('/admin/precedent-reviews?resolved=1#review-history');
}
