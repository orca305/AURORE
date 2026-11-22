import { IconLink } from "../_components/icon-link";
import Link from "next/link";
import {requestCase} from "./requests";
import {date} from "../_admin/format";
import {PageSizeSelect} from "../_components/page-size-select";
export async function LinkedChats({id,limit,offset,query}:{id:string;limit:number;offset:number;query:Record<string,string|string[]|undefined>}) {
  const response=await requestCase('/'+id+'/chats?'+new URLSearchParams({limit:String(limit),offset:String(offset)}));
  const data=response?.ok?await response.json() as {total:number;nextOffset:number|null;items:{id:string;title:string;updatedAt:string}[]}:null;
  const url=(next:number)=>{
    const params=new URLSearchParams({limit:String(limit),chatOffset:String(next)});
    for(const key of ['offset','historyOffset'])if(typeof query[key]==='string')params.set(key,query[key]);
    return '/cases/'+id+'?'+params+'#linked-chats';
  };
  return <section className="results" id="linked-chats" aria-label="연결된 대화">
    <div className="section-heading"><h2>연결된 대화 {data&&<span>{data.total}개</span>}</h2><div className="list-tools"><PageSizeSelect value={limit}/><IconLink href="/" kind="chat" label="대화하기" /></div></div>
    {!data?<p role="alert" className="empty">연결된 대화를 불러오지 못했습니다.</p>:<>
      {!data.items.length?<p className="empty">연결된 대화가 없습니다. 대화 화면의 ‘사건 연결’에서 이 사건을 선택하세요.</p>:<ul className="legal-list">{data.items.map(row=><li key={row.id}><h3><Link href={'/?chat='+row.id}>{row.title}</Link></h3><p>{date(row.updatedAt)} 수정</p></li>)}</ul>}
      <nav className="pagination" aria-label="연결된 대화 페이지">{offset>0&&<Link href={url(Math.max(0,offset-limit))} aria-label="이전 페이지" title="이전 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></Link>}<span className="page-status">{Math.floor(offset/limit)+1} 페이지</span>{data.nextOffset!==null&&<Link href={url(data.nextOffset)} aria-label="다음 페이지" title="다음 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></Link>}</nav>
    </>}
  </section>;
}
