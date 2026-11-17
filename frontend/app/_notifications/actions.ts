'use server';
import {revalidatePath} from 'next/cache';
import {trustedOrigin} from '../_auth/session';
import {requestNotifications} from './requests';
export async function readNotification(id:string,all:boolean){
 if(!(await trustedOrigin())||!/^[1-9]\d{0,18}$/.test(id)||typeof all!=='boolean')return '요청 내용을 확인해 주세요.';
 const response=await requestNotifications(all?'/read-all':'/'+id+'/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(all?{throughId:id}:{})});
 if(!response?.ok)return response?.status===401?'다시 로그인해 주세요.':'알림을 읽음으로 변경하지 못했습니다. 다시 시도해 주세요.';
 revalidatePath('/notifications');return null;
}

export async function notificationCount(){
 if(!(await trustedOrigin()))return null;
 const response=await requestNotifications('/unread');if(!response?.ok)return null;
 const data=await response.json() as {count?:unknown};return typeof data.count==='number'&&Number.isSafeInteger(data.count)&&data.count>=0?data.count:null;
}
