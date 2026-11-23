import { Pagination } from "../../_components/pagination";
import { ResetSearch } from '../../_components/page-actions';
import Link from "next/link";
import { requestAdmin, type AdminJobList } from "../../_admin/requests";
import { date, number, states } from "../../_admin/format";
import { jobErrors, jobProviders,jobResults } from "../../_admin/job-format";
import { parsePageSize } from "../../_components/page-size";
import { PageSizeSelect } from "../../_components/page-size-select";
import styles from "../page.module.css";
export const metadata = { title: "AI 작업 | AURORE" };
const text = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : "";
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams,
    q = text(params.q).trim().slice(0, 36),
    rawStatus = text(params.status),
    status =
      rawStatus === "all" || Object.hasOwn(states, rawStatus)
        ? rawStatus
        : "all",
    rawError = text(params.error),
    error = Object.hasOwn(jobErrors, rawError) ? rawError : "all",
    result=Object.hasOwn(jobResults,text(params.result))?text(params.result):"all";
  const from = text(params.from),
    to = text(params.to),
    limit = parsePageSize(params.limit),
    rawOffset = text(params.offset),
    offset = /^\d{1,6}$/.test(rawOffset)
      ? Math.min(Number(rawOffset), 100000)
      : 0;
  const sort=params.sort==='oldest'?'oldest':'newest';
  const query = new URLSearchParams({
      sort,
      q,
      status,
      error,
      result,
      from,
      to,
      limit: String(limit),
      offset: String(offset),
    }),
    response = await requestAdmin("ai-jobs", query),
    data = response?.ok ? ((await response.json()) as AdminJobList) : null;
  const pageUrl = (next: number) => {
    const value = new URLSearchParams(query);
    value.set("offset", String(next));
    return "/admin/ai-jobs?" + value;
  };
  return (
    <>
      <div className={styles.sectionTitle}>
        <div>
          <h2>AI 작업</h2>
          <p>
            처리 완료와 근거 확보를 구분해 확인합니다. 삭제·보관 만료된 대화의 작업은 제외합니다.
          </p>
        </div>

      </div>
      <form
        action="/admin/ai-jobs"
        role="search"
        className={styles.activitySearch}
      >
        <label>
          작업 번호
          <input
            name="q"
            defaultValue={q}
            maxLength={36}
            pattern="[0-9A-Fa-f-]*"
            placeholder="작업 번호 전체 또는 앞부분"
          />
        </label>
        <label>
          작업 상태
          <select name="status" defaultValue={status}>
            <option value="all">전체 상태</option>
            {Object.entries(states).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          오류 유형
          <select name="error" defaultValue={error}>
            <option value="all">전체 오류</option>
            {Object.entries(jobErrors).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        <label>처리 결과<select name="result" defaultValue={result}><option value="all">전체 결과</option>{Object.entries(jobResults).map(([code,value])=><option key={code} value={code}>{value.label}</option>)}</select></label>
        <label>
          시작일
          <input
            type="date"
            name="from"
            defaultValue={from}
            min="0001-01-01"
            max="9999-12-31"
          />
        </label>
        <label>
          종료일
          <input
            type="date"
            name="to"
            defaultValue={to}
            min="0001-01-01"
            max="9999-12-31"
          />
        </label>
        <input type="hidden" name="limit" value={limit} />
        <div className={styles.activitySearchActions}>
          <input type="hidden" name="sort" value={sort} /><button type="submit" data-primary aria-label="조회" title="조회"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.5-4.5" /></svg></button><ResetSearch/>

        </div>
      </form>
      {!data ? (
        <p role="alert" className={styles.notice}>
          {response?.status === 400
            ? "작업 번호와 조회 기간을 확인해 주세요. 시작일은 종료일보다 늦을 수 없습니다."
            : "AI 작업을 불러오지 못했습니다. 권한과 연결 상태를 확인한 뒤 다시 시도해 주세요."}
        </p>
      ) : (
        <>
          <dl className={styles.metrics+" "+styles.jobMetrics}>
            {(
              [
                ["조회 작업", data.total],
                ["실패", data.counts.failed],
                ["재시도 대기", data.counts.retrying],
                ["근거 미확보",data.counts.needsEvidence],
                ["AI 미준비",data.counts.aiNotReady],
                ["인용 검증 실패",data.counts.evidenceInvalid],
              ] as const
            ).map(([label, count]) => (
              <div
                key={label}
                className={
                  label === "실패" && count > 0 ? styles.attention : undefined
                }
              >
                <dt>{label}</dt>
                <dd>
                  {number.format(count)}
                  <small>건</small>
                </dd>
              </div>
            ))}
          </dl>
          <div className={styles.sectionTitle + " " + styles.section}>
            <div>
              <h3>처리 목록</h3>
              <p>현재 검색 조건 기준 · 변경 시각을 한국 시간으로 조회합니다.</p>
            </div>
            <PageSizeSelect value={limit} sort={sort} sortBasis="변경일" />
          </div>
          <div className={styles.tableWrap}>
            <table>
              <caption>
                작업 번호를 누르면 운영 정보와 오류 유형별 설명을 확인할 수
                있습니다.
              </caption>
              <thead>
                <tr>
                  <th scope="col">작업 번호</th>
                  <th scope="col">상태</th>
                  <th scope="col">처리 방식</th>
                  <th scope="col">처리 결과</th>
                  <th scope="col">시도</th>
                  <th scope="col">오류 유형</th>
                  <th scope="col">변경 시각</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link
                        href={"/admin/ai-jobs/" + row.id + "?limit=" + limit}
                      >
                        <code title={row.id}>{row.id.slice(0, 8)}</code>
                      </Link>
                    </td>
                    <td>
                      <span
                        className={styles.badge}
                        data-tone={
                          row.status === "FAILED"
                            ? "danger"
                            : row.status === "SUCCEEDED"
                              ? "success"
                              : undefined
                        }
                      >
                        {states[row.status] ?? "상태 확인 필요"}
                      </span>
                    </td>
                    <td>{jobProviders[row.provider] ?? "기타 처리"}</td>
                    <td>{jobResults[row.resultCode??'NONE']?.label??jobResults.OTHER.label}</td>
                    <td>{row.attempts}회</td>
                    <td>
                      {jobErrors[row.errorCode ?? "NONE"]?.label ?? "기타 오류"}
                    </td>
                    <td>{date(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.items.length && (
              <p className={styles.empty}>
                {offset > 0
                  ? "이 페이지에 표시할 작업이 없습니다. 이전 페이지에서 확인해 주세요."
                  : "검색 조건에 맞는 AI 작업이 없습니다."}
              </p>
            )}
          </div>
          <Pagination label="AI 작업 페이지" offset={offset} limit={limit} total={data.total} hasNext={data.nextOffset !== null} href={pageUrl} />
        </>
      )}
    </>
  );
}
