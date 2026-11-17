'use client';
import { useActionState } from 'react';
import { setBookmark } from './actions';
import type { BookmarkKind } from './requests';
import styles from './bookmark.module.css';
export function BookmarkButton({kind,id,saved,title,compact=false}:{kind:BookmarkKind;id:string;saved:boolean|null;title:string;compact?:boolean}) {
  const [state,action,pending]=useActionState(setBookmark.bind(null,kind,id),null);
  const selected=state?.saved??saved;
  return <form action={action} className={`${styles.control} ${compact?styles.compact:""}`}>
    <input type="hidden" name="saved" value={selected?'0':'1'}/>
    <button type="submit" disabled={pending||saved===null} aria-pressed={selected??false} aria-label={`${title} · ${selected?'관심 해제':'관심 등록'}`} data-primary>
      <svg width="17" height="17" viewBox="0 0 24 24" fill={selected?'currentColor':'none'} stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>
      {!compact&&(pending?'저장 중…':saved===null?'상태 확인 불가':selected?'관심 등록됨':'관심 등록')}
    </button>
    {state?.error&&<span role="alert" className={styles.error}>{state.error}</span>}
  </form>;
}
