import Link from "next/link";
import { requestTerms } from "../../_terms/requests";
import type { TermList } from "../../_terms/types";
import { PageSizeSelect } from "../../_components/page-size-select";
import { parsePageSize } from "../../_components/page-size";
import { SortSelect } from "../../_components/sort-select";
import { ResetSearch } from "../../_components/page-actions";
import { date } from "../../_admin/format";
import styles from "../../_terms/terms.module.css";
export const metadata = { title: "용어사전 관리 | AURORE" };
export default async function AdminTerms({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams,
    q = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "",
    state =
      typeof params.state === "string" &&
      ["DRAFT", "PUBLISHED", "DELETED"].includes(params.state)
        ? params.state
        : "ALL",
    sort = params.sort === "oldest" ? "oldest" : "newest",
    limit = parsePageSize(params.limit),
    raw = typeof params.offset === "string" ? params.offset : "0",
    offset = /^\d{1,6}$/.test(raw) ? Math.min(Number(raw), 100000) : 0;
  const query = new URLSearchParams({
      q,
      state,
      sort,
      limit: String(limit),
      offset: String(offset),
    }),
    response = await requestTerms("?" + query, true),
    data = response?.ok ? ((await response.json()) as TermList) : null;
  const page = (n: number) => {
    const p = new URLSearchParams(query);
    p.set("offset", String(n));
    return "/admin/terms?" + p;
  };
  return (
    <>
      <div className="section-heading">
        <h2>용어사전 관리</h2>
        <Link href="/admin/terms/import" className="ui-button">법제처에서 가져오기</Link>
        <Link href="/admin/terms/new" className="ui-button">
          용어 등록
        </Link>
      </div>
      <p className={styles.help}>
        법제처에서 정의와 출처를 가져온 뒤 검토해 공개합니다. 수집·수정·공개·삭제 이력을
        보관합니다.
      </p>
      {params.saved === "1" && (
        <p className={styles.notice} role="status">
          처리 결과를 반영했습니다.
        </p>
      )}
      <form className="search" action="/admin/terms" role="search">
        <label htmlFor="admin-term-query">용어·동의어·설명 검색</label>
        <input type="hidden" name="limit" value={limit} />
        <div className="search-row">
          <select name="state" defaultValue={state} aria-label="용어 상태">
            <option value="ALL">전체</option>
            <option value="DRAFT">임시 저장</option>
            <option value="PUBLISHED">공개</option>
            <option value="DELETED">삭제</option>
          </select>
          <input
            id="admin-term-query"
            name="q"
            defaultValue={q}
            maxLength={200}
          />
          <SortSelect value={sort} basis="변경일" />
          <button type="submit" data-primary>
            검색
          </button>
          <ResetSearch />
        </div>
      </form>
      <section className="results">
        <div className="section-heading">
          <h2>관리 용어{data ? ` · ${data.total}개` : ""}</h2>
          <PageSizeSelect value={limit} />
        </div>
        {!data ? (
          <p role="status" className="empty">
            용어를 불러오지 못했습니다.
          </p>
        ) : !data.items.length ? (
          <p className="empty">표시할 용어가 없습니다.</p>
        ) : (
          <ul className={styles.list}>
            {data.items.map((row) => (
              <li key={row.id}>
                <h3>
                  <Link href={"/admin/terms/" + row.id}>{row.termName}</Link>
                </h3>
                <p>{row.sourceName}{row.sourceReference ? " · "+row.sourceReference : ""}</p>
                <div className={styles.meta}>
                  <span>
                    {row.deleted
                      ? "삭제"
                      : row.state === "PUBLISHED"
                        ? "공개"
                        : "임시 저장"}{" "}
                    · 버전 {row.revision}
                  </span>
                  <span>{date(row.updatedAt)} 변경</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && (
          <nav className="pagination" aria-label="관리 용어 페이지">
            {offset > 0 && (
              <Link href={page(Math.max(0, offset - limit))}>← 이전</Link>
            )}
            <span className="page-status">
              {Math.floor(offset / limit) + 1} 페이지
            </span>
            {data.nextOffset !== null && (
              <Link href={page(data.nextOffset)}>다음 →</Link>
            )}
          </nav>
        )}
      </section>
    </>
  );
}
