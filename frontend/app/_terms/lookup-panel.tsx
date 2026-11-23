"use client";
import { Pagination } from "../_components/pagination";
import {useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {PageSizeSelect} from '../_components/page-size-select';
import {PageRefresh} from '../_components/page-actions';
import styles from './lookup.module.css';
type Result={q:string;limit:number;offset:number;total:number;nextOffset:number|null;items:{id:string;termName:string;definition:string;sourceName:string;sourceReference:string|null;sourceUrl:string}[]};
export function TermLookupPanel({onClose,initialQuery=''}:{onClose:()=>void;initialQuery?:string}){
 const [draft,setDraft]=useState(initialQuery),[limit,setLimit]=useState(10),[data,setData]=useState<Result|null>(null),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null);
 const active=useRef<AbortController|null>(null),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{input.current?.focus();return()=>active.current?.abort();},[]);
 async function load(q:string,offset=0,size=limit){
  active.current?.abort();const controller=new AbortController();active.current=controller;setPending(true);setError(null);setData(null);
  try{const response=await fetch('/api/terms/lookup?'+new URLSearchParams({q,limit:String(size),offset:String(offset)}),{cache:'no-store',signal:controller.signal});const result=await response.json();if(active.current!==controller||controller.signal.aborted)return;if(!response.ok)throw Error(typeof result.error==='string'?result.error:'용어를 불러오지 못했습니다.');setData(result as Result);}catch(e){if(active.current===controller&&!controller.signal.aborted)setError(e instanceof Error?e.message:'용어를 불러오지 못했습니다.');}finally{if(active.current===controller)setPending(false);}
 }
 function reset(){active.current?.abort();active.current=null;setData(null);setError(null);setPending(false);setDraft('');input.current?.focus();}
 function search(event:FormEvent<HTMLFormElement>){event.preventDefault();if(draft.trim())void load(draft.trim());}
 return <section id="conversation-terms" className={styles.panel} aria-labelledby="conversation-terms-title" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClose();}}}>
 <div className={styles.heading}><h2 id="conversation-terms-title">법률용어 찾기</h2><button type="button" className="ui-button" onClick={onClose}>닫기</button></div>
 <p className={styles.help}>대화에서 선택한 용어나 궁금한 표현을 검색하세요. 같은 이름도 출처에 따라 뜻이 다를 수 있습니다.</p>
 <form onSubmit={search} className={styles.form}><label htmlFor="conversation-term-query">찾을 용어</label><div className={styles.controls}><input ref={input} id="conversation-term-query" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={100} placeholder="예: 보증금, 임차권" required/><button className="ui-button" type="submit" disabled={pending||!draft.trim()}>검색</button><button className="ui-button" type="button" onClick={reset}>초기화</button><PageRefresh disabled={pending||!data} onRefresh={()=>load(data!.q,data!.offset)}/></div></form>
 <div className={styles.heading}><span aria-live="polite">{pending?'용어를 찾고 있습니다.':data?'검색 결과 '+data.total+'개':''}</span><PageSizeSelect value={limit} disabled={pending} onChange={size=>{setLimit(size);if(data)void load(data.q,0,size);}}/></div>
 {error&&<p role="alert" className={styles.error}>{error}</p>}
 {data&&!data.items.length&&<p className={styles.help}>공개된 용어를 찾지 못했습니다. 다른 표현으로 검색해 보세요.</p>}
 {data&&<ul className={styles.results}>{data.items.map(row=><li key={row.id}><h3>{row.termName}</h3><p className={styles.definition}>{row.definition}{row.definition.length===240?'…':''}</p><p className={styles.help}>{row.sourceName}{row.sourceReference?' · '+row.sourceReference:''}</p><div className={styles.links}><Link href={'/terms/'+row.id} target="_blank" rel="noopener noreferrer">정의와 풀이 자세히 보기</Link><a href={row.sourceUrl} target="_blank" rel="noopener noreferrer">출처 원문</a></div></li>)}</ul>}
 {data&&<Pagination compact label="용어 검색 페이지" offset={data.offset} limit={data.limit} hasNext={data.nextOffset!==null} disabled={pending} onGo={(next)=>void load(data.q,next)} />}
 </section>;
}
