import { requestAdmin } from "../../_admin/requests";
import { date } from "../../_admin/format";
import { ModelForms } from "./model-form";
import styles from "../page.module.css";

export const metadata = { title: "AI 모델 교체 | AURORE" };

type Settings = {
  allowed: string[]; current: string | null; effective: string | null; reachable: boolean; inSync: boolean; canRollback: boolean;
  history: { id: string; model: string; previousModel: string | null; kind: "CHANGE" | "ROLLBACK"; reason: string; actor: string; at: string }[];
};
const labels: Record<string, string> = { LOCAL: "로컬 모델만 사용", "claude-haiku-5-5": "Claude Haiku (빠르고 저렴)", "claude-sonnet-5-5": "Claude Sonnet (더 정교, 느리고 비쌈)" };
const name = (model: string | null) => (model ? labels[model] ?? model : "미지정");

export default async function AiModelPage({ searchParams }: { searchParams: Promise<{ updated?: string }> }) {
  const { updated } = await searchParams;
  const response = await requestAdmin("ai-model");
  if (!response?.ok) return <p role="alert" className={styles.notice}>모델 설정을 불러오지 못했습니다. 권한과 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>;
  const settings = (await response.json()) as Settings;
  return <>
    <div className={styles.sectionTitle}><div><h2>AI 답변 모델 교체</h2><p>허용된 모델만 고를 수 있고, 바꾼 사람·시각·사유가 이력에 남아요.</p></div></div>
    {updated === "1" && <p role="status" className={styles.notice}>모델을 바꿨어요. AI 서버에 바로 반영됐어요.</p>}
    <section className={styles.section} aria-labelledby="model-now">
      <h3 id="model-now">현재 모델</h3>
      <p>{settings.reachable ? `AI 서버가 지금 쓰는 모델: ${name(settings.effective)}` : "AI 서버에 연결하지 못했어요."}</p>
      {settings.current && !settings.inSync && settings.reachable && <p role="alert" className={styles.attention}>저장된 설정({name(settings.current)})과 AI 서버가 쓰는 모델이 달라요. 서버를 다시 켠 직후라면 잠시 뒤 다시 확인해 주세요.</p>}
      {!settings.current && <p>아직 화면에서 바꾼 적이 없어서 서버 환경변수의 기본 모델을 쓰고 있어요.</p>}
    </section>
    <ModelForms allowed={settings.allowed} current={settings.effective} labels={labels} canRollback={settings.canRollback} />
    <section className={styles.section} aria-labelledby="model-history">
      <div className={styles.sectionTitle}><h3 id="model-history">변경 이력</h3><span>최근 20건</span></div>
      <div className={styles.tableWrap}><table><caption>모델 변경 이력</caption>
        <thead><tr><th>일시</th><th>구분</th><th>이전</th><th>변경 후</th><th>처리자</th><th>사유</th></tr></thead>
        <tbody>{settings.history.length ? settings.history.map((row) => <tr key={row.id}><td>{date(row.at)}</td><td>{row.kind === "ROLLBACK" ? "되돌림" : "교체"}</td><td>{name(row.previousModel)}</td><td>{name(row.model)}</td><td>{row.actor}</td><td>{row.reason}</td></tr>) : <tr><td colSpan={6}>아직 변경 이력이 없어요.</td></tr>}</tbody>
      </table></div>
    </section>
  </>;
}
