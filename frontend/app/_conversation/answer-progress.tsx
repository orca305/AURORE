"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./answer-progress.module.css";

type Stage = "analyze" | "search" | "write";

const steps: { key: Stage; label: string }[] = [
  { key: "analyze", label: "질문을 이해해요" },
  { key: "search", label: "관련 법령·조문을 찾아요" },
  { key: "write", label: "확인한 원문으로 답변을 써요" },
];
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

/** 단계가 바뀌면 새로 만들어져(key) 그 단계에서 지난 시간만큼 조금씩 차오르는 진행 막대. */
function Bar({ stageKey }: { stageKey: string }) {
  const seconds = useSeconds();
  const percent = Math.min(97, (base[stageKey] ?? 12) + Math.min(14, seconds * 1.1));
  return <div className={styles.bar} role="progressbar" aria-label="답변 준비 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
    <i style={{ width: percent + "%" }} />
  </div>;
}

function Elapsed() {
  const elapsed = useSeconds();
  return <p className={styles.time}>{elapsed}초 지났어요{elapsed >= 45 ? " · 조금 더 걸리고 있어요" : ""}</p>;
}

/**
 * 답변을 만드는 동안 화면 가운데에 띄우는 진행 창. 모달이라 이 동안 메뉴를 포함한 다른 조작은 모두 막힌다.
 * 취소 버튼으로는 언제든 빠져나올 수 있고, 상태를 확인하지 못하면 창을 닫고 화면으로 돌아갈 수 있다.
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

  const current = stage ? steps.findIndex((step) => step.key === stage) : -1;

  return <dialog
    ref={dialog}
    className={styles.dialog}
    aria-labelledby="answer-progress-title"
    onCancel={(event) => event.preventDefault()}
  >
    <div className={styles.body}>
      <span className={styles.badge} aria-hidden="true"><span className={styles.spinner} /></span>
      <h2 id="answer-progress-title">{saving ? "질문을 저장하고 있어요" : "오로르가 답변을 만들고 있어요"}</h2>
      <p className={styles.sub}>답변이 끝날 때까지 다른 화면으로 이동하거나 새 질문을 보낼 수 없어요.</p>
      <Bar key={key} stageKey={key} />
      <ol className={styles.steps} aria-live="polite">
        {steps.map((step, index) => <li key={step.key} data-state={index < current ? "done" : index === current ? "now" : "todo"}>
          <span>{index < current ? "✓" : index + 1}</span>{step.label}
        </li>)}
      </ol>
      {active && <Elapsed key={String(active)} />}
      {failing && <p role="alert" className={styles.warn}>답변 상태를 확인하지 못하고 있어요. 잠시 기다리거나 아래에서 화면으로 돌아갈 수 있어요.</p>}
      <div className={styles.actions}>
        {failing && <button type="button" className={styles.ghost} onClick={() => setDismissed(true)}>화면으로 돌아가기</button>}
        {onCancel && !saving && <button type="button" className={styles.ghost} disabled={cancelDisabled} onClick={onCancel}>답변 취소</button>}
      </div>
    </div>
  </dialog>;
}
