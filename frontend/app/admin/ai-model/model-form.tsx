"use client";
import { useActionState } from "react";
import { changeAiModel, rollbackAiModel, type AiModelActionState } from "../../_admin/ai-model-actions";
import styles from "../page.module.css";

export function ModelForms({ allowed, current, labels, canRollback }: { allowed: string[]; current: string | null; labels: Record<string, string>; canRollback: boolean }) {
  const [changeState, changeAction, changing] = useActionState<AiModelActionState, FormData>(changeAiModel, null);
  const [rollbackState, rollbackAction, rolling] = useActionState<AiModelActionState, FormData>(rollbackAiModel, null);
  return (
    <>
      <form className={styles.approval} action={changeAction}>
        <h3>모델 교체</h3>
        <p>고르면 AI 서버에 바로 반영돼요. 질문은 개인정보 패턴을 가린 뒤 선택한 모델로 전송돼요. API 키는 서버 환경변수로만 관리하고 여기서는 입력하지 않아요.</p>
        <label>
          답변 모델
          <select name="model" defaultValue={current ?? allowed[0]} disabled={changing}>
            {allowed.map((model) => <option key={model} value={model}>{labels[model] ?? model}</option>)}
          </select>
        </label>
        <label>
          교체 사유
          <textarea name="reason" required maxLength={500} rows={3} placeholder="예: 답변 품질 비교, 비용 절감. 개인정보는 적지 마세요." disabled={changing} />
        </label>
        <label>
          <input type="checkbox" name="confirmed" value="yes" required disabled={changing} />
          선택한 모델과 사유를 확인했습니다.
        </label>
        {changeState?.error && <p role="alert" className={styles.notice}>{changeState.error}</p>}
        <button type="submit" disabled={changing}>{changing ? "반영 중…" : "모델 교체"}</button>
      </form>
      {canRollback && (
        <form className={styles.approval} action={rollbackAction}>
          <h3>직전 모델로 되돌리기</h3>
          <p>가장 최근 변경 직전에 쓰던 모델로 한 번에 돌아가요. 이 되돌림도 이력에 남아요.</p>
          <label>
            되돌리는 사유
            <textarea name="reason" required maxLength={500} rows={2} placeholder="예: 교체 후 답변 품질이 떨어졌어요." disabled={rolling} />
          </label>
          <label>
            <input type="checkbox" name="confirmed" value="yes" required disabled={rolling} />
            되돌릴 모델과 사유를 확인했습니다.
          </label>
          {rollbackState?.error && <p role="alert" className={styles.notice}>{rollbackState.error}</p>}
          <button type="submit" disabled={rolling}>{rolling ? "되돌리는 중…" : "직전 모델로 되돌리기"}</button>
        </form>
      )}
    </>
  );
}
