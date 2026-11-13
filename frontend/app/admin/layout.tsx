import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SiteHeader } from "../_components/site-header";
import { currentToken } from "../_auth/session";
import { requestAdmin } from "../_admin/requests";
import { AdminNav } from "./admin-nav";
import styles from "./page.module.css";
export default async function AdminLayout({children}:{children:ReactNode}) {
  if (!await currentToken()) redirect("/login");
  const response = await requestAdmin("session");
  if (response?.status===401) redirect("/login?expired=1");
  if (!response?.ok) return <><SiteHeader signedIn active="admin" adminAccess={false}/><main className="shell"><section className="intro"><h1>{response?.status===403 ? "관리자 권한이 필요합니다" : "관리자 화면에 연결하지 못했습니다"}</h1><p>{response?.status===403 ? "접근 권한이 있는 계정으로 로그인해 주세요." : "잠시 후 다시 시도해 주세요."}</p><Link href="/account">내 계정으로 이동 ↗</Link></section></main></>;
  return <><SiteHeader signedIn active="admin" adminAccess/><main className={styles.main}><header className={styles.heading}><div><p className={styles.eyebrow}>AURORE ADMIN</p><div className={styles.titleRow}><h1>운영 관리</h1><span className={styles.access}>관리자 전용</span></div></div></header><AdminNav/>{children}<p className={styles.privacy}>개인정보 원문 열람 비활성 · 대화·사건·첨부 본문은 표시하지 않습니다.</p></main></>;
}
