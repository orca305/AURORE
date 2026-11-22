import Link from "next/link";
import {LinkedChats} from "../../_cases/linked-chats";
import {CaseTasks} from "../../_cases/case-tasks";
import { notFound } from "next/navigation";
import { requestCase } from "../../_cases/requests";
import {
  caseIdPattern,
  type CaseDetail,
  type Snapshot,
} from "../../_cases/types";
import { CaseForm, DeleteCase } from "../../_cases/case-form";
import { parsePageSize } from "../../_components/page-size";
import { PageSizeSelect } from "../../_components/page-size-select";
import { date } from "../../_admin/format";
import styles from "../page.module.css";
export const metadata = { title: "사건·사실관계 | AURORE" };
const offset = (value: string | string[] | undefined) =>
  typeof value === "string" && /^\d{1,6}$/.test(value)
    ? Math.min(Number(value), 100000)
    : 0;
const actions: Record<string, string> = {
  CREATE_CASE: "사건 등록",
  UPDATE_CASE: "사건 수정",
  DELETE_CASE: "사건 삭제",
  CREATE_FACT: "사실관계 등록",
  UPDATE_FACT: "사실관계 수정",
  DELETE_FACT: "사실관계 삭제",
};
function Version({ value }: { value: Snapshot | null }) {
  return !value ? (
    <p>등록 전</p>
  ) : (
    <>
      <strong>{value.title}</strong>
      {value.typeName && <p>{value.typeName}</p>}
      {value.occurredOn && <p>{value.occurredOn}</p>}
      {value.content && <p className={styles.content}>{value.content}</p>}
      {value.deleted && (
        <p>
          삭제 처리
          {value.deletedFactCount !== undefined &&
            ` · 사실관계 ${value.deletedFactCount}개 포함`}
        </p>
      )}
    </>
  );
}
export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!caseIdPattern.test(id)) notFound();
  const query = await searchParams,
    limit = parsePageSize(query.limit),
    pageOffset = offset(query.offset),
    historyOffset = offset(query.historyOffset),
    path = "/cases/" + id;
  const response = await requestCase(
    "/" +
      id +
      "?" +
      new URLSearchParams({
        limit: String(limit),
        offset: String(pageOffset),
        historyOffset: String(historyOffset),
      }),
  );
  if (response?.status === 404) notFound();
  if (!response?.ok)
    return (
      <section className="intro">
        <h1>사건을 불러오지 못했습니다</h1>
        <p>잠시 후 다시 시도해 주세요.</p>
      </section>
    );
  const data = (await response.json()) as CaseDetail,
    parent = data.case;
  const pageUrl = (next: number, key = "offset") =>
    path +
    "?" +
    new URLSearchParams({
      limit: String(limit),
      offset: String(pageOffset),
      historyOffset: String(historyOffset),
      chatOffset: String(offset(query.chatOffset)),
      [key]: String(next),
    }) +
    (key === "historyOffset" ? "#case-history" : "#facts");
  return (
    <>
      <section className="intro">
        <Link href={"/cases?limit=" + limit}>← 나의 사건</Link>
        <h1>{parent.title}</h1>
        <p>
          {parent.typeName} · {date(parent.updatedAt)} 수정
        </p>
      </section>
      {query.saved === "1" && (
        <p role="status" className={styles.notice}>
          확인한 내용을 저장했습니다.
        </p>
      )}
      <LinkedChats id={id} limit={limit} offset={offset(query.chatOffset)} query={query}/>
      <CaseTasks id={id}/>
      <div className={styles.caseTools}>
        <details className={styles.edit}>
          <summary>사건 정보 수정</summary>
          <CaseForm
            key={parent.revision}
            command={{
              operation: "update",
              caseId: id,
              revision: parent.revision,
            }}
            types={data.types}
            initial={parent}
          />
        </details>
        <DeleteCase
          key={"delete:" + parent.revision}
          label="사건 삭제"
          targetTitle={parent.title}
          command={{
            operation: "delete",
            caseId: id,
            revision: parent.revision,
          }}
        />
      </div>
      <section className="results" id="facts">
        <div className="section-heading">
          <h2>
            확인한 사실관계 <span>{data.facts.total}개</span>
          </h2>
          <div className="list-tools">
            <PageSizeSelect value={limit} />
            <Link href={path + "/timeline?limit=" + limit} data-action-link>타임라인 보기 </Link>
            <a href={path+"/export"} download>정리본 내려받기 ↓</a>
            <a href="#add-fact">사실관계 추가 ↓</a>
          </div>
        </div>
        {!data.facts.items.length ? (
          <p className="empty">
            아직 등록된 사실관계가 없습니다. 확인한 사실을 아래에서 추가해
            주세요.
          </p>
        ) : (
          <ul className={styles.facts}>
            {data.facts.items.map((row) => (
              <li key={row.id}>
                <header>
                  <div>
                    <h3>{row.title}</h3>
                    {row.occurredOn && (
                      <p className={styles.factDate}>{row.occurredOn}</p>
                    )}
                  </div>
                  <div className={styles.factTools}>
                    <Link href={path + "/facts/" + row.id} data-action-link>수정 </Link>
                    <DeleteCase
                      command={{
                        operation: "deleteFact",
                        caseId: id,
                        factId: row.id,
                        revision: parent.revision,
                      }}
                      label={row.title + " 사실관계 삭제"}
                      targetTitle={row.title}
                    />
                  </div>
                </header>
                <p className={styles.content}>{row.content}</p>
                {row.imported && <p className={styles.factDate}>{row.source ? <Link href={'/?chat='+row.source.chatId} data-action-link>가져온 대화 </Link> : '가져온 대화가 삭제되었거나 보관이 종료됐습니다.'}</p>}

              </li>
            ))}
          </ul>
        )}
        <nav className="pagination" aria-label="사실관계 페이지">
          {pageOffset > 0 && (
            <Link href={pageUrl(Math.max(0, pageOffset - limit))}>← 이전</Link>
          )}
          <span className="page-status">
            {Math.floor(pageOffset / limit) + 1} 페이지
          </span>
          {data.facts.nextOffset !== null && (
            <Link href={pageUrl(data.facts.nextOffset)}>다음 →</Link>
          )}
        </nav>
      </section>
      <section id="add-fact" className={styles.section}>
        <div className="section-heading">
          <h2>사실관계 추가</h2>
        </div>
        <CaseForm
          key={"add:" + parent.revision}
          command={{
            operation: "createFact",
            caseId: id,
            revision: parent.revision,
          }}
        />
      </section>
      <details
        className={styles.history}
        id="case-history"
        open={historyOffset > 0}
      >
        <summary>변경 이력 · {data.history.total}건</summary>
        <p>저장할 때마다 등록·수정·삭제 내용을 기록합니다.</p>
        {data.history.items.map((row) => (
          <details className={styles.historyItem} key={row.id}>
            <summary>
              {actions[row.action] ?? "내용 변경"} · {date(row.createdAt)}{" "}
              <span>{row.revision}차</span>
            </summary>
            <div className={styles.comparison}>
              <div>
                <h4>변경 전</h4>
                <Version value={row.before} />
              </div>
              <div>
                <h4>변경 후</h4>
                <Version value={row.after} />
              </div>
            </div>
          </details>
        ))}
        <nav className="pagination" aria-label="사건 변경 이력 페이지">
          {historyOffset > 0 && (
            <Link
              href={pageUrl(
                Math.max(0, historyOffset - limit),
                "historyOffset",
              )}
            >
              ← 이전
            </Link>
          )}
          <span className="page-status">
            {Math.floor(historyOffset / limit) + 1} 페이지
          </span>
          {data.history.nextOffset !== null && (
            <Link href={pageUrl(data.history.nextOffset, "historyOffset")}>
              다음 →
            </Link>
          )}
        </nav>
      </details>
    </>
  );
}
