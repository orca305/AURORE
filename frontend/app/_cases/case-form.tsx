"use client";
import { useActionState, useRef, useState } from "react";
import {caseFormProblem} from './form-policy';
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
  const locked=Boolean(state&&!state.terminal);
  const problem=caseFormProblem(command.operation,{title,typeCode,content,date,confirmed})??(!deleting&&!fact&&!types.some(item=>item.code===typeCode)?'사용할 사건 분류를 선택해 주세요.':null);
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
            <span className={styles.fieldCaption}>제목 <small>{title.length}/80자</small></span>
            <input
              name="title"
              value={title}
              onChange={(event) => {setTitle(event.target.value);setConfirmed(false);}}
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
                onChange={(event) => {setType(event.target.value);setConfirmed(false);}}
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
                <span className={styles.fieldCaption}>관련 날짜 <small>선택</small></span>
                <input
                  type="date"
                  name="occurredOn"
                  value={date}
                  onChange={(event) => {setDate(event.target.value);setConfirmed(false);}}
                  min="0001-01-01"
                  max="9999-12-31"
                  disabled={pending || Boolean(state && !state.terminal)}
                />
              </label>
              <label className={styles.wide}>
                <span className={styles.fieldCaption}>사실관계 내용 <small>{content.length.toLocaleString('ko-KR')}/4,000자</small></span>
                <textarea
                  name="content"
                  value={content}
                  onChange={(event) => {setContent(event.target.value);setConfirmed(false);}}
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
      <div className={styles.savePreview} aria-label={deleting?'삭제 대상 확인':'저장할 내용 확인'}><strong>{deleting?'삭제 대상':'저장할 내용'} · {title.trim()||'제목 미입력'}</strong><p>{deleting?(command.operation==='delete'?'사건과 포함된 사실관계':'선택한 사실관계'):fact?`사실관계 ${content.length.toLocaleString('ko-KR')}자 · 관련 날짜 ${date||'미입력'}`:types.find(item=>item.code===typeCode)?.label??'분류 선택 필요'}</p>{!deleting&&<small>{fact?'확인된 사실만 남기고 불필요한 개인정보를 지워 주세요. 저장 후 대화에서 별도로 선택해 사용합니다.':'사건을 저장한 다음 사실관계를 추가하고 대화에 연결할 수 있습니다.'}</small>}</div>
      {locked&&<p className={styles.notice} role="status">처리 결과가 불확실해 입력을 보존했습니다. 내용을 바꾸지 않고 같은 요청으로 결과를 다시 확인해 주세요.</p>}
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
            <a href={"/cases/" + command.caseId} target="_blank" rel="noopener noreferrer" data-action-link>최신 내용 확인 </a>
          )}
        </p>
      )}
      {problem&&!pending&&<p className={styles.formHint} role="status">{problem}</p>}
      <div className={styles.formActions}>
        <button
          type="submit"
          disabled={pending||Boolean(problem)}
          data-danger={deleting || undefined}
         data-primary>
          {pending ? "처리 중…" : locked?"같은 요청으로 결과 확인":label}
        </button>
      </div>
    </form>
  );
}
export function DeleteCase({
  command,
  label,
  targetTitle,
}: {
  command: CaseCommand;
  label: string;
  targetTitle?:string;
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
      <CaseForm key={command.revision} command={command} initial={{title:targetTitle??label}} />
    </details>
  );
}
