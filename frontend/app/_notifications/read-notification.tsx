'use client';
import {useActionState,useState} from 'react';
import {readNotification} from './actions';
import styles from './notifications.module.css';
export function ReadNotification({id,all=false}:{id:string;all?:boolean}){
 const [confirmed,setConfirmed]=useState(false);
 const [error,action,pending]=useActionState(async()=>{try{const error=await readNotification(id,all);if(!error)window.dispatchEvent(new Event('aurore:notifications'));return error;}catch{return '읽음 처리 결과를 확인하지 못했습니다. 알림 목록을 다시 확인해 주세요.';}},null);
 return <form action={action} className={styles.action}>
 {all&&!confirmed?<button type="button" onClick={()=>setConfirmed(true)}>모두 읽음</button>:<>
 {all&&<p className={styles.readScope}>화면에 반영된 시점까지의 모든 종류의 알림을 읽음으로 표시합니다. 현재 필터 밖의 알림도 포함합니다.</p>}
 <div className={styles.tools}>{all&&<button type="button" disabled={pending} onClick={()=>setConfirmed(false)}>취소</button>}<button type="submit" disabled={pending} data-primary>{pending?'변경 중…':all?'확인 후 모두 읽음':'읽음으로 표시'}</button></div></>}
 {error&&<span role="alert">{error} <a href="">현재 알림 다시 확인</a></span>}</form>;
}
