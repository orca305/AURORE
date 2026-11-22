"use client";
import { useState, useTransition } from "react";
import { addCaseTask, deleteCaseTask, toggleCaseTask } from "./task-actions";
import styles from "./tasks.module.css";

export type Task = { id: string; text: string; done: boolean };

export function TaskList({ caseId, items, max }: { caseId: string; items: Task[]; max: number }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ error: string | null }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await work();
        if (result.error) setError(result.error);
        else after?.();
      } catch { setError("처리하지 못했습니다. 다시 시도해 주세요."); }
    });
  }

  return <section className={styles.tasks} aria-labelledby="case-tasks-title">
    <h2 id="case-tasks-title">다음 할 일</h2>
    {items.length === 0 ? <p className={styles.empty}>아직 적어 둔 할 일이 없어요. 사건에서 해야 할 일을 번호 순서대로 적어 두세요.</p>
      : <ol className={styles.list}>{items.map(task => <li key={task.id} data-done={task.done ? "1" : undefined}><div className={styles.row}>
        <label><input type="checkbox" checked={task.done} disabled={pending} onChange={event => run(() => toggleCaseTask(caseId, task.id, event.target.checked))} /><span>{task.text}</span></label>
        <button type="button" className={styles.remove} disabled={pending} aria-label={task.text + " 지우기"} title="지우기" onClick={() => run(() => deleteCaseTask(caseId, task.id))}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>
        </button>
      </div></li>)}</ol>}
    {items.length < max && <form className={styles.add} onSubmit={event => { event.preventDefault(); const value = text.trim(); if (value) run(() => addCaseTask(caseId, value), () => setText("")); }}>
      <input value={text} maxLength={200} onChange={event => setText(event.target.value)} placeholder="예: 내용증명 발송" aria-label="새 할 일" disabled={pending} />
      <button type="submit" data-primary disabled={pending || !text.trim()} aria-label="할 일 추가" title="할 일 추가">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </form>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
