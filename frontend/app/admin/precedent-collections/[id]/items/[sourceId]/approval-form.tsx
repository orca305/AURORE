"use client";
import {useActionState,useRef} from "react";
import {approveCollectedPrecedent,type CollectionApprovalState} from "../../../../../_admin/collection-actions";
import styles from "../../../../page.module.css";
export function CollectionApprovalForm({batchId,sourceId,beforeHash,afterHash}:{batchId:string;sourceId:string;beforeHash:string|null;afterHash:string}){
 const request=useRef<string|null>(null);
 const [state,action,pending]=useActionState(async(_previous:CollectionApprovalState,form:FormData)=>{request.current??=crypto.randomUUID();form.set('requestId',request.current);const result=await approveCollectedPrecedent(batchId,sourceId,beforeHash,afterHash,form);if(result?.terminal)request.current=null;return result;},null);
 return <form action={action} className={styles.approval}><h3>검토 승인 후 반영</h3><p>공식 원문과 관리자 권한을 다시 확인하고 반영합니다. 기존 원문·인용 이력은 보존하며, 같은 요청을 다시 보내도 중복 반영하지 않습니다.</p><label><input type="checkbox" name="confirmed" value="yes" required disabled={pending}/>원문을 대조했으며 이 판례의 반영을 승인합니다.</label>{state?.error&&<p role="alert" className={styles.approvalError}>{state.error}</p>}<button type="submit" disabled={pending}>{pending?'공식 원문 확인·반영 중…':'판례 승인 후 반영'}</button></form>;
}
