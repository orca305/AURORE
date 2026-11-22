import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "../../_components/site-header";
import { WithdrawalForm } from "../../_auth/withdrawal-form";
import { authRequest, currentToken } from "../../_auth/session";
import styles from "../../_auth/account.module.css";
export const metadata = { title: "회원 탈퇴 | AURORE" };
export default async function Withdrawal() {
  const token = await currentToken();
  if (!token) redirect("/login");
  const response = await authRequest("withdrawal", {
    headers: { Authorization: "Bearer " + token },
  });
  if (response?.status === 401) redirect("/login?expired=1");
  const data = response?.ok
    ? ((await response.json()) as { counts: Record<string, number> })
    : null;
  return (
    <>
      <SiteHeader signedIn active="account" />
      <main className={styles.accountMain}>
        <section className={styles.accountIntro}>
          <h1>회원 탈퇴</h1>
          <p>탈퇴 전에 이용할 수 없게 되는 자료와 처리 범위를 확인해 주세요.</p>
          <Link className="ui-button icon-button" href="/account" aria-label="마이페이지로 돌아가기" title="마이페이지로 돌아가기">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          </Link>
        </section>
        <div className={styles.accountGrid}>
          <section className={styles.accountCard}>
            <h2>탈퇴 후 처리</h2>
            <p className={styles.help}>
              계정 접근과 모든 로그인을 종료하고 미완료 답변 작업을 취소합니다.
              학습 활용 동의도 철회합니다.
            </p>
            <dl className={styles.profile}>
              <div>
                <dt>대화·사건·첨부자료</dt>
                <dd>접근 차단 후 순차 정리</dd>
              </div>
              <div>
                <dt>관심 항목·알림·역할</dt>
                <dd>연결 기록 정리</dd>
              </div>
              <div>
                <dt>개인정보·변경 이력·백업</dt>
                <dd>별도 파기 절차 필요</dd>
              </div>
            </dl>
            <p className={styles.notice}>
              자료 정리는 소프트 삭제로 진행됩니다. 현재는 개인정보의 실제
              파기와 백업 내 사본 제거가 완료되는 단계가 아니므로, 탈퇴를 파기
              완료로 안내하지 않습니다. 보관한 자료는 탈퇴 전에 필요한 범위에서
              내려받아 주세요.
            </p>
          </section>
          <section className={styles.accountCard}>
            <h2>탈퇴 확인</h2>
            {!data ? (
              <p className={styles.error} role="alert">
                처리 대상을 확인하지 못했습니다. 새로고침한 뒤 다시 시도해
                주세요.
              </p>
            ) : (
              <>
                <dl className={styles.profile}>
                  {[
                    ["chats", "대화"],
                    ["cases", "사건"],
                    ["documents", "첨부자료"],
                    ["bookmarks", "관심 항목"],
                    ["notifications", "알림"],
                  ].map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>
                        {new Intl.NumberFormat("ko-KR").format(
                          data.counts[key],
                        )}
                        개
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className={styles.help}>
                  현재 활성 자료 기준입니다. 이전에 삭제한 자료와 변경 이력도
                  별도 파기 검토 범위에 포함됩니다.
                </p>
                <WithdrawalForm />
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
