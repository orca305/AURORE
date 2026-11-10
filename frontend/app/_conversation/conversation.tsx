"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuroreMark } from "./aurore-mark";
import styles from "./conversation.module.css";

type Phase = "start" | "lease-end" | "renewal-delivery";
export type Reply = {
  phase: Phase;
  text: string;
  source?: { quote: string; label: string; url: string; href?: string };
};
type Message = Pick<Reply, "text" | "source"> & { role: "user" | "assistant" };

const examples = [
  { topic: "임대차 보증금", question: "보증금을 돌려받지 못했어요" },
  { topic: "계약 갱신", question: "계약을 갱신해 달라는 통지가 도달하면 언제 갱신되나요?" },
];

const followups = {
  start: [],
  "lease-end": ["네, 계약이 끝났어요", "아직 안 끝났어요"],
  "renewal-delivery": ["네, 도달했어요", "도달했는지 모르겠어요"],
};

export function Conversation({ ask }: { ask: (question: string, phase: Phase) => Promise<Reply> }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [phase, setPhase] = useState<Phase>("start");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const history = useRef<HTMLElement>(null);
  const inputField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (history.current) history.current.scrollTop = history.current.scrollHeight;
  }, [messages, pending]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setInput("");
    setMessages(previous => [...previous, { role: "user", text: question }]);
    try {
      const reply = await ask(question, phase);
      setPhase(reply.phase);
      setMessages(previous => [...previous, { role: "assistant", text: reply.text, source: reply.source }]);
    } catch {
      setMessages(previous => [...previous, { role: "assistant", text: "응답을 불러오지 못했습니다. 다시 시도해 주세요." }]);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function reset() {
    setMessages([]);
    setPhase("start");
    setInput("");
    inputField.current?.focus();
  }

  return <section aria-label="오로르 대화" className={styles.chat}>
    <div className={styles.chatHeader}>
      <span className={styles.assistantMark}><AuroreMark /></span>
      <div className={styles.assistantIdentity}><strong>오로르</strong><span>법률 대화 도우미</span></div>
      {messages.length > 0
        ? <button type="button" disabled={pending} className={styles.reset} onClick={reset}>
          <span aria-hidden="true">＋</span> 새 대화
        </button>
        : <span className={styles.preview}>예제 체험</span>}
    </div>
    {messages.length === 0 && <div className={styles.examples}>
      <p className={styles.exampleHeading}>예시 질문으로 시작하기</p>
      <div className={styles.exampleGrid}>
        {examples.map(({ topic, question }) => <button key={topic} type="button" className={styles.example}
          onClick={() => { setInput(question); inputField.current?.focus(); }}>
          <span className={styles.exampleTopic}>{topic}</span>
          <span>{question}</span>
          <span aria-hidden="true" className={styles.exampleArrow}>↗</span>
        </button>)}
      </div>
    </div>}
    <section ref={history} aria-label="대화 내용" aria-live="polite" className={styles.history}>
      <ol className={styles.messages}>
        {messages.map((message, index) => <li key={index}
          className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
          <p className={styles.speaker}>{message.role === "user" ? "나" : "오로르"}</p>
          <p className={styles.messageText}>{message.text}</p>
          {message.source && <figure className={styles.citation}>
            <p className={styles.citationLabel}>확인한 원문</p>
            <blockquote>{message.source.quote}</blockquote>
            <figcaption>
              {message.source.href && <Link href={message.source.href}>{message.source.label} <span aria-hidden="true">↗</span></Link>}
              <a href={message.source.url}>{message.source.href ? "법제처 원문" : message.source.label}</a>
            </figcaption>
          </figure>}
        </li>)}
      </ol>
      {pending && <p role="status" className={styles.pending}>오로르가 확인 중입니다.</p>}
    </section>
    {!pending && followups[phase].length > 0 && <div className={styles.followups} aria-label="빠른 답변">
      {followups[phase].map(text => <button key={text} type="button"
        onClick={() => { setInput(text); inputField.current?.focus(); }}>{text}</button>)}
    </div>}
    <form onSubmit={send} className={styles.composer}>
      <label htmlFor="conversation-input" className="sr-only">메시지</label>
      <div className={styles.composerRow}>
        <input ref={inputField} id="conversation-input" name="question" value={input}
          onChange={event => setInput(event.target.value)} required maxLength={1000} placeholder="지금 상황을 입력해 주세요" />
        <button type="submit" disabled={pending || !input.trim()} className={styles.send}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="M12 19V5m-5 5 5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{pending ? "확인 중…" : "보내기"}</span>
        </button>
      </div>
    </form>
  </section>;
}
