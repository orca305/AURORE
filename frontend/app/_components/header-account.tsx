"use client";
import Link from "next/link";
import { useActionState } from "react";
import { signOut } from "../_auth/actions";
import styles from "./site-header.module.css";

export function HeaderAccount({nickname, active}: {nickname: string; active: boolean}) {
  const [error, action, pending] = useActionState(signOut, null);
  return <div className={styles.memberMenu}>
    <Link href="/account" className={styles.nickname} aria-current={active ? "page" : undefined} title={nickname + " · 마이페이지"}>{nickname}</Link>
    <form action={action}><button type="submit" disabled={pending}>{pending ? "로그아웃 중…" : "로그아웃"}</button></form>
    {error && <p role="alert" className={styles.accountError}>{error}</p>}
  </div>;
}
