import { LearningConsentPanel } from '../_auth/learning-consent-panel';
import { parsePageSize } from '../_components/page-size';
import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordForm, SignOutAllForm } from "../_auth/account-form";
import { SiteHeader } from "../_components/site-header";
import { currentMember } from "../_auth/session";
import styles from "../_auth/account.module.css";

export const metadata = {title: "마이페이지 | AURORE"};

export default async function Account({searchParams}:{searchParams:Promise<{limit?:string;offset?:string}>}) {
  const params=await searchParams,limit=parsePageSize(params.limit),offset=/^\d{1,6}$/.test(params.offset??'')?Math.min(Number(params.offset),100000):0;
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
            <div className={styles.accountLinks}><Link href="/conversations" data-action-link>나의 대화 기록 </Link><Link href="/" data-action-link>새 대화 시작 </Link></div>
          </section>
          <section className={styles.accountCard} aria-labelledby="sessions-heading">
            <h2 id="sessions-heading">로그인 관리</h2>
            <SignOutAllForm />
            <div className={styles.section}><h2>회원 탈퇴</h2><p className={styles.help}>탈퇴 전에 자료 처리 범위를 확인할 수 있습니다.</p><Link href="/account/withdrawal" className="ui-button">탈퇴 안내 확인</Link></div>
          </section>
        </div>
        <section className={styles.accountCard} aria-labelledby="password-heading">
          <h2 id="password-heading">비밀번호 변경</h2>
          <p className={styles.help}>현재 비밀번호를 확인한 뒤 새 비밀번호를 설정합니다.</p>
          <PasswordForm />
        </section>
      </div>
      <LearningConsentPanel limit={limit} offset={offset}/>
    </main>
  </div>;
}
