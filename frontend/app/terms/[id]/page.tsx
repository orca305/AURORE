import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "../../_components/site-header";
import { requestTerms, validTermId } from "../../_terms/requests";
import type { Term } from "../../_terms/types";
import { date } from "../../_admin/format";
import styles from "../../_terms/terms.module.css";
export const metadata = { title: "용어 정의와 풀이 | AURORE" };

const SECTION_META: Record<string, { tone: number; icon: string }> = {
  "해설": { tone: 1, icon: "M4 5h16v11H8l-4 4zM8 9h8M8 12h5" },
  "예시": { tone: 2, icon: "M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3ZM10 21h4" },
  "주의점": { tone: 3, icon: "M12 3 2 20h20L12 3ZM12 10v5M12 17.5h.01" },
  "주의할 점": { tone: 3, icon: "M12 3 2 20h20L12 3ZM12 10v5M12 17.5h.01" },
};

/** 쉬운 풀이를 "해설·예시·주의점" 같은 소제목 단위로 나눠 색 카드로 보여 준다. 소제목이 없으면 한 장의 카드로 보인다. */
function ExplanationCards({ text }: { text: string }) {
  const lead: string[] = [];
  const blocks: { heading: string; lines: string[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (SECTION_META[line]) blocks.push({ heading: line, lines: [] });
    else if (blocks.length) blocks.at(-1)!.lines.push(line);
    else lead.push(line);
  }
  return <div className={styles.cards}>
    {lead.length > 0 && <p className={styles.lead}>{lead.join(" ")}</p>}
    {blocks.map(block => {
      const meta = SECTION_META[block.heading];
      return <article key={block.heading} className={styles.card} data-tone={meta.tone}>
        <h3><span className={styles.cardIcon}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={meta.icon} /></svg></span>{block.heading}</h3>
        <p>{block.lines.join(" ")}</p>
      </article>;
    })}
  </div>;
}
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
                  className="ui-button icon-button"
                  aria-label="출처 원문 보기"
                  title="출처 원문 보기"
                >
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" /></svg>
                </a>
              </div>
            </section>
            <section className={styles.block + " " + styles.explanation}>
              <h2>쉬운 풀이</h2>
              {data.explanation ? <ExplanationCards text={data.explanation} /> : <p>아직 등록된 쉬운 풀이가 없습니다. 출처의 정의를 먼저 확인해 주세요.</p>}
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
