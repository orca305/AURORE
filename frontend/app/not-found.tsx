import Link from "next/link";
import { SiteHeader } from "./_components/site-header";

export const metadata = { title: "페이지를 찾을 수 없어요 | AURORE" };

/** 주소가 틀렸거나 지워진 페이지. 다른 화면과 같은 사이드바와 색으로 안내한다. */
export default function NotFound() {
  return <div>
    <SiteHeader />
    <main className="shell">
      <section className="intro">
        <h1>페이지를 찾을 수 없어요</h1>
        <p>주소가 바뀌었거나 삭제된 페이지일 수 있어요. 아래에서 다시 찾아보세요.</p>
      </section>
      <p style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Link href="/" data-action-link>대화하기 </Link>
        <Link href="/legals" data-action-link>법규 검색 </Link>
        <Link href="/precedents" data-action-link>판례 검색 </Link>
        <Link href="/terms" data-action-link>용어사전 </Link>
      </p>
    </main>
  </div>;
}
