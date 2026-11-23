"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./app-dialog.module.css";

type Tone = "danger" | "info";
type Options = { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; tone?: Tone };
type Pending = Options & { kind: "confirm" | "notify"; resolve: (value: boolean) => void };

const icons: Record<Tone, ReactNode> = {
  danger: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  info: <path d="M12 8v5M12 16.5v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />,
};

/**
 * 브라우저 기본 팝업(confirm·alert) 대신 쓰는 디자인된 대화상자.
 * const { confirm, notify, dialog } = useAppDialog();  →  화면 어딘가에 {dialog} 를 두고, if (!(await confirm({...}))) return;
 */
export function useAppDialog() {
  const [current, setCurrent] = useState<Pending | null>(null);
  const ask = useCallback((kind: Pending["kind"], options: Options) => new Promise<boolean>((resolve) => setCurrent({ ...options, kind, resolve })), []);
  const confirm = useCallback((options: Options) => ask("confirm", { tone: "danger", ...options }), [ask]);
  const notify = useCallback((options: Options) => ask("notify", { tone: "info", ...options }).then(() => undefined), [ask]);
  const close = (value: boolean) => {
    current?.resolve(value);
    setCurrent(null);
  };
  const dialog = current ? <AppDialog key={current.title + current.kind} pending={current} onClose={close} /> : null;
  return { confirm, notify, dialog };
}

function AppDialog({ pending, onClose }: { pending: Pending; onClose: (value: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const tone = pending.tone ?? "info";
  useEffect(() => {
    const node = ref.current;
    if (node && !node.open) node.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={styles.dialog}
      data-tone={tone}
      aria-labelledby="app-dialog-title"
      aria-describedby={pending.message ? "app-dialog-message" : undefined}
      onCancel={(event) => { event.preventDefault(); onClose(false); }}
      onClick={(event) => { if (event.target === ref.current) onClose(false); }}
    >
      <div className={styles.body}>
        <span className={styles.icon} aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icons[tone]}</svg>
        </span>
        <h2 id="app-dialog-title">{pending.title}</h2>
        {pending.message && <p id="app-dialog-message">{pending.message}</p>}
      </div>
      <div className={styles.actions}>
        {pending.kind === "confirm" && <button type="button" className={styles.cancel} autoFocus onClick={() => onClose(false)}>{pending.cancelLabel ?? "취소"}</button>}
        <button type="button" className={styles.ok} data-tone={tone} autoFocus={pending.kind === "notify"} onClick={() => onClose(true)}>{pending.confirmLabel ?? (pending.kind === "confirm" ? "확인" : "확인했어요")}</button>
      </div>
    </dialog>,
    document.body,
  );
}
