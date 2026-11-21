"use client";

import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { splitByTerms, type GlossaryTerm } from "./term-match";
import styles from "./conversation.module.css";

// 공개된 용어 목록은 화면당 한 번만 가져와 모든 답변이 공유한다. 실패하면 하이라이트 없이 원래 문장을 보여 준다.
let glossary: Promise<GlossaryTerm[]> | null = null;
function loadGlossary() {
  glossary ??= fetch("/api/terms/glossary")
    .then((response) => (response.ok ? response.json() : { terms: [] }))
    .then((data) => (Array.isArray(data?.terms) ? (data.terms as GlossaryTerm[]) : []))
    .catch(() => []);
  return glossary;
}

function Term({ term, label }: { term: GlossaryTerm; label: string }) {
  const tip = useId();
  return (
    <a className={styles.termLink} href={"/terms/" + term.id} target="_blank" rel="noopener noreferrer" aria-describedby={tip}>
      {label}
      <span id={tip} role="tooltip" className={styles.termTip}>
        <strong>{term.termName}</strong>
        <span>{term.brief}</span>
        <em>{term.easy ? "쉬운 풀이 · " : ""}클릭하면 용어사전이 새 창으로 열려요</em>
      </span>
    </a>
  );
}

const EXPLAIN_HEADINGS = new Set(["질문에 대한 답", "쉽게 풀면", "예를 들어 (가상의 예)", "주의할 점", "확인해 보세요", "함께 본 조문", "도움 받을 곳", "결론", "이렇게 해 보세요", "알아 둘 내용", "근거 조문 (원문 확인됨)", "관련 판례", "근거 판례 (판결 요지 확인됨)"]);
// 법령과 구분해서 보여 주는 판례 소제목과, 사건번호(대법원 2024다208865) 링크: 누르면 판결문 원문과 조문 대조 결과가 있는 판례 검색으로 이동한다.
const CASE_HEADINGS = new Set(["관련 판례", "근거 판례 (판결 요지 확인됨)"]);
const CASE_REF = /(대법원\s\d{2,4}[가-힣]{1,3}\d+)/u;

export function HighlightedText({ text }: { text: string }) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  useEffect(() => {
    let active = true;
    loadGlossary().then((list) => { if (active) setTerms(list); });
    return () => { active = false; };
  }, []);
  // 해설의 소제목 줄(질문에 대한 답, 쉽게 풀면 등)은 굵게 보여 주고, 나머지 줄은 용어 하이라이트를 적용한다.
  const lines = useMemo(
    () =>
      text.split("\n").map((line) =>
        EXPLAIN_HEADINGS.has(line.trim())
          ? { heading: line.trim(), kind: CASE_HEADINGS.has(line.trim()) ? "case" : "law" }
          : { chunks: line.split(CASE_REF).map((chunk, at) => (at % 2 ? { caseRef: chunk, parts: [] as ReturnType<typeof splitByTerms> } : { caseRef: "", parts: splitByTerms(chunk, terms) })) },
      ),
    [text, terms],
  );
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && "\n"}
          {"heading" in line ? (
            <strong className={line.kind === "case" ? styles.caseHeading : styles.explainHeading}>{line.heading}</strong>
          ) : (
            line.chunks.map((chunk, at) =>
              chunk.caseRef ? (
                <a key={at} className={styles.caseLink} href={"/precedents?q=" + encodeURIComponent(chunk.caseRef.replace(/^대법원\s/u, ""))} target="_blank" rel="noopener noreferrer" title="판결문 원문과 조문 대조 결과를 새 창으로 열어요">
                  {chunk.caseRef}
                </a>
              ) : (
                chunk.parts.map((part, i) => (part.term ? <Term key={at + "-" + i} term={part.term} label={part.text} /> : part.text))
              ),
            )
          )}
        </Fragment>
      ))}
    </>
  );
}
