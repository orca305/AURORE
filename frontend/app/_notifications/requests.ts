import {currentToken} from '../_auth/session';
export type NotificationItem={id:string;targetKind:'LEGAL'|'PREC';kind:'PROMULGATED'|'EFFECTIVE'|'CORRECTED';scope:'VERSION'|'PROVISIONS';title:string;content:string;baseDate:string;occurredAt:string;deliveredAt:string;readAt:string|null;href:string};
export type NotificationList={items:NotificationItem[];total:number;unreadCount:number;readThroughId:string|null;nextOffset:number|null;sync:{lastSuccessAt:string|null;failed:boolean}};
export async function requestNotifications(path:string,init?:RequestInit){
 const token=await currentToken();if(!token)return null;
 try{return await fetch(new URL('/notifications'+path,process.env.BACKEND_URL||'http://127.0.0.1:3001'),{...init,headers:{...init?.headers,Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(8000)});}catch{return null;}
}
