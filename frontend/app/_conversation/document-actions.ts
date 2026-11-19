"use server";
import {currentToken,trustedOrigin} from "../_auth/session";
import {chatIdPattern,requestChat} from "./requests";
import type {ChatDetail,ChatResult} from "./types";
export type DocumentList={items:{id:string;name:string;format:string;size:number;characterCount?:number;partial:boolean;createdAt:string}[];total:number;offset:number;nextOffset:number|null};
async function credential(){const token=await currentToken();return token?'Bearer '+token:null;}
const invalid=<T,>():ChatResult<T>=>({data:null,error:'요청과 로그인 상태를 확인해 주세요.',status:400});
export async function listDocuments(chatId:string,limit=20,offset=0):Promise<ChatResult<DocumentList>>{
 if(!chatIdPattern.test(chatId)||![10,20,50].includes(limit)||!Number.isInteger(offset)||offset<0||offset>100000)return invalid();const auth=await credential();return auth?requestChat('/chat-sessions/'+chatId+'/documents?'+new URLSearchParams({limit:String(limit),offset:String(offset)}),auth):invalid();
}
export async function confirmDocument(chatId:string,receipt:string,markdown:string,confirmed:boolean):Promise<ChatResult<ChatDetail>>{
 if(!await trustedOrigin()||!chatIdPattern.test(chatId)||typeof receipt!=='string'||receipt.length>4096||typeof markdown!=='string'||!markdown.trim()||markdown.length>50000||confirmed!==true)return invalid();const auth=await credential();return auth?requestChat('/chat-sessions/'+chatId+'/documents',auth,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({receipt,markdown,confirmed})}):invalid();
}
export async function removeDocument(chatId:string,id:string):Promise<ChatResult<ChatDetail>>{
 if(!await trustedOrigin()||!chatIdPattern.test(chatId)||!chatIdPattern.test(id))return invalid();const auth=await credential();return auth?requestChat('/chat-sessions/'+chatId+'/documents/'+id+'/delete',auth,{method:'POST'}):invalid();
}
export async function readDocument(chatId:string,id:string):Promise<ChatResult<{filename:string;markdown:string;partial:boolean}>>{
 if(!chatIdPattern.test(chatId)||!chatIdPattern.test(id))return invalid();const auth=await credential();return auth?requestChat('/chat-sessions/'+chatId+'/documents/'+id,auth):invalid();
}
