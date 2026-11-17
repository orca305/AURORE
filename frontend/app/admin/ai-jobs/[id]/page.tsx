import Link from "next/link";
import { notFound } from "next/navigation";
import { requestAdmin, type AdminJobDetail } from "../../../_admin/requests";
import { date, states } from "../../../_admin/format";
import { jobErrors, jobProviders,jobResults } from "../../../_admin/job-format";
import { parsePageSize } from "../../../_components/page-size";
import styles from "../../page.module.css";
export const metadata = { title: "AI 작업 상세 | AURORE" };
export default async function JobDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ limit?: string | string[] }>;
}) {
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    notFound();
  const limit = parsePageSize((await searchParams).limit),
    response = await requestAdmin(`ai-jobs/${id}`);
  if (response?.status === 404) notFound();
  if (!response?.ok)
    return (
      <p role="alert" className={styles.notice}>
        작업 정보를 불러오지 못했습니다. 권한과 연결 상태를 확인한 뒤 다시
        시도해 주세요.
      </p>
    );
  const job = (await response.json()) as AdminJobDetail,
    error = jobErrors[job.errorCode ?? "NONE"] ?? jobErrors.OTHER,
    result=jobResults[job.resultCode??"NONE"]??jobResults.OTHER;
  const facts = [
    ["처리 방식", jobProviders[job.provider] ?? "기타 처리"],
    ["시도 횟수", job.attempts + "회"],
    ["생성 시각", date(job.createdAt)],
    ["변경 시각", date(job.updatedAt)],
    ["처리 기한", date(job.deadlineAt)],
    ["다음 시도 예정", job.nextAttemptAt ? date(job.nextAttemptAt) : "—"],
    ["작업 점유 만료", job.leaseExpiresAt ? date(job.leaseExpiresAt) : "—"],
  ];
  return (
    <>
      <Link className={styles.back} href={"/admin/ai-jobs?limit=" + limit}>
        ← AI 작업 목록
      </Link>
      <div className={styles.sectionTitle}>
        <div>
          <h2>AI 작업 상세</h2>
          <p className={styles.jobId}>{job.id}</p>
        </div>

      </div>
      <div className={styles.jobStatus}>
        <span
          className={styles.badge}
          data-tone={
            job.status === "FAILED"
              ? "danger"
              : job.status === "SUCCEEDED"
                ? "success"
                : undefined
          }
        >
          {states[job.status] ?? "상태 확인 필요"}
        </span>
        <p>대화·사건·첨부 본문은 표시하지 않습니다.</p>
      </div>
      {job.deadlineExceeded && (
        <p role="status" className={styles.notice}>
          처리 기한이 지난 작업입니다. 작업 회수와 상태 갱신이 진행 중일 수
          있습니다.
        </p>
      )}
      {job.leaseExpired && (
        <p role="status" className={styles.notice}>
          작업 점유 시간이 지났습니다. 작업 실행기와 점유 갱신 상태를 확인해
          주세요.
        </p>
      )}
      <section className={styles.jobError} aria-labelledby="result-heading"><h3 id="result-heading">처리 결과 · {result.label}</h3>{job.resultCode&&<code>{job.resultCode}</code>}<p>{result.detail}</p></section>
      <section className={styles.jobError} aria-labelledby="error-heading">
        <h3 id="error-heading">{error.label}</h3>
        {job.errorCode && <code>{job.errorCode}</code>}
        <p>{error.detail}</p>
      </section>
      <dl className={styles.jobFacts}>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
