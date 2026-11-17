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
    [error, action, pending] = useActionState(
      saveLearningConsent.bind(null, revision),
      null,
    );
  return (
    <form action={action} className={styles.form}>
      <fieldset disabled={pending} className={styles.consentChoices}>
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
          disabled={pending}
          required
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>
          선택 동의이며 서비스 이용에 영향을 주지 않는다는 안내를 확인했습니다.
        </span>
      </label>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button
        type="submit"
        data-primary
        disabled={pending || !confirmed || selected === agreed}
      >
        {pending ? "저장 중…" : "선택 저장"}
      </button>
    </form>
  );
}
