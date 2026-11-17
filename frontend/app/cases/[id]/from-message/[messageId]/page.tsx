import Link from "next/link";
import {notFound} from "next/navigation";
import {requestCase} from "../../../../_cases/requests";
import {CaseForm} from "../../../../_cases/case-form";
import {caseIdPattern,type CaseSummary} from "../../../../_cases/types";
import styles from "../../../page.module.css";
export const metadata={title:"대화에서 사실관계 가져오기 | AURORE"};
export default async function FactDraftPage({params}:{params:Promise<{id:string;messageId:string}>}){
  const {id,messageId}=await params;if(!caseIdPattern.test(id)||!caseIdPattern.test(messageId))notFound();
  const response=await requestCase('/'+id+'/drafts/'+messageId);
  if(response?.status===404)notFound();
  if(!response?.ok)return <section className="intro"><h1>{response?.status===409?'이미 저장한 메시지입니다':'초안을 불러오지 못했습니다'}</h1><p>{response?.status===409?'이 사건에 저장된 기존 사실관계를 확인하고 수정해 주세요.':'연결된 사건과 대화가 유효한지 확인한 후 다시 시도해 주세요.'}</p><Link href={'/cases/'+id} data-action-link>사건 확인 </Link></section>;
  const data=await response.json() as {case:CaseSummary;source:{chatId:string;messageId:string};title:string;content:string};
  return <>
    <section className="intro"><Link href={'/?chat='+data.source.chatId}>← 가져온 대화</Link><h1>사실관계 초안 확인</h1><p>{data.case.title}에 저장할 내용을 확인해 주세요.</p></section>
    <p className={styles.notice}>선택한 내 메시지를 가져왔습니다. 확인된 사실만 남기고 이름 등 불필요한 개인정보를 지운 뒤 저장하세요. 저장 전에는 초안을 보관하지 않습니다. 저장한 사실관계는 원본 대화와 별도로 보관됩니다.</p>
    <CaseForm command={{operation:'createFact',caseId:id,revision:data.case.revision,srcMsgId:messageId}} initial={{title:data.title,content:data.content}}/>
  </>;
}
