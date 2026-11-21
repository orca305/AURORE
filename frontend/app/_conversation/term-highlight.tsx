"use client";

import { useEffect, useId, useMemo, useState } from "react";
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

export function HighlightedText({ text }: { text: string }) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  useEffect(() => {
    let active = true;
    loadGlossary().then((list) => { if (active) setTerms(list); });
    return () => { active = false; };
  }, []);
  const parts = useMemo(() => splitByTerms(text, terms), [text, terms]);
  return <>{parts.map((part, index) => part.term ? <Term key={index} term={part.term} label={part.text} /> : part.text)}</>;
}
