"use client";
import Link from "next/link";
import {useState,type FormEvent} from "react";
import {caseChoices} from "./actions";
import type {ChatDetail} from "./types";
import type {CaseList} from "../_cases/types";
import styles from "./case-connection.module.css";

export function CaseConnection({chat,pending,onSave}:{chat:ChatDetail;pending:boolean;onSave:(caseId:string|null)=>Promise<string|null>}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[term,setTerm]=useState(''),[limit,setLimit]=useState(10),[data,setData]=useState<CaseList|null>(null),[loading,setLoading]=useState(false),[selected,setSelected]=useState(chat.linkedCase?.id??''),[confirmed,setConfirmed]=useState(false),[error,setError]=useState<string|null>(null),[saved,setSaved]=useState(false),[saving,setSaving]=useState(false),[selectedTitle,setSelectedTitle]=useState(chat.linkedCase?.title??'');
  async function load(q:string,size:number,offset:number) {
    setLoading(true);setError(null);
    try {const result=await caseChoices(q,size,offset);setData(result);if(!result)setError('사건 목록을 불러오지 못했습니다. 다시 시도해 주세요.');}
    catch{setError('사건 목록을 불러오지 못했습니다. 다시 시도해 주세요.');}
    finally{setLoading(false);}
  }
  function toggle(){if(loading||pending||saving)return;setOpen(!open);setSaved(false);if(!open){setSelected(chat.linkedCase?.id??'');setSelectedTitle(chat.linkedCase?.title??'');setConfirmed(false);void load(term,limit,0);}}
  async function save(event:FormEvent){event.preventDefault();if(!confirmed||pending||loading||saving)return;setError(null);setSaving(true);try{const problem=await onSave(selected||null);if(problem)setError(problem);else{setOpen(false);setConfirmed(false);setSaved(true);}}catch{setError('사건 연결 결과를 확인하지 못했습니다. 현재 연결 상태를 확인한 뒤 다시 시도해 주세요.');}finally{setSaving(false);}}
  return <section className={styles.panel} aria-label="대화의 사건 연결">
    <div className={styles.row}><p>연결된 사건 · {chat.linkedCase?<Link href={'/cases/'+chat.linkedCase.id} data-action-link>{chat.linkedCase.title} </Link>:<span>없음</span>}</p><button type="button" disabled={pending||loading||saving} aria-expanded={open} onClick={toggle}>{open?'접기':chat.linkedCase?'연결 변경':'사건 연결'}</button></div>
    {saved&&<p role="status">사건 연결을 변경했습니다.</p>}
    {open&&<div className={styles.editor}>
      <p>대화와 사건을 묶어 관리합니다. 저장한 사실관계가 AI에 자동 전달되지는 않습니다.</p>
      <form className={styles.search} onSubmit={event=>{event.preventDefault();setTerm(query);void load(query,limit,0);}}>
        <label>사건 제목 검색<input value={query} maxLength={200} onChange={event=>setQuery(event.target.value)} disabled={loading||pending||saving}/></label>
        <button disabled={loading||pending||saving}>검색</button><button type="button" disabled={loading||pending||saving} onClick={()=>{setQuery('');setTerm('');void load('',limit,0);}}>초기화</button>
        <label><select aria-label="페이지당 조회 개수" value={limit} disabled={loading||pending||saving} onChange={event=>{const size=Number(event.target.value);setLimit(size);void load(term,size,0);}}>{[10,20,50].map(size=><option key={size} value={size}>{size}개</option>)}</select></label>
      </form>
      {loading&&<p role="status">사건을 불러오는 중…</p>}
      <form onSubmit={event=>void save(event)}>
        <fieldset disabled={loading||pending||saving}><legend>연결할 사건</legend>
          <label className={styles.option}><input type="radio" name="caseId" checked={!selected} onChange={()=>{setSelected('');setSelectedTitle('');setConfirmed(false);}}/>연결하지 않음</label>
          {chat.linkedCase&&!data?.items.some(row=>row.id===chat.linkedCase!.id)&&<label className={styles.option}><input type="radio" name="caseId" checked={selected===chat.linkedCase.id} onChange={()=>{setSelected(chat.linkedCase!.id);setSelectedTitle(chat.linkedCase!.title);setConfirmed(false);}}/>{chat.linkedCase.title} · 현재 연결</label>}
          {data?.items.map(row=><label className={styles.option} key={row.id}><input type="radio" name="caseId" checked={selected===row.id} onChange={()=>{setSelected(row.id);setSelectedTitle(row.title);setConfirmed(false);}}/><span>{row.title}<small>{row.typeName} · 사실관계 {row.factCount}개</small></span></label>)}
          {data&&!data.items.length&&<p>조건에 맞는 사건이 없습니다. <Link href="/cases/new" data-action-link>사건 등록 </Link></p>}
        </fieldset>
        {data&&<nav className={styles.paging} aria-label="연결할 사건 페이지"><button type="button" disabled={loading||pending||data.offset===0} onClick={()=>void load(term,limit,Math.max(0,data.offset-limit))}>← 이전</button><span>{Math.floor(data.offset/limit)+1} 페이지 · {data.total}개</span><button type="button" disabled={loading||pending||data.nextOffset===null} onClick={()=>void load(term,limit,data.nextOffset!)}>다음 →</button></nav>}
        <p className={styles.selection} role="status">저장할 연결 · {selected?selectedTitle:'연결 해제'}{selected===chat.linkedCase?.id?' · 현재 연결':''}</p>
        <label className={styles.option}><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} required disabled={pending||loading||saving}/>연결하거나 해제할 내용을 확인했습니다.</label>
        {error&&<p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}><Link href="/cases" data-action-link>나의 사건 관리 </Link><button disabled={pending||loading||saving||!confirmed}>{pending||saving?'저장 중…':'연결 저장'}</button></div>
      </form>
    </div>}
  </section>;
}
