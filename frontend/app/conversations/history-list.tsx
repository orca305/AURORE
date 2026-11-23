"use client";

import { RenameChat } from "../_components/rename-chat";
import { useAppDialog } from "../_components/app-dialog";
import Link from "next/link";
import { useState } from "react";
import { deleteChat, moreChats } from "../_conversation/actions";
import type { ChatList } from "../_conversation/types";

import { shortDate } from "../_components/format-date";

export function HistoryList({ initial, pageSize, filter }: { initial: ChatList; pageSize: number; filter: { q: string; from: string; to: string; sort: string } }) {
  const { confirm, dialog } = useAppDialog();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [pageCursors, setPageCursors] = useState([""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string, revision: number, title: string) {
    if (!(await confirm({ title: "이 대화를 삭제할까요?", message: "「" + title + "」 대화가 목록에서 사라져요.", confirmLabel: "삭제", cancelLabel: "취소", tone: "danger" }))) return;
    setBusy(true);
    try {
      const result = await deleteChat(id, revision);
      setError(result.error);
      if (!result.error) { setItems(previous => previous.filter(row => row.id !== id)); window.dispatchEvent(new Event("aurore:chat-history")); }
      if (result.status === 409) {
        const latest = await moreChats("", pageSize, filter);
        if (latest.data) { setItems(latest.data.items); setCursor(latest.data.nextCursor); setPageCursors([""]); }
      }
    } catch { setError("대화 기록을 처리하지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }

  async function loadPage(direction: "previous" | "next") {
    const target = direction === "next" ? cursor : pageCursors.at(-2);
    if (target === null || target === undefined || busy) return;
    setBusy(true);
    try {
      const result = await moreChats(target, pageSize, filter);
      setError(result.error);
      if (result.data) {
        setItems(result.data.items);
        setCursor(result.data.nextCursor);
        setPageCursors(previous => direction === "next" ? [...previous, target] : previous.slice(0, -1));
      }
    } catch { setError("대화 기록을 불러오지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }

  return <>
    {error && <p role="alert" className="history-error">{error}</p>}
    {items.length === 0 ? <p className="empty">{filter.q || filter.from || filter.to ? "조건에 맞는 대화가 없습니다. 검색어와 기간을 바꿔 보세요. " : "아직 저장된 대화가 없습니다. "}<Link href="/">새 대화를 시작해 보세요.</Link></p>
      : <ul className="legal-list history-list">{items.map(row => <li key={row.id}>
        <div>
          <h3><Link href={"/?chat=" + row.id} prefetch={false}>{row.title}</Link>{row.unreadCorrectionCount > 0 && <span className="correction-unread">미확인 정정 {row.unreadCorrectionCount}개</span>}</h3>
          <p>{shortDate(row.updatedAt)} 수정</p>
          {row.expiresAt && <p>{shortDate(row.expiresAt)}까지 보관</p>}
        </div>
        <div className="history-actions"><RenameChat chat={row} onRenamed={next=>setItems(previous=>previous.map(item=>item.id===next.id?{...item,title:next.title,revision:next.revision,updatedAt:next.updatedAt??item.updatedAt}:item))}/><button type="button" disabled={busy} onClick={() => void remove(row.id, row.revision, row.title)}
          aria-label={row.title + " 대화 삭제"} title="대화 삭제"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6" /></svg></button></div>
      </li>)}</ul>}
    <nav className="pagination" aria-label="대화 목록 페이지">
      <button type="button" disabled={busy || pageCursors.length === 1} onClick={() => void loadPage("previous")} aria-label="이전 페이지" title="이전 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></button>
      <span className="page-status" aria-live="polite">{pageCursors.length} 페이지</span>
      <button type="button" disabled={busy || !cursor} onClick={() => void loadPage("next")} aria-label="다음 페이지" title="다음 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></button>
    </nav>
    {dialog}
  </>;
}
