"use client";
import { useActionState,useRef } from "react";
import { approveCorrection,type ApprovalState } from "../../../../_admin/correction-actions";
import styles from "../../../page.module.css";
export function ApprovalForm({id,beforeHash,afterHash}:{id:string;beforeHash:string;afterHash:string}) {
 const request=useRef<string|null>(null);
 const [state,action,pending]=useActionState(async(_previous:ApprovalState,form:FormData)=>{
  request.current ??= crypto.randomUUID();form.set('requestId',request.current);
  const result=await approveCorrection(id,beforeHash,afterHash,form);
  if(result?.terminal) request.current=null;
  return result;
 },null);
 return <form action={action} className={styles.approval}><h3>정정 승인</h3><p>공식 원문을 다시 확인한 뒤 새 이력으로 반영합니다. 기존 원문과 인용 근거는 보존됩니다.</p><label><input type="checkbox" name="confirmed" value="yes" required disabled={pending}/>전후 원문을 확인했으며 이 정정을 반영하는 데 동의합니다.</label>{state?.error && <p role="alert" className={styles.approvalError}>{state.error}</p>}<button type="submit" disabled={pending}>{pending ? "공식 원문 확인·반영 중…" : "정정 승인 후 반영"}</button></form>;
}
