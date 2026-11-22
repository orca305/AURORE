"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./page.module.css";

/** 탭 12개를 6개 묶음으로 합쳤다. 묶음 안의 화면은 아래 줄에서 고른다. */
const groups = [
  { label: "현황", items: [{ href: "/admin", label: "운영 현황", exact: true }] },
  { label: "AI", items: [{ href: "/admin/ai-monitor", label: "모니터링" }, { href: "/admin/ai-model", label: "모델" }, { href: "/admin/ai-jobs", label: "작업 목록" }] },
  { label: "회원·의견", items: [{ href: "/admin/members", label: "회원" }, { href: "/admin/feedback", label: "사용자 피드백" }] },
  { label: "데이터", items: [{ href: "/admin/legal-refresh", label: "법령 수집·정정" }, { href: "/admin/precedent-collections", label: "판례 수집 검토" }, { href: "/admin/precedent-reviews", label: "판례 연결 재검토" }, { href: "/admin/terms", label: "용어 관리" }, { href: "/admin/collection-schedule", label: "수집·백업 예약" }] },
  { label: "보안·이력", items: [{ href: "/admin/activity", label: "작업 이력" }, { href: "/admin/privacy-retention", label: "개인정보 보관" }] },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  const isOn = (item: { href: string; exact?: boolean }) => (item.exact ? pathname === item.href : pathname.startsWith(item.href));
  const current = groups.find((group) => group.items.some(isOn));
  return <>
    <nav className={styles.tabs} aria-label="관리자 메뉴">
      {groups.map((group) => <Link key={group.label} href={group.items[0].href} aria-current={group === current ? "page" : undefined}>{group.label}</Link>)}
    </nav>
    {current && current.items.length > 1 && <nav className={styles.subTabs} aria-label={current.label + " 메뉴"}>
      {current.items.map((item) => <Link key={item.href} href={item.href} aria-current={isOn(item) ? "page" : undefined}>{item.label}</Link>)}
    </nav>}
  </>;
}
