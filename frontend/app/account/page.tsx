import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordForm, SignOutAllForm } from "../_auth/account-form";
import { SiteHeader } from "../_components/site-header";
import { currentMember } from "../_auth/session";
import styles from "../_auth/account.module.css";

export const metadata = {title: "마이페이지 | AURORE"};

export default async function Account() {
  const member = await currentMember();
  if (!member) redirect("/login");
  return <div className={styles.page}>
    <SiteHeader signedIn active="account" />
    <main className={styles.accountMain}>
      <section className={styles.accountIntro}>
        <h1>마이페이지</h1>
        <p>{member.nickname}님의 회원 정보와 로그인 보안을 관리합니다.</p>
      </section>
      <div className={styles.accountGrid}>
        <div className={styles.accountColumn}>
          <section className={styles.accountCard} aria-labelledby="profile-heading">
            <h2 id="profile-heading">회원 정보</h2>
            <p className={styles.help}>현재 사용 중인 계정입니다.</p>
            <dl className={styles.profile}>
              <div><dt>아이디</dt><dd>{member.loginId}</dd></div>
              <div><dt>닉네임</dt><dd>{member.nickname}</dd></div>
            </dl>
            <div className={styles.accountLinks}><Link href="/conversations">나의 대화 기록 ↗</Link><Link href="/">새 대화 시작 ↗</Link></div>
          </section>
          <section className={styles.accountCard} aria-labelledby="sessions-heading">
            <h2 id="sessions-heading">로그인 관리</h2>
            <SignOutAllForm />
          </section>
        </div>
        <section className={styles.accountCard} aria-labelledby="password-heading">
          <h2 id="password-heading">비밀번호 변경</h2>
          <p className={styles.help}>현재 비밀번호를 확인한 뒤 새 비밀번호를 설정합니다.</p>
          <PasswordForm />
        </section>
      </div>
    </main>
  </div>;
}
