import {positiveId} from '../_components/list-response';
import { currentToken } from '../_auth/session';
export type BookmarkKind = 'LEGAL' | 'PREC';
export type BookmarkItem = { id:string; kind:BookmarkKind; targetId:string; title:string; subtitle:string; savedAt:string; href:string };
export async function requestBookmarks(path:string, init?:RequestInit) {
  const token=await currentToken(); if(!token)return null;
  try { return await fetch(new URL('/bookmarks'+path,process.env.BACKEND_URL||'http://127.0.0.1:3001'), {
    ...init,headers:{...init?.headers,Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(8000),
  }); } catch {return null;}
}
export async function bookmarkStates(kind:BookmarkKind,ids:string[]) {
  if(!ids.length)return new Set<string>();
  const response=await requestBookmarks('/state?'+new URLSearchParams({kind,ids:ids.join(',')}));
  if(!response?.ok)return null;
  const data=await response.json().catch(()=>null) as {savedIds?:unknown}|null;
  if(!data||!Array.isArray(data.savedIds)||data.savedIds.some(value=>!positiveId(value)||!ids.includes(value)))return null;
  return new Set(data.savedIds as string[]);
}
