import {currentToken,trustedOrigin} from "../../../../_auth/session";
import {chatIdPattern} from "../../../../_conversation/requests";
export async function POST(request:Request,{params}:{params:Promise<{chatId:string}>}){
 const {chatId}=await params;
 if(!chatIdPattern.test(chatId)||!await trustedOrigin())return Response.json({error:'요청을 확인할 수 없습니다.'},{status:400});
 const token=await currentToken();if(!token)return Response.json({error:'첨부자료는 로그인 후 등록할 수 있습니다.'},{status:401});
 const max=6*1024*1024;
 if(Number(request.headers.get('content-length'))>max)return Response.json({error:'5MB 이하 파일을 선택해 주세요.'},{status:413});
 let file:File;
 try{
  const reader=request.body?.getReader();if(!reader)throw Error();let total=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();return Response.json({error:'5MB 이하 파일을 선택해 주세요.'},{status:413});}chunks.push(value);}
  const bytes=new Uint8Array(total);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.byteLength;}
  const form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')??''}}).formData();
  const input=form.get('file');if(!(input instanceof File)||form.getAll('file').length!==1||[...form.keys()].some(key=>key!=='file')||!input.size||input.size>5*1024*1024)throw Error();file=input;
 }catch{return Response.json({error:'5MB 이하 파일 하나를 선택해 주세요.'},{status:400});}
 try{
  const body=new FormData();body.set('file',file);
  const response=await fetch(new URL('/chat-sessions/'+chatId+'/documents/preview',process.env.BACKEND_URL||'http://127.0.0.1:3001'),{method:'POST',headers:{Authorization:'Bearer '+token},body,cache:'no-store',signal:AbortSignal.timeout(95000)});
  const data=await response.json();
  if(!response.ok)return Response.json({error:typeof data.message==='string'?data.message:'문서를 변환하지 못했습니다.'},{status:response.status});
  return Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'문서 변환 서버에 연결하지 못했습니다.'},{status:503});}
}
