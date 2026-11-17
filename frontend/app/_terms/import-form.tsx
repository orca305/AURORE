"use client";
import {useActionState,useState} from 'react';
import Link from 'next/link';
import {importTerms} from './import-actions';
import {importLabels,type SourceItem,type ImportState} from './import-types';
import styles from './terms.module.css';
const kinds:Record<string,string>={'011401':'법령용어사전','011402':'법령정의사전','011403':'한영법령용어사전'};
export function TermImportForm({items}:{items:SourceItem[]}){
 const [selected,setSelected]=useState<Record<string,string>>({});
 const [state,action,pending]=useActionState(async(previous:ImportState,form:FormData)=>{const result=await importTerms(previous,form);if(result?.results)setSelected({});return result;},null);
 const locked=pending||Boolean(state?.uncertain),count=Object.keys(selected).length;
 function toggle(id:string,checked:boolean){setSelected(old=>{const next={...old};if(checked&&Object.keys(next).length<20)next[id]=crypto.randomUUID();else if(!checked)delete next[id];return next;});}
 return <form action={action} className={styles.command}>
 <input type="hidden" name="items" value={JSON.stringify(Object.entries(selected).map(([sourceId,requestId])=>({sourceId,requestId})))}/>
 <div className="section-heading"><span>최대 20개 · {count}개 선택</span><button type="button" disabled={locked} onClick={()=>setSelected(count?{}:Object.fromEntries(items.filter(i=>i.existing?.state!=='DELETED').slice(0,20).map(i=>[i.sourceId,crypto.randomUUID()]))) }>{count?'선택 해제':'이 페이지 선택'}</button></div>
 <ul className={styles.list}>{items.map(row=><li key={row.sourceId}><label><input type="checkbox" aria-label={row.termName+' '+row.sourceId+' 선택'} checked={Boolean(selected[row.sourceId])} disabled={locked||row.existing?.state==='DELETED'||(!selected[row.sourceId]&&count>=20)} onChange={e=>toggle(row.sourceId,e.target.checked)}/><span>{row.termName}</span></label><div className={styles.meta}><span>{kinds[row.dictionaryCode]??row.dictionaryCode} · 용어 번호 {row.sourceId}</span><a href={row.sourceUrl} target="_blank" rel="noopener noreferrer">법제처 원문</a>{row.existing&&<Link href={'/admin/terms/'+row.existing.termId}>{row.existing.state==='DELETED'?'삭제됨':row.existing.state==='PUBLISHED'?'공개 중':'검토 대기'} · 등록 내용 확인</Link>}</div></li>)}</ul>
 <button type="submit" disabled={pending||!count}>{pending?'법제처에서 가져오는 중…':'선택 용어를 검토 대기로 가져오기'}</button>
 {state?.error&&<p role="alert" className={styles.error}>{state.error}</p>}
 {state?.results&&<div role="status" className={styles.notice}><p>수집 처리가 끝났습니다. 새 정의와 변경 정의는 공개 전 검토가 필요합니다.</p><ul>{state.results.map(row=><li key={row.sourceId}>{row.sourceId} · {importLabels[row.status]??'확인 필요'} {row.termId&&<Link href={'/admin/terms/'+row.termId}>내용 검토</Link>}</li>)}</ul></div>}
 </form>;
}
