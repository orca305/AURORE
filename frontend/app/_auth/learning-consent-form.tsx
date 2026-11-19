"use client";
import { useActionState, useState } from "react";
import { saveLearningConsent } from "./actions";
import styles from "./account.module.css";
export function LearningConsentForm({
  agreed,
  revision,
}: {
  agreed: boolean;
  revision: string;
}) {
  const [selected, setSelected] = useState(agreed),
    [confirmed, setConfirmed] = useState(false),
    [state, action, pending] = useActionState(
      saveLearningConsent.bind(null, revision),
      null,
    );
  const locked=Boolean(state?.mustRefresh);
  return (
    <form action={action} className={styles.form}>
      <fieldset disabled={pending||locked} className={styles.consentChoices}>
        <legend>학습 활용 선택</legend>
        <label className={styles.consentChoice}>
          <input
            type="radio"
            name="agreed"
            value="yes"
            checked={selected}
            onChange={() => {
              setSelected(true);
              setConfirmed(false);
            }}
          />
          동의함
        </label>
        <label className={styles.consentChoice}>
          <input
            type="radio"
            name="agreed"
            value="no"
            checked={!selected}
            onChange={() => {
              setSelected(false);
              setConfirmed(false);
            }}
          />
          동의하지 않음 · 철회
        </label>
      </fieldset>
      <label className={styles.consentChoice}>
        <input
          type="checkbox"
          name="confirmed"
          checked={confirmed}
          disabled={pending||locked}
          required
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>
          선택 동의이며 서비스 이용에 영향을 주지 않는다는 안내를 확인했습니다.
        </span>
      </label>
      {selected!==agreed&&<p className={styles.selectionSummary} role="status">저장할 선택 · <strong>{selected?'동의함':'미동의 · 철회'}</strong><br/>{selected?'선택 동의를 저장합니다. 자료가 즉시 학습에 사용되는 것은 아닙니다.':'앞으로의 학습 활용에 대한 동의를 철회합니다. 이미 학습한 모델의 영향 제거 완료를 뜻하지 않습니다.'}</p>}
      {state && (
        <p role="alert" className={styles.error}>
          {state.error}{state.mustRefresh&&<> <a href={state.loginRequired?"/login":"/account#learning-consent"}>{state.loginRequired?"다시 로그인":"현재 선택 다시 확인"}</a></>}
        </p>
      )}
      <button
        type="submit"
        data-primary
        disabled={pending || locked || !confirmed || selected === agreed}
      >
        {pending ? "선택 저장 중…" : selected?"동의 선택 저장":"미동의·철회 저장"}
      </button>
    </form>
  );
}
