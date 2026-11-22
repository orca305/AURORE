"use client";

import { RenameChat } from "./rename-chat";
import { useUiPreferences } from "./ui-preferences";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteChat, moreChats, pinChat } from "../_conversation/actions";
import type { ChatList, ChatResult } from "../_conversation/types";
import styles from "./site-header.module.css";

export function SidebarHistory() {
  const pathname = usePathname();
  const router = useRouter();
  const preferences = useUiPreferences();
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
      const next = await moreChats("", 10).catch(() => ({ data: null, status: 503, error: "대화 기록을 불러오지 못했습니다." }));
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
    <summary aria-label="최근 대화" title="최근 대화" onClick={event => { if (preferences.collapsed) { event.preventDefault(); preferences.toggleSidebar(); if (details.current) details.current.open = true; } }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7M3 4v4h4" /></svg><span>최근 대화</span><span className={styles.chevron} aria-hidden="true">⌄</span></summary>
    <div className={styles.historyBody}>
      {!result ? <p role="status">불러오는 중…</p> : result.error ? <><p role="status">{result.error}</p><button type="button" disabled={pending} onClick={() => window.dispatchEvent(new Event("aurore:chat-history"))}>다시 불러오기</button></> : <>
        {!result.data?.items.length && <p>아직 대화 기록이 없습니다.</p>}
        <ul>{result.data?.items.slice(0, 10).map(row => <li key={row.id}><Link href={"/?chat=" + row.id} prefetch={false} title={row.title} aria-current={selected === row.id ? "page" : undefined} onClick={() => { setSelected(row.id); if (matchMedia("(max-width: 800px)").matches && details.current) details.current.open = false; }}><span className={styles.historyTitle}>{row.title}</span>{row.unreadCorrectionCount > 0 && <span className={styles.unread} aria-label={"미확인 정정 " + row.unreadCorrectionCount + "개"}>{row.unreadCorrectionCount}</span>}</Link><button type="button" className={row.pinned ? styles.pinOn : undefined} title={row.pinned ? "고정 해제" : "상단 고정"} aria-label={row.title + (row.pinned ? " 고정 해제" : " 상단 고정")} aria-pressed={Boolean(row.pinned)} disabled={pending} onClick={() => startTransition(async () => { const done = await pinChat(row.id, !row.pinned).catch(() => null); if (done && !done.error) window.dispatchEvent(new Event("aurore:chat-history")); else window.alert(done?.error ?? "고정하지 못했어요. 다시 시도해 주세요."); })}><svg width="16" height="16" viewBox="0 0 24 24" fill={row.pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 14v7" /></svg></button><RenameChat chat={row}/><button type="button" title="삭제" aria-label={row.title + " 삭제"} disabled={pending} onClick={() => { if (!confirm("이 대화를 삭제할까요? 삭제하면 목록에서 사라져요.")) return; startTransition(async () => { const done = await deleteChat(row.id, row.revision).catch(() => null); if (done && !done.error) { if (selected === row.id) router.push("/"); else window.dispatchEvent(new Event("aurore:chat-history")); } else window.alert("삭제하지 못했어요. 다시 시도해 주세요."); }); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg></button></li>)}</ul>
      </>}
      <Link href="/conversations" prefetch={false} className={styles.allHistory} onClick={() => { if (matchMedia("(max-width: 800px)").matches && details.current) details.current.open = false; }} data-action-link>전체 기록 보기 </Link>
    </div>
  </details>;
}
