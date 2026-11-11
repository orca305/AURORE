"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { moreChats } from "../_conversation/actions";
import type { ChatList, ChatResult } from "../_conversation/types";
import styles from "./site-header.module.css";

export function SidebarHistory() {
  const pathname = usePathname();
  const [result, setResult] = useState<ChatResult<ChatList> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const details = useRef<HTMLDetailsElement>(null);
  const request = useRef(0);
  useEffect(() => {
    try { details.current!.open = (sessionStorage.getItem("aurore_history_open") ?? String(matchMedia("(min-width: 801px)").matches)) === "true"; }
    catch { details.current!.open = matchMedia("(min-width: 801px)").matches; }
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => startTransition(async () => {
      const sequence = ++request.current;
      const next = await moreChats("").catch(() => ({ data: null, status: 503, error: "대화 기록을 불러오지 못했습니다." }));
      if (!active || request.current !== sequence) return;
      setResult(next);
      setSelected(pathname === "/" ? new URLSearchParams(window.location.search).get("chat") : null);
    });
    refresh();
    window.addEventListener("aurore:chat-history", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("popstate", refresh);
    return () => { active = false; window.removeEventListener("aurore:chat-history", refresh); window.removeEventListener("focus", refresh); window.removeEventListener("popstate", refresh); };
  }, [pathname]);
  return <details ref={details} className={styles.history} onToggle={event => {
    try { sessionStorage.setItem("aurore_history_open", String(event.currentTarget.open)); } catch { /* Storage can be disabled. */ }
  }}>
    <summary><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3h12v15H8zM4 7v14h12M11 7h6M11 11h6M11 15h3" /></svg><span>대화 기록</span><span className={styles.chevron} aria-hidden="true">⌄</span></summary>
    <div className={styles.historyBody}>
      {!result ? <p role="status">불러오는 중…</p> : result.error ? <><p role="status">{result.error}</p><button type="button" disabled={pending} onClick={() => window.dispatchEvent(new Event("aurore:chat-history"))}>다시 불러오기</button></> : <>
        {!result.data?.items.length && <p>아직 대화 기록이 없습니다.</p>}
        <ul>{result.data?.items.slice(0, 10).map(row => <li key={row.id}><Link href={"/?chat=" + row.id} prefetch={false} title={row.title} aria-current={selected === row.id ? "page" : undefined} onClick={() => { setSelected(row.id); if (matchMedia("(max-width: 800px)").matches && details.current) details.current.open = false; }}>{row.title}</Link></li>)}</ul>
      </>}
      <Link href="/conversations" prefetch={false} className={styles.allHistory} onClick={() => { if (matchMedia("(max-width: 800px)").matches && details.current) details.current.open = false; }}>전체 기록 보기 ↗</Link>
    </div>
  </details>;
}
