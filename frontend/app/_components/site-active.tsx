"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

export type ActiveKey = "conversation" | "account" | "legals" | "precedents" | "history" | "cases" | "bookmarks" | "notifications" | "terms" | "admin";

const prefixes: [string, ActiveKey][] = [
  ["/conversations", "history"],
  ["/cases", "cases"],
  ["/bookmarks", "bookmarks"],
  ["/terms", "terms"],
  ["/legals", "legals"],
  ["/precedents", "precedents"],
  ["/admin", "admin"],
  ["/account", "account"],
  ["/notifications", "notifications"],
];

/** 주소로 지금 보고 있는 메뉴를 알아낸다. 사이드바가 화면 이동 때 다시 만들어지지 않도록, 메뉴 표시는 페이지가 아니라 주소로 정한다. */
export function useActiveKey(): ActiveKey | undefined {
  const pathname = usePathname() ?? "/";
  if (pathname === "/") return "conversation";
  return prefixes.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/"))?.[1];
}

export function NavLink({ k, ...props }: ComponentProps<typeof Link> & { k: ActiveKey }) {
  const active = useActiveKey() === k;
  return <Link {...props} aria-current={active ? "page" : undefined} />;
}

/** 사이드바·상단 바는 접속 코드 화면에서는 보이지 않는다. */
export function ChromeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  if (["/gate"].some((path) => pathname === path || pathname.startsWith(path + "/"))) return null;
  return <>{children}</>;
}
