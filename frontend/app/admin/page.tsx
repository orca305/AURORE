import {jobProviders,jobErrors,jobResults} from "../_admin/job-format";
import Link from "next/link";
import { requestAdmin, type AdminOverview, type AiStatus } from "../_admin/requests";
import { AiStatusPanel } from "./ai-status-panel";
import { date, number, states } from "../_admin/format";
import styles from "./page.module.css";
export const metadata = { title: "운영 현황 | AURORE" };
export default async function AdminPage() {
  const response = await requestAdmin("overview");
  if (!response?.ok) return <p role="alert" className={styles.notice}>운영 현황을 불러오지 못했습니다. 권한과 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>;
  const data = await response.json() as AdminOverview;
  const aiResponse = await requestAdmin("ai-status");
  const ai = (aiResponse?.ok ? await aiResponse.json() : { reachable: false }) as AiStatus;
  const failures = data.jobs.find(row=>row.status==="FAILED")?.count ?? 0;
  const cards = [["회원 수",data.counts.members,"명","탈퇴 계정 제외"],["보관 중 대화",data.counts.conversations,"개","삭제·보관 만료 제외"],["실패한 AI 작업",failures,"건",failures ? "처리 상태 확인 필요" : "확인할 실패 작업 없음"]] as const;
  const datasets = [["법령",data.counts.legals,"건"],["시행본",data.counts.versions,"개"],["현재 원문 조문",data.counts.provisions,"개"],["판례",data.counts.precedents,"건"],["수집 원본",data.counts.snapshots,"개"]] as const;
  return <>
    <AiStatusPanel status={ai} />
    <div className={styles.sectionTitle}><div><h2>서비스 현황</h2><p>{date(data.asOf)} 기준</p></div></div>
    <dl className={styles.metrics}>{cards.map(([label,count,unit,note])=><div key={label} className={label==="실패한 AI 작업" && count>0 ? styles.attention : undefined}><dt>{label === "회원 수" ? <Link href="/admin/members" data-action-link>{label} </Link> : label === "실패한 AI 작업" ? <Link href="/admin/ai-jobs" data-action-link>{label} </Link> : label}</dt><dd>{number.format(count)}<small>{unit}</small></dd><dd className={styles.metricNote}>{note}</dd></div>)}</dl>
    <section className={styles.section} aria-labelledby="data-heading"><div className={styles.sectionTitle}><h2 id="data-heading">법령 데이터</h2><Link href="/admin/legal-refresh" data-action-link>수집·정정 관리 </Link></div><dl className={styles.dataset}>{datasets.map(([label,count,unit])=><div key={label}><dt>{label}</dt><dd>{number.format(count)}<small>{unit}</small></dd></div>)}</dl></section>
    <section className={styles.section} aria-labelledby="jobs-heading"><div className={styles.sectionTitle}><div><h2 id="jobs-heading">AI 처리 상태</h2><p>삭제·보관 만료된 대화의 작업은 제외합니다.</p></div><Link href="/admin/ai-jobs?status=all" data-action-link>전체 작업 보기 </Link></div>
      <dl className={styles.states}>{Object.entries(states).map(([key,label])=><div key={key} data-tone={key==="FAILED" ? "danger" : key==="SUCCEEDED" ? "success" : undefined}><dt>{label}</dt><dd>{number.format(data.jobs.find(row=>row.status===key)?.count ?? 0)}<small>건</small></dd></div>)}</dl>
      <div className={styles.tableWrap}><table><caption>최근 변경된 AI 작업 20건</caption><thead><tr><th>작업 번호</th><th>상태</th><th>처리 방식</th><th>처리 결과</th><th>시도</th><th>오류 유형</th><th>변경 시각</th></tr></thead><tbody>{data.recentJobs.map(row=><tr key={row.id}><td><Link href={"/admin/ai-jobs/"+row.id}><code title={row.id}>{row.id.slice(0,8)}</code></Link></td><td><span className={styles.badge} data-tone={row.status==="FAILED" ? "danger" : row.status==="SUCCEEDED" ? "success" : undefined}>{states[row.status] ?? row.status}</span></td><td>{jobProviders[row.provider]??"기타 처리"}</td><td>{jobResults[row.resultCode??"NONE"]?.label??jobResults.OTHER.label}</td><td>{row.attempts}회</td><td>{jobErrors[row.errorCode??"NONE"]?.label??"기타 오류"}</td><td>{date(row.updatedAt)}</td></tr>)}</tbody></table>{!data.recentJobs.length && <p className={styles.empty}>아직 처리된 작업이 없습니다.</p>}</div>
    </section>
    <section className={styles.section} aria-labelledby="sources-heading"><div className={styles.sectionTitle}><h2 id="sources-heading">최근 저장된 공식 원문</h2><span>최근 10개</span></div><div className={styles.tableWrap}><table><caption className={styles.srOnly}>공식 원문 수집 목록</caption><thead><tr><th>번호</th><th>출처</th><th>형식</th><th>저장 시각</th></tr></thead><tbody>{data.recentSources.map(row=><tr key={row.id}><td>{row.id}</td><td>{row.source==="MOLEG" ? "국가법령정보센터" : row.source}</td><td>{row.contentType.includes("json") ? "JSON" : row.contentType.includes("xml") ? "XML" : row.contentType}</td><td>{date(row.collectedAt)}</td></tr>)}</tbody></table>{!data.recentSources.length && <p className={styles.empty}>아직 저장된 원문이 없습니다.</p>}</div></section>
  </>;
}
