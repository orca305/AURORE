import {requestTerms,validTermId} from '../../../_terms/requests';
const headers={'Cache-Control':'no-store'};
function sourceUrl(value:unknown){try{if(typeof value!=='string')return false;const u=new URL(value);return u.protocol==='https:'&&u.hostname.endsWith('.go.kr')&&!u.username&&!u.password&&!u.port&&!u.pathname.startsWith('/DRF/')&&![...u.searchParams.keys()].some(k=>/^(oc|key|api_?key|servicekey|token|authorization)$/i.test(k));}catch{return false;}}
export async function GET(request:Request){
 const params=new URL(request.url).searchParams,q=(params.get('q')??'').trim().normalize('NFC'),limit=Number(params.get('limit')??20),rawOffset=params.get('offset')??'0';
 if(!q||q.length>100||/\p{Cc}/u.test(q)||![10,20,50].includes(limit)||!/^\d{1,6}$/.test(rawOffset)||Number(rawOffset)>100000||[...params.keys()].some(k=>!['q','limit','offset'].includes(k)))return Response.json({error:'검색어와 조회 개수를 확인해 주세요.'},{status:400,headers});
 const offset=Number(rawOffset),response=await requestTerms('?'+new URLSearchParams({q,limit:String(limit),offset:String(offset),sort:'newest'}));
 if(!response?.ok)return Response.json({error:'용어사전에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'},{status:503,headers});
 const data=await response.json().catch(()=>null);
 if(!data||!Array.isArray(data.items)||data.items.length>limit||!Number.isSafeInteger(data.total)||data.total<data.items.length||data.limit!==limit||data.offset!==offset||(data.nextOffset!==null&&(!Number.isSafeInteger(data.nextOffset)||data.nextOffset<=offset||data.nextOffset>100000))||data.items.some((row:Record<string,unknown>)=>!row||typeof row.id!=='string'||!validTermId(row.id)||row.state!=='PUBLISHED'||row.deleted!==false||typeof row.termName!=='string'||row.termName.length>100||typeof row.definition!=='string'||row.definition.length>10000||typeof row.sourceName!=='string'||!sourceUrl(row.sourceUrl)||(row.sourceReference!==null&&typeof row.sourceReference!=='string')))return Response.json({error:'용어 정보를 확인하지 못했습니다. 다시 시도해 주세요.'},{status:502,headers});
 return Response.json({q,limit,offset,total:data.total,nextOffset:data.nextOffset,items:data.items.map((row:Record<string,unknown>)=>({id:row.id,termName:row.termName,definition:row.definition,sourceName:row.sourceName,sourceReference:row.sourceReference,sourceUrl:row.sourceUrl}))},{headers});
}
