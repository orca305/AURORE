import Link from "next/link";
import {requestAdmin,type CollectionSchedule} from "../../_admin/requests";
import {date} from "../../_admin/format";
import styles from "../page.module.css";
export const metadata={title:'수집·백업 예약 | AURORE'};
const workers:Record<string,string>={DISABLED:'예약 비활성',NOT_RUNNING:'실행기 종료 · 예약 실행 안 됨',RUNNING:'실행기 가동 중',DELAYED:'처리 중이거나 응답 지연 · 상태 확인 필요',RECOVERY_REQUIRED:'이전 실행 중단 · 점유 확인 필요',OTHER_HOST:'다른 기기의 실행 점유 확인 필요',INVALID:'실행 점유 기록 확인 필요'};
const states:Record<string,string>={NOT_RUN:'실행 기록 없음',RUNNING:'수집 중',SUCCEEDED:'준비 완료',FAILED:'실패',BACKLOG:'일부 준비 · 이어 받기 대기'};
const errors:Record<string,string>={RUN_FAILED:'수집 실패 · 상세 수집 기록 확인',SOURCE_READ_FAILED:'공식 원문 조회 실패',SOURCE_INVALID:'공식 원문 검증 실패',SNAPSHOT_FAILED:'원문 파일 저장 실패',TARGET_BUSY:'다른 수집 작업이 실행 중',RECOVERY_REQUIRED:'중단된 수집의 점유 확인 필요',SETUP_REQUIRED:'수집 대상 또는 API 연결 설정 필요',BACKUP_FAILED:'백업 생성·복원 검증 실패 · 기존 백업 유지',RETENTION_FAILED:'백업은 보존했지만 오래된 백업 정리 확인 필요'};
export default async function Schedule(){
 const response=await requestAdmin('collection-schedule');if(!response?.ok)return <p role="alert" className={styles.notice}>예약 설정 또는 실행 기록을 불러오지 못했습니다. 저장소 상태를 확인해 주세요.</p>;
 const data=await response.json() as CollectionSchedule;
 return <><div className={styles.sectionTitle}><div><h2>수집·백업 예약</h2><p>한국 시간 기준으로 수집과 복원 검증된 백업을 예약합니다.</p></div><Link className={styles.refresh} href="/admin/collection-schedule">새로고침 ↻</Link></div>
 <section className={styles.jobError}><h3>{workers[data.worker]??'실행기 상태 확인 필요'}</h3><p>최근 상태 갱신 · {data.heartbeatAt?date(data.heartbeatAt):'기록 없음'}</p><p>실행기가 켜져 있어야 예약이 동작합니다. PC 또는 실행기가 꺼져 있으면 다음 기동 시 최근 예약 회차부터 밀린 자료를 이어 받습니다.</p></section>
 {data.jobs.map(job=><section key={job.kind} id={job.kind} className={styles.section}><div className={styles.sectionTitle}><h2>{job.kind==='law'?'법령 수집':job.kind==='backup'?'DB 백업·7일 보관':'판례 수집'}</h2>{job.kind!=='backup'&&<Link href={job.kind==='law'?'/admin/legal-refresh':'/admin/precedent-collections'}>상세 수집 기록 ↗</Link>}</div><dl className={styles.jobFacts}>
 <div><dt>예약</dt><dd>{job.enabled?'매일 '+job.dailyAt+' · 한국 시간':'비활성'}</dd></div><div><dt>최근 처리 상태</dt><dd>{job.kind==='backup'&&job.status==='SUCCEEDED'?'복원 검증 완료':states[job.status]??'확인 필요'}</dd></div><div><dt>예약된 대상</dt><dd>{job.targets}{job.kind==='backup'?'개 저장소':'개 묶음'}</dd></div>
 <div><dt>이번 회차 시도</dt><dd>{job.attempts} / 3회</dd></div><div><dt>연속 실패</dt><dd>{job.failures}회</dd></div><div><dt>다음 처리 시각</dt><dd>{job.nextAttemptAt?date(job.nextAttemptAt):'예약 없음'}</dd></div>
 <div><dt>최근 시작</dt><dd>{job.startedAt?date(job.startedAt):'—'}</dd></div><div><dt>최근 종료</dt><dd>{job.finishedAt?date(job.finishedAt):'—'}</dd></div><div><dt>최근 정상 처리</dt><dd>{job.lastSuccessAt?date(job.lastSuccessAt):'—'}</dd></div>{job.kind==='backup'&&<><div><dt>최근 검증한 백업</dt><dd>{job.processed}개</dd></div><div><dt>최근 정리한 묶음</dt><dd>{job.retentionRemoved??0}개</dd></div><div><dt>보관 기준</dt><dd>7일 · 새 복원 검증 성공 후 정리</dd></div></>}</dl>
 {job.code&&<p role="status" className={styles.notice}>{errors[job.code]??'수집 상태 확인 필요'}{job.attempts>=3?' · 이번 회차 재시도를 멈췄습니다. 다음 예약 회차에 다시 확인합니다.':''}</p>}
 </section>)}<p className={styles.notice}>실패는 1시간 간격으로 회차당 최대 3회 시도합니다. 밀린 자료가 남으면 15분 뒤 이어 받습니다. 수집 자료의 DB 반영은 원문 검토와 승인을 거칩니다. 백업은 매번 복원 검증하고 성공한 뒤에만 7일이 지난 관리 대상 묶음을 정리합니다. 예약 변경은 로컬 설정 파일에서 관리합니다.</p></>;
}
