import Link from "next/link";
import { notFound } from "next/navigation";
import { requestAdmin } from "../../../_admin/requests";
import { date } from "../../../_admin/format";
import { FeedbackStatusForm } from "../status-form";
import styles from "../../page.module.css";

export const metadata = { title: "피드백 상세 | AURORE" };

type Detail = {
  id: string; rating: string; reason: string | null; text: string | null; status: string; note: string | null;
  handledBy: string | null; handledAt: string | null; at: string; updatedAt: string;
  question: string | null; answer: string; provider: string | null; result: string | null;
  citations: { label: string; verification: string }[];
};
const reasons: Record<string, string> = { WRONG_LAW: "관련 없는 법이 나왔어요", NOT_MY_CASE: "내 상황과 맞지 않아요", TOO_HARD: "설명이 어려워요", MISSING: "빠진 내용이 있어요", OTHER: "기타" };

export default async function FeedbackDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ updated?: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,17}$/.test(id)) notFound();
  const response = await requestAdmin(`feedback/${id}`);
  if (response?.status === 404) notFound();
  if (!response?.ok) return <p role="alert" className={styles.notice}>피드백을 불러오지 못했습니다. 권한과 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>;
  const item = (await response.json()) as Detail;
  const updated = (await searchParams).updated === "1";
  return <>
    <Link className={styles.back} href="/admin/feedback">← 피드백 목록</Link>
    <div className={styles.sectionTitle}><div><h2>피드백 상세</h2><p>남긴 때 {date(item.at)}{item.updatedAt !== item.at ? ` · 수정 ${date(item.updatedAt)}` : ""}</p></div></div>
    {updated && <p role="status" className={styles.notice}>처리 상태를 저장했어요.</p>}
    <section className={styles.section} aria-labelledby="fb-opinion">
      <h3 id="fb-opinion">사용자 의견</h3>
      <p><span className={styles.badge} data-tone={item.rating === "IMPROVE" ? "danger" : "success"}>{item.rating === "IMPROVE" ? "개선 필요" : "도움 됐어요"}</span>{item.reason ? " " + (reasons[item.reason] ?? item.reason) : ""}</p>
      {item.text && <p>{item.text}</p>}
    </section>
    <section className={styles.section} aria-labelledby="fb-question">
      <h3 id="fb-question">질문</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{item.question ?? "질문을 찾을 수 없어요."}</p>
    </section>
    <section className={styles.section} aria-labelledby="fb-answer">
      <h3 id="fb-answer">답변</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{item.answer}</p>
      <p>처리 방식 {item.provider ?? "—"}{item.result ? " · 결과 " + item.result : ""}</p>
      {item.citations.length > 0 && <p>근거: {item.citations.map((citation) => citation.label).join(", ")}</p>}
    </section>
    {item.handledAt && <p>마지막 처리: {item.handledBy ?? "—"} · {date(item.handledAt)}</p>}
    <FeedbackStatusForm id={item.id} status={item.status} note={item.note} />
  </>;
}
