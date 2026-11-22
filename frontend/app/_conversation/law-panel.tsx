"use client";
import Link from "next/link";
import { useState } from "react";
import type { Source } from "./types";
import styles from "./conversation.module.css";

/** 오른쪽 열의 근거 조문 원문 패널. 대화에서 쓴 근거가 여러 개면 탭으로 고른다. */
export function LawPanel({ sources }: { sources: Source[] }) {
  const [picked, setPicked] = useState(0);
  if (!sources.length) return null;
  const at = Math.min(picked, sources.length - 1);
  const source = sources[at];
  const checked = source.verification !== "UNREVIEWED";
  return <aside className={styles.lawPanel} aria-label="근거 조문 원문">
    <div className={styles.lawHead}>
      {sources.length > 1 && <div role="tablist" className={styles.lawTabs}>{sources.map((item, index) => <button key={item.label + index} type="button" role="tab" aria-selected={index === at} className={styles.lawTab} data-on={index === at ? "1" : undefined} onClick={() => setPicked(index)}>{item.label.replace(/\s·.*$/u, "").slice(0, 18)}</button>)}</div>}
      <span className={styles.lawBadge} data-ok={checked ? "1" : undefined}>{checked ? "원문 확인됨" : "검색 후보"}</span>
    </div>
    <div className={styles.lawBody}>
      <h3>{source.label}</h3>
      <p className={styles.lawText}>{source.quote}</p>
    </div>
    <div className={styles.lawFoot}>
      <span>{checked ? "법제처 원문과 일치" : "질문과 맞는지 원문을 확인해 주세요"}</span>
      {source.href && <Link href={source.href} data-action-link aria-label="법규에서 보기" title="법규에서 보기">법규에서 보기 </Link>}
      <a href={source.url} target="_blank" rel="noopener noreferrer">법제처 원문</a>
    </div>
  </aside>;
}
