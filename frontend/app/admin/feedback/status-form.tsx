"use client";
import { useActionState } from "react";
import { setFeedbackStatus, type FeedbackActionState } from "../../_admin/feedback-actions";
import styles from "../page.module.css";

export function FeedbackStatusForm({ id, status, note }: { id: string; status: string; note: string | null }) {
  const [state, action, pending] = useActionState<FeedbackActionState, FormData>(setFeedbackStatus.bind(null, id), null);
  return (
    <form className={styles.approval} action={action}>
      <h3>처리 상태</h3>
      <label>
        상태
        <select name="status" defaultValue={status} disabled={pending}>
          <option value="NEW">새 의견</option>
          <option value="REVIEWING">검토 중</option>
          <option value="DONE">처리 완료</option>
        </select>
      </label>
      <label>
        처리 메모 (선택)
        <textarea name="note" defaultValue={note ?? ""} maxLength={500} rows={3} placeholder="어떻게 처리했는지 적어 두세요. 개인정보는 적지 마세요." disabled={pending} />
      </label>
      {state?.error && <p role="alert" className={styles.approvalError}>{state.error}</p>}
      <button type="submit" disabled={pending} data-primary>{pending ? "저장 중…" : "저장"}</button>
    </form>
  );
}
