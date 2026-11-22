"use client";
import { useState, useTransition } from "react";
import { clearAnswerFeedback, sendAnswerFeedback } from "./actions";
import type { Feedback } from "./types";
import styles from "./conversation.module.css";

const reasons = [
  ["WRONG_LAW", "관련 없는 법이 나왔어요"],
  ["NOT_MY_CASE", "내 상황과 맞지 않아요"],
  ["TOO_HARD", "설명이 어려워요"],
  ["MISSING", "빠진 내용이 있어요"],
  ["OTHER", "기타"],
] as const;
const reasonLabel = Object.fromEntries(reasons) as Record<string, string>;

/** 답변 아래 "도움 됐어요 / 개선이 필요해요". 보내면 이 질문과 답변을 운영자가 볼 수 있다는 점을 미리 알린다. */
export function FeedbackBar({ chatId, messageId, value, onChange }: { chatId: string; messageId: string; value: Feedback | null; onChange: (next: Feedback | null) => void }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState<string>(value?.reason ?? "");
  const [text, setText] = useState(value?.text ?? "");
  const [error, setError] = useState<string | null>(null);

  function save(rating: "HELPFUL" | "IMPROVE") {
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendAnswerFeedback(chatId, messageId, rating, rating === "IMPROVE" ? reason : undefined, rating === "IMPROVE" ? text : undefined);
        if (result.data) { onChange(result.data); setEditing(false); }
        else setError(result.error ?? "의견을 보내지 못했습니다. 다시 시도해 주세요.");
      } catch { setError("의견을 보내지 못했습니다. 다시 시도해 주세요."); }
    });
  }

  function clear() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await clearAnswerFeedback(chatId, messageId);
        if (result.data) { onChange(null); setEditing(false); setReason(""); setText(""); }
        else setError(result.error ?? "의견을 지우지 못했습니다.");
      } catch { setError("의견을 지우지 못했습니다. 다시 시도해 주세요."); }
    });
  }

  const improveOpen = editing;
  return <div className={styles.feedback} aria-label="답변 평가">
    {value && !editing
      ? <p role="status">{value.rating === "HELPFUL" ? "도움이 됐다고 남겨 주셨어요. 고마워요." : `개선이 필요하다고 남겨 주셨어요${value.reason ? " · " + (reasonLabel[value.reason] ?? "") : ""}. 고마워요.`}</p>
      : <p>이 답변이 도움이 됐나요?</p>}
    <div className={styles.feedbackButtons}>
      <button type="button" aria-pressed={value?.rating === "HELPFUL"} disabled={pending} onClick={() => save("HELPFUL")}>도움 됐어요</button>
      <button type="button" aria-pressed={value?.rating === "IMPROVE" || editing} aria-expanded={improveOpen} disabled={pending} onClick={() => setEditing(open => !open)}>개선이 필요해요</button>
      {value && <button type="button" className={styles.reset} disabled={pending} onClick={clear}>의견 지우기</button>}
    </div>
    {improveOpen && <form className={styles.feedbackForm} onSubmit={event => { event.preventDefault(); if (reason) save("IMPROVE"); else setError("어떤 점이 아쉬운지 골라 주세요."); }}>
      <fieldset><legend>어떤 점이 아쉬웠나요?</legend>
        {reasons.map(([code, label]) => <label key={code}><input type="radio" name={"reason-" + messageId} value={code} checked={reason === code} onChange={() => setReason(code)} disabled={pending} />{label}</label>)}
      </fieldset>
      <label htmlFor={"feedback-text-" + messageId}>하고 싶은 말 (선택, 300자 이내)</label>
      <textarea id={"feedback-text-" + messageId} value={text} maxLength={300} onChange={event => setText(event.target.value)} placeholder="이름·연락처·주소 같은 개인정보는 적지 말아 주세요." disabled={pending} />
      <div className={styles.feedbackButtons}><button type="submit" disabled={pending}>{pending ? "보내는 중…" : "의견 보내기"}</button></div>
    </form>}
    <p className={styles.sourceNote}>의견을 보내면 이 질문과 답변을 운영자가 확인해 서비스 개선에 써요. 보낸 사람이 누구인지는 운영자에게 보이지 않아요.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>;
}
