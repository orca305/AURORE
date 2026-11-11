"use client";

import Link from "next/link";
import { startTransition, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { cancelChatJob, markChatRead, refreshChat, retryChatJob, sendChatMessage } from "./actions";
import { isPendingJob, type ChatDetail, type Message, type Phase, type Reply } from "./types";
import styles from "./conversation.module.css";
export type { Reply } from "./types";

const examples = [
  { topic: "임대차 보증금", question: "보증금을 돌려받지 못했어요" },
  { topic: "계약 갱신", question: "계약을 갱신해 달라는 통지가 도달하면 언제 갱신되나요?" },
];
const followups = {
  start: [],
  "lease-end": ["네, 계약이 끝났어요", "아직 안 끝났어요"],
  "renewal-delivery": ["네, 도달했어요", "도달했는지 모르겠어요"],
};

export function Conversation({ ask, initialChat }: {
  ask?: (question: string, phase: Phase) => Promise<Reply>;
  initialChat?: ChatDetail | null;
}) {
  const saved = !ask;
  const [detail, setDetail] = useState(initialChat ?? null);
  const [messages, setMessages] = useState<Message[]>(initialChat?.messages ?? []);
  const [phase, setPhase] = useState<Phase>(initialChat?.phase ?? "start");
  const [olderCursor, setOlderCursor] = useState(initialChat?.nextBeforeSeq ?? null);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const acceptedRevision = useRef(initialChat?.revision ?? 0);
  const viewEpoch = useRef(0);
  const inFlight = useRef(false);
  const retryRequest = useRef<{ roomId: string; id: string; text: string; revision: number } | null>(null);
  const latest = useRef<HTMLDivElement>(null);
  const inputField = useRef<HTMLTextAreaElement>(null);
  const pending = submitting || isPendingJob(detail?.job ?? null);
  const roomId = detail?.id;
  const jobId = detail?.job?.id;
  const jobStatus = detail?.job?.status;
  const hasMessages = messages.length > 0;
  const latestMessageKey = messages.at(-1)?.id ?? messages.length;

  const applyChat = useCallback((data: ChatDetail, earlier = false) => {
    const current = data.revision >= acceptedRevision.current;
    if (!current && !earlier) return;
    if (current) {
      acceptedRevision.current = data.revision;
      setDetail(data);
      setPhase(data.phase);
    }
    setMessages(previous => {
      const rows = new Map(previous.map(message => [message.id, message]));
      for (const message of data.messages) {
        if (!earlier || !rows.has(message.id)) rows.set(message.id, message);
      }
      return Array.from(rows.values()).sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
    });
    if (earlier) setOlderCursor(data.nextBeforeSeq);
  }, []);

  useEffect(() => {
    if (saved && initialChat?.id) {
      const epoch = viewEpoch.current;
      startTransition(async () => {
        const result = await markChatRead(initialChat.id).catch(() => ({ data: null, error: "대화를 불러오지 못했습니다.", status: 503 }));
        if (epoch !== viewEpoch.current) return;
        if (result.data) applyChat(result.data);
        else setNotice(result.error);
      });
    }
  }, [saved, initialChat?.id, applyChat]);

  useEffect(() => {
    if (!saved || !roomId || !jobId || !jobStatus || !["QUEUED", "RUNNING", "RETRY_WAIT"].includes(jobStatus)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const id = roomId;
    const epoch = viewEpoch.current;
    function schedule(delay: number) {
      timer = setTimeout(() => startTransition(async () => {
        const result = await refreshChat(id).catch(() => ({ data: null, error: "대화 상태를 확인하지 못했습니다. 다시 연결하는 중입니다.", status: 503 }));
        if (!active || epoch !== viewEpoch.current) return;
        if (result.data) {
          setPollError(null);
          applyChat(result.data);
          if (isPendingJob(result.data.job)) schedule(800);
        } else {
          setPollError(result.error);
          if (result.status >= 500) schedule(4000);
        }
      }), delay);
    }
    schedule(500);
    return () => { active = false; clearTimeout(timer); };
  }, [saved, roomId, jobId, jobStatus, applyChat]);

  useEffect(() => {
    if (hasMessages) latest.current?.scrollIntoView({ block: "nearest" });
  }, [hasMessages, latestMessageKey, pending]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || inFlight.current || pending) return;
    inFlight.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      if (ask) {
        setInput("");
        setMessages(previous => [...previous, { role: "user", text: question }]);
        const reply = await ask(question, phase);
        setPhase(reply.phase);
        setMessages(previous => [...previous, { role: "assistant", text: reply.text, source: reply.source }]);
      } else {
        const previous = retryRequest.current;
        const request = previous?.text === question ? previous : {
          roomId: detail?.id ?? crypto.randomUUID(),
          id: crypto.randomUUID(), text: question, revision: detail?.revision ?? 0,
        };
        retryRequest.current = request;
        const result = await sendChatMessage(request.roomId, request.id, question, request.revision);
        if (result.data) {
          retryRequest.current = null;
          setInput("");
          applyChat(result.data);
          window.history.replaceState(null, "", "/?chat=" + result.data.id);
          window.dispatchEvent(new Event("aurore:chat-history"));
        } else {
          setNotice(result.error);
          if (result.status === 409 && detail) {
            const current = await refreshChat(detail.id);
            if (current.data) applyChat(current.data);
            retryRequest.current = null;
          }
        }
      }
    } catch {
      setNotice("대화를 처리하지 못했습니다. 입력한 내용을 확인하고 다시 시도해 주세요.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function reset() {
    viewEpoch.current += 1;
    acceptedRevision.current = 0;
    setDetail(null);
    setMessages([]);
    setPhase("start");
    setOlderCursor(null);
    setInput("");
    setNotice(null);
    setPollError(null);
    retryRequest.current = null;
    if (saved) window.history.replaceState(null, "", "/");
    window.dispatchEvent(new Event("aurore:chat-history"));
    inputField.current?.focus();
  }

  async function jobAction(retry: boolean) {
    if (!detail?.job || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const result = await (retry ? retryChatJob(detail.job.id) : cancelChatJob(detail.job.id));
      if (result.data) { setPollError(null); applyChat(result.data); }
      setNotice(result.error);
    } catch { setNotice("작업 상태를 변경하지 못했습니다. 다시 시도해 주세요."); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  async function earlier() {
    if (!detail || !olderCursor || loadingEarlier) return;
    setLoadingEarlier(true);
    const epoch = viewEpoch.current;
    try {
      const result = await refreshChat(detail.id, olderCursor);
      if (epoch !== viewEpoch.current) return;
      if (result.data) applyChat(result.data, true);
      else setNotice(result.error);
    } catch { setNotice("이전 대화를 불러오지 못했습니다. 다시 시도해 주세요."); }
    finally { setLoadingEarlier(false); }
  }

  return <section aria-label="오로르 대화">
    <div className={styles.context}>
      <div>
        <h1>{detail?.title ?? (messages.length ? "나의 법률 대화" : "무슨 일이 있었나요?")}</h1>
        <p>나의 상황을 이야기하고, 필요한 사실을 함께 확인합니다.</p>
      </div>
      {messages.length > 0 && <button type="button" disabled={submitting || (pending && !pollError)}
        className={styles.reset} onClick={reset}>새 대화 ↗</button>}
    </div>
    {olderCursor && <button className={styles.reset} type="button" disabled={loadingEarlier} onClick={() => void earlier()}>
      {loadingEarlier ? "이전 대화 불러오는 중…" : "이전 대화 더 보기"}
    </button>}
    {(hasMessages || pending) && <div className={styles.record}>
      <section aria-label="대화 내용" aria-live="polite" className={styles.history}>
        <ol className={styles.messages}>
          {messages.map((message, index) => <li key={message.id ?? index}
            className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
            <p className={styles.speaker}>{message.role === "user" ? "내 이야기" : "오로르"}</p>
            <div className={styles.speech}>
              <p className={styles.messageText}>{message.text}</p>
              {message.source && <figure className={styles.citation}>
                <p className={styles.citationLabel}>확인한 원문</p>
                <blockquote>{message.source.quote}</blockquote>
                <figcaption>
                  {message.source.href && <Link href={message.source.href}>{message.source.label} <span aria-hidden="true">↗</span></Link>}
                  <a href={message.source.url}>{message.source.href ? "법제처 원문" : message.source.label}</a>
                </figcaption>
                {message.source.warning && <p className={styles.sourceWarning}>{message.source.warning}</p>}
              </figure>}
            </div>
          </li>)}
        </ol>
        {pending && <p role="status" className={styles.pending}>{submitting ? "질문을 저장하는 중입니다." : "오로르가 확인 중입니다."}</p>}
        <div ref={latest} />
      </section>
      {!pending && followups[phase].length > 0 && <div className={styles.followups} aria-label="빠른 답변">
        {followups[phase].map(text => <button key={text} type="button"
          onClick={() => { setInput(text); inputField.current?.focus(); }}>{text} ↗</button>)}
      </div>}
      <div className={styles.sources}>
        <p>답변에 쓰인 법령·판례는 인용문과 함께 표시합니다.</p>
        <Link href="/legals">법규 원문 검색 ↗</Link>
      </div>
    </div>}
    {(notice || pollError) && <p role="alert" className={styles.error}>{notice || pollError}</p>}
    {detail?.job && ["FAILED", "CANCELLED"].includes(detail.job.status) && <div className={styles.jobControls}>
      <p>{detail.job.status === "FAILED" ? "답변을 준비하지 못했습니다. 저장된 질문으로 다시 시도할 수 있어요." : "답변 준비를 취소했습니다."}</p>
      <button type="button" className={styles.reset} disabled={submitting} onClick={() => void jobAction(true)}>답변 다시 시도</button>
    </div>}
    {saved && pending && <button type="button" className={styles.reset} disabled={submitting} onClick={() => void jobAction(false)}>답변 준비 취소</button>}
    <form onSubmit={send} className={`${styles.composer} ${!hasMessages ? styles.initialComposer : ""}`}>
      <label htmlFor="conversation-input">{hasMessages ? "이어서 이야기하기" : "나의 상황"}</label>
      <textarea ref={inputField} id="conversation-input" name="question" value={input}
        onChange={event => setInput(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        required maxLength={1000} placeholder="상황이나 궁금한 점을 편하게 적어 주세요." />
      <div className={styles.composeFooter}>
        <p>Enter 전송 · Shift + Enter 줄바꿈</p>
        <button type="submit" disabled={pending || !input.trim()} className={styles.send}>
          {pending ? "확인 중…" : "보내기 →"}
        </button>
      </div>
      {!hasMessages && <div className={styles.examples} aria-label="예시 질문">
        <span>예시로 시작</span>
        {examples.map(({ topic, question }) => <button key={topic} type="button" className={styles.example}
          title={question} onClick={() => { setInput(question); inputField.current?.focus(); }}>
          <strong>{topic} ↗</strong><small>{question}</small>
        </button>)}
      </div>}
    </form>
    {!hasMessages && !pending && <p className={styles.sourceNote}>답변은 법령·판례의 원문과 함께 확인할 수 있습니다. <Link href="/legals">법규 검색 ↗</Link></p>}
  </section>;
}
