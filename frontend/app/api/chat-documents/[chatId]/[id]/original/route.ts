import {currentToken} from "../../../../../_auth/session";
import {chatIdPattern} from "../../../../../_conversation/requests";
/** 올린 원본 파일을 그대로 내려받는다(로그인한 본인의 삭제되지 않은 첨부자료만). */
export async function GET(_request:Request,{params}:{params:Promise<{chatId:string;id:string}>}){
 const {chatId,id}=await params;
 if(!chatIdPattern.test(chatId)||!chatIdPattern.test(id))return new Response(null,{status:404});
 const token=await currentToken();
 if(!token)return new Response(null,{status:401,headers:{'Cache-Control':'no-store'}});
 try{
  const response=await fetch(new URL('/chat-sessions/'+chatId+'/documents/'+id+'/original',process.env.BACKEND_URL||'http://127.0.0.1:3001'),{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok)return new Response(null,{status:response.status===404?404:502,headers:{'Cache-Control':'no-store'}});
  return new Response(response.body,{headers:{
   'Content-Type':response.headers.get('content-type')??'application/octet-stream',
   'Content-Disposition':response.headers.get('content-disposition')??'attachment',
   'X-Content-Type-Options':'nosniff',
   'Cache-Control':'private, no-store',
  }});
 }catch{return new Response(null,{status:503,headers:{'Cache-Control':'no-store'}});}
}
