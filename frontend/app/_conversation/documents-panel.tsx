"use client";
import {useRef,useState,type FormEvent} from "react";
import {confirmDocument,listDocuments,readDocument,removeDocument,type DocumentList} from "./document-actions";
import type {ChatDetail} from "./types";
import styles from "./documents.module.css";
type Preview={receipt:string;markdown:string;partial:boolean;filename:string};
export function DocumentsPanel({chatId,disabled,onBusy,onSaved}:{chatId:string|null;disabled:boolean;onBusy:(busy:boolean)=>void;onSaved:(chat:ChatDetail)=>void}){
 const [open,setOpen]=useState(false),[file,setFile]=useState<File|null>(null),[draft,setDraft]=useState<Preview|null>(null),[markdown,setMarkdown]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null),[list,setList]=useState<DocumentList|null>(null),[limit,setLimit]=useState(20),[view,setView]=useState<{id:string;text:string}|null>(null),[deleting,setDeleting]=useState<string|null>(null),[uncertain,setUncertain]=useState(false);
 const newRoom=useRef<string|null>(null),lock=useRef(false),input=useRef<HTMLInputElement>(null);
 function id(){if(chatId)return chatId;return newRoom.current??(newRoom.current=crypto.randomUUID());}
 function start(){if(lock.current||disabled)return false;lock.current=true;setBusy(true);onBusy(true);setError(null);setNotice(null);return true;}
 function stop(){lock.current=false;setBusy(false);onBusy(false);}
 async function load(offset=0,size=limit){const result=await listDocuments(id(),size,offset);if(result.data)setList(result.data);else setError(result.error);}
 async function toggle(){if(busy||disabled)return;setOpen(!open);if(!open&&chatId){if(!start())return;try{await load();}finally{stop();}}}
 async function upload(event:FormEvent){event.preventDefault();if(!file||!start())return;setView(null);
  try{if(!file.size||file.size>5*1024*1024){setError('5MB 이하 파일을 선택해 주세요.');return;}const body=new FormData();body.set('file',file);const response=await fetch('/api/chat-documents/'+id()+'/preview',{method:'POST',body});const data=await response.json();if(!response.ok){setError(data.error??'문서를 변환하지 못했습니다.');return;}const preview=data as Preview;setDraft(preview);setMarkdown(preview.markdown);setConfirmed(false);setUncertain(false);setFile(null);if(input.current)input.current.value='';}
  catch{setError('변환 결과를 확인하지 못했습니다. 다시 시도해 주세요.');}finally{stop();}}
 async function save(event:FormEvent){event.preventDefault();if(!draft||!confirmed||!start())return;
  try{const result=await confirmDocument(id(),draft.receipt,markdown,true);if(result.data){onSaved(result.data);setDraft(null);setMarkdown('');setConfirmed(false);setUncertain(false);setNotice('확인한 Markdown 변환본을 대화에 등록했습니다.');await load();}else{setError(result.error);setUncertain(result.status>=500);}}
  catch{setError('저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.');setUncertain(true);}finally{stop();}}
 async function show(docId:string){if(!start())return;try{const result=await readDocument(id(),docId);if(result.data)setView({id:docId,text:result.data.markdown});else setError(result.error);}finally{stop();}}
 async function remove(docId:string){if(!start())return;try{const result=await removeDocument(id(),docId);if(result.data){onSaved(result.data);setView(null);setDeleting(null);await load();setNotice('첨부자료를 목록에서 삭제했습니다.');}else setError(result.error);}finally{stop();}}
 return <section className={styles.panel} aria-label="대화 첨부자료">
  <button type="button" className={styles.toggle} aria-expanded={open} disabled={busy||disabled} onClick={()=>void toggle()}>⌁ 첨부파일 {open?'접기':'등록·보기'}</button>
  {open&&<div className={styles.body}>
   <p>원본을 Markdown으로 변환하고 개인정보·민감정보를 검토한 뒤 등록합니다. 원본은 보관하거나 AI에 전달하지 않습니다. 등록한 변환본의 AI 답변 연결은 준비 중입니다.</p>
   {!draft&&<form onSubmit={event=>void upload(event)} className={styles.upload}><label>첨부파일 선택<input ref={input} type="file" accept=".pdf,.hwp,.hwpx,.docx,.txt,.md" disabled={busy||disabled} onChange={event=>{setFile(event.target.files?.[0]??null);setError(null);}}/></label><button disabled={busy||disabled||!file}>{busy?'처리 중…':'Markdown 변환'}</button><small>파일 1개당 5MB · PDF·HWP·HWPX·DOCX·TXT·MD · 암호·스캔 문서는 판독이 제한됩니다.</small></form>}
   {draft&&<form onSubmit={event=>void save(event)} className={styles.review}>
    <h2>Markdown 변환본 확인</h2><p>{draft.partial?'텍스트 위주로 변환했습니다. 표·그림·각주·배치가 빠질 수 있으니 원본과 확인해 주세요.':'텍스트를 Markdown으로 변환했습니다.'} 자동 제외가 모든 개인정보를 찾지는 못합니다. 이름·주소·민감한 사실을 직접 지워 주세요.</p>
    <label>등록할 Markdown<textarea value={markdown} maxLength={50000} rows={12} disabled={busy||uncertain} onChange={event=>{setMarkdown(event.target.value);setConfirmed(false);}}/></label>
    <label className={styles.confirm}><input type="checkbox" checked={confirmed} required disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>개인정보·민감정보와 판독 누락을 확인하고 필요한 내용만 남겼습니다.</label>
    <div className={styles.actions}><button type="button" disabled={busy||uncertain} onClick={()=>{setDraft(null);setMarkdown('');setConfirmed(false);}}>취소</button><button disabled={busy||!confirmed}>{busy?'저장 중…':'확인 후 첨부 등록'}</button></div>
   </form>}
   {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}
   {list&&<><div className={styles.listHeading}><h2>등록한 Markdown <span>{list.total}개</span></h2><label>페이지당<select value={limit} disabled={busy} onChange={event=>{const size=Number(event.target.value);setLimit(size);if(start())void load(0,size).finally(stop);}}>{[10,20,50].map(size=><option value={size} key={size}>{size}개</option>)}</select></label></div>
    <ul className={styles.list}>{list.items.map(doc=><li key={doc.id}><div><strong>{doc.name}</strong><small>{doc.format.toUpperCase()}에서 변환 · {doc.partial?'텍스트 판독 · 검토 완료':'검토 완료'}</small></div><div className={styles.actions}><button type="button" disabled={busy} onClick={()=>void show(doc.id)}>내용 보기</button><a href={'/api/chat-documents/'+chatId+'/'+doc.id+'/download'} download>MD ↓</a><button type="button" aria-label={doc.name+' 첨부자료 삭제'} title="첨부자료 삭제" disabled={busy} onClick={()=>setDeleting(doc.id)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6"/></svg></button></div>{deleting===doc.id&&<div className={styles.deleteConfirm}><p>첨부자료를 대화에서 삭제할까요?</p><button type="button" disabled={busy} onClick={()=>setDeleting(null)}>취소</button><button type="button" disabled={busy} onClick={()=>void remove(doc.id)}>삭제 확인</button></div>}</li>)}</ul>
    {!list.items.length&&<p>등록한 첨부자료가 없습니다.</p>}
    <nav className={styles.actions} aria-label="첨부자료 페이지"><button type="button" disabled={busy||!list.offset} onClick={()=>{if(start())void load(Math.max(0,list.offset-limit)).finally(stop);}}>← 이전</button><span>{Math.floor(list.offset/limit)+1} 페이지</span><button type="button" disabled={busy||list.nextOffset===null} onClick={()=>{if(start())void load(list.nextOffset!).finally(stop);}}>다음 →</button></nav>
   </>}
   {view&&<div className={styles.review}><div className={styles.listHeading}><h2>등록한 Markdown 내용</h2><button type="button" onClick={()=>setView(null)}>닫기</button></div><pre>{view.text}</pre></div>}
  </div>}
 </section>;
}
