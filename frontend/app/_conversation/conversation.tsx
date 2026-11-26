"use client";

import { UsageNotice } from "./usage-notice";
import {documentSelectionProblem,type DocumentSelection} from './context-selection';
import {TermLookupPanel} from '../_terms/lookup-panel';
import {HighlightedText, useTermPlan} from './term-highlight';
import {DocumentsPanel} from "./documents-panel";
import {AnswerProgress} from "./answer-progress";
import {CaseContextPanel} from "./case-context-panel";
import { CaseConnection } from "./case-connection";
import {CorrectionRead,CorrectionHistory} from "./correction-read";
import {FeedbackBar} from "./feedback-bar";
import {parseAnswer} from "./answer-sections";
import {LawPanel} from "./law-panel";
import Link from "next/link";
import { useMemo, startTransition, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { cancelChatJob, connectChatCase, markChatRead, refreshChat, retryChatJob, sendChatMessage } from "./actions";
import { isPendingJob, type ChatDetail, type Message, type Phase, type Reply } from "./types";
import styles from "./conversation.module.css";
export type { Reply } from "./types";

// 첫 화면 "상황으로 시작하기" 카드. 누르면 입력창에 채워 줄 뿐 바로 보내지 않는다.
const examples = [
  { topic: "집 · 임대차", question: "보증금을 돌려받지 못했어요", tone: "tone1", icon: "M3 11l9-7 9 7v9H3zM9 20v-6h6v6" },
  { topic: "일 · 근로", question: "월급이나 퇴직금이 안 나와요", tone: "tone2", icon: "M4 8h16v11H4zM9 8V5h6v3M4 13h16" },
  { topic: "소비 · 계약", question: "약관이 불공정한 것 같아요", tone: "tone3", icon: "M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6" },
  { topic: "돈 · 채무", question: "빚이 많아서 회생을 알아봐요", tone: "tone4", icon: "M3 7h18v12H3zM3 11h18M7 15h3" },
] as const;
const followups = {
  start: [],
  "lease-end": ["네, 계약이 끝났어요", "아직 안 끝났어요"],
  "renewal-delivery": ["네, 도달했어요", "도달했는지 모르겠어요"],
};

type Block = { kind: "list"; items: string[] } | { kind: "text"; text: string };
type BasisGroup = { name: string; articles: string[] };

/** 문장 끝의 " — 근거: 법 제2조, 법 제9조" 를 본문과 근거 묶음으로 나눈다(같은 법은 한 칩으로 묶는다). */
function splitBasis(text: string): { body: string; groups: BasisGroup[] } {
  const match = /^([\s\S]*?)\s*[—–]\s*근거:\s*([\s\S]+)$/u.exec(text);
  if (!match) return { body: text, groups: [] };
  const groups: BasisGroup[] = [];
  for (const raw of match[2].split(/,\s*(?=[^,]*제\d)/u)) {
    const ref = raw.trim();
    if (!ref) continue;
    const parts = /^(.+?)\s+(제\d+조.*)$/u.exec(ref);
    const name = parts ? parts[1] : ref;
    const article = parts ? parts[2] : "";
    const found = groups.find(group => group.name === name);
    if (found) { if (article && !found.articles.includes(article)) found.articles.push(article); }
    else groups.push({ name, articles: article ? [article] : [] });
  }
  return { body: match[1].trim(), groups };
}

/** 법제처 국가법령정보센터의 원문 주소(법령명, 조 번호). 법령명과 조 번호는 주소에 맞게 인코딩한다. */
const lawUrl = (name: string) => "https://www.law.go.kr/법령/" + encodeURIComponent(name);
const articleUrl = (name: string, article: string) => {
  const found = /^(제\d+조(?:의\d+)?)/u.exec(article);
  return found ? lawUrl(name) + "/" + encodeURIComponent(found[1]) : lawUrl(name);
};

function BasisChips({ groups }: { groups: BasisGroup[] }) {
  if (!groups.length) return null;
  return <span className={styles.basis} aria-label="근거 조문">
    <span className={styles.basisLabel}>근거</span>
    {groups.map(group => <span key={group.name} className={styles.basisChip}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v15M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z" /></svg>
      <a className={styles.basisLink} href={lawUrl(group.name)} target="_blank" rel="noopener noreferrer" title={group.name + " 법제처 원문 (새 창)"}><span className={styles.basisLaw}>{group.name}</span></a>
      {group.articles.length > 0 && <strong>{group.articles.map((article, at) => <span key={article}>
        {at > 0 && " · "}
        <a className={styles.basisLink} href={articleUrl(group.name, article)} target="_blank" rel="noopener noreferrer" aria-label={group.name + " " + article + " 법제처 원문 (새 창)"} title={group.name + " " + article + " 법제처 원문 (새 창)"}>{article}</a>
      </span>)}</strong>}
    </span>)}
  </span>;
}

function WithBasis({ text, allow }: { text: string; allow?: Set<string> }) {
  const { body, groups } = splitBasis(text);
  return <><HighlightedText text={body} allow={allow} /><BasisChips groups={groups} /></>;
}

/** 단계 본문을 글머리(· - •) 목록과 일반 문단으로 나눈다. */
function toBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[·•\-*]\s*(.+)$/u.exec(line);
    const last = blocks.at(-1);
    if (bullet) {
      if (last?.kind === "list") last.items.push(bullet[1]);
      else blocks.push({ kind: "list", items: [bullet[1]] });
    } else if (last?.kind === "text") last.text += " " + line;
    else blocks.push({ kind: "text", text: line });
  }
  return blocks;
}

