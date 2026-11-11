import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "../_components/site-header";
import { currentToken } from "../_auth/session";
import { requestAdmin, type AdminOverview } from "../_admin/requests";
import styles from "./page.module.css";

export const metadata = { title: "운영 관리 | AURORE" };
const format = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" });
const date = (value: string) => format.format(new Date(value));
const number = new Intl.NumberFormat("ko-KR");
const states: Record<string, string> = { QUEUED: "대기", RUNNING: "처리 중", RETRY_WAIT: "재시도 대기", SUCCEEDED: "완료", FAILED: "실패", CANCELLED: "취소" };

export default async function AdminPage() {
  if (!await currentToken()) redirect("/login");
  const response = await requestAdmin("overview");
  if (response?.status === 401) redirect("/login?expired=1");
  const allowed = Boolean(response?.ok);
  if (!allowed) return <>
    <SiteHeader signedIn active="admin" adminAccess={false} />
    <main className="shell"><section className="intro"><h1>{response?.status === 403 ? "관리자 권한이 필요합니다" : "운영 현황을 불러오지 못했습니다"}</h1>
      <p>{response?.status === 403 ? "접근 권한이 있는 계정으로 로그인해 주세요." : "잠시 후 다시 시도해 주세요."}</p>
      <Link href="/account">내 계정으로 이동 ↗</Link></section></main>
  </>;
  const data = await response!.json() as AdminOverview;
  const cards = [["회원", data.counts.members], ["보관 중 대화", data.counts.conversations], ["법령", data.counts.legals], ["시행본", data.counts.versions], ["현재 원문 조문", data.counts.provisions], ["판례", data.counts.precedents], ["수집 원본", data.counts.snapshots]] as const;
  return <>
    <SiteHeader signedIn active="admin" adminAccess />
    <main className="shell">
      <section className="intro"><h1>운영 현황</h1><p>저장된 데이터와 AI 작업의 처리 상태를 확인합니다.</p></section>
      <div className={styles.toolbar}><p>{date(data.asOf)} 기준</p><form action="/admin"><button type="submit">새로고침 ↻</button></form></div>
      <dl className={styles.metrics}>{cards.map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{number.format(count)}<small>건</small></dd></div>)}</dl>
      <section className={styles.section} aria-labelledby="jobs-heading">
        <div className="section-heading"><h2 id="jobs-heading">AI 작업</h2><span>삭제·보관 만료된 대화 제외</span></div>
        <dl className={styles.states}>{Object.entries(states).map(([key,label]) => <div key={key}><dt>{label}</dt><dd>{number.format(data.jobs.find(row => row.status === key)?.count ?? 0)}</dd></div>)}</dl>
        <div className={styles.tableWrap}><table><caption>최근 변경된 AI 작업 20건</caption><thead><tr><th>작업</th><th>상태</th><th>처리 방식</th><th>시도</th><th>오류 유형</th><th>변경 시각</th></tr></thead>
          <tbody>{data.recentJobs.map(row => <tr key={row.id}><td title={row.id}>{row.id.slice(0,8)}</td><td>{states[row.status] ?? row.status}</td><td>{row.provider === "DEMO" ? "검증 예제" : row.provider}</td><td>{row.attempts}</td><td>{row.errorCode ?? "—"}</td><td>{date(row.updatedAt)}</td></tr>)}</tbody></table>
          {!data.recentJobs.length && <p className="empty">아직 처리된 작업이 없습니다.</p>}
        </div>
      </section>
      <section className={styles.section} aria-labelledby="sources-heading"><div className="section-heading"><h2 id="sources-heading">최근 원문 수집</h2><span>최근 10건</span></div>
        <div className={styles.tableWrap}><table><caption>최근 저장된 공식 원문</caption><thead><tr><th>번호</th><th>출처 구분</th><th>형식</th><th>수집 시각</th></tr></thead><tbody>{data.recentSources.map(row => <tr key={row.id}><td>{row.id}</td><td>{row.source}</td><td>{row.contentType}</td><td>{date(row.collectedAt)}</td></tr>)}</tbody></table>
        {!data.recentSources.length && <p className="empty">수집된 원문이 없습니다.</p>}</div>
      </section>
      <p className={styles.notice}>개인정보 원문 열람은 비활성화되어 있습니다. 대화·사건·첨부 본문은 표시하지 않습니다.</p>
    </main>
  </>;
}
