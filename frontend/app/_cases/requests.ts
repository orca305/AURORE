import {currentToken} from "../_auth/session";
export async function requestCase(path:string,init?:RequestInit){
 const token=await currentToken();if(!token)return null;
 try{return await fetch(new URL('/cases'+path,process.env.BACKEND_URL||'http://127.0.0.1:3001'),{...init,headers:{...init?.headers,Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(12000)});}catch{return null;}
}
