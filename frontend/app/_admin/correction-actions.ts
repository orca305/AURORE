"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentToken, trustedOrigin } from "../_auth/session";
import { correctionResults } from "./format";
export type ApprovalState={error:string;terminal:boolean}|null;
export async function approveCorrection(id:string,beforeHash:string,afterHash:string,form:FormData):Promise<ApprovalState> {
 if(!await trustedOrigin()) return {error:"요청을 확인할 수 없습니다. 페이지를 다시 열어 주세요.",terminal:false};
 const token=await currentToken();if(!token) redirect("/login");
 const requestId=form.get("requestId");
 if(!/^[a-f0-9]{64}$/.test(id)||![beforeHash,afterHash].every(hash=>/^[a-f0-9]{64}$/.test(hash))||typeof requestId!=="string"||!/^[0-9a-f-]{36}$/i.test(requestId)||form.get("confirmed")!=="yes") return {error:"전후 원문 확인에 동의한 뒤 승인해 주세요.",terminal:true};
 let response:Response;
 try {response=await fetch(new URL('/admin/legal-refresh/reviews/'+id+'/approve',process.env.BACKEND_URL||'http://127.0.0.1:3001'),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({requestId,beforeHash,afterHash,confirmed:true}),cache:'no-store',signal:AbortSignal.timeout(45000)});} catch {return {error:"결과를 확인하지 못했습니다. 다시 누르면 같은 처리 번호로 결과를 확인합니다.",terminal:false};}
 if(response.status===401) redirect('/login?expired=1');
 if(response.status===403) return {error:"관리자 권한을 다시 확인해 주세요.",terminal:true};
 if(!response.ok) return {error:"요청을 완료하지 못했습니다. 처리 이력을 확인한 뒤 다시 시도해 주세요.",terminal:false};
 const result=await response.json() as {status:string;resultCode:string};
 revalidatePath('/admin/activity');revalidatePath('/admin');revalidatePath('/admin/legal-refresh');
 if(result.status==='SUCCEEDED') {revalidatePath('/legals','layout');redirect('/admin/legal-refresh?applied=1#processing-history');}
 return {error:correctionResults[result.resultCode]??"정정을 반영하지 못했습니다. 처리 이력을 확인해 주세요.",terminal:true};
}
