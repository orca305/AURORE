import { PeriodFields } from "../_components/period-fields";
import { readPeriod } from "../_components/period-read";
import { SortSelect } from '../_components/sort-select';
import { ResetSearch } from '../_components/page-actions';
import Link from "next/link";
import { requestCase } from "../_cases/requests";
import type { CaseList } from "../_cases/types";
import { parsePageSize } from "../_components/page-size";
import { PageSizeSelect } from "../_components/page-size-select";
import { date, number } from "../_admin/format";
import styles from "./page.module.css";
export const metadata = { title: "나의 사건 | AURORE" };
export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams,
    q = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "",
    limit = parsePageSize(params.limit),
    raw = typeof params.offset === "string" ? params.offset : "0",
    offset = /^\d{1,6}$/.test(raw) ? Math.min(Number(raw), 100000) : 0;
  const sort=params.sort==='oldest'?'oldest':'newest';
  const from = readPeriod(params.from), to = readPeriod(params.to);
  const query = new URLSearchParams({
      sort,
      q,
      from,
      to,
      limit: String(limit),
      offset: String(offset),
    }),
    response = await requestCase("?" + query),
    data = response?.ok ? ((await response.json()) as CaseList) : null;
  const url = (next: number) => {
    const value = new URLSearchParams(query);
    value.set("offset", String(next));
    return "/cases?" + value;
  };
  return (
    <>
      <section className="intro">
        <h1>나의 사건</h1>
        <p>
          확인한 사실을 정리하고 변경 내용을 기록합니다. 저장한 사건은 본인만 볼
          수 있습니다.
        </p>
      </section>
      {params.removed === "1" && (
        <p role="status" className={styles.notice}>
          사건과 포함된 사실관계를 목록에서 삭제했습니다.
        </p>
      )}
      <form action="/cases" className="search" role="search">
        <label htmlFor="case-query">사건 제목으로 검색</label>
        <input type="hidden" name="limit" value={limit} />
        <div className="search-row">
          <input
            id="case-query"
            name="q"
            defaultValue={q}
            maxLength={200}
            placeholder="사건 제목을 입력하세요"
          />
          <SortSelect value={sort} basis="수정일"/><button type="submit" data-primary aria-label="검색" title="검색"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.5-4.5" /></svg></button><ResetSearch/>
        </div>
        <PeriodFields from={from} to={to} />
      </form>
      <section className="results">
        <div className="section-heading">
          <h2>
            나의 사건 {data && <span>{number.format(data.total)}개</span>}
          </h2>
          <div className="list-tools">
            <PageSizeSelect value={limit} />
            <Link href="/cases/new" data-action-link>사건 등록 </Link>
          </div>
        </div>
        {!data ? (
          <p role="alert" className="empty">
            사건 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </p>
        ) : (
          <>
            <ul className="legal-list">
              {data.items.map((row) => (
                <li key={row.id}>
                  <h3>
                    <Link href={"/cases/" + row.id + "?limit=" + limit}>
                      {row.title}
                    </Link>
                  </h3>
                  <p>
                    {row.typeName} · 사실관계 {row.factCount}개 ·{" "}
                    {date(row.updatedAt)} 수정
                  </p>
                </li>
              ))}
            </ul>
            {!data.items.length && (
              <p className="empty">
                {q
                  ? "검색 조건에 맞는 사건이 없습니다."
                  : "아직 등록된 사건이 없습니다. 사건을 등록하고 확인한 사실을 정리해 보세요."}
              </p>
            )}
            <nav className="pagination" aria-label="사건 목록 페이지">
              {offset > 0 && (
                <Link href={url(Math.max(0, offset - limit))}>← 이전</Link>
              )}
              <span className="page-status">
                {Math.floor(offset / limit) + 1} 페이지
              </span>
              {data.nextOffset !== null && (
                <Link href={url(data.nextOffset)}>다음 →</Link>
              )}
            </nav>
          </>
        )}
      </section>
    </>
  );
}
