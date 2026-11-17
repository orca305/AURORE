import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "../../_components/site-header";
import { requestTerms, validTermId } from "../../_terms/requests";
import type { Term } from "../../_terms/types";
import { date } from "../../_admin/format";
import styles from "../../_terms/terms.module.css";
export const metadata = { title: "용어 정의와 풀이 | AURORE" };
export default async function TermDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!validTermId(id)) notFound();
  const response = await requestTerms("/" + id);
  if (response?.status === 404) notFound();
  const data = response?.ok ? ((await response.json()) as Term) : null;
  return (
    <>
      <SiteHeader active="terms" />
      <main className="shell">
        <section className="intro">
          <Link href="/terms">← 용어사전</Link>
          <h1>{data?.termName ?? "용어 정의와 풀이"}</h1>
          {data && (
            <p>
              사전 버전 {data.revision} · 공개{" "}
              {date(data.publishedAt ?? data.updatedAt)}
            </p>
          )}
        </section>
        {!data ? (
          <p className="empty" role="status">
            용어를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.
          </p>
        ) : (
          <>
            {data.aliases.length > 0 && (
              <p className={styles.aliases}>
                동의어·약어 · {data.aliases.join(" · ")}
              </p>
            )}
            <section className={styles.block}>
              <h2>출처의 정의</h2>
              <p>{data.definition}</p>
              <div className={styles.source}>
                <p>
                  출처 · {data.sourceName}
                  {data.sourceReference ? " · " + data.sourceReference : ""}
                </p>
                <a
                  href={data.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-action-link
                >
                  출처 원문 보기
                </a>
              </div>
            </section>
            <section className={styles.block + " " + styles.explanation}>
              <h2>쉬운 풀이 · 운영자 작성</h2>
              <p>
                {data.explanation ??
                  "아직 등록된 쉬운 풀이가 없습니다. 출처의 정의를 먼저 확인해 주세요."}
              </p>
            </section>
            <p className={styles.help}>
              같은 용어도 법령과 문맥에 따라 의미가 달라질 수 있습니다. 출처의
              적용 범위를 함께 확인하세요.
            </p>
          </>
        )}
      </main>
    </>
  );
}
