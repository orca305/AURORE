"use client";

import { useActionState } from "react";
import { secureAccount, signOut, submitAccount } from "./actions";
import styles from "./account.module.css";

export function AccountForm({ mode }: { mode: "signup" | "login" }) {
  const [error, action, pending] = useActionState(submitAccount.bind(null, mode), null);
  const signup = mode === "signup";
  return (
    <form action={action} className={styles.form}>
      <label>
        아이디
        <input name="loginId" autoComplete="username" autoCapitalize="none" spellCheck={false} required aria-describedby={signup ? "login-id-help" : undefined} />
        {signup && <small id="login-id-help">영문으로 시작하는 영문·숫자·밑줄 4~12자</small>}
      </label>
      {signup && <label>
        닉네임
        <input name="nickname" autoComplete="nickname" required aria-describedby="nickname-help" />
        <small id="nickname-help">한글·영문·숫자·밑줄·내부 공백 2~12자</small>
      </label>}
      <label>
        비밀번호
        <input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required aria-describedby={signup ? "password-help" : undefined} />
        {signup && <small id="password-help">8~16자</small>}
      </label>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <button type="submit" disabled={pending}>{pending ? "처리 중…" : signup ? "계정 만들기" : "로그인"}</button>
    </form>
  );
}

export function SignOutForm() {
  const [error, action, pending] = useActionState(signOut, null);
  return <form action={action} className={styles.form}>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button type="submit" disabled={pending}>{pending ? "처리 중…" : "로그아웃"}</button>
  </form>;
}

export function PasswordForm() {
  const [error, action, pending] = useActionState(secureAccount.bind(null, "password"), null);
  return <form action={action} className={styles.form}>
    <label>현재 비밀번호<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
    <label>새 비밀번호<input name="newPassword" type="password" autoComplete="new-password" required aria-describedby="new-password-help" />
      <small id="new-password-help">8~16자 · 현재와 다른 비밀번호를 입력해 주세요.</small>
    </label>
    <label>새 비밀번호 확인<input name="confirmPassword" type="password" autoComplete="new-password" required /></label>
    <p className={styles.help}>변경하면 이 기기를 포함한 모든 기기에서 로그아웃됩니다.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button type="submit" disabled={pending}>{pending ? "변경 중…" : "비밀번호 변경"}</button>
  </form>;
}

export function SignOutAllForm() {
  const [error, action, pending] = useActionState(secureAccount.bind(null, "logout-all"), null);
  return <form action={action} className={styles.form}>
    <p className={styles.help}>이 기기를 포함해 로그인된 모든 기기의 접속을 종료합니다.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button type="submit" className={styles.secondary} disabled={pending}>{pending ? "로그아웃 중…" : "모든 기기에서 로그아웃"}</button>
  </form>;
}
