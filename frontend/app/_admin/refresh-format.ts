export const refreshExecutions:Record<string,{label:string;detail:string}>={
 IDLE:{label:'대기',detail:'실행 중인 수집 점유가 없습니다. 준비 완료일 다음 날짜부터 재개할 수 있습니다.'},
 RUNNING:{label:'수집 실행 중',detail:'다른 실행이 점유하고 있습니다. 중복 실행을 시작하지 마세요.'},
 RECOVERY_REQUIRED:{label:'재개 전 점유 확인 필요',detail:'이 기기의 이전 수집 프로세스가 종료된 기록입니다. 상태를 확인하고 복구 옵션으로 재개해 주세요.'},
 OTHER_HOST:{label:'다른 기기의 점유 확인 필요',detail:'다른 기기에서 만든 점유 기록입니다. 해당 기기의 실행 종료를 확인하기 전에는 점유를 해제하지 않습니다.'},
 INVALID:{label:'점유 기록 확인 필요',detail:'점유 기록을 읽거나 검증하지 못했습니다. 임의로 덮어쓰지 말고 기록과 수집 실행 상태를 확인해 주세요.'},
};
export const refreshFailures:Record<string,string>={PLAN_FAILED:'변경 목록 조회 실패',PREVIEW_FAILED:'원문 조회·대조 실패',PREPARE_FAILED:'신규 시행본 준비 실패',REVIEW_FAILED:'정정 비교 준비 실패',TOO_MANY_CANDIDATES:'수집 기간 분할 필요',INCOMPLETE_REPORT:'준비 기록 불완전',EDITION_CONFLICT:'판본 충돌 · 검토 필요',STAGING_FAILED:'수집 준비 실패 · 점검 필요'};
