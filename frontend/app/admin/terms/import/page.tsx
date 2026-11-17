import Link from 'next/link';
import {requestTerms} from '../../../_terms/requests';
import {TermImportForm} from '../../../_terms/import-form';
import type {SourcePage} from '../../../_terms/import-types';
import {PageSizeSelect} from '../../../_components/page-size-select';
import {parsePageSize} from '../../../_components/page-size';
import {SortSelect} from '../../../_components/sort-select';
import {ResetSearch} from '../../../_components/page-actions';
import styles from '../../../_terms/terms.module.css';
export const metadata={title:'법제처 용어 가져오기 | AURORE'};
export default async function ImportPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,q=typeof params.q==='string'?params.q.trim().slice(0,100):'',limit=parsePageSize(params.limit),page=typeof params.page==='string'&&/^\d{1,4}$/.test(params.page)?Math.max(1,Math.min(1000,Number(params.page))):1,sort=params.sort==='oldest'?'oldest':'newest';
 const query=new URLSearchParams({q,limit:String(limit),page:String(page),sort});
 const response=q?await requestTerms('/sources?'+query,true):null,data=response?.ok?await response.json() as SourcePage:null;
 const href=(n:number)=>{const p=new URLSearchParams(query);p.set('page',String(n));return '/admin/terms/import?'+p;};
 return <><div className="section-heading"><h2>법제처 용어 가져오기</h2><Link href="/admin/terms" className="ui-button">관리 목록</Link></div><p className={styles.help}>공식 정의·출처를 자동으로 가져와 초안으로 저장합니다. 같은 이름도 출처별로 구분합니다. 법제처가 묶어 제공한 용어는 출처별로 펼쳐서 표시하므로 조회 개수보다 많을 수 있습니다. 직접 수정한 정의와 삭제한 용어는 덮어쓰지 않습니다.</p><p className={styles.notice}>AI 쉬운 풀이 생성은 아직 연결하지 않았습니다. 수집한 원문을 검토하고 공개할 수 있습니다.</p>
 <form action="/admin/terms/import" className="search" role="search"><label htmlFor="source-term-query">법제처 용어 검색</label><input type="hidden" name="limit" value={limit}/><div className="search-row"><input id="source-term-query" name="q" maxLength={100} defaultValue={q} required/><SortSelect value={sort}/><button type="submit" data-primary>검색</button><ResetSearch/></div></form>
 <section className="results"><div className="section-heading"><h2>검색 결과{data?' · '+data.total+'개':''}</h2><PageSizeSelect value={limit}/></div>{!q?<p className="empty">찾을 용어를 입력해 주세요.</p>:!data?<p role="alert" className={styles.error}>법제처 용어를 불러오지 못했습니다. 인증 설정과 연결 상태를 확인한 후 다시 시도해 주세요.</p>:!data.items.length?<p className="empty">검색 결과가 없습니다.</p>:<TermImportForm key={query.toString()} items={data.items}/>}
 {data&&<nav className="pagination" aria-label="법제처 용어 페이지">{page>1&&<Link href={href(page-1)}>← 이전</Link>}<span className="page-status">{page} 페이지</span>{data.nextPage!==null&&<Link href={href(data.nextPage)}>다음 →</Link>}</nav>}</section></>;
}
