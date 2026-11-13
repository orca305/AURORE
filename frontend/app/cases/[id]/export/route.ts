import {currentToken} from "../../../_auth/session";
import {requestCase} from "../../../_cases/requests";
import {caseIdPattern} from "../../../_cases/types";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!caseIdPattern.test(id))return new Response(null,{status:404});if(!await currentToken())return new Response('로그인이 필요합니다.',{status:401,headers:{'Cache-Control':'no-store'}});
 const response=await requestCase('/'+id+'/export');if(!response?.ok)return new Response('정리본을 내려받지 못했습니다.',{status:response?.status??503,headers:{'Cache-Control':'no-store'}});
 const data=await response.json() as {filename:string;markdown:string};return new Response(data.markdown,{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':'attachment; filename="aurore-case-'+id+'.md"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}});
}
