"use client";

import { useActionState,useState,type FormEvent } from "react";
import {passwordChangeProblem,passwordLength} from './form-policy';
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
      <button type="submit" disabled={pending} data-primary>{pending ? "처리 중…" : signup ? "계정 만들기" : "로그인"}</button>
    </form>
  );
}

export function SignOutForm() {
  const [error, action, pending] = useActionState(signOut, null);
  return <form action={action} className={styles.form}>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button type="submit" disabled={pending} data-primary>{pending ? "처리 중…" : "로그아웃"}</button>
  </form>;
}

export function PasswordForm() {
  const [error, action, pending] = useActionState(secureAccount.bind(null, "password"), null);
  const [problem,setProblem]=useState<string|null>(null),[length,setLength]=useState(0);
  function check(event:FormEvent<HTMLFormElement>){const fields=event.currentTarget.elements;const current=(fields.namedItem('currentPassword') as HTMLInputElement).value,next=(fields.namedItem('newPassword') as HTMLInputElement).value,confirmation=(fields.namedItem('confirmPassword') as HTMLInputElement).value;setLength(passwordLength(next));setProblem(passwordChangeProblem(current,next,confirmation));}
  return <form action={action} className={styles.form} onInput={check}>
    <label>현재 비밀번호<input name="currentPassword" type="password" autoComplete="current-password" required disabled={pending}/></label>
    <label>새 비밀번호<input name="newPassword" type="password" autoComplete="new-password" required disabled={pending} aria-describedby="new-password-help"/>
      <small id="new-password-help">{length}/16자 · 8~16자, 현재와 다른 비밀번호</small>
    </label>
    <label>새 비밀번호 확인<input name="confirmPassword" type="password" autoComplete="new-password" required disabled={pending}/></label>
    <p className={styles.help}>변경하면 이 기기를 포함한 모든 기기에서 로그아웃됩니다.</p>
    {problem&&<p className={styles.help} role="status">{problem}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button type="submit" disabled={pending||Boolean(problem)} data-primary>{pending ? "변경 중…" : "비밀번호 변경"}</button>
  </form>;
}

export function SignOutAllForm() {
  const [confirmed,setConfirmed]=useState(false);
  const [error, action, pending] = useActionState(secureAccount.bind(null, "logout-all"), null);
  return <form action={action} className={styles.form}>
    <p className={styles.help}>이 기기를 포함해 로그인된 모든 기기의 접속을 종료합니다.</p>
    <label className={styles.consentChoice}><input type="checkbox" name="confirmed" required checked={confirmed} disabled={pending} onChange={event=>setConfirmed(event.target.checked)}/>모든 기기에서 다시 로그인해야 함을 확인했습니다.</label>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button type="submit" className={styles.secondary} disabled={pending||!confirmed} data-primary>{pending ? "로그아웃 중…" : "모든 기기에서 로그아웃"}</button>
  </form>;
}
