import {shortDate} from "../_components/format-date";
import {isNotificationPage} from '../_components/list-response';
import { SortSelect } from '../_components/sort-select';
import { ResetSearch } from '../_components/page-actions';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {currentMember} from '../_auth/session';
import {SiteHeader} from '../_components/site-header';
import {parsePageSize} from '../_components/page-size';
import {PageSizeSelect} from '../_components/page-size-select';
import {requestNotifications} from '../_notifications/requests';
import {ReadNotification} from '../_notifications/read-notification';
import styles from '../_notifications/notifications.module.css';
export const metadata={title:'알림 | AURORE'};
const labels={PROMULGATED:'공포',EFFECTIVE:'시행',CORRECTED:'원문 정정'};
function date(value:string){return shortDate(value);}
export default async function NotificationsPage({searchParams}:{searchParams:Promise<{filter?:string;sort?:string;kind?:string;limit?:string;offset?:string}>}){
 if(!(await currentMember()))redirect('/login');
 const params=await searchParams,filter=params.filter==='UNREAD'?'UNREAD':'ALL',kind=['PROMULGATED','EFFECTIVE','CORRECTED'].includes(params.kind??'')?params.kind!:'ALL';
 const sort=params.sort==='oldest'?'oldest':'newest';
 const limit=parsePageSize(params.limit),offset=/^\d{1,6}$/.test(params.offset??'')?Math.min(Number(params.offset),100000):0;
 const query=new URLSearchParams({filter,kind,sort,limit:String(limit),offset:String(offset)});
 const response=await requestNotifications('?'+query),payload=response?.ok?await response.json().catch(()=>null):null;
 const data=isNotificationPage(payload,limit,offset)?payload:null;
 const pageUrl=(n:number)=>'/notifications?'+new URLSearchParams({filter,kind,sort,limit:String(limit),offset:String(n)});
 return <div><SiteHeader active="notifications"/><main className="shell"><section className="intro"><h1>알림</h1><p>관심 등록 이후의 공포·시행·원문 정정 소식을 확인하세요. 저장된 법령·판례 자료를 기준으로 안내합니다.</p></section>
 <form className="search" action="/notifications"><label htmlFor="notice-filter">알림 보기</label><input type="hidden" name="limit" value={limit}/><div className="search-row"><select id="notice-filter" name="filter" defaultValue={filter}><option value="ALL">전체 알림</option><option value="UNREAD">읽지 않은 알림</option></select><select name="kind" aria-label="알림 종류" defaultValue={kind}><option value="ALL">모든 종류</option><option value="PROMULGATED">공포</option><option value="EFFECTIVE">시행</option><option value="CORRECTED">원문 정정</option></select><SortSelect value={sort} basis="수신일"/><button type="submit" data-primary>조회</button><ResetSearch/></div></form>
 <section className="results"><div className="section-heading"><h2>{data?`읽지 않은 알림 ${data.unreadCount}개`:'받은 알림'}</h2><div className={styles.tools}><PageSizeSelect value={limit}/>{data?.unreadCount&&data.readThroughId?<ReadNotification key={data.readThroughId} id={data.readThroughId} all/>:null}</div></div>
 {!data?<p role="status" className="empty">알림을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</p>:<>
 {data.sync.failed&&<p role="status" className={styles.failure}>새 알림 확인이 지연되고 있습니다. 기존 알림은 확인할 수 있으며 서버에서 다시 시도합니다.</p>}
 {!data.items.length?<p className="empty">{offset>0&&data.total>0?'이 페이지에 표시할 알림이 없습니다.':kind!=='ALL'?'현재 조건에 맞는 알림이 없습니다.':filter==='UNREAD'?'읽지 않은 알림이 없습니다.':'받은 알림이 없습니다. 관심 법령·판례를 등록하면 이후 변경 소식을 받을 수 있습니다.'}{offset>0&&<>{' '}<Link href={pageUrl(0)}>처음부터 보기</Link></>}</p>:<ul className={styles.list}>{data.items.map(row=><li key={row.id} data-unread={!row.readAt}><div className={styles.detail}><div className={styles.meta}><span>{row.targetKind==='PREC'?'판례 · ':''}{labels[row.kind]}{row.scope==='PROVISIONS'?' · 일부 조문':''}</span>{!row.readAt&&<span className={styles.unread}>새 알림</span>}<span>기준일 {row.baseDate}</span></div><h3><Link href={row.href}>{row.title}</Link></h3><p>{row.content}</p><div className={styles.meta}><span>받은 시각 {date(row.deliveredAt)}</span><Link href={row.href} data-action-link>{row.kind==='CORRECTED'?'정정 전후 비교 ':'현재 시행본 보기 '}</Link></div></div>{!row.readAt?<ReadNotification id={row.id}/>:<span className={styles.meta}>읽음</span>}</li>)}</ul>}
 <nav className="pagination" aria-label="알림 페이지"><span className="page-status">{Math.floor(offset/limit)+1} 페이지</span>{offset>0&&<Link href={pageUrl(Math.max(0,offset-limit))}>← 이전</Link>}{data.nextOffset!==null&&<Link href={pageUrl(data.nextOffset)}>다음 →</Link>}</nav>
 <p className={styles.note}>서버 실행 중 약 1분마다 새 변경을 확인합니다. 원문 정정은 저장 자료의 수정이며 법률 개정이나 새 판결 선고와 구분됩니다.</p>
 </>}
 </section></main></div>;
}
