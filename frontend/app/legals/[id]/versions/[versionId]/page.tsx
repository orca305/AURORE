import { IconLink } from "../../../../_components/icon-link";
import { ResetSearch } from '../../../../_components/page-actions';
import { parsePageSize } from "../../../../_components/page-size";
import { PageSizeSelect } from "../../../../_components/page-size-select";
import Link from "next/link";
import { SiteHeader } from "../../../../_components/site-header";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { officialUrl } from "../official-source";

const maxOffset = 100000;
type SearchParams = Promise<{ limit?: string | string[]; q?: string | string[]; offset?: string | string[]; asOf?: string | string[] }>;
type Edition = { legalName: string; enfcDt: string | null; sourceUrl: string | null };
type Provision = { id: string; dispNo: string; proviNm: string | null; proviCont: string };

async function readProvisions(path: string, q: string, offset: number, pageSize: number) {
  try {
    const backend = process.env.BACKEND_URL || "http://127.0.0.1:3001";
    const editionUrl = new URL(path, backend);
    const provisionsUrl = new URL(editionUrl.href + "/provisions");
    provisionsUrl.search = new URLSearchParams({ q, limit: String(pageSize + 1), offset: String(offset) }).toString();
    const options = { cache: "no-store" as const, signal: AbortSignal.timeout(5000) };
    const [edition, provisions] = await Promise.all([fetch(editionUrl, options), fetch(provisionsUrl, options)]);
    if (edition.status === 404 || provisions.status === 404) return { status: "missing" as const };
    if (!edition.ok || !provisions.ok) return { status: "unavailable" as const };
    const meta: Edition = await edition.json();
    const rows: unknown = await provisions.json();
    if (typeof meta?.legalName !== "string" || !Array.isArray(rows)) return { status: "unavailable" as const };
    return { status: "ok" as const, meta, rows: rows as Provision[] };
  } catch {
    return { status: "unavailable" as const };
  }
}

async function ProvisionResults({ id, versionId, searchParams }: {
  id: string; versionId: string; searchParams: SearchParams;
}) {
  if ([id, versionId].some(value => !/^[1-9]\d{0,18}$/.test(value) ||
    BigInt(value) > BigInt("9223372036854775807"))) notFound();
  const query = await searchParams;
  const pageSize = parsePageSize(query.limit);
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 200) : "";
  const asOf = typeof query.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.asOf) ? query.asOf : "";
  const rawOffset = typeof query.offset === "string" ? query.offset : "";
  const offset = /^\d{1,6}$/.test(rawOffset) ? Math.min(Number(rawOffset), maxOffset) : 0;
  const versionsPath = `/legals/${id}/versions`;
  const path = `${versionsPath}/${versionId}`;
  // 시행본이 두 개 이상 저장돼 있을 때만 비교 버튼을 보여 준다.
  const canCompare = await fetch(new URL(`/legals/${id}/versions?limit=2`, process.env.BACKEND_URL || "http://127.0.0.1:3001"), { cache: "no-store", signal: AbortSignal.timeout(5000) })
    .then(response => (response.ok ? response.json() : []))
    .then((rows: unknown) => Array.isArray(rows) && rows.length > 1)
    .catch(() => false);
  const pageUrl = (next: number) => `${path}?${new URLSearchParams({ q, asOf, offset: String(next), limit: String(pageSize) })}`;
  const result = await readProvisions(path, q, offset, pageSize);
  if (result.status === "missing") notFound();
  const source = result.status === "ok" ? officialUrl(result.meta.sourceUrl) : null;

  return <>
    <section className="intro">
      <Link className="ui-button icon-button" href={asOf ? `${versionsPath}?${new URLSearchParams({ asOf })}` : versionsPath} aria-label="시행본 목록으로" title="시행본 목록으로"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg></Link>
      <h1>{result.status === "ok" ? result.meta.legalName : "조문 검색"}</h1>
      <p>
        {result.status === "ok" && result.meta.enfcDt && `${result.meta.enfcDt.slice(0, 10)} 시행본 · `}
        조문 번호나 본문 키워드로 검색할 수 있습니다.
      </p>
      <p className="intro-actions">
        {canCompare && <IconLink href={"/legals/"+id+"/compare?beforeVersionId="+versionId} kind="compare" label="다른 시행본과 비교" />}
        {source && <a className="ui-button icon-button" href={source} target="_blank" rel="noopener noreferrer" aria-label="해당 시행본 원문" title="해당 시행본 원문"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></svg></a>}
      </p>
    </section>
    <form className="search" action={path} role="search">
      <label htmlFor="provision-query">조문 번호 또는 키워드</label>
      <input type="hidden" name="limit" value={pageSize} />
      <div className="search-row">
        <input id="provision-query" name="q" defaultValue={q} maxLength={200} placeholder="예시 제6조의2 또는 보증금" />
        {asOf && <input type="hidden" name="asOf" value={asOf} />}
        <button type="submit" data-primary aria-label="검색" title="검색"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.5-4.5" /></svg></button><ResetSearch/>
      </div>
    </form>
    <section aria-labelledby="provision-results" className="results">
      <div className="section-heading">
        <h2 id="provision-results">{q ? `“${q}” 검색 결과` : "저장된 조문과 부칙"}</h2><PageSizeSelect value={pageSize} />
      </div>
      {result.status === "unavailable" ? <p role="status" className="empty">조문을 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.</p>
        : result.rows.length === 0 ? <p className="empty">{q ? "일치하는 조문이 없습니다." : "이 페이지에 표시할 조문이 없습니다."}</p>
        : <ul className="legal-list">
          {result.rows.slice(0, pageSize).map(row => <li key={row.id}>
            <h3>{row.dispNo}{row.proviNm && ` · ${row.proviNm}`}</h3>
            <pre className="provision-text">{row.proviCont}</pre>
          </li>)}
        </ul>}
      {result.status === "ok" && (result.rows.length > 0 || offset > 0) &&
        <nav aria-label="조문 검색 결과 페이지" className="pagination">
          <span className="page-status">{Math.floor(offset / pageSize) + 1} 페이지</span>
          {offset > 0 && <Link href={pageUrl(Math.max(0, offset - pageSize))} aria-label="이전 페이지" title="이전 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></Link>}
          {result.rows.length > pageSize && offset < maxOffset &&
            <Link href={pageUrl(Math.min(maxOffset, offset + pageSize))} aria-label="다음 페이지" title="다음 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></Link>}
        </nav>}
    </section>
  </>;
}

export default async function ProvisionsPage({ params, searchParams }: {
  params: Promise<{ id: string; versionId: string }>; searchParams: SearchParams;
}) {
  const { id, versionId } = await params;
  return <div>
    <SiteHeader active="legals" />
    <main className="shell">
      <Suspense fallback={<p role="status" className="empty">조문을 불러오는 중입니다.</p>}>
        <ProvisionResults id={id} versionId={versionId} searchParams={searchParams} />
      </Suspense>
    </main>
  </div>;
}
