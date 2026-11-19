'use server';
import {positiveId,bookmarkReceipt} from '../_components/list-response';
import { revalidatePath } from 'next/cache';
import { trustedOrigin } from '../_auth/session';
import { requestBookmarks, type BookmarkKind } from './requests';
export type BookmarkState = {error:string|null;saved:boolean;uncertain?:boolean}|null;
export async function setBookmark(kind:BookmarkKind,id:string,_state:BookmarkState,form:FormData):Promise<BookmarkState> {
  const desired=form.get('saved');
  if(!(await trustedOrigin())||!['LEGAL','PREC'].includes(kind)||!positiveId(id)||!['1','0'].includes(String(desired)))
    return {error:'요청 내용을 확인해 주세요.',saved:desired==='0'};
  const response=await requestBookmarks('/'+kind+'/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({saved:desired==='1'})});
  if(!response?.ok)return {error:response?.status===401?'다시 로그인해 주세요.':response?.status===404?'현재 등록할 수 없는 자료입니다.':'관심 항목을 변경하지 못했습니다. 다시 시도해 주세요.',saved:desired==='0',uncertain:!response||response.status>=500};
  const data=await response.json().catch(()=>null);
  if(!bookmarkReceipt(data,kind,id,desired==='1'))return {error:'변경 결과를 확인하지 못했습니다. 현재 관심 상태를 다시 확인해 주세요.',saved:desired==='0',uncertain:true};
  for(const path of ['/bookmarks','/legals','/precedents'])revalidatePath(path);
  return {error:null,saved:desired==='1'};
}
