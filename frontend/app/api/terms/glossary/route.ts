import {requestTerms,validTermId} from '../../../_terms/requests';
const headers={'Cache-Control':'public, max-age=300'};
const fail={'Cache-Control':'no-store'};
// 대화 답변에서 용어를 하이라이트하기 위한 공개 용어 목록. 공개·미삭제 용어의 이름·동의어·짧은 설명만 전달한다(원문 출처·이력·관리자 정보는 제외).
function brief(row:Record<string,unknown>){
 // 쉬운 풀이는 첫 문단이 한 줄 요약이다. 툴팁에는 그 문단만 보여 준다.
 const easy=typeof row.explanation==='string'?row.explanation.trim().split(/\n\s*\n/)[0].trim():'';
 const base=easy||(typeof row.definition==='string'?row.definition.trim():'');
 return base.length>180?base.slice(0,177).trimEnd()+'…':base;
}
// 출처 표기("근로기준법 제95조 조문 인용 · …", "법령정의사전 · 법령명[법률 …]")에서 법령 이름을 뽑는다.
function lawName(reference:unknown){
 if(typeof reference!=='string')return undefined;
 const found=/^(.+?) 제\d+조/u.exec(reference)??/· ([^\[]+?)\s*\[/u.exec(reference);
 return found&&found[1].length<=100?found[1]:undefined;
}
export async function GET(){
 const terms:{id:string;termName:string;aliases:string[];brief:string;easy:boolean;law?:string}[]=[];
 for(let offset=0;offset<=1000;offset+=50){
  const response=await requestTerms('?'+new URLSearchParams({q:'',limit:'50',offset:String(offset),sort:'newest'}));
  if(!response?.ok)return Response.json({terms:[]},{status:503,headers:fail});
  const data=await response.json().catch(()=>null);
  if(!data||!Array.isArray(data.items)||data.items.length>50)return Response.json({terms:[]},{status:502,headers:fail});
  for(const row of data.items as Record<string,unknown>[]){
   if(!row||typeof row.id!=='string'||!validTermId(row.id)||row.state!=='PUBLISHED'||row.deleted!==false||typeof row.termName!=='string'||row.termName.length>100)continue;
   const aliases=Array.isArray(row.aliases)?row.aliases.filter((a):a is string=>typeof a==='string'&&a.length>0&&a.length<=100):[];
   terms.push({id:row.id,termName:row.termName,aliases,brief:brief(row),easy:typeof row.explanation==='string'&&row.explanation.trim().length>0,law:lawName(row.sourceReference)});
  }
  if(data.nextOffset===null||data.nextOffset===undefined)break;
 }
 return Response.json({terms},{headers});
}
