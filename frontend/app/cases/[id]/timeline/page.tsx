import { IconLink } from "../../../_components/icon-link";
import Link from "next/link";
import {notFound} from "next/navigation";
import {requestCase} from "../../../_cases/requests";
import {caseIdPattern,type CaseTimeline} from "../../../_cases/types";
import {DeleteCase} from "../../../_cases/case-form";
import {PageSizeSelect} from "../../../_components/page-size-select";
import {parsePageSize} from "../../../_components/page-size";
import {date} from "../../../_admin/format";
import styles from "../../page.module.css";
export const metadata={title:"사건 타임라인 | AURORE"};
export default async function TimelinePage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {id}=await params;if(!caseIdPattern.test(id))notFound();
  const query=await searchParams,limit=parsePageSize(query.limit),raw=typeof query.offset==='string'?query.offset:'0',offset=/^\d{1,6}$/.test(raw)?Math.min(Number(raw),100000):0;
  const path='/cases/'+id,response=await requestCase('/'+id+'/timeline?'+new URLSearchParams({limit:String(limit),offset:String(offset)}));
  if(response?.status===404)notFound();
  if(!response?.ok)return <section className="intro"><h1>타임라인을 불러오지 못했습니다</h1><p>잠시 후 다시 시도해 주세요.</p><Link href={path} data-action-link>사건으로 돌아가기 </Link></section>;
  const data=await response.json() as CaseTimeline;
  const pageUrl=(next:number)=>path+'/timeline?'+new URLSearchParams({limit:String(limit),offset:String(next)});
  return <>
    <section className="intro"><Link href={path+'?limit='+limit}>← {data.case.title}</Link><h1>사건 타임라인</h1><p>입력한 관련 날짜를 기준으로 오래된 순서대로 보여줍니다. 같은 날짜의 내용은 등록 순서로, 날짜가 없는 내용은 마지막에 표시합니다.</p></section>
    {query.saved==='1'&&<p role="status" className={styles.notice}>변경한 사실관계를 타임라인에 반영했습니다.</p>}
    <div className="section-heading"><h2>확인한 사실관계 <span>{data.total}개 · 날짜 미입력 {data.undatedTotal}개</span></h2><div className="list-tools"><PageSizeSelect value={limit}/><IconLink href={path+'#add-fact'} kind="plus" label="사실관계 추가" /><IconLink href={path+'/export'} kind="download" label="정리본 내려받기" download /></div></div>
    {!data.items.length?<p className="empty">{data.total?'이 페이지에 표시할 사실관계가 없습니다.':'등록된 사실관계가 없습니다. 관련 날짜와 함께 사실관계를 추가해 보세요.'}</p>:<ol className={styles.timeline} aria-label="관련 날짜순 사실관계">
      {data.items.map((row,index)=>{
        const heading=index===0||row.occurredOn!==data.items[index-1].occurredOn;
        return <li key={row.id} className={styles.timelineEntry}>
          <div className={styles.timelineDate}>{heading?(row.occurredOn?<time dateTime={row.occurredOn}>{row.occurredOn}</time>:<strong>날짜 미입력</strong>):<span className={styles.sameDate}>같은 날짜</span>}</div>
          <article className={styles.timelineFact}><header><h3>{row.title}</h3><div className={styles.factTools}><IconLink href={path+'/facts/'+row.id+'?returnTo=timeline'} kind="edit" label="사실관계 수정" /><DeleteCase command={{operation:'deleteFact',caseId:id,factId:row.id,revision:data.case.revision,returnTo:'timeline'}} label={row.title+' 사실관계 삭제'} targetTitle={row.title}/></div></header><p className={styles.content}>{row.content}</p><div className={styles.timelineMeta}><span>{date(row.updatedAt!)} 수정</span>{row.imported&&(row.source?<Link href={'/?chat='+row.source.chatId} data-action-link>가져온 대화 </Link>:<span>가져온 대화가 삭제되었거나 보관이 종료됐습니다.</span>)}</div></article>
        </li>;
      })}
    </ol>}
    <nav className="pagination" aria-label="사건 타임라인 페이지">{offset>0&&<Link href={pageUrl(Math.max(0,offset-limit))} aria-label="이전 페이지" title="이전 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></Link>}<span className="page-status">{Math.floor(offset/limit)+1} 페이지</span>{data.nextOffset!==null&&<Link href={pageUrl(data.nextOffset)} aria-label="다음 페이지" title="다음 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></Link>}</nav>
  </>;
}
