import { ResetSearch } from "../_components/page-actions";
import { IconLink } from "../_components/icon-link";
import { PageSizeSelect } from "../_components/page-size-select";
import { parsePageSize } from "../_components/page-size";
import { PeriodFields } from "../_components/period-fields";
import { readPeriod } from "../_components/period-read";
import Link from "next/link";
import { SiteHeader } from "../_components/site-header";
import { loadChatList } from "../_conversation/requests";
import { HistoryList } from "./history-list";

export const metadata = { title: "대화 기록 | AURORE" };

type Params = { limit?: string | string[]; sort?: string | string[]; q?: string | string[]; from?: string | string[]; to?: string | string[] };

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const pageSize = parsePageSize(params.limit);
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 200);
  const from = readPeriod(params.from), to = readPeriod(params.to);
  const sort = params.sort === "oldest" ? "oldest" : "newest";
  const result = await loadChatList(undefined, pageSize, { q, from, to, sort });
  return <div>
    <SiteHeader active="history" />
    <main className="shell">
      <section className="intro">
        <h1>대화 기록</h1>
        <p>회원 기록은 계정으로, 비회원 기록은 현재 브라우저의 인증으로 확인합니다. 비회원 대화는 생성일부터 1개월 보관합니다.</p>
      </section>
      <form className="search" action="/conversations" role="search">
        <label htmlFor="history-query">질문이나 제목으로 찾기</label>
        <input type="hidden" name="limit" value={pageSize} />
        <input type="hidden" name="sort" value={sort} />
        <div className="search-row">
          <input id="history-query" name="q" defaultValue={q} maxLength={200} placeholder="질문이나 법령 이름을 입력하세요" />
          <button type="submit" data-primary aria-label="검색" title="검색"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.5-4.5" /></svg></button><ResetSearch />
        </div>
        <PeriodFields from={from} to={to} />
      </form>
      <div className="section-heading">
        <h2>나의 대화</h2><div className="list-tools"><PageSizeSelect value={pageSize} sort={sort} sortBasis="수정일" /><IconLink href="/" kind="squarePen" label="새 대화" /></div>
      </div>
      <section className="results conversation-results">
        {result.data ? <HistoryList key={pageSize + q + from + to + sort} initial={result.data} pageSize={pageSize} filter={{ q, from, to, sort }} />
          : <p role="alert" className="empty">{result.error}</p>}
      </section>
    </main>
  </div>;
}
