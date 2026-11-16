"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {currentToken,trustedOrigin} from "../_auth/session";
export type CollectionApprovalState={error:string;terminal:boolean}|null;
export async function approveCollectedPrecedent(batchId:string,sourceId:string,beforeHash:string|null,afterHash:string,form:FormData):Promise<CollectionApprovalState>{
 if(!await trustedOrigin())return {error:'요청을 확인하지 못했습니다. 페이지를 다시 열어 주세요.',terminal:false};
 const token=await currentToken();if(!token)redirect('/login');
 const requestId=form.get('requestId');
 if(!/^[a-f0-9]{64}$/.test(batchId)||!/^[1-9][0-9]{0,11}$/.test(sourceId)||(beforeHash!==null&&!/^[a-f0-9]{64}$/.test(beforeHash))||!/^[a-f0-9]{64}$/.test(afterHash)||typeof requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(requestId)||form.get('confirmed')!=='yes')return {error:'원문 확인에 동의한 뒤 승인해 주세요.',terminal:true};
 let response:Response;
 try{response=await fetch(new URL('/admin/precedent-collections/'+batchId+'/items/'+sourceId+'/approve',process.env.BACKEND_URL||'http://127.0.0.1:3001'),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({requestId,beforeHash,afterHash,confirmed:true}),cache:'no-store',signal:AbortSignal.timeout(45000)});}catch{return {error:'결과를 확인하지 못했습니다. 다시 누르면 같은 처리 번호로 확인합니다.',terminal:false};}
 if(response.status===401)redirect('/login?expired=1');if(response.status===403)return {error:'관리자 권한을 확인해 주세요.',terminal:true};
 if(!response.ok)return {error:'처리하지 못했습니다. 처리 이력을 확인한 뒤 다시 시도해 주세요.',terminal:false};
 const result=await response.json() as {status:string;resultCode:string};
 revalidatePath('/admin');revalidatePath('/admin/precedent-collections','layout');
 if(result.status==='SUCCEEDED'){revalidatePath('/precedents','layout');revalidatePath('/admin/precedent-reviews');redirect('/admin/precedent-collections/history');}
 const messages:Record<string,string>={REVIEW_UNAVAILABLE:'수집 기록과 원문을 확인해 주세요.',REVIEW_CHANGED:'검토 이후 원문이 변경되었습니다. 새로고침한 뒤 다시 대조해 주세요.',SOURCE_NOT_CONFIGURED:'공식 원문 연결 설정을 확인해 주세요.',SOURCE_VERIFY_FAILED:'공식 원문을 재확인하지 못했거나 수집 원문과 달라졌습니다.',PERMISSION_CHANGED:'처리 중 관리자 권한 또는 로그인이 변경되었습니다.',APPLY_FAILED:'반영하지 못했습니다. 원문과 DB 상태를 확인해 주세요.'};
 return {error:messages[result.resultCode]??'처리 이력을 확인해 주세요.',terminal:true};
}
