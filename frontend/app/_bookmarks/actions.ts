'use server';
import { revalidatePath } from 'next/cache';
import { trustedOrigin } from '../_auth/session';
import { requestBookmarks, type BookmarkKind } from './requests';
export type BookmarkState = {error:string|null;saved:boolean}|null;
export async function setBookmark(kind:BookmarkKind,id:string,_state:BookmarkState,form:FormData):Promise<BookmarkState> {
  const desired=form.get('saved');
  if(!(await trustedOrigin())||!['LEGAL','PREC'].includes(kind)||!/^[1-9]\d{0,18}$/.test(id)||!['1','0'].includes(String(desired)))
    return {error:'요청 내용을 확인해 주세요.',saved:desired==='0'};
  const response=await requestBookmarks('/'+kind+'/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({saved:desired==='1'})});
  if(!response?.ok)return {error:response?.status===401?'다시 로그인해 주세요.':response?.status===404?'현재 등록할 수 없는 자료입니다.':'관심 항목을 변경하지 못했습니다. 다시 시도해 주세요.',saved:desired==='0'};
  const data=await response.json() as {saved:boolean};
  for(const path of ['/bookmarks','/legals','/precedents'])revalidatePath(path);
  return {error:null,saved:data.saved};
}
