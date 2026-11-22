import { parsePageSize } from "../../../_components/page-size";
import Link from "next/link";
import {notFound} from "next/navigation";
import {SiteHeader} from "../../../_components/site-header";
import {officialUrl} from "../versions/official-source";
import {IconLink} from "../../../_components/icon-link";
import styles from "./page.module.css";
export const metadata={title:'법령 시행본 비교 | AURORE'};
type Version={id:string;enfcDt:string|null};
type Meta={versionId:string;revisionId:string;revision:number;effectiveDate:string|null;sourceUrl:string|null};
type Part={text:string;changed:boolean};
type Unit={number:string|null;title:string|null;text:string|null};
type Comparison={legalName:string;before:Meta;after:Meta;summary:{total:number;added:number;removed:number;modified:number;unchanged:number};view:string;nextOffset:number|null;items:{key:string;status:string;before:Unit|null;after:Unit|null;highlights:{before:Part[];after:Part[];coarse:boolean}}[]};
const text=(v:string|string[]|undefined)=>typeof v==='string'?v:'';
const offset=(v:string|string[]|undefined)=>/^\d{1,6}$/.test(text(v))?Math.min(Number(v),100000):0;
const validId=(v:string)=>/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=BigInt('9223372036854775807');
async function get(path:string){try{return await fetch(new URL(path,process.env.BACKEND_URL||'http://127.0.0.1:3001'),{cache:'no-store',signal:AbortSignal.timeout(10000)});}catch{return null;}}
const label=(date:string|null)=>date?date.slice(0,10)+' 시행':'시행일 미상';
export default async function VersionComparison({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {id}=await params;if(!validId(id))notFound();const q=await searchParams;const pageSize=parsePageSize(q.limit);const pickerOffset=offset(q.pickerOffset),pageOffset=offset(q.offset),view=text(q.view)==='all'?'all':'changed';const path='/legals/'+id+'/compare';
 const [lawResponse,versionsResponse]=await Promise.all([get('/legals/'+id),get('/legals/'+id+'/versions?'+new URLSearchParams({limit:String(pageSize+1),offset:String(pickerOffset)}))]);
 if(lawResponse?.status===404)notFound();const law=lawResponse?.ok?await lawResponse.json() as {legalNm:string}:null;const versions:Version[]=versionsResponse?.ok?await versionsResponse.json():[];
 const beforeId=text(q.beforeVersionId)||versions[1]?.id||versions[0]?.id||'';const afterId=text(q.afterVersionId)||versions[0]?.id||'';
 const request=new URLSearchParams({beforeVersionId:beforeId,afterVersionId:afterId,offset:String(pageOffset),limit:String(pageSize),view});for(const key of ['beforeRevisionId','afterRevisionId'])if(text(q[key]))request.set(key,text(q[key]));
 const response=validId(beforeId)&&validId(afterId)?await get('/legals/'+id+'/comparison?'+request):null;const data:Comparison|null=response?.ok?await response.json():null;
 const selected=new Map(versions.slice(0,pageSize).map(v=>[v.id,v]));if(data)for(const version of [data.before,data.after])if(!selected.has(version.versionId))selected.set(version.versionId,{id:version.versionId,enfcDt:version.effectiveDate});
 const pinned=new URLSearchParams({beforeVersionId:beforeId,afterVersionId:afterId,pickerOffset:String(pickerOffset),limit:String(pageSize),view,...(data?{beforeRevisionId:data.before.revisionId,afterRevisionId:data.after.revisionId}:{})});
 const pageUrl=(next:number,key='offset')=>{const query=new URLSearchParams(pinned);query.set(key,String(next));if(key==='pickerOffset')query.set('offset','0');return path+'?'+query;};
 const correction=Boolean(data&&data.before.versionId===data.after.versionId&&data.before.revisionId!==data.after.revisionId);
 const source=(url:string|null)=>{const href=officialUrl(url);return href?<a href={href} target="_blank" rel="noopener noreferrer" data-action-link>법제처 원문 </a>:null;};
 const names:Record<string,string>={added:'추가',removed:'삭제',modified:'변경',unchanged:'동일'};
 return <><SiteHeader active="legals"/><main className="shell"><section className="intro"><IconLink href={'/legals/'+id+'/versions'} kind="list" label="시행본 목록으로" /><h1>{law?.legalNm??'법령'} · {correction?'정정 전후 비교':'시행본 비교'}</h1><p>저장된 조문과 부칙을 나란히 비교합니다. 추가·삭제·변경된 부분을 강조해 표시합니다.</p></section>
 {!law||!versionsResponse?.ok?<p role="status" className="empty">시행본을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>:<>
 {correction&&data?<div className={styles.correctionInfo}><p>같은 시행본의 정정 전 원문과 정정 후 원문을 비교하고 있습니다.</p><Link href={path} data-action-link>다른 시행본 선택 </Link></div>:<form action={path} className={styles.picker}>
 <label>비교 전 시행본<select name="beforeVersionId" defaultValue={beforeId}>{[...selected.values()].map(v=><option key={v.id} value={v.id}>{label(v.enfcDt)}</option>)}</select></label>
 <label>비교 후 시행본<select name="afterVersionId" defaultValue={afterId}>{[...selected.values()].map(v=><option key={v.id} value={v.id}>{label(v.enfcDt)}</option>)}</select></label>
 <label>표시 범위<select name="view" defaultValue={view}><option value="changed">변경된 항목만</option><option value="all">전체 항목</option></select></label><input type="hidden" name="limit" value={pageSize}/><input type="hidden" name="pickerOffset" value={pickerOffset}/><button type="submit" data-primary aria-label="비교하기" title={selected.size<2?"비교할 시행본이 하나뿐이에요":"비교하기"} disabled={selected.size<2}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3 4 7l4 4M4 7h16M16 13l4 4-4 4M20 17H4" /></svg></button>{selected.size<2&&<p className={styles.onlyOne} role="status">저장된 시행본이 하나뿐이라 비교할 수 없어요. 새 시행본이 수집되면 비교할 수 있어요.</p>}
 </form>}
 {!correction&&(pickerOffset>0||versions.length>pageSize)&&<nav className="pagination" aria-label="시행본 선택 페이지">{pickerOffset>0&&<Link href={pageUrl(Math.max(0,pickerOffset-pageSize),'pickerOffset')}>← 최신 시행본</Link>}<span className="page-status">선택 목록 {Math.floor(pickerOffset/pageSize)+1} 페이지</span>{versions.length>pageSize&&<Link href={pageUrl(pickerOffset+pageSize,'pickerOffset')}>이전 시행본 →</Link>}</nav>}
 {!data?<p role="status" className="empty">{versions.length===0?'저장된 시행본이 없습니다.':response?.status===404?'선택한 시행본의 저장 원문을 찾을 수 없습니다. 다른 시행본을 선택해 주세요.':'비교할 두 시행본을 선택해 주세요.'}</p>:<>
 <div className={styles.summary} aria-label="비교 요약">{(['added','removed','modified','unchanged'] as const).map(key=><span key={key} data-change={key}>{names[key]} <strong>{data.summary[key]}</strong>개</span>)}</div>
 <div className={styles.legend}><span>노란색 형광펜: 변경된 문구</span><span>비교 전은 삭제·수정 전, 비교 후는 추가·수정 후 내용입니다.</span><Link href={pageUrl(0).replace('view='+view,'view='+(view==='all'?'changed':'all'))}>{view==='all'?'변경된 항목만 보기':'전체 항목 보기'}</Link></div>
 <div className={styles.editions}><div><strong>비교 전 · {label(data.before.effectiveDate)}</strong><span>원문 {data.before.revision}차 · {source(data.before.sourceUrl)}</span></div><div><strong>비교 후 · {label(data.after.effectiveDate)}</strong><span>원문 {data.after.revision}차 · {source(data.after.sourceUrl)}</span></div></div>
 <section aria-label="조문 변경 비교">{!data.items.length?<p className="empty">{view==='changed'?'변경된 조문이나 부칙이 없습니다.':'이 페이지에 표시할 항목이 없습니다.'}</p>:data.items.map(row=><article className={styles.unit} key={row.key}><header><h2>{row.after?.number??row.before?.number} {row.after?.title??row.before?.title}</h2><span data-change={row.status}>{names[row.status]}</span></header><div className={styles.sides}>{(['before','after'] as const).map(side=><div className={styles.side} key={side}><h3>{side==='before'?'비교 전':'비교 후'} · {row[side]?.number} {row[side]?.title}</h3>{row[side]?<pre>{row.highlights[side].map((part,i)=>part.changed?(side==='before'?<del key={i}>{part.text}</del>:<ins key={i}>{part.text}</ins>):<span key={i}>{part.text}</span>)}</pre>:<p className={styles.absent}>{side==='before'?'추가 전에는 없는 항목입니다.':'삭제된 항목입니다.'}</p>}</div>)}</div>{row.highlights.coarse&&<p className={styles.diffNote}>변경 구간이 길어 블록 단위로 강조했습니다.</p>}</article>)}</section>
 <nav className="pagination" aria-label="조문 비교 페이지">{pageOffset>0&&<Link href={pageUrl(Math.max(0,pageOffset-pageSize))} aria-label="이전 페이지" title="이전 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></Link>}<span className="page-status">{Math.floor(pageOffset/pageSize)+1} 페이지</span>{data.nextOffset!==null&&<Link href={pageUrl(data.nextOffset)} aria-label="다음 페이지" title="다음 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></Link>}</nav>
 </>}
 </>}
 </main></>;
}
