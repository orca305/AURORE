"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./page.module.css";
export function AdminNav() {
  const pathname = usePathname();
  return <nav className={styles.tabs} aria-label="관리자 메뉴"><Link href="/admin" aria-current={pathname==="/admin" ? "page" : undefined}>운영 현황</Link><Link href="/admin/members" aria-current={pathname.startsWith("/admin/members") ? "page" : undefined}>회원 관리</Link><Link href="/admin/collection-schedule" aria-current={pathname.startsWith("/admin/collection-schedule") ? "page" : undefined}>수집·백업 예약</Link><Link href="/admin/legal-refresh" aria-current={pathname.startsWith("/admin/legal-refresh") ? "page" : undefined}>법령 수집·정정</Link><Link href="/admin/precedent-collections" aria-current={pathname.startsWith("/admin/precedent-collections") ? "page" : undefined}>판례 수집 검토</Link><Link href="/admin/precedent-reviews" aria-current={pathname.startsWith("/admin/precedent-reviews") ? "page" : undefined}>판례 연결 재검토</Link><Link href="/admin/privacy-retention" aria-current={pathname.startsWith("/admin/privacy-retention") ? "page" : undefined}>개인정보 보관</Link><Link href="/admin/activity" aria-current={pathname.startsWith("/admin/activity") ? "page" : undefined}>작업 이력</Link><Link href="/admin/ai-jobs" aria-current={pathname.startsWith("/admin/ai-jobs") ? "page" : undefined}>AI 작업</Link></nav>;
}
