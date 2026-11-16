"use server";

import { cookies } from "next/headers";
import { authRequest, currentToken, tokenPattern, trustedOrigin } from "../_auth/session";
import { chatCredential, chatIdPattern, guestCookie, loadChat, loadChatList, requestChat } from "./requests";
import type { ChatDetail, ChatResult } from "./types";


const invalid = <T=ChatDetail>(): ChatResult<T> => ({ data: null, error: "요청을 확인할 수 없습니다. 페이지를 다시 열어 주세요.", status: 400 });

async function rememberGuest(token: string, expiresAt: string, secure: boolean) {
  (await cookies()).set(guestCookie, token, {
    httpOnly: true, sameSite: "lax", secure, path: "/", expires: new Date(expiresAt),
  });
}

async function createGuest(secure: boolean) {
  const response = await authRequest("guest", { method: "POST" });
  if (!response?.ok) return null;
  const data = await response.json() as { token: string; expiresAt: string };
  if (!tokenPattern.test(data.token) || !Number.isFinite(Date.parse(data.expiresAt))) return null;
  await rememberGuest(data.token, data.expiresAt, secure);
  return "Guest " + data.token;
}

async function mutation<T=ChatDetail>(path: string, body?: object, create = false): Promise<ChatResult<T>> {
  const origin = await trustedOrigin();
  if (!origin) return invalid<T>();
  const member = await currentToken();
  let credential = await chatCredential();
  if (!credential && create) credential = await createGuest(origin.protocol === "https:");
  if (!credential) return { data: null, error: "대화 인증을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", status: 401 };
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) };
  let result = await requestChat<T & {authExpiresAt?:string|null}>(path, credential, init);
  if (result.status === 401 && !member && create) {
    credential = await createGuest(origin.protocol === "https:");
    if (credential) result = await requestChat<T & {authExpiresAt?:string|null}>(path, credential, init);
  }
  if (result.data?.authExpiresAt && credential?.startsWith("Guest ")) {
    await rememberGuest(credential.slice(6), result.data.authExpiresAt, origin.protocol === "https:");
  }
  return result;
}

export async function sendChatMessage(id: string, requestId: string, question: string, revision: number, documentIds:string[] = [], caseContext?:import("./types").CaseSelection,clarifyReplyTo?:string) {
  if (!chatIdPattern.test(id) || !chatIdPattern.test(requestId) ||
    typeof question !== "string" || Array.from(question).length > 1000 || !Number.isInteger(revision) || revision < 0) return invalid();
  if(!Array.isArray(documentIds)||documentIds.length>3||documentIds.some(value=>!chatIdPattern.test(value))||new Set(documentIds).size!==documentIds.length)return invalid();
  if(clarifyReplyTo!==undefined&&!chatIdPattern.test(clarifyReplyTo))return invalid();
  const result=await mutation("/chat-sessions/" + id + "/messages", { question, requestId, revision, documentIds,...(caseContext?{caseContext}:{}),...(clarifyReplyTo?{clarifyReplyTo}:{}) }, true);
  if(documentIds.length){if(result.status===503)result.error='첨부자료 답변용 로컬 AI가 준비되지 않았습니다. 모델 연결 후 다시 시도해 주세요.';if(result.status===400)result.error='첨부자료는 최대 3개, 선택한 Markdown 합계 12,000자까지 사용할 수 있습니다.';if(result.status===404)result.error='선택한 첨부자료가 삭제되었거나 이 대화의 자료가 아닙니다. 다시 확인해 주세요.';}
  if(clarifyReplyTo&&result.status===409)result.error='보완할 질문이 변경되었습니다. 최신 대화를 확인해 주세요.';
  if(caseContext){if(result.status===409)result.error='사건 또는 대화가 변경되었습니다. 사용할 사실관계를 다시 확인해 주세요.';if(result.status===400)result.error='사실관계는 최대 10개·합계 8,000자이며 조회 기준일을 확인해야 합니다.';}
  return result;
}

