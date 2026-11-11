import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountForm } from "../_auth/account-form";
import { AccountPanel } from "../_auth/account-panel";
import { currentMember } from "../_auth/session";
import styles from "../_auth/account.module.css";

export default async function Login({ searchParams }: { searchParams: Promise<{ registered?: string; passwordChanged?: string; signedOut?: string; expired?: string }> }) {
  if (await currentMember()) redirect("/account");
  const { registered, passwordChanged, signedOut, expired } = await searchParams;
  return <AccountPanel title="로그인">
    {registered === "1" && <p className={styles.notice} role="status">가입이 완료됐어요. 로그인해 주세요.</p>}
    {passwordChanged === "1" && <p className={styles.notice} role="status">비밀번호가 변경됐어요. 새 비밀번호로 로그인해 주세요.</p>}
    {signedOut === "1" && <p className={styles.notice} role="status">모든 기기에서 로그아웃됐어요.</p>}
    {expired === "1" && <p className={styles.notice} role="status">로그인이 만료됐어요. 다시 로그인해 주세요.</p>}
    <AccountForm mode="login" />
    <p className={styles.footer}>계정이 없으신가요? <Link href="/signup">회원가입</Link></p>
  </AccountPanel>;
}
