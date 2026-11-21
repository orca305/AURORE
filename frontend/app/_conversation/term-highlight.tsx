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

const EXPLAIN_HEADINGS = new Set(["질문에 대한 답", "쉽게 풀면", "예를 들어 (가상의 예)", "주의할 점", "확인해 보세요", "함께 본 조문", "도움 받을 곳", "결론", "이렇게 해 보세요", "알아 둘 내용", "근거 조문 (원문 확인됨)"]);

export function HighlightedText({ text }: { text: string }) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  useEffect(() => {
    let active = true;
    loadGlossary().then((list) => { if (active) setTerms(list); });
    return () => { active = false; };
  }, []);
  // 해설의 소제목 줄(질문에 대한 답, 쉽게 풀면 등)은 굵게 보여 주고, 나머지 줄은 용어 하이라이트를 적용한다.
  const lines = useMemo(
    () => text.split("\n").map((line) => (EXPLAIN_HEADINGS.has(line.trim()) ? { heading: line.trim() } : { parts: splitByTerms(line, terms) })),
    [text, terms],
  );
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && "\n"}
          {"heading" in line ? (
            <strong className={styles.explainHeading}>{line.heading}</strong>
          ) : (
            line.parts.map((part, at) => (part.term ? <Term key={at} term={part.term} label={part.text} /> : part.text))
          )}
        </Fragment>
      ))}
    </>
  );
}
