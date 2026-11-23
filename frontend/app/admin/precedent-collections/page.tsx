import { Pagination } from "../../_components/pagination";
import Link from "next/link";
import {requestAdmin,type CollectionList} from "../../_admin/requests";
import {parsePageSize} from "../../_components/page-size";
import {PageSizeSelect} from "../../_components/page-size-select";
import styles from "../page.module.css";
export const metadata={title:"판례 수집 검토 | AURORE"};
export default async function Collections({searchParams}:{searchParams:Promise<{offset?:string;limit?:string}>}){
 const params=await searchParams,limit=parsePageSize(params.limit),offset=/^\d{1,6}$/.test(params.offset??'')?Math.min(Number(params.offset),100000):0;
 const response=await requestAdmin('precedent-collections',new URLSearchParams({offset:String(offset),limit:String(limit)}));
 if(!response?.ok)return <p role="status" className={styles.notice}>판례 수집 목록을 불러오지 못했습니다. 저장소 상태를 확인해 주세요.</p>;
 const data=await response.json() as CollectionList;
 const url=(next:number)=>'/admin/precedent-collections?'+new URLSearchParams({offset:String(next),limit:String(limit)});
 return <><div className={styles.sectionTitle}><div><h2>판례 수집 검토</h2><p>검색으로 만든 후보 목록과 수집된 공식 원문을 확인합니다.</p></div></div>
 <Link className={styles.back} href="/admin/precedent-collections/history" data-action-link>반영 처리 이력 </Link><p className={styles.notice}>원문 수집과 DB 반영은 별도 단계입니다. 이 화면을 조회해도 판례가 반영되지 않습니다.</p>
 <div className="pagination"><span>수집 묶음 {data.total}개</span><PageSizeSelect value={limit}/></div>
 <div className={styles.tableWrap}><table><caption>판례 수집 묶음</caption><thead><tr><th>수집 묶음</th><th>후보 판례</th><th>원문 수집</th><th>미수집</th><th>상태</th><th>검토</th></tr></thead><tbody>{data.items.map(row=><tr key={row.id}><td>{row.label}</td><td>{row.available?row.total+'건':'—'}</td><td>{row.available?row.collected+'건':'—'}</td><td>{row.available?row.remaining+'건':'—'}</td><td>{!row.available?'기록 확인 필요':row.remaining===0?'원문 수집 완료':row.collected?'일부 수집':'수집 전'}</td><td>{row.available?<Link href={'/admin/precedent-collections/'+row.id} data-action-link>후보 확인 </Link>:'무결성·저장소 확인 필요'}</td></tr>)}</tbody></table>{!data.items.length&&<p className={styles.empty}>아직 확인할 수집 목록이 없습니다.</p>}</div>
 <Pagination label="수집 묶음 페이지" offset={offset} limit={limit} total={data.total} hasNext={data.nextOffset !== null} href={url} /></>;
}
