"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {createPortal} from "react-dom";
import {useRouter} from "next/navigation";
import {renameChat,refreshChat} from "../_conversation/actions";
import type {ChatDetail} from "../_conversation/types";
import styles from "./rename-chat.module.css";
export function RenameChat({chat,onRenamed}:{chat:{id:string;title:string;revision:number};onRenamed?:(chat:ChatDetail)=>void}){
 const router=useRouter(),dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);const [open,setOpen]=useState(false),[name,setName]=useState(chat.title),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null);
 useEffect(()=>{if(open){dialog.current?.showModal();input.current?.focus();input.current?.select();}},[open]);
 async function submit(event:FormEvent){event.preventDefault();if(pending)return;setPending(true);setError(null);try{const result=await renameChat(chat.id,chat.revision,name);if(result.data){onRenamed?.(result.data);window.dispatchEvent(new CustomEvent('aurore:chat-renamed',{detail:result.data}));window.dispatchEvent(new Event('aurore:chat-history'));setOpen(false);router.refresh();}else{setError(result.error);if(result.status===409){const latest=await refreshChat(chat.id);if(latest.data){onRenamed?.(latest.data);window.dispatchEvent(new CustomEvent('aurore:chat-renamed',{detail:latest.data}));}window.dispatchEvent(new Event('aurore:chat-history'));router.refresh();}}}catch{setError('제목을 변경하지 못했습니다. 다시 시도해 주세요.');}finally{setPending(false);}}
 return <><button type="button" className={styles.trigger} title="제목 변경" aria-label={chat.title+' 제목 변경'} onClick={()=>{setName(chat.title);setError(null);setOpen(true);}}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z"/></svg></button>
 {open&&createPortal(<dialog ref={dialog} className={styles.dialog} aria-label="대화 제목 변경" onClose={()=>setOpen(false)} onCancel={event=>{if(pending)event.preventDefault();}}><form onSubmit={submit}><h2>대화 제목 변경</h2><label>새 제목<input ref={input} value={name} onChange={event=>setName(event.target.value)} required maxLength={160} disabled={pending}/></label><p className={styles.help}>1~80자까지 입력할 수 있습니다.</p>{error&&<p role="alert" className={styles.error}>{error}</p>}<div className={styles.actions}><button type="button" disabled={pending} onClick={()=>setOpen(false)}>취소</button><button type="submit" disabled={pending||!name.trim()||Array.from(name.normalize('NFC').trim()).length>80}>{pending?'저장 중…':'저장'}</button></div></form></dialog>,document.body)}
 </>;
}
