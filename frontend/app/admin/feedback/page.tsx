import Link from "next/link";
import { requestAdmin } from "../../_admin/requests";
import { date } from "../../_admin/format";
import { parsePageSize } from "../../_components/page-size";
import styles from "../page.module.css";

export const metadata = { title: "사용자 피드백 | AURORE" };

type FeedbackList = {
  total: number; offset: number; limit: number; nextOffset: number | null;
  summary: {
    helpful: number; improve: number; helpfulRate: number | null; recentHelpful: number; recentImprove: number; recentHelpfulRate: number | null;
    byReason: { reason: string; count: number }[]; byStatus: Record<string, number>;
  };
  items: { id: string; rating: string; reason: string | null; text: string | null; status: string; at: string; question: string; provider: string | null }[];
};

export const feedbackReasons: Record<string, string> = { WRONG_LAW: "관련 없는 법", NOT_MY_CASE: "내 상황과 다름", TOO_HARD: "설명이 어려움", MISSING: "빠진 내용", OTHER: "기타", NONE: "이유 없음" };
export const feedbackStatuses: Record<string, string> = { NEW: "새 의견", REVIEWING: "검토 중", DONE: "처리 완료" };
const ratings: Record<string, string> = { HELPFUL: "도움 됐어요", IMPROVE: "개선 필요" };
const pick = (value: string | string[] | undefined, allowed: string[]) => (typeof value === "string" && allowed.includes(value) ? value : "all");
const pct = (value: number | null) => (value === null ? "-" : Math.round(value * 100) + "%");

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const status = pick(params.status, Object.keys(feedbackStatuses));
  const rating = pick(params.rating, Object.keys(ratings));
  const reason = pick(params.reason, Object.keys(feedbackReasons).filter((code) => code !== "NONE"));
  const limit = parsePageSize(params.limit);
  const rawOffset = typeof params.offset === "string" ? params.offset : "";
  const offset = /^\d{1,6}$/.test(rawOffset) ? Math.min(Number(rawOffset), 100000) : 0;
  const query = new URLSearchParams({ status, rating, reason, limit: String(limit), offset: String(offset) });
  const response = await requestAdmin("feedback", query);
  if (!response?.ok) return <p role="alert" className={styles.notice}>피드백을 불러오지 못했습니다. 권한과 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>;
  const data = (await response.json()) as FeedbackList;
  const link = (next: Partial<Record<"status" | "rating" | "reason" | "offset", string>>) => {
    const value = new URLSearchParams({ status, rating, reason, limit: String(limit), ...next });
    return "/admin/feedback?" + value;
  };
  const pageUrl = (next: number) => { const value = new URLSearchParams(query); value.set("offset", String(next)); return "/admin/feedback?" + value; };
  return <>
    <div className={styles.sectionTitle}><div><h2>사용자 피드백</h2>
      <p>답변 아래에서 사용자가 남긴 의견이에요. 해당 질문과 답변 내용은 볼 수 있지만, 누가 남겼는지는 알 수 없어요.</p></div></div>
    <section className={styles.section} aria-labelledby="fb-summary">
      <h3 id="fb-summary">요약</h3>
      <p>전체 도움 됐어요 {data.summary.helpful}건 · 개선 필요 {data.summary.improve}건 (도움 비율 {pct(data.summary.helpfulRate)}) · 최근 30일 {data.summary.recentHelpful}건 / {data.summary.recentImprove}건 (도움 비율 {pct(data.summary.recentHelpfulRate)})</p>
      <p>처리 상태: {Object.entries(feedbackStatuses).map(([code, label]) => `${label} ${data.summary.byStatus[code] ?? 0}건`).join(" · ")}</p>
      {data.summary.byReason.length > 0 && <p>개선 필요 이유: {data.summary.byReason.map((row) => `${feedbackReasons[row.reason] ?? row.reason} ${row.count}건`).join(" · ")}</p>}
    </section>
    <nav aria-label="피드백 필터" className={styles.sectionTitle}>
      <span>상태 {["all", ...Object.keys(feedbackStatuses)].map((code) => <Link key={code} href={link({ status: code, offset: "0" })} aria-current={code === status ? "page" : undefined}>{code === "all" ? "전체" : feedbackStatuses[code]} </Link>)}</span>
      <span>평가 {["all", ...Object.keys(ratings)].map((code) => <Link key={code} href={link({ rating: code, offset: "0" })} aria-current={code === rating ? "page" : undefined}>{code === "all" ? "전체" : ratings[code]} </Link>)}</span>
      <span>이유 {["all", ...Object.keys(feedbackReasons).filter((code) => code !== "NONE")].map((code) => <Link key={code} href={link({ reason: code, offset: "0" })} aria-current={code === reason ? "page" : undefined}>{code === "all" ? "전체" : feedbackReasons[code]} </Link>)}</span>
    </nav>
    <div className={styles.tableWrap}><table><caption>피드백 {data.total}건</caption>
      <thead><tr><th>남긴 때</th><th>평가</th><th>이유</th><th>질문</th><th>상태</th><th></th></tr></thead>
      <tbody>{data.items.length ? data.items.map((row) => <tr key={row.id}>
        <td>{date(row.at)}</td>
        <td><span className={styles.badge} data-tone={row.rating === "IMPROVE" ? "danger" : "success"}>{ratings[row.rating] ?? row.rating}</span></td>
        <td>{row.reason ? feedbackReasons[row.reason] ?? row.reason : "—"}{row.text ? " · " + row.text.slice(0, 40) + (row.text.length > 40 ? "…" : "") : ""}</td>
        <td>{row.question || "—"}</td>
        <td><span className={styles.badge}>{feedbackStatuses[row.status] ?? row.status}</span></td>
        <td><Link href={"/admin/feedback/" + row.id}>자세히</Link></td>
      </tr>) : <tr><td colSpan={6}>조건에 맞는 피드백이 없어요.</td></tr>}</tbody>
    </table></div>
    {(offset > 0 || data.nextOffset !== null) && <nav className="pagination" aria-label="피드백 페이지">
      {offset > 0 && <Link href={pageUrl(Math.max(0, offset - limit))}>← 이전</Link>}
      {data.nextOffset !== null && <Link href={pageUrl(data.nextOffset)}>다음 →</Link>}
    </nav>}
  </>;
}
