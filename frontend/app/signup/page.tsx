import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountForm } from "../_auth/account-form";
import { AccountPanel } from "../_auth/account-panel";
import { currentMember } from "../_auth/session";
import styles from "../_auth/account.module.css";

export default async function Signup() {
  if (await currentMember()) redirect("/account");
  return <AccountPanel title="회원가입">
    <AccountForm mode="signup" />
    <p className={styles.footer}>이미 계정이 있으신가요? <Link href="/login">로그인</Link></p>
  </AccountPanel>;
}
