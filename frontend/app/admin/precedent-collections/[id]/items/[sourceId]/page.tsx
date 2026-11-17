import Link from "next/link";
import {notFound} from "next/navigation";
import {requestAdmin,type CollectedPrecedent} from "../../../../../_admin/requests";
import {CollectionApprovalForm} from "./approval-form";
import styles from "../../../../page.module.css";
const text=(value:string|null)=>value?.replace(/<br\s*\/?\s*>/gi,'\n')??'제공된 내용이 없습니다.';
const statuses:Record<string,string>={NEW:'신규 판례',SAME:'기존 원문과 동일',DIFFERENT:'기존 원문과 다름',DELETED:'삭제된 판례 · 반영 금지',UNAVAILABLE:'기존 판본 확인 필요'};
export default async function CollectedOriginal({params}:{params:Promise<{id:string;sourceId:string}>}){
 const {id,sourceId}=await params;if(!/^[a-f0-9]{64}$/.test(id)||!/^[1-9][0-9]{0,11}$/.test(sourceId))notFound();
 const response=await requestAdmin(`precedent-collections/${id}/items/${sourceId}`);if(response?.status===404)notFound();
 const back=<Link className={styles.back} href={'/admin/precedent-collections/'+id}>← 후보 목록</Link>;
 if(!response?.ok)return <>{back}<p role="status" className={styles.notice}>{response?.status===409?'아직 원문이 수집되지 않은 판례입니다.':'원문 무결성 또는 저장소 상태를 확인해 주세요.'}</p></>;
 const data=await response.json() as CollectedPrecedent;
 return <>{back}<div className={styles.sectionTitle}><div><h2>{data.candidate.title}</h2><p>{data.candidate.caseNumber} · {data.candidate.court} · {data.candidate.date} 선고</p></div><a className={styles.refresh} href={data.officialUrl} target="_blank" rel="noopener noreferrer" data-action-link>법제처 원문 </a></div>
 <p className={styles.notice}><strong>{statuses[data.status]??'상태 확인 필요'}</strong> · 수집된 원문과 현재 DB 원문을 대조합니다. 반영하려면 아래에서 원문 확인 후 승인해야 합니다. 원문이 다르다는 표시는 의미상 법리 변경을 판정한 결과가 아닙니다.</p>
 {(['issue','summary','decision'] as const).map((field,index)=><section className={styles.reviewBlock} key={field}><h3>{['판시사항','판결요지','판결문'][index]}</h3><div className={styles.comparison}><div><h4>현재 DB 원문{data.current&&' · '+data.current.caseNumber}</h4><p>{data.current?text(data.current[field]):data.status==='DELETED'?'삭제된 판례는 다시 게시할 수 없습니다.':'현재 대조할 DB 원문이 없습니다.'}</p></div><div><h4>수집 원문</h4><p>{text(data.candidate[field])}</p></div></div></section>)}
 {!['DELETED','UNAVAILABLE'].includes(data.status)&&<CollectionApprovalForm batchId={id} sourceId={sourceId} beforeHash={data.beforeHash} afterHash={data.afterHash}/>}
 </>;
}
