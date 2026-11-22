import {PageRefresh} from '../_components/page-actions';
import {isConsentPage,readAccountPayload} from './form-policy';
import Link from "next/link";
import { authRequest, currentToken } from "./session";
import { LearningConsentForm } from "./learning-consent-form";
import { PageSizeSelect } from "../_components/page-size-select";
import { date } from "../_admin/format";
import styles from "./account.module.css";
export async function LearningConsentPanel({
  limit,
  offset,
  saved,
}: {
  limit: number;
  offset: number;
  saved?:string;
}) {
  const token = await currentToken();
  const response = token
    ? await authRequest(
        "learning-consent?" +
          new URLSearchParams({ limit: String(limit), offset: String(offset) }),
        { headers: { Authorization: "Bearer " + token } },
      )
    : null;
  const payload=response?.ok?await readAccountPayload(response):null;
  const data=isConsentPage(payload,limit,offset)?payload:null;
  const url = (n: number) =>
    "/account?" +
    new URLSearchParams({ limit: String(limit), offset: String(n) }) +
    "#learning-consent";
  return (
    <section id="learning-consent" className={styles.consentSection}>
      <div className={styles.accountGrid}>
        <section className={styles.accountCard}>
<div className="section-heading"><h2>학습 활용 동의 · 선택</h2><PageRefresh/></div>
          <p className={styles.help}>
            대화·사건·검토한 첨부자료를 오로르 개선을 위한 학습에 활용할지
            선택합니다. 동의하지 않아도 서비스를 이용할 수 있습니다.
          </p>
          <p className={styles.notice}>
            현재 사용자 자료를 학습하는 기능은 연결되어 있지 않습니다. 동의한
            자료도 개인정보·민감정보 정리와 품질 확인을 거쳐야 활용할 수
            있습니다. 철회는 새 학습 활용에 대한 선택을 바꾸며, 이미 학습한
            모델의 영향을 제거하는 기능은 아직 제공하지 않습니다.
          </p>
          {data ? (
            <>
              {((saved==='agreed'&&data.agreed)||(saved==='withdrawn'&&!data.agreed))&&<p className={styles.notice} role="status">{data.agreed?'학습 활용 동의를 저장했습니다.':'학습 활용 미동의·철회를 저장했습니다.'} 현재 선택과 아래 변경 이력을 확인해 주세요.</p>}
              <p className={styles.consentStatus}>
                현재 선택{" "}
                <strong>{data.agreed ? "동의함" : "동의하지 않음"}</strong>
              </p>
<p className={styles.help}>적용 정책 {data.policyVersion}</p>
              <LearningConsentForm
                key={data.revision}
                agreed={data.agreed}
                revision={data.revision}
              />
            </>
          ) : (
            <p role="alert" className={styles.error}>
              동의 상태를 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.
            </p>
          )}
        </section>
        <section className={styles.accountCard}>
          <div className="section-heading">
            <h2>동의 변경 이력{data ? ` · ${data.total}건` : ""}</h2>
            <PageSizeSelect value={limit} />
          </div>
          {data && (
            <>
              <div className={styles.consentTable}>
                <table>
                  <thead>
                    <tr>
                      <th>선택</th>
                      <th>정책 버전</th>
                      <th>기록 시각</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((row) => (
                      <tr key={row.id}>
                        <td>{row.agreed ? "동의" : "미동의 · 철회"}</td>
                        <td>{row.policyVersion}</td>
                        <td>{date(row.recordedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.history.length && (
                <p className={styles.help}>
                  {data.total===0?'변경 이력이 없으면 기본 미동의로 처리합니다.':'이 페이지에 표시할 변경 이력이 없습니다.'}
                  {offset>0&&<> <Link href={url(0)}>최근 이력부터 보기</Link></>}
                </p>
              )}
              <nav className="pagination" aria-label="동의 변경 이력 페이지">
                {offset > 0 && (
                  <Link href={url(Math.max(0, offset - limit))} aria-label="이전 페이지" title="이전 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></Link>
                )}
                <span className="page-status">
                  {Math.floor(offset / limit) + 1} 페이지
                </span>
                {data.nextOffset !== null && (
                  <Link href={url(data.nextOffset)} aria-label="다음 페이지" title="다음 페이지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></Link>
                )}
              </nav>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
