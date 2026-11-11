import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordForm, SignOutAllForm, SignOutForm } from "../_auth/account-form";
import { AccountPanel } from "../_auth/account-panel";
import { currentMember } from "../_auth/session";
import styles from "../_auth/account.module.css";

export default async function Account() {
  const member = await currentMember();
  if (!member) redirect("/login");
  return <AccountPanel title="내 계정" signedIn>
    <dl className={styles.profile}>
      <div><dt>아이디</dt><dd>{member.loginId}</dd></div>
      <div><dt>닉네임</dt><dd>{member.nickname}</dd></div>
    </dl>
    <SignOutForm />
    <section className={styles.section} aria-labelledby="password-heading">
      <h2 id="password-heading">비밀번호 변경</h2>
      <PasswordForm />
    </section>
    <section className={styles.section} aria-labelledby="sessions-heading">
      <h2 id="sessions-heading">로그인 관리</h2>
      <SignOutAllForm />
    </section>
    <p className={styles.footer}><Link href="/">법률 대화로 돌아가기</Link></p>
  </AccountPanel>;
}
