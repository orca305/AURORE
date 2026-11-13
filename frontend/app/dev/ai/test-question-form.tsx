"use client";

import { useActionState, useState } from "react";

export type Result = {
  error?: string;
  answer?: string;
  mode?: string;
  source?: { label: string; dateLabel: string; url: string; quote: string };
};

const example = "보증금을 반환받지 못해 임차권등기명령을 신청하려고 합니다";

export function TestQuestionForm({ ask }: { ask: (previous: Result, form: FormData) => Promise<Result> }) {
  const [result, action, pending] = useActionState(ask, {});
  const [question, setQuestion] = useState("");

  return <>
    <form action={action} className="search">
      <label htmlFor="test-mode">테스트 유형</label>
      <select id="test-mode" name="testMode" defaultValue="law">
        <option value="law">법령 모의 답변</option>
        <option value="bad-citation">인용 오류 재현</option>
        <option value="local-ai">로컬 AI 연결</option>
      </select>
      <label htmlFor="test-question">테스트 질문</label>
      <div className="search-row">
        <input id="test-question" name="question" value={question} onChange={event => setQuestion(event.target.value)} required maxLength={1000} placeholder={example} />
        <button type="submit" disabled={pending}>{pending ? "응답 중…" : "보내기"}</button>
      </div>
      <button type="button" className="mt-3 underline" onClick={() => setQuestion(example)}>임차권등기명령 예제 입력</button>
    </form>
    <section className="results" aria-live="polite" aria-atomic="true">
      {pending ? <p>응답을 기다리는 중입니다.</p> : <>
        {result.mode && <h2>{result.mode}</h2>}
        {result.error && <p>{result.error}</p>}
        {result.answer && <p className="whitespace-pre-wrap wrap-anywhere">{result.answer}</p>}
        {result.source && <figure className="mt-4 border-l-2 border-current pl-4">
          <blockquote className="whitespace-pre-wrap wrap-anywhere">{result.source.quote}</blockquote>
          <figcaption className="mt-2">
            <a className="underline" href={result.source.url} target="_blank" rel="noopener noreferrer">{result.source.label} · {result.source.dateLabel}</a>
          </figcaption>
        </figure>}
      </>}
    </section>
  </>;
}
