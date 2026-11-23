import { Pagination } from "../../../_components/pagination";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requestAdmin, type MemberDetail } from "../../../_admin/requests";
import { date, number } from "../../../_admin/format";
import { parsePageSize } from "../../../_components/page-size";
import { PageSizeSelect } from "../../../_components/page-size-select";
import { StatusForm } from "./status-form";
import styles from "../../page.module.css";
export const metadata = { title: "회원 상태·이력 | AURORE" };
const statusNames: Record<string, string> = {
  ACTIVE: "정상",
  BLOCKED: "차단",
  UNAVAILABLE: "상태 확인 필요",
};
export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > BigInt("9223372036854775807"))
    notFound();
  const query = await searchParams,
    limit = parsePageSize(query.limit);
  const raw = typeof query.offset === "string" ? query.offset : "0";
  const offset = /^\d{1,6}$/.test(raw) ? Math.min(Number(raw), 100000) : 0;
  const path = "/admin/members/" + id;
  const response = await requestAdmin(
    `members/${id}`,
    new URLSearchParams({ limit: String(limit), offset: String(offset) }),
  );
  if (response?.status === 404) notFound();
  if (!response?.ok)
    return (
      <p role="alert" className={styles.notice}>
        회원 상태를 불러오지 못했습니다. 권한과 연결 상태를 확인한 뒤 다시
        시도해 주세요.
      </p>
    );
  const { member, history } = (await response.json()) as MemberDetail;
  const pageUrl = (next: number) =>
    path +
    "?" +
    new URLSearchParams({ limit: String(limit), offset: String(next) }) +
    "#status-history";
  return (
    <>
      <Link className={styles.back} href={"/admin/members?limit=" + limit}>
        ← 회원 목록
      </Link>
      <div className={styles.sectionTitle}>
        <div>
          <h2>회원 상태·이력</h2>
          <p>
            {member.loginIdMasked} · {member.nicknameMasked}
          </p>
        </div>

      </div>
      {query.updated === "1" && (
        <p role="status" className={styles.notice}>
          상태 변경을 처리했습니다. 아래에서 현재 상태와 처리 이력을 확인할 수
          있습니다.
        </p>
      )}
      <dl className={styles.memberFacts}>
        <div>
          <dt>현재 상태</dt>
          <dd>
            <span
              className={styles.badge}
              data-tone={member.status === "ACTIVE" ? "success" : "danger"}
            >
              {statusNames[member.status]}
            </span>
          </dd>
        </div>
        <div>
          <dt>가입일</dt>
          <dd>{date(member.joinedAt)}</dd>
        </div>
      </dl>
      {member.canChange ? (
        <StatusForm
          key={member.revision + ":" + member.status}
          id={id}
          revision={member.revision}
          status={member.status}
          limit={limit}
        />
      ) : (
        <p className={styles.notice}>
          {member.self
            ? "본인 계정의 상태는 변경할 수 없습니다."
            : "계정의 상태 설정을 확인한 뒤 처리해 주세요."}
        </p>
      )}
      <section id="status-history" className={styles.section}>
        <div className={styles.sectionTitle}>
          <h3>
            상태 변경 이력{" "}
            <span className={styles.memberTotal}>
              {number.format(history.total)}건
            </span>
          </h3>
          <PageSizeSelect value={limit} />
        </div>
        <div className={styles.tableWrap}>
          <table>
            <caption>
              관리자가 처리한 차단·해제 이력을 보관합니다. 처리자 아이디는
              일부를 가려 표시합니다.
            </caption>
            <thead>
              <tr>
                <th scope="col">변경 전</th>
                <th scope="col">변경 후</th>
                <th scope="col">처리 사유</th>
                <th scope="col">처리자</th>
                <th scope="col">처리 시각</th>
              </tr>
            </thead>
            <tbody>
              {history.items.map((row) => (
                <tr key={row.id}>
                  <td>{statusNames[row.previousStatus] ?? "상태 확인 필요"}</td>
                  <td>{statusNames[row.status] ?? "상태 확인 필요"}</td>
                  <td className={styles.reason}>{row.reason}</td>
                  <td>{row.operatorMasked}</td>
                  <td>{date(row.changedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!history.items.length && (
            <p className={styles.empty}>아직 상태 변경 이력이 없습니다.</p>
          )}
        </div>
        <Pagination label="회원 상태 이력 페이지" offset={offset} limit={limit} total={history.total} hasNext={history.nextOffset !== null} href={pageUrl} />
      </section>
    </>
  );
}
