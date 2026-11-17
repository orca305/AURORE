"use client";
import { useActionState, useState } from "react";
import { withdrawAccount } from "./actions";
import styles from "./account.module.css";
export function WithdrawalForm() {
  const [error, action, pending] = useActionState(withdrawAccount, null),
    [confirmed, setConfirmed] = useState(false);
  return (
    <form action={action} className={styles.form}>
      <label>
        현재 비밀번호
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={32}
          disabled={pending}
        />
      </label>
      <label className={styles.withdrawalConfirm}>
        <input
          name="confirmed"
          type="checkbox"
          required
          checked={confirmed}
          disabled={pending}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>
          탈퇴 후 모든 기기에서 로그아웃되며 대화·사건·첨부자료를 다시 이용할 수
          없음을 확인했습니다. 개인정보 파기는 별도로 진행되고, 파기 완료 전에는
          같은 아이디로 다시 가입할 수 없습니다.
        </span>
      </label>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button type="submit" data-danger disabled={pending || !confirmed}>
        {pending ? "탈퇴 처리 중…" : "회원 탈퇴"}
      </button>
    </form>
  );
}