// 근거 조문·판례 목록은 단계가 아니라 접었다 펼치는 상자로 보여 준다.
const EVIDENCE = /^(근거 조문|근거 판례|함께 본 조문)/u;

type Seg = { text: string; at: number };
type PlannedBlock = { kind: "text"; seg: Seg } | { kind: "list"; items: Seg[] };

function StepContent({ blocks, plan }: { blocks: PlannedBlock[]; plan: Set<string>[] }) {
  return <>{blocks.map((block, index) => block.kind === "text"
    ? <p key={index} className={styles.messageText}><WithBasis text={block.seg.text} allow={plan[block.seg.at]} /></p>
    : <ul key={index} className={styles.stepList}>{block.items.map((item, at) => <li key={at}><WithBasis text={item.text} allow={plan[item.at]} /></li>)}</ul>)}</>;
}

/** 해설을 화면에 그릴 조각(결론·단계·맺음말·근거)으로 나누고, 읽는 순서대로 번호를 매긴다(용어 툴팁을 답변당 한 번만 달기 위해). */
function buildAnswer(text: string) {
  const parsed = parseAnswer(text);
  if (!parsed.structured) return { structured: false as const, segments: [text] };
  const segments: string[] = [];
  const seg = (value: string): Seg => { segments.push(splitBasis(value).body); return { text: value, at: segments.length - 1 }; };
  const raw = (value: string): Seg => { segments.push(value); return { text: value, at: segments.length - 1 }; };
  const all = parsed.steps.map(step => ({ heading: step.heading, blocks: toBlocks(step.body) }));
  const rawSteps = all.filter(step => !EVIDENCE.test(step.heading));
  const rawEvidence = all.filter(step => EVIDENCE.test(step.heading));
  // 마지막 단계 끝에 붙은 맺음말(예: "실제 분쟁이라면 전문가와 상담하세요")은 타임라인 밖으로 뺀다.
  let closing = "";
  const last = all.at(-1);
  if (last && last.blocks.length > 1 && last.blocks.some(block => block.kind === "list") && last.blocks.at(-1)?.kind === "text") {
    closing = (last.blocks.pop() as { kind: "text"; text: string }).text;
  }
  const conclusion = parsed.conclusion ? seg(parsed.conclusion) : null;
  const steps = rawSteps.map(step => ({
    heading: step.heading,
    blocks: step.blocks.map((block): PlannedBlock => block.kind === "text" ? { kind: "text", seg: seg(block.text) } : { kind: "list", items: block.items.map(seg) }),
  }));
  const closingSeg = closing ? raw(closing) : null;
  const evidence = rawEvidence.map(step => ({
    heading: step.heading,
    items: step.blocks.flatMap(block => block.kind === "list" ? block.items : [block.text]).map(raw),
  }));
  return { structured: true as const, conclusion, steps, closingSeg, evidence, segments };
}

