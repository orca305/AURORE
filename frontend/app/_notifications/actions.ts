'use server';
import {positiveId,readReceipt,unreadValue} from '../_components/list-response';
import {revalidatePath} from 'next/cache';
import {trustedOrigin} from '../_auth/session';
import {requestNotifications} from './requests';
export async function readNotification(id:string,all:boolean){
 if(!(await trustedOrigin())||!positiveId(id)||typeof all!=='boolean')return '요청 내용을 확인해 주세요.';
 const response=await requestNotifications(all?'/read-all':'/'+id+'/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(all?{throughId:id}:{})});
 if(!response?.ok)return response?.status===401?'다시 로그인해 주세요.':'알림을 읽음으로 변경하지 못했습니다. 다시 시도해 주세요.';
 const data=await response.json().catch(()=>null);if(!readReceipt(data))return '읽음 처리 결과를 확인하지 못했습니다. 알림 목록을 새로 확인해 주세요.';
 revalidatePath('/notifications');return null;
}

export async function notificationCount(){
 if(!(await trustedOrigin()))return null;
 const response=await requestNotifications('/unread');if(!response?.ok)return null;
 return unreadValue(await response.json().catch(()=>null));
}
