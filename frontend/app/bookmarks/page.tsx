import { PeriodFields } from "../_components/period-fields";
import { readPeriod } from "../_components/period-read";
import {isBookmarkPage} from '../_components/list-response';
import { ShortTitle } from '../_components/short-title';
import { SortSelect } from '../_components/sort-select';
import { ResetSearch } from '../_components/page-actions';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '../_components/site-header';
import { currentMember } from '../_auth/session';
import { parsePageSize } from '../_components/page-size';
import { PageSizeSelect } from '../_components/page-size-select';
import { requestBookmarks } from '../_bookmarks/requests';
import { BookmarkButton } from '../_bookmarks/bookmark-button';
export const metadata={title:'관심 항목 | AURORE'};
export default async function BookmarksPage({searchParams}:{searchParams:Promise<{q?:string;sort?:string;kind?:string;limit?:string;offset?:string;from?:string;to?:string}>}) {
  if(!(await currentMember()))redirect('/login');
  const params=await searchParams,q=typeof params.q==='string'?params.q.trim().slice(0,200):'';
  const kind=['LEGAL','PREC'].includes(params.kind??'')?params.kind!:'ALL';
 const sort=params.sort==='oldest'?'oldest':'newest';
  const limit=parsePageSize(params.limit),offset=/^\d{1,6}$/.test(params.offset??'')?Math.min(Number(params.offset),100000):0;
  const from=readPeriod(params.from),to=readPeriod(params.to);
  const query=new URLSearchParams({q,kind,sort,from,to,limit:String(limit),offset:String(offset)});
  const response=await requestBookmarks('?'+query);
  const payload=response?.ok?await response.json().catch(()=>null):null;
  const data=isBookmarkPage(payload,limit,offset)?payload:null;
  const pageUrl=(n:number)=>'/bookmarks?'+new URLSearchParams({q,kind,sort,from,to,limit:String(limit),offset:String(n)});
  return <div><SiteHeader active="bookmarks"/><main className="shell">
    <section className="intro"><h1>관심 항목</h1><p>다시 확인할 법령과 판례를 모아 보세요. 법령은 특정 시행본이 아닌 법령 자체에 등록됩니다.</p></section>
    <form className="search" action="/bookmarks" role="search"><label htmlFor="bookmark-query">관심 항목 검색</label><input type="hidden" name="limit" value={limit}/><div className="search-row"><select name="kind" aria-label="관심 항목 종류" defaultValue={kind}><option value="ALL">전체</option><option value="LEGAL">법령</option><option value="PREC">판례</option></select><input id="bookmark-query" name="q" defaultValue={q} maxLength={200} placeholder="법령명·판례명·사건번호"/><SortSelect value={sort} basis="관심 등록일"/><button type="submit" data-primary aria-label="검색" title="검색"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.5-4.5" /></svg></button><ResetSearch/></div><PeriodFields from={from} to={to}/></form>
    <section className="results"><div className="section-heading"><h2>저장한 관심 항목{data?` · ${data.total}개`:''}</h2><PageSizeSelect value={limit}/></div>
      {!data?<p role="status" className="empty">관심 항목을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</p>:!data.items.length?<p className="empty">{offset>0&&data.total>0?'이 페이지에 표시할 관심 항목이 없습니다.':q||kind!=='ALL'?'조건에 맞는 관심 항목이 없습니다.':'아직 저장한 관심 항목이 없습니다. 법규·판례 검색에서 별표를 눌러 등록하세요.'}{offset>0&&<>{' '}<Link href={pageUrl(0)}>처음부터 보기</Link></>}</p>:<ul className="legal-list">{data.items.map(row=><li key={row.id}><h3><Link href={row.href}><ShortTitle text={row.title}/></Link></h3><p>{row.kind==='LEGAL'?'법령':'판례'} · {row.subtitle}</p><BookmarkButton key={row.id} kind={row.kind} id={row.targetId} saved title={row.title}/></li>)}</ul>}
      {data&&<nav className="pagination" aria-label="관심 항목 페이지"><span className="page-status">{Math.floor(offset/limit)+1} 페이지</span>{offset>0&&<Link href={pageUrl(Math.max(0,offset-limit))}>← 이전</Link>}{data.nextOffset!==null&&<Link href={pageUrl(data.nextOffset)}>다음 →</Link>}</nav>}
    </section></main></div>;
}
