"use client";
import { useActionState, useState } from "react";
import { saveTerm } from "./actions";
import type { Term } from "./types";
import styles from "./terms.module.css";
export function TermForm({
  initial,
  requestId: initialRequest,
}: {
  initial?: Term;
  requestId: string;
}) {
  const [requestId, setRequestId] = useState(initialRequest),
    [draft, setDraft] = useState({
      termName: initial?.termName ?? "",
      aliases: initial?.aliases.join("\n") ?? "",
      definition: initial?.definition ?? "",
      explanation: initial?.explanation ?? "",
      sourceName: initial?.sourceName ?? "",
      sourceUrl: initial?.sourceUrl ?? "",
      sourceReference: initial?.sourceReference ?? "",
    });
  const [state, action, pending] = useActionState(
      saveTerm.bind(
        null,
        initial ? "update" : "create",
        initial?.id ?? null,
        initial?.revision ?? null,
      ),
      null,
    ),
    locked = Boolean(state?.uncertain);
  function change(name: keyof typeof draft, value: string) {
    if (locked) return;
    setDraft((old) => ({ ...old, [name]: value }));
    setRequestId(crypto.randomUUID());
  }
  const field = (
    name: keyof typeof draft,
    label: string,
    max: number,
    required = false,
    rows?: number,
  ) => (
    <label key={name}>
      {label}
      {rows ? (
        <textarea
          name={name}
          rows={rows}
          maxLength={max}
          required={required}
          value={draft[name]}
          readOnly={locked}
          disabled={pending}
          onChange={(e) => change(name, e.target.value)}
        />
      ) : (
        <input
          name={name}
          type={name === "sourceUrl" ? "url" : "text"}
          maxLength={max}
          required={required}
          value={draft[name]}
          readOnly={locked}
          disabled={pending}
          onChange={(e) => change(name, e.target.value)}
        />
      )}
    </label>
  );
  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="requestId" value={requestId} />
      {initial?.sourceKind === "MOLEG_TERM" && <p className={styles.notice}>법제처에서 수집한 정의입니다. 용어·정의·출처를 직접 수정하면 재수집할 때 해당 수정 내용을 보호합니다. 동의어와 쉬운 풀이만 추가할 수도 있습니다.</p>}
      {initial?.state === "PUBLISHED" && (
        <p className={styles.notice}>
          저장하면 공개가 중지됩니다. 수정한 정의와 출처를 검토한 뒤 다시 공개해
          주세요.
        </p>
      )}
      <div className={styles.fields}>
        {field("termName", "용어", 100, true)}
        {field(
          "aliases",
          "동의어·약어 · 한 줄에 하나, 최대 20개",
          2100,
          false,
          3,
        )}
      </div>
      {field("definition", "출처의 정의 · 원문 그대로", 10000, true, 8)}
      {field("explanation", "쉬운 풀이 · 운영자 작성, 선택", 8000, false, 5)}
      <div className={styles.fields}>
        {field("sourceName", "출처 기관·자료명", 200, true)}
        {field("sourceUrl", "출처 원문 주소 · 공공기관 HTTPS", 2000, true)}
      </div>
      {field("sourceReference", "출처 조문·판본·자료 기준 · 선택", 4000)}
      <p className={styles.help}>
        공식 정의와 쉬운 풀이를 구분해 작성하세요. 저장한 내용은 검토 전까지
        공개되지 않습니다.{" "}
        <a
          href="https://www.law.go.kr/LSW/lsTrmScListP.do"
          target="_blank"
          rel="noopener noreferrer"
        >
          법제처 용어 확인
        </a>
      </p>
      {state && (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      <button type="submit" data-primary disabled={pending}>
        {pending
          ? "저장 중…"
          : locked
            ? "같은 내용으로 다시 시도"
            : "임시 저장"}
      </button>
    </form>
  );
}
export function TermCommandForm({
  term,
  mode,
  requestId,
}: {
  term: Term;
  mode: "publish" | "delete";
  requestId: string;
}) {
  const [checked, setChecked] = useState(false),
    [state, action, pending] = useActionState(
      saveTerm.bind(null, mode, term.id, term.revision),
      null,
    ),
    locked = Boolean(state?.uncertain);
  return (
    <form action={action} className={styles.command}>
      <input type="hidden" name="requestId" value={requestId} />
      {locked && checked && (
        <input type="hidden" name="confirmed" value="yes" />
      )}
      <label>
        <input
          type="checkbox"
          name="confirmed"
          value="yes"
          required
          checked={checked}
          disabled={pending || locked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        {mode === "publish"
          ? "출처 원문과 정의를 대조했고 쉬운 풀이가 원문과 구분됨을 확인했습니다."
          : "용어를 삭제하고 공개 검색에서 제외할 내용을 확인했습니다."}
      </label>
      {state && (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      <button
        type="submit"
        data-primary={mode === "publish" || undefined}
        data-danger={mode === "delete" || undefined}
        disabled={pending || !checked}
      >
        {pending
          ? "처리 중…"
          : locked
            ? "같은 요청으로 다시 시도"
            : mode === "publish"
              ? "검토 후 공개"
              : "용어 삭제"}
      </button>
    </form>
  );
}