/** 해설을 "한 줄 결론"과 번호 단계로 나눠 보여 준다. 소제목이 없는 짧은 답은 그대로 보여 준다. */
function AnswerBody({ text }: { text: string }) {
  const model = useMemo(() => buildAnswer(text), [text]);
  const plan = useTermPlan(model.segments, text);
  if (!model.structured) return <p className={styles.messageText}><HighlightedText text={text} /></p>;
  const { conclusion, steps, closingSeg, evidence } = model;
  return <>
    {conclusion && <div className={styles.conclusion}><p className={styles.eyebrow}>한 줄 결론</p><p className={styles.conclusionText}><WithBasis text={conclusion.text} allow={plan[conclusion.at]} /></p></div>}
    {steps.length > 0 && <ol className={styles.timeline}>{steps.map((step, index) => <li key={step.heading + index} className={styles.step}>
      <span className={styles.stepNo} data-tone={(index % 5) + 1}>{index + 1}</span>
      <h3>{step.heading}</h3>
      <StepContent blocks={step.blocks} plan={plan} />
    </li>)}</ol>}
    {evidence.map(step => <details key={step.heading} className={styles.evidence}>
      <summary><span>{step.heading.replace(/\s*\(.*$/u, "")}</span><span className={styles.evidenceCount}>{step.items.length}개</span></summary>
      <ul className={styles.evidenceList}>{step.items.map((item, at) => <li key={at}><HighlightedText text={item.text} allow={plan[item.at]} /></li>)}</ul>
    </details>)}
    {closingSeg && <p className={styles.closingNote}><HighlightedText text={closingSeg.text} allow={plan[closingSeg.at]} /></p>}
  </>;
}

export function Conversation({ ask, initialChat, member = false }: {
  member?: boolean;
  ask?: (question: string, phase: Phase) => Promise<Reply>;
  initialChat?: ChatDetail | null;
}) {
  const saved = !ask;
  const [detail, setDetail] = useState(initialChat ?? null);
  const [messages, setMessages] = useState<Message[]>(initialChat?.messages ?? []);
  const [phase, setPhase] = useState<Phase>(initialChat?.phase ?? "start");
  const [olderCursor, setOlderCursor] = useState(initialChat?.nextBeforeSeq ?? null);
  const [input, setInput] = useState("");
  const [clarifyTarget,setClarifyTarget]=useState<string|null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [documentBusy,setDocumentBusy]=useState(false);
  const [documentsOpen,setDocumentsOpen]=useState(false);
  const [termsOpen,setTermsOpen]=useState(false);
  const termsButton=useRef<HTMLButtonElement>(null);
  const termHistory=useRef<HTMLElement>(null);
  const [termQuery,setTermQuery]=useState('');
  const [selectedDocuments,setSelectedDocuments]=useState<DocumentSelection[]>([]);
  const [documentEpoch,setDocumentEpoch]=useState(0);
  const [caseSelection,setCaseSelection]=useState<import("./types").CaseSelection|null>(null);
  const [caseEpoch,setCaseEpoch]=useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const acceptedRevision = useRef(initialChat?.revision ?? 0);
  const viewEpoch = useRef(0);
  const inFlight = useRef(false);
  const retryRequest = useRef<{ roomId: string; id: string; text: string; revision: number; documentIds:string[];caseContext?:import("./types").CaseSelection;clarifyReplyTo?:string } | null>(null);
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
        if (!earlier || !rows.has(message.id)) {
          const known=rows.get(message.id)?.source?.correction;
          const incoming=message.source?.correction;
          if(known?.readAt&&incoming?.key===known.key&&!incoming.readAt)rows.set(message.id,{...message,source:{...message.source!,correction:{...incoming,readAt:known.readAt}}});
          else rows.set(message.id,message);
        }
      }
      return Array.from(rows.values()).sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
    });
    if (earlier) setOlderCursor(data.nextBeforeSeq);
  }, []);

  useEffect(()=>{
    const renamed=(event:Event)=>{const next=(event as CustomEvent<ChatDetail>).detail;if(next?.id===roomId)applyChat(next);};
    window.addEventListener('aurore:chat-renamed',renamed);return()=>window.removeEventListener('aurore:chat-renamed',renamed);
  },[roomId,applyChat]);

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
          // 답을 쓰는 단계에서는 결론이 곧 오므로 조금 더 자주 확인한다.
          if (isPendingJob(result.data.job)) schedule(result.data.job?.stage === "write" ? 500 : 800);
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
    const selectionProblem=documentSelectionProblem(selectedDocuments);
    if(selectionProblem){setNotice(selectionProblem);return;}
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
        const documentIds=selectedDocuments.map(doc=>doc.id).sort();
        const previous = retryRequest.current;
        const request = previous?.text === question && JSON.stringify(previous.documentIds)===JSON.stringify(documentIds) && JSON.stringify(previous.caseContext??null)===JSON.stringify(caseSelection) && (previous.clarifyReplyTo??null)===clarifyTarget ? previous : {
          roomId: detail?.id ?? crypto.randomUUID(),
          id: crypto.randomUUID(), text: question, revision: detail?.revision ?? 0, documentIds,...(caseSelection?{caseContext:caseSelection}:{}),...(clarifyTarget?{clarifyReplyTo:clarifyTarget}:{}),
        };
        retryRequest.current = request;
        const result = await sendChatMessage(request.roomId, request.id, question, request.revision, request.documentIds,request.caseContext,request.clarifyReplyTo);
        if (result.data) {
          retryRequest.current = null;
          setClarifyTarget(null);
          setSelectedDocuments([]);
          setCaseSelection(null);setCaseEpoch(value=>value+1);
          setInput("");
          applyChat(result.data);
          window.history.replaceState(null, "", "/?chat=" + result.data.id);
          window.dispatchEvent(new Event("aurore:chat-history"));
        } else {
          setNotice(result.error);
          if (result.status === 409 && detail) {
            const current = await refreshChat(detail.id);
            if (current.data) applyChat(current.data);
            retryRequest.current = null;setClarifyTarget(null);
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
    if(documentBusy)return;
    setDocumentsOpen(false);
    setDocumentEpoch(value=>value+1);
    setClarifyTarget(null);
    setCaseSelection(null);setCaseEpoch(value=>value+1);
    setSelectedDocuments([]);
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

  async function connectCase(caseId:string|null) {
    if(!detail||inFlight.current||pending)return '진행 중인 작업이 끝난 후 다시 시도해 주세요.';
    inFlight.current=true;setSubmitting(true);
    try {
      const result=await connectChatCase(detail.id,detail.revision,caseId,true);
      if(result.data){applyChat(result.data);window.dispatchEvent(new Event('aurore:chat-history'));return null;}
      if(result.status===409){const latest=await refreshChat(detail.id);if(latest.data)applyChat(latest.data);}
      return result.error??'사건 연결을 변경하지 못했습니다.';
    }catch{return '처리 결과를 확인하지 못했습니다. 연결된 사건을 확인한 뒤 다시 시도해 주세요.';}
    finally{inFlight.current=false;setSubmitting(false);}
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

  // 첫 질문 화면: 대화도 사건 연결도 없는 새 대화일 때만 큰 입력창 구조를 쓴다.
  const fresh = !hasMessages && !detail && !pending;
  const withSide = hasMessages || pending;
  const panelSources = (() => { const seen = new Set<string>(); const list: NonNullable<Message["source"]>[] = []; for (const message of [...messages].reverse()) { if (message.role === "assistant" && message.source && !seen.has(message.source.label)) { seen.add(message.source.label); list.push(message.source); } if (list.length >= 6) break; } return list; })();
  const lastParsed = parseAnswer([...messages].reverse().find(message => message.role === "assistant")?.text ?? "");
  return <section aria-label="오로르 대화" className={[fresh ? styles.fresh : "", withSide ? styles.withSide : ""].filter(Boolean).join(" ") || undefined}>
    {fresh && <p className={styles.heroPill}>공식 법령 원문을 근거로 설명해요</p>}
    <div className={styles.context}>
      <div>
        <div className={styles.titleRow}><h1 className={fresh ? undefined : styles.oneLine} title={detail?.title}>{detail?.title ?? (messages.length ? "나의 법률 대화" : "어떤 일이 있었는지 편하게 말해 주세요")}</h1>
        {(messages.length > 0 || detail) && <button type="button" disabled={documentBusy || submitting || (pending && !pollError)} className={styles.newChat} onClick={reset}>새 대화 </button>}</div>
        <p>{fresh ? "법률 용어를 몰라도 괜찮아요. 관련 법 조문을 찾아 쉬운 말로 풀어 드리고, 원문은 그대로 보여 드려요." : "나의 상황을 이야기하고, 필요한 사실을 함께 확인합니다."}</p>
      </div>
    </div>
    {saved && member && (detail ? <CaseConnection key={detail.id} chat={detail} pending={pending||documentBusy} onSave={async id=>{const error=await connectCase(id);if(!error){setCaseSelection(null);setCaseEpoch(value=>value+1);}return error;}}/> : <p className={styles.caseHint}>대화를 시작하면 나의 사건을 연결할 수 있습니다.</p>)}
    {messages.some(message=>message.source?.correction)&&<div className={styles.correctionNotice} role="status"><strong>{messages.some(message=>message.source?.correction&&!message.source.correction.readAt)?'미확인 정정 안내':'정정 안내 확인 완료'}</strong><p>{messages.some(message=>message.source?.correction&&!message.source.correction.readAt)?'이 대화에 표시된 답변에 미확인 정정 안내가 있습니다. 전후 원문을 살펴본 뒤 안내를 확인해 주세요.':'표시된 정정 안내를 모두 확인했습니다. 이전 답변과 인용문은 그대로 유지됩니다.'}</p></div>}
    {saved&&roomId&&<CorrectionHistory chatId={roomId}/>}
    {olderCursor && <button className={styles.reset} type="button" disabled={loadingEarlier} onClick={() => void earlier()}>
      {loadingEarlier ? "이전 대화 불러오는 중…" : "이전 대화 더 보기"}
    </button>}
    {(hasMessages || pending) && <div className={styles.record}>
      <section ref={termHistory} aria-label="대화 내용" aria-live="polite" className={styles.history}>
        <ol className={styles.messages}>
          {messages.map((message, index) => <li key={message.id ?? index}
            className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
            <p className={styles.speaker}>{message.role === "user" ? "내 이야기" : "오로르"}</p>
            <div className={styles.speech}>
              {message.caseContext&&<p className={styles.sourceNote}>사건 사실관계 {message.caseContext.factCount}개 · 사건 버전 {message.caseContext.revision} · 법령 조회 기준일 {message.caseContext.asOf}{message.caseContext.current===false&&<span> · 이후 사건 정보나 연결이 변경되었습니다. 현재 사실관계로 다시 질문해 주세요.</span>}</p>}
              {message.clarifyReplyTo&&<p className={styles.sourceNote}>이전 질문에 보완한 내용</p>}
              {message.explained&&<p className={styles.citationLabel}>AI 쉬운 해설 · 참고용 (공식 원문이 아닙니다)</p>}
              {message.role==="user"?<p className={styles.messageText}>{message.text}</p>:<AnswerBody text={message.text}/>}
              {saved&&message.clarification&&message.id===messages.at(-1)?.id&&!pending&&<div className={styles.followups} aria-label="근거 보완 안내"><button type="button" disabled={documentBusy} onClick={()=>{setClarifyTarget(message.id!);inputField.current?.focus();}}>내용 보완하기 </button></div>}
              {saved && member && detail?.linkedCase && message.role === "user" && message.id && <Link className={styles.factImport} href={'/cases/'+detail.linkedCase.id+'/from-message/'+message.id} data-action-link>사실관계로 가져오기 </Link>}

              {message.documentAnswer&&<div className={styles.documentEvidence}><p className={styles.citationLabel}>회원이 검토한 첨부자료</p>{message.documentQuotes?.map(quote=><figure className={styles.citation} key={quote.id}><blockquote>{quote.quote}</blockquote><figcaption><a href={'/api/chat-documents/'+roomId+'/'+quote.documentId+'/download'} download>{quote.name} ↓</a><span>원문 일치 · 질문 관련성 AI 검토</span></figcaption></figure>)}{!message.documentQuotes?.length&&<p className={styles.sourceNote}>관련 원문을 확인하지 못했거나 첨부자료가 삭제되어 인용을 표시할 수 없습니다.</p>}</div>}
              {message.source && (message.source.warning || message.source.correction) && <figure className={styles.citation}>
                <p className={styles.citationLabel}>{message.source.verification==='UNREVIEWED'?'검색 후보 · 질문 관련성 미검증':'확인한 원문'}</p>
                <blockquote>{message.source.quote}</blockquote>
                <figcaption>
                  {message.source.href && <Link href={message.source.href} data-action-link>{message.source.label}</Link>}
                  <a href={message.source.url} target="_blank" rel="noopener noreferrer">{message.source.href ? "법제처 원문" : message.source.label}</a>
                </figcaption>
                {message.source.verification==='MODEL_REVIEWED'&&<p className={styles.sourceNote}>원문 일치 · 질문 관련성 AI 검토</p>}
                {message.source.warning && <p className={styles.sourceWarning}>{message.source.warning}</p>}
                {message.source.correction&&<div className={styles.correctionLinks}><span>{new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeZone:'Asia/Seoul'}).format(new Date(message.source.correction.recordedAt))} 정정 원문 등록</span>{message.source.correction.compareHref&&<Link href={message.source.correction.compareHref} data-action-link>정정 전후 비교 </Link>}<Link href={message.source.correction.currentHref} data-action-link>현재 원문 확인 </Link></div>}
                {saved&&roomId&&message.id&&message.source.correction&&<CorrectionRead chatId={roomId} messageId={message.id} noticeKey={message.source.correction.key} readAt={message.source.correction.readAt} onConfirmed={(key,date)=>setMessages(previous=>previous.map(row=>row.id===message.id&&row.source?.correction?.key===key?{...row,source:{...row.source,correction:{...row.source.correction,readAt:date}}}:row))} onStale={()=>{void refreshChat(roomId).then(result=>{if(result.data)applyChat(result.data);});}}/>}
              </figure>}
              {saved&&roomId&&message.id&&message.role==="assistant"&&!message.clarification&&<FeedbackBar chatId={roomId} messageId={message.id} value={message.feedback??null} onChange={next=>setMessages(previous=>previous.map(row=>row.id===message.id?{...row,feedback:next??undefined}:row))}/>}
            </div>
          </li>)}
        </ol>
        {pending && <p role="status" className={styles.pending}>{submitting ? "질문을 저장하는 중입니다." : ({analyze:"질문을 이해하는 중입니다. (1/3)",search:"관련 법령과 조문을 찾는 중입니다. (2/3)",write:"확인한 원문으로 답변을 쓰는 중입니다. (3/3)"} as const)[detail?.job?.stage as "analyze"] ?? "오로르가 확인 중입니다."}</p>}
        <AnswerProgress active={pending} saving={submitting} stage={detail?.job?.stage as "analyze" | "search" | "write" | undefined} preview={detail?.job?.preview} failing={Boolean(pollError)} onCancel={saved ? () => void jobAction(false) : undefined} cancelDisabled={submitting} />
        <div ref={latest} />
      </section>
    </div>}
    {(notice || pollError) && <p role="alert" className={styles.error}>{notice || pollError}</p>}
    {detail?.job && ["FAILED", "CANCELLED"].includes(detail.job.status) && <div className={styles.jobControls}>
      <p>{detail.job.reason==="CASE_CONTEXT_CHANGED" ? "사건 정보가 변경되어 답변 저장을 취소했습니다. 사실관계를 다시 선택하고 질문해 주세요." : detail.job.status === "FAILED" ? "답변을 준비하지 못했습니다. 저장된 질문으로 다시 시도할 수 있어요." : "답변 준비를 취소했습니다."}</p>
      {detail.job.reason!=="CASE_CONTEXT_CHANGED"&&<button type="button" className={styles.reset} disabled={submitting} onClick={() => void jobAction(true)}>답변 다시 시도</button>}
    </div>}
    {saved && pending && <button type="button" className={styles.reset} disabled={submitting} onClick={() => void jobAction(false)}>답변 준비 취소</button>}
    {saved&&member&&detail?.linkedCase&&<CaseContextPanel key={detail.linkedCase.id+':'+caseEpoch} chatId={detail.id} disabled={pending||documentBusy} value={caseSelection} onChange={setCaseSelection} onBusy={busy=>{inFlight.current=busy;setDocumentBusy(busy);}}/>}

    {clarifyTarget&&<div className={styles.caseHint} role="status">이전 질문에 덧붙일 내용을 작성합니다. 첨부자료·사건 정보는 필요한 경우 다시 선택해 주세요. <button type="button" className={styles.reset} disabled={pending||documentBusy} onClick={()=>{setClarifyTarget(null);retryRequest.current=null;}}>새 질문으로 작성</button></div>}
    <form onSubmit={send} className={`${styles.composer} ${!hasMessages ? styles.initialComposer : ""}`}>
      {(selectedDocuments.length>0||caseSelection)&&<div className={styles.contextSummary} aria-label="이번 질문에 사용할 정보"><strong>이번 질문에 사용할 정보</strong>{caseSelection&&<p>사실관계 {caseSelection.factIds.length}개 · 법령 조회 기준일 {caseSelection.asOf}<button type="button" className={styles.reset} disabled={pending||documentBusy} onClick={()=>{setCaseSelection(null);setCaseEpoch(value=>value+1);}}>사건 정보 사용 해제</button></p>}{selectedDocuments.length>0&&<><p>첨부자료 {selectedDocuments.length}/3개 · {selectedDocuments.reduce((sum,row)=>sum+row.characterCount,0).toLocaleString('ko-KR')} / 12,000자</p><ul>{selectedDocuments.map(doc=><li key={doc.id}><span>{doc.name}</span><button type="button" className={styles.reset} disabled={pending||documentBusy} aria-label={doc.name+' 이번 질문에서 제외'} onClick={()=>setSelectedDocuments(rows=>rows.filter(row=>row.id!==doc.id))}>선택 해제</button></li>)}</ul></>}<small>확인한 정보만 이번 질문에 사용하며, 다음 질문에는 다시 선택합니다.</small></div>}
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
        <div className={styles.composeActions}><button ref={termsButton} type="button" className={styles.attach} aria-label="용어 찾기" title="용어 찾기" aria-expanded={termsOpen} aria-controls="conversation-terms" onClick={()=>{const selection=window.getSelection();const selected=selection?.anchorNode&&selection.focusNode&&termHistory.current?.contains(selection.anchorNode)&&termHistory.current.contains(selection.focusNode)?selection.toString().trim():'';if(selected&&selected.length<=100){setTermQuery(selected);setTermsOpen(true);}else{setTermQuery('');setTermsOpen(value=>!value);}setDocumentsOpen(false);}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 18 9 5l5 13M6 13h6M16 8h5m-3 0v10" /></svg></button>{saved&&member&&<button type="button" className={styles.attach} aria-expanded={documentsOpen} disabled={documentBusy||pending} aria-label="첨부파일" title="첨부파일" onClick={()=>{setDocumentsOpen(value=>!value);setTermsOpen(false);}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 5 5l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 8" /></svg></button>}
        <button type="submit" disabled={documentBusy || pending || !input.trim()} className={styles.send} data-primary aria-label={pending ? "확인 중" : "보내기"} title="보내기">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button></div>
      </div>
    </form>
    <UsageNotice />
    {fresh && <div className={styles.situations} aria-label="상황으로 시작하기">
      <p>상황으로 시작하기</p>
      <div className={styles.cards}>
        {examples.map(({ topic, question, tone, icon }) => <button key={topic} type="button" className={`${styles.card} ${styles[tone]}`}
          onClick={() => { setInput(question); inputField.current?.focus(); }}>
          <span className={styles.cardIcon}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg></span><small>{topic}</small><strong>{question}</strong>
        </button>)}
      </div>
    </div>}
    {withSide && <aside className={styles.rcol} aria-label="도움말">
      <LawPanel key={panelSources.map(item => item.label).join("|")} sources={panelSources} />
      <div className={styles.sideCard}><p className={styles.eyebrow}>도움 받을 곳</p>{lastParsed.help ? <p className={styles.sideNote} style={{ whiteSpace: "pre-wrap" }}>{lastParsed.help}</p> : <p className={styles.sideNote}>대한법률구조공단 법률상담 <strong>132</strong></p>}</div>
      {lastParsed.checks.length > 0 && <div className={styles.sideCard}><p className={styles.eyebrow}>확인해 보세요 · 마지막 답변 기준</p>{lastParsed.checks.map(text => <p key={text} className={styles.sideCheck}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></svg><span>{text}</span></p>)}</div>}
      {followups[phase].length > 0 && !pending && <div className={styles.sideCard}><p className={styles.eyebrow}>확인해 보세요 · 마지막 답변 기준</p>
        {followups[phase].map(text => <button key={text} type="button" className={styles.sideAsk} onClick={() => { setInput(text); inputField.current?.focus(); }}>{text}</button>)}</div>}
    </aside>}
    {termsOpen&&<TermLookupPanel key={termQuery} initialQuery={termQuery} onClose={()=>{setTermsOpen(false);termsButton.current?.focus();}}/>}
    {saved&&member&&<DocumentsPanel open={documentsOpen} onClose={()=>setDocumentsOpen(false)} key={documentEpoch} chatId={roomId??null} disabled={pending||documentBusy} onBusy={value=>{inFlight.current=value;setDocumentBusy(value);}} selected={selectedDocuments} onSelect={setSelectedDocuments} onRemoved={id=>setMessages(previous=>previous.map(message=>({...message,documentQuotes:message.documentQuotes?.filter(quote=>quote.documentId!==id)})))} onSaved={data=>{applyChat(data);window.history.replaceState(null,"","/?chat="+data.id);window.dispatchEvent(new Event('aurore:chat-history'));}}/>}
      </section>;
}
