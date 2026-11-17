import Link from 'next/link';
import {notFound} from 'next/navigation';
import {SiteHeader} from '../../../_components/site-header';
import {officialUrl} from '../../../legals/[id]/versions/official-source';
import styles from '../../../legals/[id]/compare/page.module.css';
export const metadata={title:'판례 정정 전후 비교 | AURORE'};
type Part={text:string;changed:boolean};
type Revision={id:string;revision:number;sourceUrl:string;collectedAt:string};
type Comparison={caseName:string;caseNumber:string;before:Revision;after:Revision;sections:{title:string;before:string;after:string;changed:boolean;highlights:{before:Part[];after:Part[];coarse:boolean}}[]};
export default async function PrecedentComparison({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{beforeRevisionId?:string;afterRevisionId?:string}>}){
 const {id}=await params,q=await searchParams;if(!/^[1-9]\d{0,18}$/.test(id)||BigInt(id)>BigInt('9223372036854775807'))notFound();
 const before=typeof q.beforeRevisionId==='string'?q.beforeRevisionId:'',after=typeof q.afterRevisionId==='string'?q.afterRevisionId:'';
 let missing=false;
 let data:Comparison|null=null,error='비교할 판본을 확인해 주세요.';
 if([before,after].every(v=>/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=BigInt('9223372036854775807'))){
  try{const url=new URL('/legals/precedents/'+id+'/comparison',process.env.BACKEND_URL||'http://127.0.0.1:3001');url.search=new URLSearchParams({beforeRevisionId:before,afterRevisionId:after}).toString();const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(response.status===404)missing=true;if(response.ok)data=await response.json() as Comparison;else error=response.status===400?'화면 비교 범위를 초과하거나 판본이 잘못되었습니다. 공식 원문에서 확인해 주세요.':'비교할 원문을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.';}catch{error='비교할 원문을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.';}
 }
 if(missing)notFound();
 return <><SiteHeader active="precedents"/><main className="shell"><section className="intro"><h1>{data?data.caseName+' · 정정 전후 비교':'판례 정정 전후 비교'}</h1><p>같은 판례의 저장 원문을 비교합니다. 단순 띄어쓰기는 제외하고 내용이 바뀐 부분을 강조합니다.</p><Link href="/notifications" data-action-link>알림으로 돌아가기</Link></section>{!data?<p role="status" className="empty">{error}</p>:<>
 <div className={styles.editions}>{(['before','after'] as const).map(side=><div key={side}><strong>{side==='before'?'정정 전':'정정 후'} · 원문 {data[side].revision}차</strong>{officialUrl(data[side].sourceUrl)&&<a href={officialUrl(data[side].sourceUrl)!} target="_blank" rel="noopener noreferrer" data-action-link>법제처 원문</a>}</div>)}</div>
 {data.sections.map(section=><article className={styles.unit} key={section.title}><header><h2>{section.title}</h2><span>{section.changed?'변경':'동일'}</span></header><div className={styles.sides}>{(['before','after'] as const).map(side=><div className={styles.side} key={side}><h3>{side==='before'?'정정 전':'정정 후'}</h3><pre>{section.highlights[side].map((part,index)=>part.changed?(side==='before'?<del key={index}>{part.text}</del>:<ins key={index}>{part.text}</ins>):<span key={index}>{part.text}</span>)}</pre></div>)}</div>{section.highlights.coarse&&<p className={styles.diffNote}>원문이 길어 변경된 블록 전체를 강조했습니다.</p>}</article>)}
 </>}</main></>;
}
