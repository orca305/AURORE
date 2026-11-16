import Link from "next/link";
import {notFound} from "next/navigation";
import {requestAdmin,type CollectionDetail} from "../../../_admin/requests";
import {date} from "../../../_admin/format";
import {parsePageSize} from "../../../_components/page-size";
import {PageSizeSelect} from "../../../_components/page-size-select";
import styles from "../../page.module.css";
export default async function Collection({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{offset?:string;limit?:string}>}){
 const {id}=await params;if(!/^[a-f0-9]{64}$/.test(id))notFound();
 const query=await searchParams,limit=parsePageSize(query.limit),offset=/^\d{1,6}$/.test(query.offset??'')?Math.min(Number(query.offset),100000):0;
 const response=await requestAdmin(`precedent-collections/${id}`,new URLSearchParams({offset:String(offset),limit:String(limit)}));if(response?.status===404)notFound();
 if(!response?.ok)return <p role="status" className={styles.notice}>수집 기록 또는 원문 무결성을 확인해 주세요. 목록으로 돌아가 다시 확인할 수 있습니다.</p>;
 const data=await response.json() as CollectionDetail;
 const url=(next:number)=>'/admin/precedent-collections/'+id+'?'+new URLSearchParams({offset:String(next),limit:String(limit)});
 return <><Link className={styles.back} href="/admin/precedent-collections">← 수집 묶음</Link><div className={styles.sectionTitle}><div><h2>{data.label}</h2><p>후보 {data.total}건 · 원문 수집 {data.collected}건 · 미수집 {data.total-data.collected}건</p></div><Link className={styles.refresh} href={url(offset)}>새로고침 ↻</Link></div>
 <p className={styles.notice}>수집된 원문만 대조할 수 있습니다. 수집 완료 표시는 DB 반영 여부와 별개입니다.</p><div className="pagination"><PageSizeSelect value={limit}/></div>
 <div className={styles.tableWrap}><table><caption>판례별 수집 상태</caption><thead><tr><th>사건번호</th><th>판례 번호</th><th>원문 상태</th><th>수집 시각</th><th>원문 검토</th></tr></thead><tbody>{data.items.map(row=><tr key={row.sourceId}><td>{row.caseNumber}</td><td>{row.sourceId}</td><td><span className={styles.badge} data-tone={row.ready?'success':undefined}>{row.ready?'수집 완료':'수집 전'}</span></td><td>{row.collectedAt?date(row.collectedAt):'—'}</td><td>{row.ready?<Link href={'/admin/precedent-collections/'+id+'/items/'+row.sourceId}>기존 원문과 대조 ↗</Link>:'원문 수집 후 확인'}</td></tr>)}</tbody></table></div>
 <nav className="pagination" aria-label="수집 후보 페이지">{offset>0&&<Link href={url(Math.max(0,offset-limit))}>← 이전</Link>}<span className="page-status">{Math.floor(offset/limit)+1} 페이지</span>{data.nextOffset!==null&&<Link href={url(data.nextOffset)}>다음 →</Link>}</nav></>;
}
