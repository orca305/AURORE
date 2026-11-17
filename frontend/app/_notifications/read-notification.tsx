'use client';
import {useActionState} from 'react';
import {readNotification} from './actions';
import styles from './notifications.module.css';
export function ReadNotification({id,all=false}:{id:string;all?:boolean}){
 const [error,action,pending]=useActionState(async()=>{const error=await readNotification(id,all);if(!error)window.dispatchEvent(new Event('aurore:notifications'));return error;},null);
 return <form action={action} className={styles.action}><button type="submit" disabled={pending} data-primary>{pending?'변경 중…':all?'모두 읽음':'읽음으로 표시'}</button>{error&&<span role="alert">{error}</span>}</form>;
}
