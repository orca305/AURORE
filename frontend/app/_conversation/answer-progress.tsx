"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./answer-progress.module.css";

type Stage = "analyze" | "search" | "write";

const labels: Record<string, string> = {
  saving: "질문을 저장하고 있어요",
  start: "1. 질문을 이해해요",
  analyze: "1. 질문을 이해해요",
  search: "2. 관련 법령·조문을 찾아요",
  write: "3. 확인한 원문으로 답변을 써요",
};
// 단계별 진행률 기준(%). 단계 안에서는 시간이 지날수록 조금씩 차오른다.
const base: Record<string, number> = { saving: 6, start: 12, analyze: 28, search: 58, write: 84 };

function useSeconds() {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, Math.round((now - started) / 1000));
}

/** 저울 아이콘을 감싸는 원형 게이지. 단계가 바뀌면 새로 만들어져(key) 그 단계에서 지난 시간만큼 조금씩 차오른다. */
function Dial({ stageKey }: { stageKey: string }) {
  const seconds = useSeconds();
  const percent = Math.min(97, (base[stageKey] ?? 12) + Math.min(14, seconds * 1.1));
  const radius = 46;
  const length = 2 * Math.PI * radius;
  return <>
  <div className={styles.dial} role="progressbar" aria-label="답변 준비 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
    <svg viewBox="0 0 100 100" className={styles.track} aria-hidden="true">
      <circle cx="50" cy="50" r={radius} className={styles.trackBg} />
      <circle cx="50" cy="50" r={radius} className={styles.trackFill} strokeDasharray={length} strokeDashoffset={length * (1 - percent / 100)} />
    </svg>
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v16M8 20h8" /><circle cx="12" cy="5" r="1.2" fill="currentColor" /><path d="M5 8.5l7-2.5 7 2.5" /><path d="M5 8.5l-2.5 6h5l-2.5-6ZM19 8.5l-2.5 6h5l-2.5-6Z" fill="currentColor" fillOpacity=".15" /></svg>
  </div>
  <b className={styles.percent} aria-hidden="true">{Math.round(percent)}%</b>
  </>;
}

/**
 * 답변을 만드는 동안 화면 가운데에 띄우는 최소한의 진행 창(저울 아이콘, 게이지, 지금 단계 문구). 모달이라 이 동안 다른 조작은 막힌다.
 * 작은 "취소"로 언제든 빠져나올 수 있고, 상태를 확인하지 못하면 창을 닫고 화면으로 돌아갈 수 있다.
 */
export function AnswerProgress({ active, saving, stage, failing, onCancel, cancelDisabled }: {
  active: boolean;
  saving: boolean;
  stage?: Stage;
  failing: boolean;
  onCancel?: () => void;
  cancelDisabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const [wasActive, setWasActive] = useState(false);
  if (wasActive !== active) { setWasActive(active); if (!active) setDismissed(false); }
  const open = active && !dismissed;
  const key = saving ? "saving" : stage ?? "start";

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return <dialog
    ref={dialog}
    className={styles.dialog}
    aria-label="답변을 만드는 중"
    onCancel={(event) => event.preventDefault()}
  >
    <div className={styles.body}>
      <Dial key={key} stageKey={key} />
      <p key={"label-" + key} className={styles.label} role="status" aria-live="polite">{labels[key]}</p>
      {onCancel && !saving && <button type="button" className={styles.close} aria-label="답변 취소" title="답변 취소" disabled={cancelDisabled} onClick={onCancel}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>}
      {failing && <p role="alert" className={styles.warn}>답변 상태를 확인하지 못하고 있어요. 잠시 기다리거나 화면으로 돌아갈 수 있어요.</p>}
      {failing && <button type="button" className={styles.link} onClick={() => setDismissed(true)}>화면으로 돌아가기</button>}
    </div>
  </dialog>;
}
