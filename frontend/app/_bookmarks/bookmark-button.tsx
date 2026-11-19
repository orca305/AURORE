'use client';
import { useActionState } from 'react';
import { setBookmark,type BookmarkState } from './actions';
import type { BookmarkKind } from './requests';
import styles from './bookmark.module.css';
export function BookmarkButton({kind,id,saved,title,compact=false}:{kind:BookmarkKind;id:string;saved:boolean|null;title:string;compact?:boolean}) {
  const [state,action,pending]=useActionState(async(previous:BookmarkState,form:FormData):Promise<BookmarkState>=>{try{return await setBookmark(kind,id,previous,form);}catch{return {error:'변경 결과를 확인하지 못했습니다. 현재 상태를 다시 확인해 주세요.',saved:form.get('saved')==='0',uncertain:true};}},null);
  const selected=state?.saved??saved,unknown=saved===null||Boolean(state?.uncertain);
  return <form action={action} className={`${styles.control} ${compact?styles.compact:""}`}>
    <input type="hidden" name="saved" value={selected?'0':'1'}/>
    <button type="submit" disabled={pending||unknown} aria-pressed={unknown?'mixed':selected??false} aria-label={`${title} · ${unknown?'관심 상태 확인 필요':selected?'관심 해제':'관심 등록'}`} title={unknown?'현재 관심 상태를 새로고침해 주세요.':selected?'관심 해제':'관심 등록'} data-primary>
      <svg width="17" height="17" viewBox="0 0 24 24" fill={!unknown&&selected?'currentColor':'none'} stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>
      {!compact&&(pending?'저장 중…':unknown?'상태 확인 필요':selected?'관심 해제':'관심 등록')}
    </button>
    {state?.error&&<span role="alert" className={styles.error}>{state.error}{state.uncertain&&<> <a href="">현재 상태 다시 확인</a></>}</span>}
  </form>;
}
