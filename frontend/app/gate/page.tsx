import Image from "next/image";
import { redirect } from "next/navigation";
import { gateEnabled, safeNext } from "../_gate/gate";
import styles from "../_auth/account.module.css";

export const metadata = { title: "접속 코드 | AURORE", robots: { index: false, follow: false } };

/** 외부 공개 중 처음 들어올 때 접속 코드를 받는 화면. 접속 코드가 설정되지 않은 로컬에서는 바로 첫 화면으로 보낸다. */
export default async function Gate({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  if (!gateEnabled()) redirect("/");
  const { error, next } = await searchParams;
  const target = safeNext(next);
  return <div className={styles.authPage}>
    <main className={styles.authMain}>
      <div className={styles.authBrand}>
        <Image src="/brand/aurore-icon.svg" alt="" width={44} height={44} unoptimized />
        <span>AURORE</span>
      </div>
      <section className={styles.authCard} aria-labelledby="gate-title">
        <h1 id="gate-title">접속 코드</h1>
        <p className={styles.help}>테스트 중인 서비스예요. 안내받은 접속 코드를 입력해 주세요.</p>
        <form method="post" action="/gate/verify" className={styles.form}>
          <input type="hidden" name="next" value={target} />
          <label>
            접속 코드
            <input name="code" type="password" autoComplete="off" required autoFocus />
          </label>
          {error === "wrong" && <p role="alert" className={styles.error}>코드가 맞지 않아요. 다시 확인해 주세요.</p>}
          {error === "locked" && <p role="alert" className={styles.error}>입력을 여러 번 틀려서 잠시 막았어요. 10분 뒤에 다시 시도해 주세요.</p>}
          <button type="submit" data-primary style={{ width: "100%", minHeight: "3rem" }}>들어가기</button>
        </form>
      </section>
    </main>
  </div>;
}
