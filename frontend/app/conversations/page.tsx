import Link from "next/link";
import { SiteHeader } from "../_components/site-header";
import { loadChatList } from "../_conversation/requests";
import { HistoryList } from "./history-list";

export const metadata = { title: "대화 기록 | AURORE" };

export default async function ConversationsPage() {
  const result = await loadChatList();
  return <div>
    <SiteHeader active="history" />
    <main className="shell">
      <section className="intro">
        <h1>대화 기록</h1>
        <p>회원 기록은 계정으로, 비회원 기록은 현재 브라우저의 인증으로 확인합니다. 비회원 대화는 생성일부터 1개월 보관합니다.</p>
      </section>
      <div className="section-heading">
        <h2>나의 대화</h2><Link href="/">새 대화 ↗</Link>
      </div>
      <section className="results">
        {result.data ? <HistoryList initial={result.data} />
          : <p role="alert" className="empty">{result.error}</p>}
      </section>
    </main>
  </div>;
}
