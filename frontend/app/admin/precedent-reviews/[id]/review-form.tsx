"use client";
import {useActionState,useRef} from "react";
import {resolvePrecedent,type ReviewState} from "../../../_admin/precedent-actions";
import styles from "../../page.module.css";
export function ReviewForm({id,reviewHash,canVerify}:{id:string;reviewHash:string;canVerify:boolean}){
 const request=useRef<string|null>(null);
 const [state,action,pending]=useActionState(async(_previous:ReviewState,form:FormData)=>{request.current??=crypto.randomUUID();form.set('requestId',request.current);const result=await resolvePrecedent(id,reviewHash,form);if(result?.terminal)request.current=null;return result;},null);
 return <form className={styles.approval} action={action}>
  <h3>검토 결과 저장</h3><p>연결 확인은 판례와 해당 시행본 조문의 관계를 관리자가 확인한 결과입니다.</p>
  <label>검토 결과<select name="decision" required defaultValue={canVerify?'verified':'unverified'}><option value="verified" disabled={!canVerify}>현재 조문과의 연결 확인</option><option value="unverified">미확인으로 종결 · 연결 근거에서 제외</option></select></label>
  {!canVerify&&<p>현재 조문이 없거나 여러 개여서 연결 확인을 선택할 수 없습니다.</p>}
  <label>검토 사유<textarea name="reason" required maxLength={2000} rows={4} placeholder="판결문과 시행본을 대조한 근거를 남겨 주세요."/></label>
  <label><input type="checkbox" name="confirmed" value="yes" required/>판결문과 정정 전후 조문을 확인했으며 이 검토 결과를 저장합니다.</label>
  {state?.error&&<p role="alert" className={styles.approvalError}>{state.error}</p>}
  <button type="submit" disabled={pending}>{pending?'저장 중…':'검토 결과 저장'}</button>
 </form>;
}
