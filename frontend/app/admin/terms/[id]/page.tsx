import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requestTerms, validTermId } from "../../../_terms/requests";
import { termActions, type AdminTerm } from "../../../_terms/types";
import { TermForm, TermCommandForm } from "../../../_terms/term-form";
import { PageSizeSelect } from "../../../_components/page-size-select";
import { parsePageSize } from "../../../_components/page-size";
import { date } from "../../../_admin/format";
import styles from "../../../_terms/terms.module.css";
export const metadata = { title: "법률용어 검토·이력 | AURORE" };
export default async function TermReview({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!validTermId(id)) notFound();
  const q = await searchParams,
    limit = parsePageSize(q.limit),
    raw = typeof q.offset === "string" ? q.offset : "0",
    offset = /^\d{1,6}$/.test(raw) ? Math.min(Number(raw), 100000) : 0,
    chosen =
      typeof q.historyRevision === "string" &&
      /^[1-9]\d{0,9}$/.test(q.historyRevision) &&
      Number(q.historyRevision) <= 2147483647
        ? q.historyRevision
        : "";
  const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      ...(chosen ? { historyRevision: chosen } : {}),
    }),
    response = await requestTerms("/" + id + "?" + query, true);
  if (response?.status === 404) notFound();
  const data = response?.ok ? ((await response.json()) as AdminTerm) : null;
  const page = (n: number, revision?: number) =>
    "/admin/terms/" +
    id +
    "?" +
    new URLSearchParams({
      limit: String(limit),
      offset: String(n),
      ...(revision ? { historyRevision: String(revision) } : {}),
    }) +
    "#term-history";
  return (
    <>
      <Link href="/admin/terms" className="ui-button">
        목록으로
      </Link>
      {!data ? (
        <p className="empty" role="status">
          용어를 불러오지 못했습니다.
        </p>
      ) : (
        <>
          <div className="section-heading">
            <h2>{data.termName}</h2>
            <span>
              {data.deleted
                ? "삭제"
                : data.state === "PUBLISHED"
                  ? "공개"
                  : "임시 저장"}{" "}
              · 버전 {data.revision}
            </span>
          </div>
          {data.sourceKind === "MOLEG_TERM" && <p className={styles.help}>법제처 수집 · 용어 번호 {data.sourceId}</p>}
          {q.saved === "1" && (
            <p role="status" className={styles.notice}>
              처리 결과를 반영했습니다.
            </p>
          )}
          {data.state === "PUBLISHED" && !data.deleted && (
            <p>
              <Link href={"/terms/" + id} className="ui-button">
                공개 화면 보기
              </Link>
            </p>
          )}
          {!data.deleted && (
            <>
              <TermForm
                key={data.revision}
                initial={data}
                requestId={randomUUID()}
              />
              {data.state === "DRAFT" && (
                <section className={styles.block}>
                  <h2>출처 검토 후 공개</h2>
                  <p className={styles.help}>
                    정의·동의어·쉬운 풀이와 출처 기준을 확인한 뒤 공개해 주세요.
                  </p>
                  <a
                    href={data.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-action-link
                  >
                    출처 원문 확인
                  </a>
                  <TermCommandForm
                    key={"publish:" + data.revision}
                    term={data}
                    mode="publish"
                    requestId={randomUUID()}
                  />
                </section>
              )}
            </>
          )}
          <section id="term-history" className="results">
            <div className="section-heading">
              <h2>변경 이력 · {data.history.total}건</h2>
              <PageSizeSelect value={limit} />
            </div>
            <div className={styles.history}>
              <table>
                <thead>
                  <tr>
                    <th>버전</th>
                    <th>처리</th>
                    <th>시각</th>
                    <th>내용</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.items.map((row) => (
                    <tr key={row.revision}>
                      <td>{row.revision}</td>
                      <td>{termActions[row.action] ?? row.action}</td>
                      <td>{date(row.recordedAt)}</td>
                      <td>
                        <Link href={page(offset, row.revision)}>
                          변경 내용 보기
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="pagination" aria-label="용어 변경 이력 페이지">
              {offset > 0 && (
                <Link href={page(Math.max(0, offset - limit))} aria-label="이전 페이지" title="이전 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></Link>
              )}
              <span className="page-status">
                {Math.floor(offset / limit) + 1} 페이지
              </span>
              {data.history.nextOffset !== null && (
                <Link href={page(data.history.nextOffset)} aria-label="다음 페이지" title="다음 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></Link>
              )}
            </nav>
            {chosen && !data.selectedHistory && (
              <p className={styles.help}>선택한 버전의 이력이 없습니다.</p>
            )}
            {data.selectedHistory && (
              <div className={styles.block}>
                <h2>
                  버전 {data.selectedHistory.revision} ·{" "}
                  {termActions[data.selectedHistory.action]}
                </h2>
                <div className={styles.comparison}>
                  {(["before", "after"] as const).map((side) => {
                    const row = data.selectedHistory![side];
                    return (
                      <div key={side}>
                        <h3>{side === "before" ? "변경 전" : "변경 후"}</h3>
                        {row ? (
                          <>
                            <p>
                              {row.termName} ·{" "}
                              {row.deleted
                                ? "삭제"
                                : row.state === "PUBLISHED"
                                  ? "공개"
                                  : "임시 저장"}
                            </p>
                            <h4>출처의 정의</h4>
                            <p>{row.definition}</p>
                            <h4>쉬운 풀이</h4>
                            <p>{row.explanation ?? "등록 없음"}</p>
                            <h4>출처</h4>
                            <p>
                              {row.sourceName} · {row.sourceReference}
                              <br />
                              {row.sourceUrl}
                            </p>
                          </>
                        ) : (
                          <p>등록 전 이력이 없습니다.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
          {!data.deleted && (
            <details className={styles.danger}>
              <summary>용어 삭제</summary>
              <TermCommandForm
                key={"delete:" + data.revision}
                term={data}
                mode="delete"
                requestId={randomUUID()}
              />
            </details>
          )}
        </>
      )}
    </>
  );
}
