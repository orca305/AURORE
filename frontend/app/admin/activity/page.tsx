import Link from "next/link";
import { requestAdmin, type AdminActivity } from "../../_admin/requests";
import { correctionResults, date, number } from "../../_admin/format";
import { parsePageSize } from "../../_components/page-size";
import { PageSizeSelect } from "../../_components/page-size-select";
import styles from "../page.module.css";
export const metadata = { title: "관리자 작업 이력 | AURORE" };
const text = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : "";
const kinds: Record<string, string> = {
  LAW_CORRECTION: "법령 정정",
  PRECEDENT_REVIEW: "판례 연결 검토",
  MEMBER_STATUS: "회원 상태 변경",
};
const actions: Record<string, string> = {
  ...correctionResults,
  VERIFIED: "연결 확인",
  UNVERIFIED: "미확인 종결",
  BLOCKED: "회원 차단",
  ACTIVE: "차단 해제",
};
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams,
    q = text(params.q).trim().slice(0, 200),
    kind = Object.hasOwn(kinds, text(params.kind)) ? text(params.kind) : "all",
    result = ["SUCCEEDED", "FAILED"].includes(text(params.result))
      ? text(params.result)
      : "all";
  const from = text(params.from),
    to = text(params.to),
    limit = parsePageSize(params.limit),
    rawOffset = text(params.offset),
    offset = /^\d{1,6}$/.test(rawOffset)
      ? Math.min(Number(rawOffset), 100000)
      : 0;
  const query = new URLSearchParams({
    q,
    kind,
    result,
    from,
    to,
    limit: String(limit),
    offset: String(offset),
  });
  const response = await requestAdmin("activity", query),
    data = response?.ok ? ((await response.json()) as AdminActivity) : null;
  const url = (next: number) => {
    const value = new URLSearchParams(query);
    value.set("offset", String(next));
    return "/admin/activity?" + value;
  };
  const filtered = Boolean(
    q || kind !== "all" || result !== "all" || from || to,
  );
  return (
    <>
      <div className={styles.sectionTitle}>
        <div>
          <h2>관리자 작업 이력</h2>
          <p>
            법령 정정·판례 연결 검토·회원 상태 변경 기록을 처리 시각순으로
            확인합니다.
          </p>
        </div>
        <Link className={styles.refresh} href={url(offset)}>
          새로고침 ↻
        </Link>
      </div>
      <form
        action="/admin/activity"
        role="search"
        className={styles.activitySearch}
      >
        <label>
          대상 또는 처리 사유
          <input
            name="q"
            defaultValue={q}
            maxLength={200}
            placeholder="법령명, 판례명, 처리 사유"
          />
        </label>
        <label>
          작업 종류
          <select name="kind" defaultValue={kind}>
            <option value="all">전체 작업</option>
            {Object.entries(kinds).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          처리 결과
          <select name="result" defaultValue={result}>
            <option value="all">전체 결과</option>
            <option value="SUCCEEDED">완료</option>
            <option value="FAILED">실패</option>
          </select>
        </label>
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
          <button type="submit">조회</button>
          {filtered && (
            <Link href={"/admin/activity?limit=" + limit}>조건 지우기</Link>
          )}
        </div>
      </form>
      {!data ? (
        <p role="alert" className={styles.notice}>
          {response?.status === 400
            ? "조회 기간과 검색 조건을 확인해 주세요. 시작일은 종료일보다 늦을 수 없습니다."
            : "작업 이력을 불러오지 못했습니다. 권한과 연결 상태를 확인한 뒤 다시 시도해 주세요."}
        </p>
      ) : (
        <>
          <dl className={styles.metrics}>
            {(
              [
                ["조회 결과", data.total],
                ["완료", data.counts.succeeded],
                ["실패", data.counts.failed],
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
              <h3>처리 기록</h3>
              <p>현재 검색 조건 기준 · 날짜는 한국 시간으로 조회합니다.</p>
            </div>
            <PageSizeSelect value={limit} />
          </div>
          <div className={styles.tableWrap}>
            <table>
              <caption>
                개인정보와 대화·사건·첨부 본문은 표시하지 않습니다. 처리자와
                회원 식별정보는 일부를 가려 표시합니다.
              </caption>
              <thead>
                <tr>
                  <th scope="col">처리 시각</th>
                  <th scope="col">작업 종류</th>
                  <th scope="col">대상</th>
                  <th scope="col">결과</th>
                  <th scope="col">처리 사유</th>
                  <th scope="col">처리자</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td>{date(row.occurredAt)}</td>
                    <td>{kinds[row.kind]}</td>
                    <td className={styles.activitySubject}>
                      {row.subject}
                      {row.href && (
                        <Link className={styles.subtext} href={row.href}>
                          관련 화면 ↗
                        </Link>
                      )}
                    </td>
                    <td>
                      <span
                        className={styles.badge}
                        data-tone={
                          row.result === "FAILED" ? "danger" : "success"
                        }
                      >
                        {row.result === "FAILED" ? "실패" : "완료"}
                      </span>
                      <span className={styles.subtext}>
                        {actions[row.action] ?? "처리 기록 확인"}
                      </span>
                    </td>
                    <td className={styles.reason}>{row.reason ?? "—"}</td>
                    <td>{row.operatorMasked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.items.length && (
              <p className={styles.empty}>
                {offset > 0
                  ? "이 페이지에 표시할 기록이 없습니다. 이전 페이지에서 확인해 주세요."
                  : filtered
                    ? "검색 조건에 맞는 작업 이력이 없습니다."
                    : "아직 기록된 관리자 작업이 없습니다."}
              </p>
            )}
          </div>
          <nav className="pagination" aria-label="작업 이력 페이지">
            {offset > 0 && (
              <Link href={url(Math.max(0, offset - limit))}>← 이전</Link>
            )}
            <span className="page-status">
              {Math.floor(offset / limit) + 1} 페이지 ·{" "}
              {data.items.length
                ? `${number.format(offset + 1)}–${number.format(offset + data.items.length)}건`
                : "0건"}{" "}
              / {number.format(data.total)}건
            </span>
            {data.nextOffset !== null && (
              <Link href={url(data.nextOffset)}>다음 →</Link>
            )}
          </nav>
        </>
      )}
    </>
  );
}
