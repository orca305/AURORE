import { KindBadge, legalKind } from "../_components/kind-badge";
import { ShortTitle } from '../_components/short-title';
import { SortSelect } from '../_components/sort-select';
import { ResetSearch } from '../_components/page-actions';
import { BookmarkButton } from '../_bookmarks/bookmark-button';
import { bookmarkStates } from '../_bookmarks/requests';
import { currentMember } from '../_auth/session';
import { parsePageSize } from "../_components/page-size";
import { PageSizeSelect } from "../_components/page-size-select";
import { Suspense } from "react";
import Link from "next/link";
import { SiteHeader } from "../_components/site-header";

type Legal = { id: string; srcCd: string; srcKey: string; legalNm: string };
type Search = Promise<{ limit?: string | string[]; q?: string | string[]; sort?: string | string[]; offset?: string | string[] }>;

async function LegalResults({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const sort=params.sort==='oldest'?'oldest':'newest';
  const pageSize = parsePageSize(params.limit);
  const q = (typeof params.q === "string" ? params.q : "").slice(0, 200);
  const offsetValue = typeof params.offset === "string" ? params.offset : "0";
  const offset = /^\d{1,6}$/.test(offsetValue) ? Math.min(Number(offsetValue), 100000) : 0;
  let rows: Legal[] = [];
  let unavailable = false;
  try {
    const url = new URL("/legals", process.env.BACKEND_URL || "http://127.0.0.1:3001");
    url.search = new URLSearchParams({ q, sort, offset: String(offset), limit: String(pageSize + 1) }).toString();
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
  const member=await currentMember();
  const saved=member?await bookmarkStates('LEGAL',rows.slice(0,pageSize).map(row=>row.id)):null;
  const pageUrl = (next: number) => `/legals?${new URLSearchParams({ q, sort, offset: String(next), limit: String(pageSize) })}`;

  return <>
    <form className="search" action="/legals" role="search">
      <label htmlFor="legal-query">법규 이름으로 검색</label>
      <input type="hidden" name="limit" value={pageSize} />
      <div className="search-row">
        <input id="legal-query" name="q" defaultValue={q} maxLength={200} placeholder="찾고 싶은 법규 이름을 입력하세요" />
        <SortSelect value={sort} basis="등록일"/><button type="submit" data-primary aria-label="검색" title="검색"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.5-4.5" /></svg></button><ResetSearch/>
      </div>
    </form>
    <section aria-labelledby="results-title" className="results">
      <div className="section-heading"><h2 id="results-title">{q ? `“${q}” 검색 결과` : "등록된 법규"}</h2><PageSizeSelect value={pageSize} /></div>
      {unavailable ? <p role="status" className="empty">법규 목록을 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.</p>
        : rows.length === 0 ? <p className="empty">{q ? "검색 결과가 없습니다. 다른 이름으로 검색해 보세요." : "아직 등록된 법규가 없습니다."}</p>
        : <ul className="legal-list">{rows.slice(0, pageSize).map(row => <li key={row.id}>
          <div className="legal-title-row"><h3><ShortTitle text={row.legalNm}/> <KindBadge {...legalKind(row.legalNm)} /></h3>{member&&<BookmarkButton key={row.id+':'+String(saved?.has(row.id))} kind='LEGAL' id={row.id} saved={saved?saved.has(row.id):null} title={row.legalNm} compact/>}</div><p>출처 {row.srcCd} · {row.srcKey}</p>
          <Link href={`/legals/${row.id}/versions`} className="mt-2 inline-block underline">
            시행본 조회<span className="sr-only"> · {row.legalNm}</span>
          </Link>

        </li>)}</ul>}
      {!unavailable && <nav aria-label="검색 결과 페이지" className="pagination">
        <span className="page-status">{Math.floor(offset / pageSize) + 1} 페이지</span>
        {offset > 0 && <a href={pageUrl(Math.max(0, offset - pageSize))}>← 이전</a>}
        {rows.length > pageSize && offset < 100000 && <a href={pageUrl(Math.min(100000, offset + pageSize))}>다음 →</a>}
      </nav>}
    </section>
  </>;
}

export default function LegalSearchPage({ searchParams }: { searchParams: Search }) {
  return <div>
    <SiteHeader active="legals" />
    <main className="shell">
      <section className="intro"><h1>법규 검색</h1><p>법규 이름으로 저장된 시행본과 조문을 찾아볼 수 있습니다.</p></section>
      <Suspense fallback={<p role="status" className="empty">법규 목록을 불러오는 중입니다.</p>}><LegalResults searchParams={searchParams} /></Suspense>
    </main>
    <footer className="shell">AURORE · 법규 원문을 바탕으로 한 이해</footer>
  </div>;
}