export async function caseContextOptions(id:string,limit=20,offset=0):Promise<ChatResult<import('./types').CaseContextPage>>{
 if(!chatIdPattern.test(id)||![10,20,50].includes(limit)||!Number.isInteger(offset)||offset<0||offset>100000)return invalid();
 const credential=await chatCredential();if(!credential)return {data:null,status:401,error:'로그인 상태를 확인해 주세요.'};
 return requestChat('/chat-sessions/'+id+'/case-context?'+new URLSearchParams({limit:String(limit),offset:String(offset)}),credential);
}

export async function refreshChat(id: string, beforeSeq?: number) {
  return loadChat(id, beforeSeq);
}

export async function markChatRead(id: string) {
  if (!chatIdPattern.test(id)) return invalid();
  return mutation("/chat-sessions/" + id + "/read");
}

export async function retryChatJob(id: string) {
  if (!chatIdPattern.test(id)) return invalid();
  return mutation("/jobs/" + id + "/retry");
}

export async function cancelChatJob(id: string) {
  if (!chatIdPattern.test(id)) return invalid();
  return mutation("/jobs/" + id + "/cancel");
}

export async function deleteChat(id: string, revision: number) {
  if (!chatIdPattern.test(id) || !Number.isInteger(revision) || revision < 0) return invalid();
  return mutation("/chat-sessions/" + id + "/delete", { revision });
}

export async function moreChats(cursor: string, limit = 20) {
  if (![10,20,50].includes(limit) || typeof cursor !== "string" || cursor.length > 200) return { data: null, error: "목록 위치를 확인해 주세요.", status: 400 };
  return loadChatList(cursor, limit);
}

export async function renameChat(id:string,revision:number,title:string){
 if(!chatIdPattern.test(id)||!Number.isInteger(revision)||revision<0||typeof title!=='string'||Array.from(title.normalize('NFC').trim()).length>80||!title.trim())return invalid();
 return mutation('/chat-sessions/'+id+'/title',{revision,title});
}

export async function confirmChatCorrection(id:string,messageId:string,key:string){
 if(!chatIdPattern.test(id)||!chatIdPattern.test(messageId)||!/^[a-f0-9]{64}$/.test(key))return invalid<{key:string;readAt:string}>();
 const result=await mutation<{key:string;readAt:string}>('/chat-sessions/'+id+'/corrections/'+messageId+'/read',{key});
 if(result.status===409)result.error='원문이 다시 변경되었습니다. 최신 정정 안내를 확인해 주세요.';return result;
}
export async function loadCorrectionHistory(id:string,offset=0,limit=20):Promise<ChatResult<import('./types').CorrectionHistoryPage>>{
 if(![10,20,50].includes(limit)||!chatIdPattern.test(id)||!Number.isInteger(offset)||offset<0||offset>100000)return invalid<import('./types').CorrectionHistoryPage>();
 const credential=await chatCredential();if(!credential)return {data:null,status:401,error:'대화 인증을 확인해 주세요.'};
 return requestChat('/chat-sessions/'+id+'/corrections/history?'+new URLSearchParams({offset:String(offset),limit:String(limit)}),credential);
}

export async function connectChatCase(id:string,revision:number,caseId:string|null,confirmed:boolean) {
  if(!chatIdPattern.test(id)||!Number.isInteger(revision)||revision<0||(caseId!==null&&!chatIdPattern.test(caseId))||confirmed!==true)return invalid();
  return mutation('/chat-sessions/'+id+'/case',{revision,caseId,confirmed});
}
export async function caseChoices(q:string,limit:number,offset:number) {
  if(typeof q!=='string'||q.length>200||![10,20,50].includes(limit)||!Number.isInteger(offset)||offset<0||offset>100000||!await currentToken())return null;
  const {requestCase}=await import('../_cases/requests');
  const response=await requestCase('?'+new URLSearchParams({q,limit:String(limit),offset:String(offset)}));
  return response?.ok?await response.json() as import('../_cases/types').CaseList:null;
}
