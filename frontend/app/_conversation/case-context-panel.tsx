"use client";
import {useState} from 'react';
import {caseContextOptions} from './actions';
import type {CaseContextPage,CaseSelection} from './types';
import styles from './case-connection.module.css';
export function CaseContextPanel({chatId,disabled,value,onChange,onBusy}:{chatId:string;disabled:boolean;value:CaseSelection|null;onChange:(value:CaseSelection|null)=>void;onBusy:(value:boolean)=>void}){
 const [open,setOpen]=useState(false),[page,setPage]=useState<CaseContextPage|null>(null),[selected,setSelected]=useState<CaseContextPage['items']>([]),[date,setDate]=useState(''),[limit,setLimit]=useState(20),[confirmed,setConfirmed]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
 async function load(size=limit,offset=0){if(disabled||loading)return;setLoading(true);onBusy(true);setError(null);try{const result=await caseContextOptions(chatId,size,offset);if(result.data){if(page&&page.revision!==result.data.revision){setSelected([]);setConfirmed(false);onChange(null);setError('사건이 변경되어 선택을 초기화했습니다. 다시 확인해 주세요.');}setPage(result.data);}else setError(result.error);}finally{setLoading(false);onBusy(false);}}
 function choose(row:CaseContextPage['items'][number],checked:boolean){setConfirmed(false);onChange(null);if(checked){if(selected.length>=10){setError('최대 10개의 사실관계를 선택할 수 있습니다.');return;}setSelected([...selected,row]);}else setSelected(selected.filter(item=>item.id!==row.id));}
 const textLength=selected.reduce((n,row)=>n+row.title.length+row.content.length+30,0);
 return <section className={styles.panel} aria-label="이번 질문의 사건 정보">
  <div className={styles.row}><p>{value?`이번 질문 · 사실관계 ${value.factIds.length}개 · 법령 조회 기준일 ${value.asOf}`:'이번 질문에 사건 정보 활용'}</p><button type="button" disabled={disabled||loading} aria-expanded={open} onClick={()=>{setOpen(!open);if(!open)void load();}}>{open?'접기':'선택·확인'}</button>{value&&<button type="button" disabled={disabled||loading} onClick={()=>{onChange(null);setSelected([]);setConfirmed(false);}}>사용 해제</button>}</div>
  {open&&<div className={styles.editor}>
   <p>확인한 사실관계만 선택해 이번 질문에 사용합니다. 아래 정제본을 검토하고, 법령 조회 기준일을 직접 지정해 주세요. 발생일이 곧 법률 적용 기준일인 것은 아닙니다. 선택은 다음 질문으로 자동 이어지지 않습니다.</p>
   <div className={styles.search}><label>법령 조회 기준일<input type="date" min="1900-01-01" max="2100-12-31" value={date} disabled={disabled||loading} onChange={event=>{setDate(event.target.value);setConfirmed(false);onChange(null);}}/></label><label>페이지당<select disabled={disabled||loading} value={limit} onChange={event=>{const size=Number(event.target.value);setLimit(size);void load(size);}}>{[10,20,50].map(n=><option key={n} value={n}>{n}개</option>)}</select></label><button type="button" disabled={disabled||loading} onClick={()=>void load()}>새로 확인</button></div>
   <fieldset disabled={disabled||loading}><legend>확인된 사실관계 · {page?.total??0}개</legend>{page?.items.map(row=><label className={styles.option} key={row.id}><input type="checkbox" checked={selected.some(item=>item.id===row.id)} onChange={event=>choose(row,event.target.checked)}/><span>{row.title}<small>{row.occurredOn??'발생일 미상'} · {row.content}</small></span></label>)}{page&&!page.items.length&&<p>사용자 확인을 마친 사실관계가 없습니다.</p>}</fieldset>
   {page&&<nav className={styles.paging} aria-label="사건 정보 페이지"><button type="button" disabled={disabled||loading||!page.offset} onClick={()=>void load(limit,Math.max(0,page.offset-limit))}>← 이전</button><span>{Math.floor(page.offset/limit)+1} 페이지</span><button type="button" disabled={disabled||loading||page.nextOffset===null} onClick={()=>void load(limit,page.nextOffset!)}>다음 →</button></nav>}
   {selected.length>0&&<div><h3>이번 질문에 사용할 정제본</h3>{selected.map(row=><p key={row.id}>{row.title} · {row.occurredOn??'발생일 미상'}<br/>{row.content}</p>)}</div>}
   <label className={styles.option}><input type="checkbox" disabled={disabled||loading} checked={confirmed} onChange={event=>{setConfirmed(event.target.checked);if(!event.target.checked)onChange(null);}}/>개인정보·민감정보가 남아 있지 않은지, 선택한 사실과 기준일을 확인했습니다. 자동 정제는 모든 정보를 찾지 못할 수 있습니다.</label>
   {error&&<p role="alert" className={styles.error}>{error}</p>}
   <div className={styles.actions}><span>{selected.length}/10개 · 합계 8,000자 이내</span><button type="button" disabled={disabled||loading||!confirmed||!date||!selected.length||textLength>8000} onClick={()=>{if(page){onChange({revision:page.revision,factIds:selected.map(row=>row.id).sort(),asOf:date,confirmed:true});setOpen(false);}}}>이번 질문에 사용</button></div>
  </div>}
 </section>;
}
