import Link from "next/link";
import { requestAdmin } from "../../_admin/requests";
import styles from "../page.module.css";

export const metadata = { title: "AI 모니터링 | AURORE" };

type Monitor = {
  days: number; pricesAssumed: boolean;
  daily: { day: string; questions: number; calls: number; avgMs: number | null; p95Ms: number | null; errorRate: number; externalShare: number | null; fallbacks: number; estimatedCostUsd: number }[];
  stages: { stage: string; calls: number; errors: number; avgMs: number | null; p95Ms: number | null }[];
  alerts: { level: "warn" | "danger"; code: string; message: string }[];
  thresholds: { errorRate: number; p95Ms: number; fallbackRate: number; dailyCostUsd: number | null };
};
const stageNames: Record<string, string> = { propose: "조문 짚기", answer: "답변 작성", explain: "해설", status: "상태" };
const sec = (ms: number | null) => (ms === null ? "-" : (ms / 1000).toFixed(1) + "초");
const pct = (value: number | null) => (value === null ? "-" : Math.round(value * 100) + "%");

export default async function AiMonitorPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days } = await searchParams;
  const span = ["7", "14", "30"].includes(days ?? "") ? (days as string) : "7";
  const response = await requestAdmin("ai-monitor", new URLSearchParams({ days: span }));
  if (!response?.ok) return <p role="alert" className={styles.notice}>모니터링 정보를 불러오지 못했습니다. 권한과 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>;
  const data = (await response.json()) as Monitor;
  return <>
    <div className={styles.sectionTitle}><div><h2>AI 모니터링</h2><p>모델 호출의 단계·모델·걸린 시간·토큰 수·결과만 기록해요. 질문과 답변 내용은 저장하지 않아요.</p></div>
      <span>{["7", "14", "30"].map((d) => <Link key={d} href={`/admin/ai-monitor?days=${d}`} aria-current={d === span ? "page" : undefined}>{d}일 </Link>)}</span></div>
    <section className={styles.section} aria-labelledby="alerts-heading">
      <h3 id="alerts-heading">알림</h3>
      {data.alerts.length === 0 ? <p>지금은 임계치를 넘은 항목이 없어요.</p> : <ul>{data.alerts.map((alert) => <li key={alert.code} role="alert" className={alert.level === "danger" ? styles.attention : undefined}>{alert.message}</li>)}</ul>}
      <p>기준: 오류율 {pct(data.thresholds.errorRate)} 초과 · P95 {sec(data.thresholds.p95Ms)} 초과 · 로컬 전환 {pct(data.thresholds.fallbackRate)} 초과(최근 1시간, 5건 이상){data.thresholds.dailyCostUsd ? ` · 하루 추정 비용 $${data.thresholds.dailyCostUsd}` : ""}</p>
    </section>
    <section className={styles.section} aria-labelledby="daily-heading">
      <h3 id="daily-heading">일별 현황 (최근 {data.days}일)</h3>
      <div className={styles.tableWrap}><table><caption>일별 AI 호출 현황</caption>
        <thead><tr><th>날짜</th><th>질문 수</th><th>호출 수</th><th>평균 지연</th><th>P95 지연</th><th>오류율</th><th>외부 비율</th><th>로컬 전환</th><th>추정 비용</th></tr></thead>
        <tbody>{data.daily.length ? data.daily.map((row) => <tr key={row.day}><td>{row.day}</td><td>{row.questions}</td><td>{row.calls}</td><td>{sec(row.avgMs)}</td><td>{sec(row.p95Ms)}</td><td>{pct(row.errorRate)}</td><td>{pct(row.externalShare)}</td><td>{row.fallbacks}회</td><td>${row.estimatedCostUsd.toFixed(2)}</td></tr>) : <tr><td colSpan={9}>아직 기록된 호출이 없어요. 질문이 들어오면 쌓여요.</td></tr>}</tbody>
      </table></div>
      <p>호출 수는 모델 호출 단위라 질문 하나가 여러 번 호출될 수 있어요. 지연은 호출 하나가 걸린 시간이에요. {data.pricesAssumed ? "추정 비용은 모델별 가격을 서버 환경변수(AURORE_MODEL_PRICES)에 넣지 않아 가정한 가격으로 계산한 값이에요. 실제 요금과 다를 수 있어요." : "추정 비용은 설정한 모델별 가격과 기록된 토큰 수로 계산한 값이에요."}</p>
    </section>
    <section className={styles.section} aria-labelledby="stage-heading">
      <h3 id="stage-heading">단계별 (최근 24시간)</h3>
      <div className={styles.tableWrap}><table><caption>단계별 호출</caption>
        <thead><tr><th>단계</th><th>호출 수</th><th>오류</th><th>평균 지연</th><th>P95 지연</th></tr></thead>
        <tbody>{data.stages.length ? data.stages.map((row) => <tr key={row.stage}><td>{stageNames[row.stage] ?? row.stage}</td><td>{row.calls}</td><td>{row.errors}</td><td>{sec(row.avgMs)}</td><td>{sec(row.p95Ms)}</td></tr>) : <tr><td colSpan={5}>최근 24시간 기록이 없어요.</td></tr>}</tbody>
      </table></div>
    </section>
  </>;
}
