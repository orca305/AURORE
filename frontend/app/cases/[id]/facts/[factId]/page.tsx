import Link from "next/link";
import {notFound} from "next/navigation";
import {requestCase} from "../../../../_cases/requests";
import {CaseForm} from "../../../../_cases/case-form";
import {caseIdPattern,factIdPattern,type CaseSummary,type Fact} from "../../../../_cases/types";
export const metadata={title:'사실관계 수정 | AURORE'};
export default async function EditFactPage({params,searchParams}:{params:Promise<{id:string;factId:string}>;searchParams:Promise<{returnTo?:string}>}){const {id,factId}=await params;const returnTo=(await searchParams).returnTo==='timeline'?'timeline':undefined;if(!caseIdPattern.test(id)||!factIdPattern.test(factId))notFound();const response=await requestCase('/'+id+'/facts/'+factId);if(response?.status===404||response?.status===400)notFound();if(!response?.ok)return <section className="intro"><h1>사실관계를 불러오지 못했습니다</h1><p>잠시 후 다시 시도해 주세요.</p></section>;const data=await response.json() as {case:CaseSummary;fact:Fact};return <><section className="intro"><Link href={'/cases/'+id+(returnTo?'/timeline':'')}>← {data.case.title}</Link><h1>사실관계 수정</h1><p>수정 전 내용은 변경 이력에 보관합니다.</p></section><CaseForm command={{operation:'updateFact',caseId:id,factId,returnTo,revision:data.case.revision}} initial={data.fact}/></>;}
