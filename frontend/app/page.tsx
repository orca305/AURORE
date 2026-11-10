import Link from "next/link";
import { redirect } from "next/navigation";
import { askConversation } from "./_conversation/answer";
import { AuroreMark } from "./_conversation/aurore-mark";
import { Conversation } from "./_conversation/conversation";
import styles from "./_conversation/conversation.module.css";

type Search = Promise<{ q?: string | string[]; offset?: string | string[] }>;

export default async function Home({ searchParams }: { searchParams: Search }) {
  const { q, offset } = await searchParams;
  if (typeof q === "string" || typeof offset === "string") {
    const query = new URLSearchParams({
      ...(typeof q === "string" ? { q: q.slice(0, 200) } : {}),
      ...(typeof offset === "string" ? { offset } : {}),
    });
    redirect(`/legals?${query}`);
  }

  return <div className={styles.home}>
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.brand} aria-label="AURORE 홈">
          <span className={styles.brandMark}><AuroreMark /></span>
          <span>AURORE<span className={styles.brandKorean}>오로르</span></span>
        </Link>
        <nav aria-label="자료 검색" className={styles.nav}>
          <Link href="/legals">법규 검색</Link>
          <Link href="/precedents">판례 검색</Link>
        </nav>
      </div>
    </header>
    <main className={styles.main}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}><span /> 법률 대화</p>
        <h1>무슨 일이 있었나요?</h1>
        <p className={styles.lead}>상황을 이야기하면 필요한 사실을 함께 확인하고,<br className={styles.desktopBreak} />{" "}
          답변에 쓰인 법령과 판례를 보여드려요.</p>
      </section>
      <Conversation ask={askConversation} />
      <p className={styles.footnote}>임대차 예제로 체험할 수 있어요. 실제 개인정보는 입력하지 마세요.</p>
    </main>
  </div>;
}
