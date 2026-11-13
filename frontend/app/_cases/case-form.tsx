"use client";
import { useActionState, useRef, useState } from "react";
import { saveCase, type CaseActionState } from "./actions";
import type { CaseCommand, CaseType } from "./types";
import styles from "../cases/page.module.css";
export function CaseForm({
  command,
  types = [],
  initial,
}: {
  command: CaseCommand;
  types?: CaseType[];
  initial?: {
    title: string;
    typeCode?: string;
    content?: string;
    occurredOn?: string | null;
  };
}) {
  const [title, setTitle] = useState(initial?.title ?? ""),
    [typeCode, setType] = useState(initial?.typeCode ?? "OTHER"),
    [content, setContent] = useState(initial?.content ?? ""),
    [date, setDate] = useState(initial?.occurredOn ?? ""),
    [confirmed, setConfirmed] = useState(false);
  const deleting =
      command.operation === "delete" || command.operation === "deleteFact",
    fact =
      command.operation === "createFact" || command.operation === "updateFact";
  const request = useRef<{ id: string; payload: string } | null>(null);
  const [state, action, pending] = useActionState(
    async (_previous: CaseActionState, form: FormData) => {
      // Prefer submitted values: native input/autofill can precede React state.
      // Disabled fields are absent when retrying an uncertain request.
      const submittedTitle = String(form.get("title") ?? title);
      const submittedType = String(form.get("typeCode") ?? typeCode);
      const submittedContent = String(form.get("content") ?? content);
      const submittedDate = String(form.get("occurredOn") ?? date);
      if (!deleting) {
        setTitle(submittedTitle);
        if (fact) { setContent(submittedContent); setDate(submittedDate); }
        else setType(submittedType);
      }
      const payload = JSON.stringify([command, submittedTitle, submittedType, submittedContent, submittedDate]);
      if (request.current?.payload !== payload)
        request.current = { id: crypto.randomUUID(), payload };
      form.set("requestId", request.current.id);
      if (!deleting) {
        form.set("title", submittedTitle);
        if (fact) {
          form.set("content", submittedContent);
          form.set("occurredOn", submittedDate);
        } else form.set("typeCode", submittedType);
      }
      const result = await saveCase(command, form);
      if (result?.terminal) request.current = null;
      return result;
    },
    null,
  );
  const label =
    command.operation === "create"
      ? "사건 저장"
      : command.operation === "createFact"
        ? "사실관계 저장"
        : deleting
          ? "삭제"
          : "수정 내용 저장";
  return (
    <form action={action} className={styles.form}>
      {!deleting && (
        <>
          <label>
            제목
            <input
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={80}
              disabled={pending || Boolean(state && !state.terminal)}
              placeholder={
                fact ? "예: 계약 종료 통지" : "예: 임대차 보증금 반환"
              }
            />
          </label>
          {!fact ? (
            <label>
              사건 분류
              <select
                name="typeCode"
                value={typeCode}
                onChange={(event) => setType(event.target.value)}
                required
                disabled={pending || Boolean(state && !state.terminal)}
              >
                {!types.some((item) => item.code === typeCode) && (
                  <option value={typeCode} disabled>
                    현재 분류 · 사용 종료
                  </option>
                )}
                {types.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                관련 날짜 <span>선택</span>
                <input
                  type="date"
                  name="occurredOn"
                  defaultValue={date}
                  onChange={(event) => setDate(event.target.value)}
                  min="0001-01-01"
                  max="9999-12-31"
                  disabled={pending || Boolean(state && !state.terminal)}
                />
              </label>
              <label className={styles.wide}>
                사실관계 내용
                <textarea
                  name="content"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  required
                  maxLength={4000}
                  rows={5}
                  disabled={pending || Boolean(state && !state.terminal)}
                  placeholder="확인한 사실을 적어 주세요. 이름 대신 임대인·임차인 같은 역할명으로 적으면 좋습니다."
                />
              </label>
            </>
          )}
        </>
      )}
      {deleting && (
        <p className={styles.wide}>
          {command.operation === "delete"
            ? "사건을 삭제하면 포함된 사실관계도 목록에서 숨겨집니다."
            : "이 사실관계는 목록에서 숨겨지며 변경 이력은 보관합니다."}
        </p>
      )}
      <label className={styles.confirm}>
        <input
          type="checkbox"
          name="confirmed"
          value="yes"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          required
          disabled={pending}
        />
        {deleting
          ? "삭제할 내용을 확인했습니다."
          : "입력한 내용을 확인했으며 저장에 동의합니다."}
      </label>
      {state?.error && (
        <p role="alert" className={styles.error}>
          {state.error}{" "}
          {state.terminal && command.caseId && (
            <a href={"/cases/" + command.caseId}>최신 내용 확인 ↗</a>
          )}
        </p>
      )}
      <div className={styles.formActions}>
        <button
          type="submit"
          disabled={pending}
          data-danger={deleting || undefined}
        >
          {pending ? "처리 중…" : label}
        </button>
      </div>
    </form>
  );
}
export function DeleteCase({
  command,
  label,
}: {
  command: CaseCommand;
  label: string;
}) {
  return (
    <details className={styles.delete}>
      <summary aria-label={label} title={label}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6" />
        </svg>
      </summary>
      <CaseForm command={command} />
    </details>
  );
}
