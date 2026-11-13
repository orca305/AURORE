export const number = new Intl.NumberFormat("ko-KR");
const formatter = new Intl.DateTimeFormat("sv-SE", {year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Asia/Seoul"});
export function date(value: string) { const time = new Date(value); return Number.isFinite(time.getTime()) ? formatter.format(time) : "—"; }
export function day(value: string | null) { return value && /^\d{8}$/.test(value) ? value.slice(0,4)+"-"+value.slice(4,6)+"-"+value.slice(6) : value || "—"; }
export const states: Record<string,string> = {QUEUED:"대기",RUNNING:"처리 중",RETRY_WAIT:"재시도 대기",SUCCEEDED:"완료",FAILED:"실패",CANCELLED:"취소"};
export const reviewStates: Record<string,string> = {"ready-to-apply":"신규 시행본 확인 대기","ready-to-review":"정정 검토 대기","stale-review":"기준 원문 변경 · 재검토 필요","artifacts-missing":"수집 자료 누락","watch-inactive":"수집 대상 확인 필요","edition-changed":"시행본 충돌 · 재검토 필요"};

export const correctionResults:Record<string,string>={APPLIED:"정정 반영 완료",REVIEW_CHANGED:"검토 기준 변경",REVIEW_UNAVAILABLE:"검토 자료 확인 실패",SOURCE_NOT_CONFIGURED:"공식 원문 연결 설정 필요",SOURCE_VERIFY_FAILED:"공식 원문 재검증 실패",APPLY_FAILED:"반영 실패 · 재검토 필요",PERMISSION_CHANGED:"처리 중 관리자 인증 변경"};
