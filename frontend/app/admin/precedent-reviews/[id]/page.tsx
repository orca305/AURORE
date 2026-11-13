import Link from "next/link";
import {notFound} from "next/navigation";
import {requestAdmin} from "../../../_admin/requests";
import type {PrecedentReview} from "../../../_admin/precedent-types";
import {officialUrl} from "../../../legals/[id]/versions/official-source";
import {ReviewForm} from "./review-form";
import styles from "../../page.module.css";
export default async function ReviewDetail({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[1-9]\d{0,18}$/.test(id))notFound();const response=await requestAdmin(`precedent-reviews/${id}`);if(response?.status===404)notFound();
 if(!response?.ok)return <><Link className={styles.back} href="/admin/precedent-reviews">← 재검토 목록</Link><p className={styles.notice}>{response?.status===409?'이미 처리되었거나 원문이 변경되었습니다. 목록에서 다시 확인해 주세요.':'검토 내용을 불러오지 못했습니다.'}</p></>;
 const row=await response.json() as PrecedentReview;const source=(value:string|null,label:string)=>{const url=officialUrl(value);return url?<a href={url} target="_blank" rel="noopener noreferrer">{label} ↗</a>:null;};
 return <>
  <Link className={styles.back} href="/admin/precedent-reviews">← 재검토 목록</Link>
  <div className={styles.sectionTitle}><div><h2>{row.caseName}</h2><p>{row.caseNumber} · {row.reference} · {row.lawName} {row.effectiveDate} 시행</p></div></div>
  <section className={styles.reviewBlock}><h3>판결문 대조</h3><div className={styles.comparison}><div><h4>이전 판결문 {source(row.beforeCaseUrl,'공식 원문')}</h4><p>{row.beforeDecision}</p></div><div><h4>현재 판결문 {source(row.caseUrl,'공식 원문')}</h4><p>{row.currentDecision}</p></div></div></section>
  <section className={styles.reviewBlock}><h3>조문 대조</h3><div className={styles.comparison}><div><h4>이전 조문 {source(row.beforeLawUrl,'공식 원문')}</h4><p>{row.beforeText}</p></div><div><h4>현재 조문 {source(row.lawUrl,'공식 원문')}</h4><p>{row.currentText??'현재 연결할 조문을 하나로 확인할 수 없습니다.'}</p></div></div></section>
  <ReviewForm id={id} reviewHash={row.reviewHash} canVerify={row.status==='READY_TO_REVIEW'}/>
 </>;
}
