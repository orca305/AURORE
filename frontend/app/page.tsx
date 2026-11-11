import Link from "next/link";
import { redirect } from "next/navigation";
import { currentMember } from "./_auth/session";
import { SiteHeader } from "./_components/site-header";
import { Conversation } from "./_conversation/conversation";
import { loadChat } from "./_conversation/requests";
import styles from "./_conversation/conversation.module.css";

type Search = Promise<{ q?: string | string[]; offset?: string | string[]; chat?: string | string[] }>;

export default async function Home({ searchParams }: { searchParams: Search }) {
  const { q, offset, chat } = await searchParams;
  if (typeof q === "string" || typeof offset === "string") {
    const query = new URLSearchParams({
      ...(typeof q === "string" ? { q: q.slice(0, 200) } : {}),
      ...(typeof offset === "string" ? { offset } : {}),
    });
    redirect(`/legals?${query}`);
  }

  const member = await currentMember();
  const selected = typeof chat === "string" ? await loadChat(chat) : null;
  return <div className={styles.home}>
    <SiteHeader signedIn={Boolean(member)} active="conversation" />
    <main className={styles.main}>
      {selected?.error ? <div className="empty" role="alert">
        <h1>대화를 열 수 없습니다</h1>
        <p>{selected.error}</p><Link href="/">새 대화 시작</Link>
      </div> : <Conversation key={selected?.data?.id ?? "new"} initialChat={selected?.data ?? null} />}
      <p className={styles.footnote}>임대차 보증금·계약 갱신 예제를 체험할 수 있어요. 실제 개인정보는 입력하지 마세요.</p>
    </main>
  </div>;
}
