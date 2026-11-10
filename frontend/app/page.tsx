import { Suspense } from "react";
import Link from "next/link";

type Legal = { id: string; srcCd: string; srcKey: string; legalNm: string };
type Search = Promise<{ q?: string | string[]; offset?: string | string[] }>;

async function LegalResults({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").slice(0, 200);
  const offsetValue = typeof params.offset === "string" ? params.offset : "0";
  const offset = /^\d{1,6}$/.test(offsetValue) ? Math.min(Number(offsetValue), 100000) : 0;
  let rows: Legal[] = [];
  let unavailable = false;
  try {
    const url = new URL("/legals", process.env.BACKEND_URL || "http://127.0.0.1:3001");
    url.search = new URLSearchParams({ q, offset: String(offset), limit: "20" }).toString();
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("법규 목록 조회 실패");
    const data: unknown = await response.json();
    if (!Array.isArray(data) || !data.every(row => row && typeof row.id === "string" && typeof row.legalNm === "string" && typeof row.srcCd === "string" && typeof row.srcKey === "string")) {
      throw new Error("법규 목록 응답 형식 오류");
    }
    rows = data;
  } catch {
    unavailable = true;
  }
  const pageUrl = (next: number) => `/?${new URLSearchParams({ q, offset: String(next) })}`;

  return <>
    <form className="search" action="/" role="search">
      <label htmlFor="legal-query">법규 이름으로 검색</label>
      <div className="search-row">
        <input id="legal-query" name="q" defaultValue={q} maxLength={200} placeholder="찾고 싶은 법규 이름을 입력하세요" />
        <button type="submit">검색</button>
      </div>
    </form>
    <section aria-labelledby="results-title" className="results">
      <div className="section-heading"><h2 id="results-title">{q ? `“${q}” 검색 결과` : "등록된 법규"}</h2><span>원문을 향한 첫걸음</span></div>
      {unavailable ? <p role="status" className="empty">법규 목록을 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.</p>
        : rows.length === 0 ? <p className="empty">{q ? "검색 결과가 없습니다. 다른 이름으로 검색해 보세요." : "아직 등록된 법규가 없습니다."}</p>
        : <ul className="legal-list">{rows.map(row => <li key={row.id}>
          <h3>{row.legalNm}</h3><p>출처 {row.srcCd} · {row.srcKey}</p>
          <Link href={`/legals/${row.id}/versions`} className="mt-2 inline-block underline">
            시행본 조회<span className="sr-only"> · {row.legalNm}</span>
          </Link>
        </li>)}</ul>}
      {!unavailable && <nav aria-label="검색 결과 페이지" className="pagination">
        {offset > 0 && <a href={pageUrl(Math.max(0, offset - 20))}>← 이전</a>}
        {rows.length === 20 && offset < 100000 && <a href={pageUrl(Math.min(100000, offset + 20))}>다음 →</a>}
      </nav>}
    </section>
  </>;
}

export default function Home({ searchParams }: { searchParams: Search }) {
  return <div className="shell">
    <header className="site-header">
      <Link href="/" className="brand" aria-label="AURORE 홈">AURORE<span>법을 이해하는 시작</span></Link>
      <nav aria-label="검색 메뉴" className="header-note flex gap-4">
        <span aria-current="page">법규 검색</span>
        <Link href="/precedents" className="underline">판례 검색</Link>
      </nav>
    </header>
    <main>
      <section className="intro"><p className="eyebrow">A CLEARER UNDERSTANDING</p><h1>법을 이해하는<br />새로운 시작.</h1><p>궁금한 법규를 찾아보세요.<br />복잡한 법률을 이해하는 여정을 AURORE와 함께합니다.</p></section>
      <Suspense fallback={<p role="status" className="empty">법규 목록을 불러오는 중입니다.</p>}><LegalResults searchParams={searchParams} /></Suspense>
    </main>
    <footer>AURORE · 법규 원문을 바탕으로 한 이해</footer>
  </div>;
}
