"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

type Phase = "start" | "lease-end";
export type Reply = {
  phase: Phase;
  text: string;
  source?: { quote: string; label: string; url: string; href?: string };
};
type Message = Pick<Reply, "text" | "source"> & { role: "user" | "assistant" };

const examples = ["보증금을 돌려받지 못했어요", "계약을 갱신해 달라는 통지가 도달하면 언제 갱신되나요?"];

export function Conversation({ ask }: { ask: (question: string, phase: Phase) => Promise<Reply> }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [phase, setPhase] = useState<Phase>("start");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

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

  return <>
    <section aria-label="대화 내용" aria-live="polite" className="mb-6">
      {messages.length === 0 && <div className="flex flex-wrap gap-2">
        {examples.map(example => <button key={example} type="button" className="rounded-full border px-4 py-2 text-sm"
          onClick={() => setInput(example)}>{example}</button>)}
      </div>}
      <ol className="grid gap-4">
        {messages.map((message, index) => <li key={index}
          className={message.role === "user" ? "ml-auto max-w-[88%] rounded-xl bg-[#204c3f] px-5 py-4 text-white" :
            "mr-auto max-w-[92%] rounded-xl border border-[#d9e0d9] bg-white px-5 py-4"}>
          <p className="text-xs font-semibold">{message.role === "user" ? "나" : "오로르"}</p>
          <p className="mt-1 whitespace-pre-wrap wrap-anywhere">{message.text}</p>
          {message.source && <figure className="mt-3 border-l-2 border-[#bac9bd] pl-3">
            <blockquote className="whitespace-pre-wrap wrap-anywhere text-sm">{message.source.quote}</blockquote>
            <figcaption className="mt-2 flex flex-wrap gap-3 text-sm">
            {message.source.href && <Link className="underline" href={message.source.href}>{message.source.label}</Link>}
            <a className="underline" href={message.source.url}>{message.source.href ? "법제처 원문" : message.source.label}</a>
          </figcaption>
          </figure>}
        </li>)}
      </ol>
      {pending && <p role="status" className="mt-3 text-sm">오로르가 확인 중입니다.</p>}
    </section>
    <form onSubmit={send} className="search">
      <label htmlFor="conversation-input">메시지</label>
      <div className="search-row">
        <input id="conversation-input" name="question" value={input} onChange={event => setInput(event.target.value)}
          required maxLength={1000} placeholder="지금 상황을 입력해 주세요" />
        <button type="submit" disabled={pending}>{pending ? "확인 중…" : "보내기"}</button>
      </div>
      {messages.length > 0 && <button type="button" disabled={pending} className="mt-3 underline"
        onClick={() => { setMessages([]); setPhase("start"); setInput(""); }}>새 대화</button>}
    </form>
  </>;
}
