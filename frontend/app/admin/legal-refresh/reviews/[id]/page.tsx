import {parsePageSize} from "../../../../_components/page-size";
import {PageSizeSelect} from "../../../../_components/page-size-select";
import { ApprovalForm } from "./approval-form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requestAdmin, type CorrectionReview } from "../../../../_admin/requests";
import { day, number, reviewStates } from "../../../../_admin/format";
import styles from "../../../page.module.css";
export const metadata={title:"정정 전후 비교 | AURORE"};
export default async function ReviewPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{offset?:string;limit?:string}>}) {
  const {id}=await params; const {offset="0",limit}=await searchParams;const pageSize=parsePageSize(limit);
  if(!/^[a-f0-9]{64}$/.test(id) || !/^\d{1,6}$/.test(offset)) notFound();
  const response=await requestAdmin(`legal-refresh/reviews/${id}?offset=${offset}&limit=${pageSize}`);
  if(response?.status===404) notFound();
  if(!response?.ok) return <><Link href="/admin/legal-refresh">← 검토 목록</Link><p className={styles.notice} role="alert">원문 자료를 검증하지 못했거나 검토 기준이 변경되었습니다. 목록을 새로고침한 뒤 다시 확인해 주세요.</p></>;
  const data=await response.json() as CorrectionReview;
  return <><Link className={styles.back} href="/admin/legal-refresh">← 검토 목록</Link><div className={styles.sectionTitle}><div><h2>{data.lawName ?? "법령 "+data.lawId} · 정정 전후 비교</h2><p>시행일 {day(data.effectiveDate)} · 변경 조문 {number.format(data.totalChanges)}개</p></div></div>
    <p className={styles.notice}>{reviewStates[data.status] ?? "검토 필요"}{data.status!=="ready-to-review" ? " · 현재 DB 원문이 수집 당시 기준과 달라 다시 검토해야 합니다." : " · 저장된 원문 해시와 비교 결과를 검증했습니다."}</p>
    <details className={styles.identity}><summary>원문 식별정보</summary><dl><div><dt>법령 버전</dt><dd>{data.versionKey}</dd></div><div><dt>정정 전 해시</dt><dd><code>{data.beforeHash}</code></dd></div><div><dt>정정 후 해시</dt><dd><code>{data.afterHash}</code></dd></div></dl></details>
    {data.changes.map(change=><section className={styles.change} key={change.key}><div className={styles.sectionTitle}><h3>{change.after?.number ?? change.before?.number ?? change.key} {change.after?.title ?? change.before?.title ?? ""}</h3><span className={styles.badge}>{change.change==="added" ? "추가" : change.change==="removed" ? "삭제" : "변경"}</span></div><div className={styles.comparison}><div><h4>정정 전</h4><p>{change.before?.text ?? "해당 조문 없음"}</p></div><div><h4>정정 후</h4><p>{change.after?.text ?? "해당 조문 없음"}</p></div></div></section>)}
    {!data.totalChanges && <p className={styles.empty}>조문 본문 변경은 없습니다. 원문의 다른 항목이 변경된 후보입니다.</p>}
    {data.status==="ready-to-review" && <ApprovalForm id={data.id} beforeHash={data.beforeHash} afterHash={data.afterHash}/>}
    <nav className="pagination" aria-label="변경 조문 페이지"><PageSizeSelect value={pageSize}/>{data.offset>0 && <Link href={"?offset="+Math.max(0,data.offset-pageSize)+"&limit="+pageSize} aria-label="이전 페이지" title="이전 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></Link>}<span className="page-status">{Math.floor(data.offset/pageSize)+1} 페이지</span>{data.nextOffset!==null && <Link href={"?offset="+data.nextOffset+"&limit="+pageSize} aria-label="다음 페이지" title="다음 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></Link>}</nav>
  </>;
}
