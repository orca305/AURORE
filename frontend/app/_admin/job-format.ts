export const jobProviders:Record<string,string>={DEMO:'검증 예제',OTHER:'기타 처리'};
export const jobErrors:Record<string,{label:string;detail:string}>={
 GENERATION_FAILED:{label:'답변 생성 실패',detail:'답변 생성 경로에서 오류가 기록됐습니다. 처리 방식에 따른 생성 설정과 서버 운영 기록을 확인해 주세요.'},
 TOTAL_TIMEOUT:{label:'전체 처리 시간 초과',detail:'작업에 허용된 전체 처리 시간을 초과했습니다. 응답 지연과 서버 자원 상태를 확인해 주세요.'},
 ATTEMPTS_EXHAUSTED:{label:'처리 한도 도달',detail:'최대 시도 횟수 또는 처리 기한에 도달했습니다. 시도 횟수와 처리 기한을 함께 확인해 주세요.'},
 OTHER:{label:'기타 오류',detail:'현재 분류에 없는 오류입니다. 서버 운영 기록을 확인해 주세요.'},
 NONE:{label:'오류 기록 없음',detail:'저장된 오류 코드가 없습니다. 현재 작업 상태와 처리 시각을 함께 확인해 주세요.'},
};
