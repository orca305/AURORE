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
      <span className={styles.lawFootActions}>{source.href && <Link href={source.href} className="ui-button icon-button" aria-label="법규에서 보기" title="법규에서 보기"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v15M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z" /></svg></Link>}
      <a href={source.url} className="ui-button icon-button" target="_blank" rel="noopener noreferrer" aria-label="법제처 원문" title="법제처 원문"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></svg></a></span>
    </div>
  </aside>;
}
