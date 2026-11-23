"use client";
import { Pagination } from "../_components/pagination";
import {PageSizeSelect} from "../_components/page-size-select";
import Link from "next/link";
import {useCallback,useEffect,useRef,useState,useTransition} from "react";
import {confirmChatCorrection,loadCorrectionHistory} from "./actions";
import type {CorrectionHistoryPage,ChatResult} from "./types";
import styles from "./conversation.module.css";
const formatDate=(value:string)=>new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'}).format(new Date(value));
export function CorrectionRead({chatId,messageId,noticeKey,readAt,onConfirmed,onStale}:{chatId:string;messageId:string;noticeKey:string;readAt:string|null;onConfirmed:(key:string,date:string)=>void;onStale:()=>void}){
 const [pending,startTransition]=useTransition(),[error,setError]=useState<string|null>(null);
 return <div className={styles.correctionRead}>
  {readAt?<span className={styles.readBadge}>확인 완료 · {formatDate(readAt)}</span>:<><span className={styles.unreadBadge}>미확인</span><button type="button" disabled={pending} onClick={()=>startTransition(async()=>{setError(null);try{const result=await confirmChatCorrection(chatId,messageId,noticeKey);if(result.data){onConfirmed(result.data.key,result.data.readAt);window.dispatchEvent(new CustomEvent('aurore:correction-read',{detail:{chatId}}));window.dispatchEvent(new Event('aurore:chat-history'));}else{setError(result.error);if(result.status===409)onStale();}}catch{setError('확인 결과를 저장하지 못했습니다. 다시 시도해 주세요.');}})}>{pending?'저장 중…':'정정 안내 확인'}</button></>}
  {error&&<p role="alert" className={styles.error}>{error}</p>}
 </div>;
}
export function CorrectionHistory({chatId}:{chatId:string}){
 const [pageSize,setPageSize]=useState(10);
 const [result,setResult]=useState<ChatResult<CorrectionHistoryPage>|null>(null),[pending,startTransition]=useTransition();const details=useRef<HTMLDetailsElement>(null),sequence=useRef(0),offset=useRef(0);
 const load=useCallback((next:number,size=pageSize)=>startTransition(async()=>{const request=++sequence.current;let response:ChatResult<CorrectionHistoryPage>;try{response=await loadCorrectionHistory(chatId,next,size);}catch{response={data:null,status:503,error:'확인 이력을 불러오지 못했습니다.'};}if(request!==sequence.current)return;if(response.data){offset.current=next;setPageSize(size);}setResult(response);}),[chatId,pageSize]);
 const invalidate=useCallback(()=>{sequence.current++;},[]);
 useEffect(()=>{const refresh=(event:Event)=>{if((event as CustomEvent<{chatId:string}>).detail?.chatId===chatId&&details.current?.open)load(offset.current);};window.addEventListener('aurore:correction-read',refresh);return()=>{invalidate();window.removeEventListener('aurore:correction-read',refresh);};},[chatId,load,invalidate]);
 const page=result?.data;
 return <details ref={details} className={styles.correctionHistory} onToggle={event=>{if(event.currentTarget.open)load(offset.current);}}><summary>정정 안내 확인 이력</summary>
  {(page?.items.length??0)>10&&<div className="pagination"><PageSizeSelect value={pageSize} disabled={pending} onChange={size=>load(0,size)}/></div>}
  {!result?<p role="status">확인 이력을 불러오는 중입니다.</p>:result.error?<div role="status"><p>{result.error}</p><button type="button" disabled={pending} onClick={()=>load(offset.current)}>다시 불러오기</button></div>:page&&<>
   {!page.items.length?<p>아직 확인한 정정 안내가 없습니다.</p>:<ul>{page.items.map(row=><li key={row.id}><div><strong>{row.label}</strong><span>{row.kind==='LAW_CORRECTED'?'법령 정정':'판결문 정정'} · {formatDate(row.readAt)} 확인</span></div>{row.compareHref?<Link href={row.compareHref} data-action-link>확인한 정정 비교 </Link>:<Link href={row.currentHref} data-action-link>현재 판결문 보기 </Link>}</li>)}</ul>}
   {(page.offset>0||page.nextOffset!==null)&&<Pagination label="정정 확인 이력 페이지" offset={page.offset} limit={pageSize} hasNext={page.nextOffset!==null} onGo={load} disabled={pending} />}
  </>}
 </details>;
}
