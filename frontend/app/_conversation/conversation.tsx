"use client";

import {documentSelectionProblem,type DocumentSelection} from './context-selection';
import {TermLookupPanel} from '../_terms/lookup-panel';
import {DocumentsPanel} from "./documents-panel";
import {CaseContextPanel} from "./case-context-panel";
import { CaseConnection } from "./case-connection";
import {CorrectionRead,CorrectionHistory} from "./correction-read";
import Link from "next/link";
import { startTransition, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { cancelChatJob, connectChatCase, markChatRead, refreshChat, retryChatJob, sendChatMessage } from "./actions";
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

  return <section aria-label="오로르 대화">
    <div className={styles.context}>
      <div>
        <div className={styles.titleRow}><h1>{detail?.title ?? (messages.length ? "나의 법률 대화" : "무슨 일이 있었나요?")}</h1>
        {(messages.length > 0 || detail) && <button type="button" disabled={documentBusy || submitting || (pending && !pollError)} className={styles.newChat} onClick={reset}>새 대화 </button>}</div>
        <p>나의 상황을 이야기하고, 필요한 사실을 함께 확인합니다.</p>
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
              <p className={styles.messageText}>{message.text}</p>
              {saved&&message.clarification&&message.id===messages.at(-1)?.id&&!pending&&<div className={styles.followups} aria-label="근거 보완 안내"><button type="button" disabled={documentBusy} onClick={()=>{setClarifyTarget(message.id!);inputField.current?.focus();}}>내용 보완하기 </button></div>}
              {saved && member && detail?.linkedCase && message.role === "user" && message.id && <Link className={styles.factImport} href={'/cases/'+detail.linkedCase.id+'/from-message/'+message.id} data-action-link>사실관계로 가져오기 </Link>}

              {message.documentAnswer&&<div className={styles.documentEvidence}><p className={styles.citationLabel}>회원이 검토한 첨부자료</p>{message.documentQuotes?.map(quote=><figure className={styles.citation} key={quote.id}><blockquote>{quote.quote}</blockquote><figcaption><a href={'/api/chat-documents/'+roomId+'/'+quote.documentId+'/download'} download>{quote.name} ↓</a><span>원문 일치 · 질문 관련성 AI 검토</span></figcaption></figure>)}{!message.documentQuotes?.length&&<p className={styles.sourceNote}>관련 원문을 확인하지 못했거나 첨부자료가 삭제되어 인용을 표시할 수 없습니다.</p>}</div>}
              {message.source && <figure className={styles.citation}>
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
            </div>
          </li>)}
        </ol>
        {pending && <p role="status" className={styles.pending}>{submitting ? "질문을 저장하는 중입니다." : "오로르가 확인 중입니다."}</p>}
        <div ref={latest} />
      </section>
      {!pending && followups[phase].length > 0 && <div className={styles.followups} aria-label="빠른 답변">
        {followups[phase].map(text => <button key={text} type="button"
          onClick={() => { setInput(text); inputField.current?.focus(); }}>{text} </button>)}
      </div>}
      <div className={styles.sources}>
        <p>답변에 쓰인 법령·판례는 인용문과 함께 표시합니다.</p>
        <Link href="/legals" data-action-link>법규 원문 검색 </Link>
      </div>
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
        <div className={styles.composeActions}><button ref={termsButton} type="button" className={styles.attach} aria-expanded={termsOpen} aria-controls="conversation-terms" onClick={()=>{const selection=window.getSelection();const selected=selection?.anchorNode&&selection.focusNode&&termHistory.current?.contains(selection.anchorNode)&&termHistory.current.contains(selection.focusNode)?selection.toString().trim():'';if(selected&&selected.length<=100){setTermQuery(selected);setTermsOpen(true);}else{setTermQuery('');setTermsOpen(value=>!value);}setDocumentsOpen(false);}}>용어 찾기</button>{saved&&member&&<button type="button" className={styles.attach} aria-expanded={documentsOpen} disabled={documentBusy||pending} onClick={()=>{setDocumentsOpen(value=>!value);setTermsOpen(false);}}>첨부파일</button>}
        <button type="submit" disabled={documentBusy || pending || !input.trim()} className={styles.send} data-primary>
          {pending ? "확인 중…" : "보내기"}
        </button></div>
      </div>
      {!hasMessages && <div className={styles.examples} aria-label="예시 질문">
        <span>예시로 시작</span>
        {examples.map(({ topic, question }) => <button key={topic} type="button" className={styles.example}
          title={question} onClick={() => { setInput(question); inputField.current?.focus(); }}>
          <strong>{topic} </strong><small>{question}</small>
        </button>)}
      </div>}
    </form>
    {termsOpen&&<TermLookupPanel key={termQuery} initialQuery={termQuery} onClose={()=>{setTermsOpen(false);termsButton.current?.focus();}}/>}
    {saved&&member&&<DocumentsPanel open={documentsOpen} onClose={()=>setDocumentsOpen(false)} key={documentEpoch} chatId={roomId??null} disabled={pending||documentBusy} onBusy={value=>{inFlight.current=value;setDocumentBusy(value);}} selected={selectedDocuments} onSelect={setSelectedDocuments} onRemoved={id=>setMessages(previous=>previous.map(message=>({...message,documentQuotes:message.documentQuotes?.filter(quote=>quote.documentId!==id)})))} onSaved={data=>{applyChat(data);window.history.replaceState(null,"","/?chat="+data.id);window.dispatchEvent(new Event('aurore:chat-history'));}}/>}
    {!hasMessages && !pending && <p className={styles.sourceNote}>답변은 법령·판례의 원문과 함께 확인할 수 있습니다. <Link href="/legals" data-action-link>법규 검색 </Link></p>}
  </section>;
}
