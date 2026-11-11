import { requestAdmin } from "../_admin/requests";
import { SidebarHistory } from "./sidebar-history";
import Image from "next/image";
import Link from "next/link";
import { currentMember } from "../_auth/session";
import styles from "./site-header.module.css";

const menu = [
  { key: "conversation", href: "/", label: "대화하기", path: "M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0ZM7 10h8M7 14h5" },
  { key: "history", href: "/conversations", label: "대화 기록", path: "M8 3h12v15H8zM4 7v14h12M11 7h6M11 11h6M11 15h3" },
  { key: "legals", href: "/legals", label: "법규 검색", path: "M12 5v15M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z" },
  { key: "precedents", href: "/precedents", label: "판례 검색", path: "m3 7 9-4 9 4H3ZM5 10v7M10 10v7M14 10v7M19 10v7M3 20h18" },
] as const;

export async function SiteHeader({ signedIn, active, adminAccess }: {
  adminAccess?: boolean;
  signedIn?: boolean;
  active?: "conversation" | "account" | "legals" | "precedents" | "history" | "admin";
}) {
  const member = await currentMember();
  const hasAccount = signedIn ?? Boolean(member);
  const isAdmin = adminAccess ?? (hasAccount && Boolean((await requestAdmin("session"))?.ok));
  return <>
    <aside className={styles.sidebar} aria-label="서비스 탐색">
      <Link href="/" className={styles.brand} aria-label="AURORE 홈">
        <Image src="/aurore-mark.png" alt="" width={40} height={40} className={styles.mark} />
        <span>AURORE</span>
      </Link>
      <nav aria-label="주 메뉴" className={styles.nav}>
        {menu.map(item => item.key === "history" ? <SidebarHistory key={member?.loginId ?? "guest"} /> : <Link key={item.key} href={item.href} aria-current={active === item.key ? "page" : undefined}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.path} /></svg>
          <span>{item.label}</span>
        </Link>)}
        {isAdmin && <Link href="/admin" aria-current={active === "admin" ? "page" : undefined}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" /></svg><span>운영 관리</span>
        </Link>}
      </nav>
    </aside>
    <header className={styles.header} data-site-navigation>
      <Link href={hasAccount ? "/account" : "/login"} className={styles.account}
        aria-current={active === "account" ? "page" : undefined}>
        {hasAccount ? "내 계정" : "로그인"}
      </Link>
    </header>
  </>;
}