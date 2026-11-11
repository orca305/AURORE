import type { Metadata } from "next";
import { SiteHeader } from "../_components/site-header";
import { Suspense } from "react";

export const metadata: Metadata = { title: "판례 검색 | AURORE" };

type SearchParams = Promise<{ q?: string | string[]; offset?: string | string[] }>;
type Reference = {
  refKey: string;
  statCd: "VERIFIED" | "UNVERIFIED" | "REVIEW_REQUIRED";
  evidenceDesc: string;
  target: { effectiveDate: string | null; sourceUrl: string | null } | null;
};
type Precedent = {
  sourceKey: string;
  caseNo: string;
  caseNm: string;
  courtNm: string;
  decisionDate: string;
  sourceUrl: string;
  references: Reference[];
  excerpt?: string;
};

const pageSize = 20;
const maxOffset = 100000;

function officialUrl(value: string | null) {
  const url = value && URL.parse(value);
  return url && url.protocol === "https:" && url.hostname === "www.law.go.kr" &&
    !url.port && !url.username && !url.password ? url.href : null;
}

async function fetchPrecedents(q: string, offset: number): Promise<Precedent[] | null> {
  try {
    const url = new URL("/legals/precedents", process.env.BACKEND_URL || "http://127.0.0.1:3001");
    url.search = new URLSearchParams({ q, offset: String(offset), limit: String(pageSize + 1) }).toString();
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function PrecedentCard({ row }: { row: Precedent }) {
  const source = officialUrl(row.sourceUrl);

  return <li id={`case-${row.sourceKey}`}>
    <h3>{row.caseNm}</h3>
    <p>{row.courtNm} · {row.decisionDate} 선고 · {row.caseNo}</p>
    {row.excerpt && <p className="case-excerpt">{row.excerpt}</p>}
    {source && <a className="mt-2 inline-block underline" href={source}>판결문 원문</a>}
    <details className="mt-4">
      <summary className="cursor-pointer font-semibold">조문 대조 결과</summary>
      {row.references.length === 0 ? <p className="pt-3">표시할 조문 대조 결과가 없습니다.</p>
        : <dl className="mt-3 grid gap-3">
          {row.references.map(ref => {
            const verified = ref.statCd === "VERIFIED" && ref.target !== null;
            const source = verified ? officialUrl(ref.target?.sourceUrl ?? null) : null;
            const effectiveDate = verified ? ref.target?.effectiveDate : null;
            const label = ref.statCd === "REVIEW_REQUIRED" ? "재검토 필요" :
              verified ? "시행본 확인" : "시행본 미확인";
            return <div key={ref.refKey}>
              <dt className="text-sm font-semibold">
                {ref.refKey} · {label}
              </dt>
              <dd className="mt-1 text-sm">
                {effectiveDate && <span>{effectiveDate} 시행 · </span>}
                {ref.evidenceDesc}
                {source && <a className="ml-2 inline-block underline" href={source}>해당 시행본 원문</a>}
              </dd>
            </div>;
          })}
        </dl>}
    </details>
  </li>;
}

async function PrecedentResults({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 200);
  const rawOffset = typeof params.offset === "string" ? params.offset : "";
  const offset = /^\d{1,6}$/.test(rawOffset) ? Math.min(Number(rawOffset), maxOffset) : 0;
  const rows = await fetchPrecedents(q, offset);
  const pageUrl = (offset: number) => `/precedents?${new URLSearchParams({ q, offset: String(offset) })}`;

  return <>
    <form className="search" action="/precedents" role="search">
      <label htmlFor="case-query">판례 제목이나 내용으로 검색</label>
      <div className="search-row">
        <input id="case-query" name="q" defaultValue={q} maxLength={200} placeholder="예시 보증금 반환, 계약갱신요구권" />
        <button type="submit">검색</button>
      </div>
    </form>
    <section aria-labelledby="precedent-results" className="results">
      <div className="section-heading">
        <h2 id="precedent-results">{q ? `“${q}” 검색 결과` : "등록된 판례"}</h2>
      </div>
      {rows === null ? <p role="status" className="empty">판례를 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.</p>
        : rows.length === 0 ? <p className="empty">
          {q ? "검색 결과가 없습니다. 제목이나 내용의 다른 키워드로 검색해 주세요." : "이 페이지에 표시할 판례가 없습니다."}
        </p>
        : <ul className="legal-list">
          {rows.slice(0, pageSize).map(row => <PrecedentCard key={row.sourceUrl} row={row} />)}
        </ul>}
      {rows !== null && (offset > 0 || rows.length > pageSize) &&
        <nav aria-label="판례 검색 결과 페이지" className="pagination">
          {offset > 0 && <a href={pageUrl(Math.max(0, offset - pageSize))}>← 이전</a>}
          {rows.length > pageSize && offset < maxOffset &&
            <a href={pageUrl(Math.min(maxOffset, offset + pageSize))}>다음 →</a>}
        </nav>}
    </section>
  </>;
}

export default function PrecedentsPage({ searchParams }: { searchParams: SearchParams }) {
  return <div>
    <SiteHeader active="precedents" />
    <main className="shell">
      <section className="intro">
        <h1>판례 검색</h1>
        <p>제목이나 내용의 키워드로 판결문을 찾고, 관련 조문과 원문을 확인하세요.</p>
      </section>
      <Suspense fallback={<p role="status" className="empty">판례를 불러오는 중입니다.</p>}>
        <PrecedentResults searchParams={searchParams} />
      </Suspense>
    </main>
  </div>;
}
