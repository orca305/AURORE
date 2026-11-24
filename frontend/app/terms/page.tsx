import { Pagination } from "../_components/pagination";
import { IconLink } from "../_components/icon-link";
import Link from "next/link";
import { PageSizeSelect } from "../_components/page-size-select";
import { parsePageSize } from "../_components/page-size";
import { ResetSearch } from "../_components/page-actions";
import { ShortTitle } from "../_components/short-title";
import { requestTerms } from "../_terms/requests";
import type { TermList } from "../_terms/types";
import styles from "../_terms/terms.module.css";
export const metadata = { title: "용어사전 | AURORE" };
export default async function Terms({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams,
    q = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "",
    sort = params.sort === "oldest" ? "oldest" : "newest",
    limit = parsePageSize(params.limit),
    raw = typeof params.offset === "string" ? params.offset : "0",
    offset = /^\d{1,6}$/.test(raw) ? Math.min(Number(raw), 100000) : 0;
  const query = new URLSearchParams({
      q,
      sort,
      limit: String(limit),
      offset: String(offset),
    }),
    response = await requestTerms("?" + query),
    data = response?.ok ? ((await response.json()) as TermList) : null;
  const page = (n: number) => {
    const p = new URLSearchParams(query);
    p.set("offset", String(n));
    return "/terms?" + p;
  };
  return (
    <>
      
      <main className="shell">
        <section className="intro">
          <h1>용어사전</h1>
          <p>
            출처의 정의와 쉬운 풀이를 구분해 살펴보세요. 검토 후 공개한 용어를
            제공합니다.
          </p>
        </section>
        <form className="search" action="/terms" role="search">
          <label htmlFor="term-query">용어·동의어·설명 검색</label>
          <input type="hidden" name="limit" value={limit} />
          <div className="search-row">
            <input
              id="term-query"
              name="q"
              defaultValue={q}
              maxLength={200}
              placeholder="궁금한 법률용어를 입력하세요"
            />
            <input type="hidden" name="sort" value={sort} />
            <button type="submit" data-primary aria-label="검색" title="검색"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.5-4.5" /></svg></button>
            <ResetSearch />
          </div>
        </form>
        <section className="results">
          <div className="section-heading">
            <h2>
              {q ? "검색 결과" : "등록된 용어"}
              {data ? ` · ${data.total}개` : ""}
            </h2>
            <PageSizeSelect value={limit} sort={sort} sortBasis="사전 변경일" />
          </div>
          {!data ? (
            <p className="empty" role="status">
              용어를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.
            </p>
          ) : !data.items.length ? (
            <p className="empty">
              {q
                ? "검색 결과가 없습니다. 다른 용어나 동의어로 검색해 보세요."
                : "아직 검토 후 공개한 용어가 없습니다."}
            </p>
          ) : (
            <ul className={styles.list}>
              {data.items.map((row) => (
                <li key={row.id}>
                  <h3>
                    <Link href={"/terms/" + row.id}>
                      <ShortTitle text={row.termName} />
                    </Link>
                  </h3>
                  {row.aliases.length > 0 && (
                    <div className={styles.aliases}>
                      동의어·약어 · {row.aliases.join(" · ")}
                    </div>
                  )}
                  <p>
                    {row.definition}
                    {row.definition.length === 240 ? "…" : ""}
                  </p>
                  <div className={styles.meta}>
                    <span>{row.sourceName}{row.sourceReference ? " · "+row.sourceReference : ""}</span>
                    <IconLink href={"/terms/" + row.id} kind="eye" label="정의와 풀이 보기" />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data && (
            <Pagination label="용어 검색 페이지" offset={offset} limit={limit} total={data.total} hasNext={data.nextOffset !== null} href={page} />
          )}
        </section>
      </main>
    </>
  );
}
