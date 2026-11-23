import { Pagination } from "../_components/pagination";
import { PeriodFields } from "../_components/period-fields";
import { readPeriod } from "../_components/period-read";
import { KindBadge, caseKind } from "../_components/kind-badge";
import { ShortTitle } from '../_components/short-title';
import { ResetSearch } from '../_components/page-actions';
import { BookmarkButton } from '../_bookmarks/bookmark-button';
import { bookmarkStates } from '../_bookmarks/requests';
import { currentMember } from '../_auth/session';
import { parsePageSize } from "../_components/page-size";
import { PageSizeSelect } from "../_components/page-size-select";
import type { Metadata } from "next";
import { SiteHeader } from "../_components/site-header";
import { Suspense } from "react";

export const metadata: Metadata = { title: "판례 검색 | AURORE" };

type SearchParams = Promise<{ limit?: string | string[]; q?: string | string[]; sort?: string | string[]; offset?: string | string[]; from?: string | string[]; to?: string | string[] }>;
type Reference = {
  refKey: string;
  statCd: "VERIFIED" | "UNVERIFIED" | "REVIEW_REQUIRED";
  evidenceDesc: string;
  target: { effectiveDate: string | null; sourceUrl: string | null } | null;
};
type Precedent = {
  id:string;
  sourceKey: string;
  caseNo: string;
  caseNm: string;
  courtNm: string;
  decisionDate: string;
  sourceUrl: string;
  references: Reference[];
  excerpt?: string;
};

const maxOffset = 100000;

function officialUrl(value: string | null) {
  const url = value && URL.parse(value);
  return url && url.protocol === "https:" && url.hostname === "www.law.go.kr" &&
    !url.port && !url.username && !url.password ? url.href : null;
}

async function fetchPrecedentTotal(q: string, from: string, to: string): Promise<number | null> {
  try {
    const url = new URL("/legals/precedents/count", process.env.BACKEND_URL || "http://127.0.0.1:3001");
    url.search = new URLSearchParams({ q, from, to }).toString();
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return data && typeof (data as { total?: unknown }).total === "number" ? (data as { total: number }).total : null;
  } catch {
    return null;
  }
}

async function fetchPrecedents(q: string, offset: number, pageSize: number, sort: string, from: string, to: string): Promise<Precedent[] | null> {
  try {
    const url = new URL("/legals/precedents", process.env.BACKEND_URL || "http://127.0.0.1:3001");
    url.search = new URLSearchParams({ q, sort, from, to, offset: String(offset), limit: String(pageSize + 1) }).toString();
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function PrecedentCard({ row, member, saved }: { row: Precedent; member:boolean; saved:boolean|null }) {
  const source = officialUrl(row.sourceUrl);

  return <li id={`case-${row.sourceKey}`}>
    <div className="legal-title-row"><h3><ShortTitle text={row.caseNm}/>{caseKind(row.caseNo) && <> <KindBadge {...caseKind(row.caseNo)!} /></>}</h3>{member&&<BookmarkButton key={row.id+':'+String(saved)} kind='PREC' id={row.id} saved={saved} title={row.caseNm} compact/>}</div>
    <p>{row.courtNm} · {row.decisionDate} 선고 · {row.caseNo}</p>
    {row.excerpt && <p className="case-excerpt">{row.excerpt}</p>}
    {source && <a className="mt-2 inline-block underline" href={source} target="_blank" rel="noopener noreferrer">판결문 원문</a>}

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
                {source && <a className="ml-2 inline-block underline" href={source} target="_blank" rel="noopener noreferrer">해당 시행본 원문</a>}
              </dd>
            </div>;
          })}
        </dl>}
    </details>
  </li>;
}

async function PrecedentResults({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const sort=params.sort==='oldest'?'oldest':'newest';
  const pageSize = parsePageSize(params.limit);
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 200);
  const rawOffset = typeof params.offset === "string" ? params.offset : "";
  const offset = /^\d{1,6}$/.test(rawOffset) ? Math.min(Number(rawOffset), maxOffset) : 0;
  // params 는 위에서 이미 읽었다
  const from = readPeriod(params.from), to = readPeriod(params.to);
  const [rows, total] = await Promise.all([fetchPrecedents(q, offset, pageSize, sort, from, to), fetchPrecedentTotal(q, from, to)]);
  const member=Boolean(await currentMember());
  const saved=member?await bookmarkStates('PREC',(rows??[]).slice(0,pageSize).map(row=>row.id)):null;
  const pageUrl = (offset: number) => `/precedents?${new URLSearchParams({ q, sort, from, to, offset: String(offset), limit: String(pageSize) })}`;

  return <>
    <form className="search" action="/precedents" role="search">
      <label htmlFor="case-query">판례 제목이나 내용으로 검색</label>
      <input type="hidden" name="limit" value={pageSize} />
      <div className="search-row">
        <input id="case-query" name="q" defaultValue={q} maxLength={200} placeholder="예시 보증금 반환, 계약갱신요구권" />
        <input type="hidden" name="sort" value={sort} /><button type="submit" data-primary aria-label="검색" title="검색"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.5-4.5" /></svg></button><ResetSearch/>
      </div>
      <PeriodFields from={from} to={to} />
    </form>
    <section aria-labelledby="precedent-results" className="results">
      <div className="section-heading">
        <h2 id="precedent-results">{q ? `“${q}” 검색 결과` : "등록된 판례"}</h2><PageSizeSelect value={pageSize} sort={sort} sortBasis="선고일" />
      </div>
      {rows === null ? <p role="status" className="empty">판례를 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.</p>
        : rows.length === 0 ? <p className="empty">
          {q ? "검색 결과가 없습니다. 제목이나 내용의 다른 키워드로 검색해 주세요." : "이 페이지에 표시할 판례가 없습니다."}
        </p>
        : <ul className="legal-list">
          {rows.slice(0, pageSize).map(row => <PrecedentCard key={row.sourceUrl} row={row} member={member} saved={saved?saved.has(row.id):null} />)}
        </ul>}
      {rows !== null && (rows.length > 0 || offset > 0) &&
        <Pagination label="판례 검색 결과 페이지" offset={offset} limit={pageSize} total={total} hasNext={rows.length > pageSize} href={pageUrl} />}
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
