"use client";
import Link from "next/link";
import { useActionState } from "react";
import { signOut } from "../_auth/actions";
import { useActiveKey } from "./site-active";
import styles from "./site-header.module.css";

export function HeaderAccount({nickname}: {nickname: string}) {
  const active = useActiveKey() === "account";
  const [error, action, pending] = useActionState(signOut, null);
  return <div className={styles.memberMenu}>
    <Link href="/account" className={styles.nickname} aria-current={active ? "page" : undefined} title={nickname + " · 마이페이지"}>{nickname}</Link>
    <form action={action}><button type="submit" className={styles.logout} disabled={pending} aria-label={pending ? "로그아웃 중" : "로그아웃"} title="로그아웃"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" /></svg></button></form>
    {error && <p role="alert" className={styles.accountError}>{error}</p>}
  </div>;
}
