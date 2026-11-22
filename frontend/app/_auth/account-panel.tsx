import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteHeader } from "../_components/site-header";
import styles from "./account.module.css";

/** 로그인·회원가입: 사이드바 없이 화면 가운데에 카드 하나만 보여 준다. 비회원으로도 바로 시작할 수 있다. */
export function AuthScreen({ title, children }: { title: string; children: ReactNode }) {
  return <div className={styles.authPage}>
    <main className={styles.authMain}>
      <Link href="/" className={styles.authBrand} aria-label="AURORE 홈">
        <Image src="/brand/aurore-icon.svg" alt="" width={44} height={44} unoptimized />
        <span>AURORE</span>
      </Link>
      <section className={styles.authCard} aria-labelledby="account-title">
        <h1 id="account-title">{title}</h1>
        {children}
        <div className={styles.guestBlock}>
          <span className={styles.guestOr}>또는</span>
          <Link href="/" className={"ui-button " + styles.guestButton}>비회원으로 시작하기</Link>
          <p className={styles.guestNote}>가입 없이 바로 질문할 수 있어요. 비회원 대화는 만든 날부터 1개월 뒤 삭제되고, 사건·첨부 기능은 회원만 쓸 수 있어요.</p>
        </div>
      </section>
    </main>
  </div>;
}

export function AccountPanel({ title, children, signedIn = false }: {
  title: string;
  children: ReactNode;
  signedIn?: boolean;
}) {
  return <div className={styles.page}>
    <SiteHeader signedIn={signedIn} active="account" />
    <main className={styles.main}>
      <section className={styles.panel} aria-labelledby="account-title">
        <h1 id="account-title">{title}</h1>
        {children}
      </section>
    </main>
  </div>;
}
