"use client";
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {notificationCount} from '../_notifications/actions';
import {useActiveKey} from './site-active';
import styles from './site-header.module.css';
export function NotificationBell({initialCount}:{initialCount:number|null}){
 const active=useActiveKey()==='notifications';
 const [count,setCount]=useState(initialCount);
 useEffect(()=>{let stopped=false,running=false;async function refresh(){if(running||document.hidden)return;running=true;try{const result=await notificationCount();if(!stopped)setCount(result);}catch{if(!stopped)setCount(null);}finally{running=false;}}const timer=setInterval(()=>void refresh(),60000);const focus=()=>void refresh();window.addEventListener('focus',focus);window.addEventListener('aurore:notifications',focus);return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('aurore:notifications',focus);};},[]);
 const total=Number.isSafeInteger(count)&&count!==null&&count>0?count:0;
 return <Link href="/notifications" className={styles.bell} aria-current={active?'page':undefined} aria-label={count===null?'알림 · 읽지 않은 개수 확인 불가':total?`알림 · 읽지 않은 알림 ${total}개`:'알림'} title="알림"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>{count===null&&<span className={styles.bellUnknown} aria-hidden="true">?</span>}{total>0&&<span className={styles.bellCount} aria-hidden="true">{total>99?'99+':total}</span>}</Link>;
}
