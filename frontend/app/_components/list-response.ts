import type {BookmarkItem} from '../_bookmarks/requests';
import type {NotificationList} from '../_notifications/requests';
export function positiveId(value:unknown):value is string{return typeof value==='string'&&/^[1-9]\d{0,18}$/.test(value)&&BigInt(value)<=BigInt('9223372036854775807');}
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const count=(value:unknown)=>Number.isSafeInteger(value)&&(value as number)>=0;
const text=(value:unknown,max=2000)=>typeof value==='string'&&value.length<=max;
const date=(value:unknown)=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
export function readingHref(value:unknown):value is string{if(typeof value!=='string'||/\p{Cc}/u.test(value)||value.includes('\\')||!(value.startsWith('/legals/')||value==='/precedents'||value.startsWith('/precedents?')||value.startsWith('/precedents/')))return false;try{return new URL(value,'https://aurore.invalid').origin==='https://aurore.invalid';}catch{return false;}}
export function unreadValue(value:unknown):number|null{const row=object(value);return row&&count(row.count)?row.count as number:null;}
export function readReceipt(value:unknown){return object(value)?.read===true;}
export function bookmarkReceipt(value:unknown,kind:string,id:string,saved:boolean){const row=object(value);return row?.kind===kind&&row.targetId===id&&row.saved===saved;}
function next(value:unknown,offset:number){return value===null||(count(value)&&(value as number)>offset&&(value as number)<=100000);}
export type BookmarkPage={items:BookmarkItem[];total:number;offset:number;nextOffset:number|null};
export function isBookmarkPage(value:unknown,limit:number,offset:number):value is BookmarkPage{
 const row=object(value);if(!row||!count(row.total)||row.offset!==offset||!next(row.nextOffset,offset)||!Array.isArray(row.items)||row.items.length>limit||row.items.length>(row.total as number))return false;
 return row.items.every(value=>{const item=object(value);return item&&positiveId(item.id)&&positiveId(item.targetId)&&typeof item.kind==='string'&&['LEGAL','PREC'].includes(item.kind)&&text(item.title)&&text(item.subtitle)&&date(item.savedAt)&&readingHref(item.href);});
}
export function isNotificationPage(value:unknown,limit:number,offset:number):value is NotificationList{
 const row=object(value),sync=object(row?.sync);if(!row||!sync||typeof sync.failed!=='boolean'||(sync.lastSuccessAt!==null&&!date(sync.lastSuccessAt))||!count(row.total)||!count(row.unreadCount)||(row.readThroughId!==null&&!positiveId(row.readThroughId))||!next(row.nextOffset,offset)||!Array.isArray(row.items)||row.items.length>limit||row.items.length>(row.total as number))return false;
 return row.items.every(value=>{const item=object(value);return item&&positiveId(item.id)&&positiveId(row.readThroughId)&&BigInt(item.id)<=BigInt(row.readThroughId)&&typeof item.targetKind==='string'&&['LEGAL','PREC'].includes(item.targetKind)&&typeof item.kind==='string'&&['PROMULGATED','EFFECTIVE','CORRECTED'].includes(item.kind)&&typeof item.scope==='string'&&['VERSION','PROVISIONS'].includes(item.scope)&&text(item.title)&&text(item.content,10000)&&typeof item.baseDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(item.baseDate)&&date(item.baseDate)&&new Date(item.baseDate).toISOString().slice(0,10)===item.baseDate&&date(item.occurredAt)&&date(item.deliveredAt)&&(item.readAt===null||date(item.readAt))&&readingHref(item.href);});
}
