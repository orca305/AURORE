import Link from "next/link";
import { redirect } from "next/navigation";
import { askConversation } from "./_conversation/answer";
import { Conversation } from "./_conversation/conversation";

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

  return <div className="shell">
    <header className="site-header">
      <Link href="/" className="brand" aria-label="AURORE 홈">AURORE<span>법을 이해하는 시작</span></Link>
      <nav aria-label="자료 검색" className="header-note flex gap-4">
        <Link href="/legals" className="underline">법규 검색</Link>
        <Link href="/precedents" className="underline">판례 검색</Link>
      </nav>
    </header>
    <main className="mx-auto max-w-3xl pb-16">
      <section className="intro">
        <h1>무슨 일이 있었나요?</h1>
        <p>상황을 이야기하면 필요한 내용을 되묻고, 확인한 법령과 판례를 답변에 붙입니다.</p>
        <p className="mt-2 text-sm">지금은 아래 임대차 예제를 체험할 수 있습니다. 실제 개인정보는 입력하지 마세요.</p>
      </section>
      <Conversation ask={askConversation} />
    </main>
  </div>;
}
