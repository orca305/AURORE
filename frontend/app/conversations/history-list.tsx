"use client";

import Link from "next/link";
import { useState } from "react";
import { deleteChat, moreChats } from "../_conversation/actions";
import type { ChatList } from "../_conversation/types";

const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });

export function HistoryList({ initial }: { initial: ChatList }) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string, revision: number) {
    setBusy(true);
    try {
      const result = await deleteChat(id, revision);
      setError(result.error);
      if (!result.error) { setItems(previous => previous.filter(row => row.id !== id)); window.dispatchEvent(new Event("aurore:chat-history")); }
      if (result.status === 409) {
        const latest = await moreChats("");
        if (latest.data) { setItems(latest.data.items); setCursor(latest.data.nextCursor); }
      }
    } catch { setError("대화 기록을 처리하지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }

  async function more() {
    if (!cursor) return;
    setBusy(true);
    try {
      const result = await moreChats(cursor);
      setError(result.error);
      const page = result.data;
      if (page) {
        setItems(previous => {
          const rows = new Map(previous.map(row => [row.id, row]));
          for (const row of page.items) rows.set(row.id, row);
          return Array.from(rows.values());
        });
        setCursor(page.nextCursor);
      }
    } catch { setError("대화 기록을 처리하지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }

  return <>
    {error && <p role="alert" className="history-error">{error}</p>}
    {items.length === 0 ? <p className="empty">아직 저장된 대화가 없습니다. <Link href="/">새 대화를 시작해 보세요.</Link></p>
      : <ul className="legal-list history-list">{items.map(row => <li key={row.id}>
        <div>
          <h3><Link href={"/?chat=" + row.id} prefetch={false}>{row.title}</Link></h3>
          <p>{dateFormat.format(new Date(row.updatedAt))} 수정</p>
          {row.expiresAt && <p>{dateFormat.format(new Date(row.expiresAt))}까지 보관</p>}
        </div>
        <button type="button" disabled={busy} onClick={() => void remove(row.id, row.revision)}
          aria-label={row.title + " 대화 삭제"}>삭제</button>
      </li>)}</ul>}
    {cursor && <div className="pagination"><button type="button" disabled={busy} onClick={() => void more()}>
      {busy ? "불러오는 중…" : "대화 더 보기"}
    </button></div>}
  </>;
}
