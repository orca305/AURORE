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

export async function sendChatMessage(id: string, requestId: string, question: string, revision: number) {
  if (!chatIdPattern.test(id) || !chatIdPattern.test(requestId) ||
    typeof question !== "string" || Array.from(question).length > 1000 || !Number.isInteger(revision) || revision < 0) return invalid();
  return mutation("/chat-sessions/" + id + "/messages", { question, requestId, revision }, true);
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
