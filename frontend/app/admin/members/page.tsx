import { SortSelect } from '../../_components/sort-select';
import { ResetSearch } from '../../_components/page-actions';
import Link from "next/link";
import { requestAdmin, type MemberList } from "../../_admin/requests";
import { date, number } from "../../_admin/format";
import { parsePageSize } from "../../_components/page-size";
import { PageSizeSelect } from "../../_components/page-size-select";
import styles from "../page.module.css";

export const metadata = { title: "회원 관리 | AURORE" };
type Search = Promise<Record<string, string | string[] | undefined>>;
const text = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : "";
const labels = {
  ACTIVE: "정상",
  BLOCKED: "차단",
  UNAVAILABLE: "상태 확인 필요",
};

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const params = await searchParams;
  const q = text(params.q).trim().slice(0, 200);
  const status = ["ACTIVE", "BLOCKED"].includes(text(params.status))
    ? text(params.status)
    : "all";
  const limit = parsePageSize(params.limit);
  const rawOffset = text(params.offset);
  const offset = /^\d{1,6}$/.test(rawOffset)
    ? Math.min(Number(rawOffset), 100000)
    : 0;
  const sort=params.sort==='oldest'?'oldest':'newest';
  const query = new URLSearchParams({
    sort,
    q,
    status,
    limit: String(limit),
    offset: String(offset),
  });
  const response = await requestAdmin("members", query);
  if (!response?.ok)
    return (
      <p role="alert" className={styles.notice}>
        회원 목록을 불러오지 못했습니다. 권한과 연결 상태를 확인한 뒤 다시
        시도해 주세요.
      </p>
    );
  const data = (await response.json()) as MemberList;
  const pageUrl = (next: number) => {
    const value = new URLSearchParams(query);
    value.set("offset", String(next));
    return "/admin/members?" + value;
  };
  const metrics = [
    ["전체 회원", data.counts.members],
    ["정상 회원", data.counts.active],
    ["차단 회원", data.counts.blocked],
  ] as const;
  return (
    <>
      <div className={styles.sectionTitle}>
        <div>
          <h2>회원 관리</h2>
          <p>회원 상태와 가입 현황을 확인합니다. 탈퇴 계정은 제외합니다.</p>
        </div>

      </div>
      <dl className={styles.metrics}>
        {metrics.map(([label, count]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {number.format(count)}
              <small>명</small>
            </dd>
          </div>
        ))}
      </dl>
      <form
        action="/admin/members"
        role="search"
        className={styles.memberSearch}
      >
        <label className={styles.memberQuery}>
          아이디 또는 닉네임
          <input
            name="q"
            defaultValue={q}
            maxLength={200}
            placeholder="검색어를 입력하세요"
          />
        </label>
        <label>
          회원 상태
          <select name="status" defaultValue={status}>
            <option value="all">전체 상태</option>
            <option value="ACTIVE">정상</option>
            <option value="BLOCKED">차단</option>
          </select>
        </label>
        <input type="hidden" name="limit" value={limit} />
        <SortSelect value={sort} basis="가입일"/><button type="submit" data-primary aria-label="검색" title="검색"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.5-4.5" /></svg></button><ResetSearch/>

      </form>
      <div className={styles.sectionTitle}>
        <h3>
          조회 결과{" "}
          <span className={styles.memberTotal}>
            {number.format(data.total)}명
          </span>
        </h3>
        <PageSizeSelect value={limit} />
      </div>
      <div className={styles.tableWrap}>
        <table>
          <caption>
            아이디와 닉네임은 일부를 가려 표시합니다. 가입일은 한국 시간
            기준입니다.
          </caption>
          <thead>
            <tr>
              <th scope="col">번호</th>
              <th scope="col">아이디</th>
              <th scope="col">닉네임</th>
              <th scope="col">상태</th>
              <th scope="col">가입일</th>
              <th scope="col">관리</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row, index) => (
              <tr key={row.id}>
                <td>{number.format(offset + index + 1)}</td>
                <td>{row.loginIdMasked}</td>
                <td>{row.nicknameMasked}</td>
                <td>
                  <span
                    className={styles.badge}
                    data-tone={row.status === "ACTIVE" ? "success" : "danger"}
                  >
                    {labels[row.status]}
                  </span>
                </td>
                <td>{date(row.joinedAt)}</td>
                <td><Link href={"/admin/members/" + row.id + "?limit=" + limit} data-action-link>상태·이력 </Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.items.length && (
          <p className={styles.empty}>
            {offset > 0
              ? "이 페이지에 표시할 회원이 없습니다. 이전 페이지에서 확인해 주세요."
              : q || status !== "all"
                ? "검색 조건에 맞는 회원이 없습니다."
                : "등록된 회원이 없습니다."}
          </p>
        )}
      </div>
      <nav className="pagination" aria-label="회원 목록 페이지">
        {offset > 0 && (
          <Link href={pageUrl(Math.max(0, offset - limit))}>← 이전</Link>
        )}
        <span className="page-status">
          {Math.floor(offset / limit) + 1} 페이지 ·{" "}
          {data.items.length
            ? `${number.format(offset + 1)}–${number.format(offset + data.items.length)}명`
            : "0명"}{" "}
          / {number.format(data.total)}명
        </span>
        {data.nextOffset !== null && (
          <Link href={pageUrl(data.nextOffset)}>다음 →</Link>
        )}
      </nav>
    </>
  );
}
