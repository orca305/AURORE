import Link from "next/link";
import {requestCase} from "../../_cases/requests";
import type {CaseType} from "../../_cases/types";
import {CaseForm} from "../../_cases/case-form";
import styles from "../page.module.css";
export const metadata={title:'사건 등록 | AURORE'};
export default async function NewCasePage(){const response=await requestCase('/options'),data=response?.ok?await response.json() as {types:CaseType[]}:null;return <><section className="intro"><Link href="/cases">← 내 사건</Link><h1>사건 등록</h1><p>사건 제목과 분류를 확인해 저장하세요. 이후 사실관계를 하나씩 추가할 수 있습니다.</p></section>{data?.types.length?<CaseForm command={{operation:'create'}} types={data.types}/>:<p role="status" className={styles.notice}>사건 분류를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>}</>;}
