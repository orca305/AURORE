import { LearningConsentPanel } from '../_auth/learning-consent-panel';
import { parsePageSize } from '../_components/page-size';
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutAllForm } from "../_auth/account-form";
import { PasswordDisclosure } from "../_auth/password-disclosure";
import { currentMember } from "../_auth/session";
import styles from "../_auth/account.module.css";

export const metadata = {title: "마이페이지 | AURORE"};

export default async function Account({searchParams}:{searchParams:Promise<{limit?:string;offset?:string;consentSaved?:string}>}) {
  const params=await searchParams,limit=parsePageSize(params.limit),offset=/^\d{1,6}$/.test(params.offset??'')?Math.min(Number(params.offset),100000):0;
  const member = await currentMember();
  if (!member) redirect("/login");
  return <div className={styles.page}>
    
    <main className={styles.accountMain}>
      <section className={styles.accountIntro}>
        <h1>마이페이지</h1>
        <p>계정 정보와 개인정보 설정을 관리해요.</p>
      </section>
      <div className={styles.accountSingle}>
        <section className={styles.accountCard} aria-labelledby="profile-heading">
          <h2 id="profile-heading">계정 정보</h2>
          <dl className={styles.profile}>
            <div><dt>아이디</dt><dd>{member.loginId}</dd></div>
            <div><dt>닉네임</dt><dd>{member.nickname}</dd></div>
          </dl>
          <div className={styles.field}><span className={styles.fieldLabel}>비밀번호</span><PasswordDisclosure /></div>
        </section>
        <section className={styles.accountCard} aria-labelledby="sessions-heading">
          <h2 id="sessions-heading">로그인 관리</h2>
          <SignOutAllForm />
        </section>
        <section className={styles.accountCard} aria-labelledby="withdraw-heading">
          <h2 id="withdraw-heading">회원 탈퇴</h2>
          <p className={styles.help}>탈퇴하면 대화와 사건이 삭제 대기 상태가 돼요. 탈퇴 전에 자료 처리 범위를 확인할 수 있어요.</p>
          <Link href="/account/withdrawal" className={"ui-button " + styles.withdrawButton}>탈퇴 안내 확인</Link>
        </section>
      </div>
      <LearningConsentPanel limit={limit} offset={offset} saved={params.consentSaved}/>
    </main>
  </div>;
}
