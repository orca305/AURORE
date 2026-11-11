import Link from "next/link";
import { SiteHeader } from "../../../_components/site-header";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { officialUrl } from "./official-source";

const pageSize = 20;
const maxOffset = 100000;
type SearchParams = Promise<{ asOf?: string | string[]; offset?: string | string[] }>;
type Version = {
  id: string;
  verKey: string;
  enfcDt: string | null;
  prmlDt: string | null;
  sourceUrl: string | null;
};

async function readVersions(id: string, asOf: string, offset: number) {
  try {
    const backend = process.env.BACKEND_URL || "http://127.0.0.1:3001";
    const detailUrl = new URL(`/legals/${id}`, backend);
    const versionsUrl = new URL(detailUrl.href + "/versions");
    versionsUrl.search = new URLSearchParams({
      limit: String(pageSize + 1), offset: String(offset), ...(asOf ? { asOf } : {}),
    }).toString();
    const options = { cache: "no-store" as const, signal: AbortSignal.timeout(5000) };
    const [detail, versions] = await Promise.all([fetch(detailUrl, options), fetch(versionsUrl, options)]);
    if (detail.status === 404) return { status: "missing" as const };
    if (!detail.ok) return { status: "unavailable" as const };
    const law = await detail.json();
    if (typeof law?.legalNm !== "string") return { status: "unavailable" as const };
    if (versions.status === 400) return { status: "invalid" as const, name: law.legalNm };
    if (!versions.ok) return { status: "unavailable" as const };
    const rows: unknown = await versions.json();
    if (!Array.isArray(rows)) return { status: "unavailable" as const };
    return { status: "ok" as const, name: law.legalNm, rows: rows as Version[] };
  } catch {
    return { status: "unavailable" as const };
  }
}

async function VersionResults({ id, searchParams }: { id: string; searchParams: SearchParams }) {
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > BigInt("9223372036854775807")) notFound();
  const query = await searchParams;
  const asOf = typeof query.asOf === "string" ? query.asOf.slice(0, 20) : "";
  const rawOffset = typeof query.offset === "string" ? query.offset : "";
  const offset = /^\d{1,6}$/.test(rawOffset) ? Math.min(Number(rawOffset), maxOffset) : 0;
  const path = `/legals/${id}/versions`;
  const pageUrl = (next: number) => `${path}?${new URLSearchParams({ asOf, offset: String(next) })}`;
  const result = await readVersions(id, asOf, offset);
  if (result.status === "missing") notFound();

  return <>
    <section className="intro">
      <h1>{"name" in result ? result.name : "법령 시행본"}</h1>
      <p>저장된 시행본을 시행일 최신순으로 보여줍니다. 기준일을 입력하면 그날까지 시행된 저장본을 볼 수 있습니다.</p>
    </section>
    <form className="search" action={path} role="search">
      <label htmlFor="edition-date">시행본 조회 기준일</label>
      <div className="search-row">
        <input type="date" id="edition-date" name="asOf" defaultValue={asOf} min="0001-01-01" max="9999-12-31" />
        <button type="submit">조회</button>
      </div>
      {asOf && <Link href={path} className="mt-3 inline-block underline">기준일 지우기</Link>}
    </form>
    <section aria-labelledby="version-results" className="results">
      <div className="section-heading">
        <h2 id="version-results">{asOf ? `${asOf}까지 시행된 저장본` : "저장된 시행본"}</h2>
      </div>
      {result.status === "unavailable" ? <p role="status" className="empty">시행본을 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.</p>
        : result.status === "invalid" ? <p role="status" className="empty">유효한 기준일을 입력해 주세요.</p>
        : result.rows.length === 0 ? <p className="empty">
          {asOf ? "이 기준일까지 시행된 저장본이 없습니다." : "이 페이지에 표시할 시행본이 없습니다."}
        </p> : <ul className="legal-list">
          {result.rows.slice(0, pageSize).map(version => {
            const source = officialUrl(version.sourceUrl);
            return <li key={version.id}>
              <h3>{version.enfcDt ? `${version.enfcDt.slice(0, 10)} 시행` : "시행일 미상"}</h3>
              <p>{version.prmlDt && `${version.prmlDt.slice(0, 10)} 공포 · `}법령키 {version.verKey}</p>
              <Link href={asOf ? `${path}/${version.id}?${new URLSearchParams({ asOf })}` : `${path}/${version.id}`}
                className="mt-2 inline-block underline">조문 보기</Link>
              {source && <a className="ml-4 mt-2 inline-block underline" href={source}>해당 시행본 원문</a>}
            </li>;
          })}
        </ul>}
      {result.status === "ok" && (offset > 0 || result.rows.length > pageSize) &&
        <nav aria-label="시행본 결과 페이지" className="pagination">
          {offset > 0 && <Link href={pageUrl(Math.max(0, offset - pageSize))}>← 이전</Link>}
          {result.rows.length > pageSize && offset < maxOffset &&
            <Link href={pageUrl(Math.min(maxOffset, offset + pageSize))}>다음 →</Link>}
        </nav>}
    </section>
  </>;
}

export default async function LegalVersionsPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: SearchParams;
}) {
  const { id } = await params;
  return <div>
    <SiteHeader active="legals" />
    <main className="shell">
      <Suspense fallback={<p role="status" className="empty">시행본을 불러오는 중입니다.</p>}>
        <VersionResults id={id} searchParams={searchParams} />
      </Suspense>
    </main>
  </div>;
}
