import type { AiStatus } from "../_admin/requests";
import styles from "./page.module.css";

const reasons: Record<string, string> = {
  BUDGET_EXHAUSTED: "API 예산(크레딧)이 소진됐어요",
  AUTH_FAILED: "API 키 인증에 실패했어요",
  OVERLOADED: "외부 모델이 일시적으로 과부하예요",
  NETWORK: "외부 모델에 연결하지 못했어요",
  KEY_MISSING: "API 키가 설정되지 않았어요",
};
const minutes = (seconds: number) => (seconds >= 120 ? `${Math.ceil(seconds / 60)}분` : `${seconds}초`);

/** 답변·해설을 어느 모델이 하고 있는지 한눈에 보여 준다. 예산이 떨어져 로컬로 전환됐으면 이유와 다시 시도까지 남은 시간을 알린다. */
export function AiStatusPanel({ status }: { status: AiStatus }) {
  if (!status.reachable)
    return <p role="alert" className={styles.notice}>AI 서버에 연결하지 못했어요. 서버가 켜져 있는지 확인해 주세요.</p>;
  const { mode, externalModel, localModel, calls } = status;
  const headline =
    mode === "external" ? `답변 모델: ${externalModel ?? "외부 모델"} (정상)`
    : mode === "fallback" ? `답변 모델: 로컬 ${localModel}로 전환됨`
    : `답변 모델: 로컬 ${localModel} (외부 모델 사용 안 함)`;
  const detail =
    mode === "fallback"
      ? `${reasons[status.blockedKind ?? ""] ?? "외부 모델을 사용할 수 없어요"}. ${minutes(status.blockedSecondsLeft ?? 0)} 뒤에 다시 시도해요. 그동안 답변은 더 느리고 품질이 낮을 수 있어요.`
      : mode === "external"
        ? `질문은 개인정보 패턴을 가린 뒤 ${externalModel ?? "외부 모델"}로 전송돼요. 문제가 생기면 자동으로 로컬 모델로 전환돼요.`
        : status.keyConfigured ? "외부 모델 설정이 꺼져 있어 모든 답변을 로컬에서 처리해요." : "API 키가 없어 모든 답변을 로컬에서 처리해요. 질문이 외부로 나가지 않아요.";
  return (
    <section className={styles.section} aria-labelledby="ai-status-heading" data-tone={mode === "fallback" ? "danger" : undefined}>
      <div className={styles.sectionTitle}><div><h2 id="ai-status-heading">AI 답변 모델</h2><p>{headline}</p></div></div>
      <p className={mode === "fallback" ? styles.attention : undefined}>{detail}</p>
      {calls && <p>서버가 켜진 뒤 호출: 외부 {calls.external}회 · 로컬 {calls.local}회 · 외부 실패로 로컬 전환 {calls.fallback}회{calls.lastFallbackKind ? ` (마지막 사유: ${reasons[calls.lastFallbackKind] ?? calls.lastFallbackKind})` : ""}</p>}
    </section>
  );
}
