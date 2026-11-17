import Link from "next/link";
import {requestAdmin,type CollectionHistory} from "../../../_admin/requests";
import {date} from "../../../_admin/format";
import {parsePageSize} from "../../../_components/page-size";
import {PageSizeSelect} from "../../../_components/page-size-select";
import styles from "../../page.module.css";
const labels:Record<string,string>={APPLIED:'반영 완료',UNCHANGED:'이미 동일한 원문',FORMAT_ONLY:'형식만 변경',PREVIOUSLY_SEEN:'이전 수집 원문 · 현재 판본 유지',REVIEW_UNAVAILABLE:'검토 자료 확인 필요',REVIEW_CHANGED:'검토 이후 원문 변경',SOURCE_NOT_CONFIGURED:'공식 원문 연결 설정 필요',SOURCE_VERIFY_FAILED:'공식 원문 재확인 실패',PERMISSION_CHANGED:'권한·로그인 변경',APPLY_FAILED:'반영 실패'};
export default async function History({searchParams}:{searchParams:Promise<{offset?:string;limit?:string}>}){
 const params=await searchParams,limit=parsePageSize(params.limit),offset=/^\d{1,6}$/.test(params.offset??'')?Math.min(Number(params.offset),100000):0;
 const response=await requestAdmin('precedent-collections/history',new URLSearchParams({offset:String(offset),limit:String(limit)}));if(!response?.ok)return <p role="status" className={styles.notice}>처리 이력을 불러오지 못했습니다.</p>;
 const data=await response.json() as CollectionHistory;const url=(next:number)=>'/admin/precedent-collections/history?'+new URLSearchParams({offset:String(next),limit:String(limit)});
 return <><Link className={styles.back} href="/admin/precedent-collections">← 수집 묶음</Link><div className={styles.sectionTitle}><div><h2>판례 반영 처리 이력</h2><p>승인 결과와 처리자를 기록합니다. 실패한 요청은 판례 반영을 되돌립니다.</p></div></div><div className="pagination"><span>총 {data.total}건</span><PageSizeSelect value={limit}/></div><div className={styles.tableWrap}><table><caption>판례 승인 처리 결과</caption><thead><tr><th>판례 번호</th><th>결과</th><th>처리 사유</th><th>판본</th><th>처리자</th><th>완료 시각</th></tr></thead><tbody>{data.items.map(row=><tr key={row.id}><td><Link href={'/admin/precedent-collections/'+row.batchId+'/items/'+row.sourceId} data-action-link>{row.sourceId} </Link></td><td>{row.status==='SUCCEEDED'?'완료':'실패'}</td><td>{labels[row.resultCode]??'상태 확인 필요'}</td><td>{row.revision??'—'}</td><td>{row.operator}</td><td>{date(row.finishedAt)}</td></tr>)}</tbody></table>{!data.items.length&&<p className={styles.empty}>아직 처리 이력이 없습니다.</p>}</div><nav className="pagination" aria-label="판례 반영 이력 페이지">{offset>0&&<Link href={url(Math.max(0,offset-limit))}>← 이전</Link>}<span className="page-status">{Math.floor(offset/limit)+1} 페이지</span>{data.nextOffset!==null&&<Link href={url(data.nextOffset)}>다음 →</Link>}</nav></>;
}
