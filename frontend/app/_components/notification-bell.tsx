"use client";
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {notificationCount} from '../_notifications/actions';
import styles from './site-header.module.css';
export function NotificationBell({initialCount,active}:{initialCount:number;active:boolean}){
 const [count,setCount]=useState(initialCount);
 useEffect(()=>{let stopped=false,running=false;async function refresh(){if(running||document.hidden)return;running=true;try{const result=await notificationCount();if(!stopped&&result!==null)setCount(result);}catch{}finally{running=false;}}const timer=setInterval(()=>void refresh(),60000);const focus=()=>void refresh();window.addEventListener('focus',focus);window.addEventListener('aurore:notifications',focus);return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('aurore:notifications',focus);};},[]);
 const total=Number.isSafeInteger(count)&&count>0?count:0;
 return <Link href="/notifications" className={styles.bell} aria-current={active?'page':undefined} aria-label={total?`알림 · 읽지 않은 알림 ${total}개`:'알림'} title="알림"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>{total>0&&<span className={styles.bellCount} aria-hidden="true">{total>99?'99+':total}</span>}</Link>;
}
