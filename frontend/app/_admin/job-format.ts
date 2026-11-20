export const jobProviders:Record<string,string>={DEMO:'검증 예제',LOCAL_DOC:'로컬 AI · 첨부자료',LOCAL_RAG:'로컬 AI · 법령근거',LOCAL_EXPLAIN:'로컬 AI · 근거 해설',STORED_SEARCH:'저장 원문 검색',OTHER:'기타 처리'};
export const jobErrors:Record<string,{label:string;detail:string}>={
 ACCOUNT_WITHDRAWN:{label:'회원 탈퇴',detail:'계정 탈퇴로 답변 작업을 취소했습니다.'},
 CASE_CONTEXT_CHANGED:{label:'사건 정보 변경',detail:'선택한 사실관계 또는 사건 연결이 변경되어 답변 저장을 취소했습니다.'},
 AI_UNAVAILABLE:{label:'AI 연결·응답 불가',detail:'로컬 AI 서버 연결 또는 응답을 확인하지 못했습니다. 서버·모델 준비 상태와 응답 지연을 확인해 주세요.'},
 AI_UPSTREAM_FAILURE:{label:'모델 연결·출력 처리 실패',detail:'AI 서버가 모델 연결 또는 출력 검증 단계에서 처리를 완료하지 못했습니다. 모델 서버 상태와 출력 검증을 확인해 주세요. 원문 불일치로 원인을 단정하지 않습니다.'},
 AI_CONFIGURATION:{label:'AI 연결 설정 확인',detail:'허용된 로컬 AI 주소 설정을 확인해 주세요. 외부 서버로 자동 전환하지 않습니다.'},
 EVIDENCE_INVALID:{label:'인용 검증 실패',detail:'AI 응답 형식·원문 일치·출처 또는 검토 표시를 확인하지 못해 답변을 저장하지 않았습니다. 출력 검증과 모델 평가를 확인해 주세요.'},
 SOURCE_UNAVAILABLE:{label:'선택 자료 사용 불가',detail:'선택한 자료의 사용 가능 상태를 확인하지 못했습니다. 자료 삭제·변경 또는 허용 범위를 확인해 주세요.'},
 GENERATION_FAILED:{label:'답변 생성 실패',detail:'답변 생성 경로에서 오류가 기록됐습니다. 처리 방식에 따른 생성 설정과 서버 운영 기록을 확인해 주세요.'},
 TOTAL_TIMEOUT:{label:'전체 처리 시간 초과',detail:'작업에 허용된 전체 처리 시간을 초과했습니다. 응답 지연과 서버 자원 상태를 확인해 주세요.'},
 ATTEMPTS_EXHAUSTED:{label:'처리 한도 도달',detail:'최대 시도 횟수 또는 처리 기한에 도달했습니다. 시도 횟수와 처리 기한을 함께 확인해 주세요.'},
 OTHER:{label:'기타 오류',detail:'현재 분류에 없는 오류입니다. 서버 운영 기록을 확인해 주세요.'},
 NONE:{label:'오류 기록 없음',detail:'저장된 오류 코드가 없습니다. 현재 작업 상태와 처리 시각을 함께 확인해 주세요.'},
};

export const jobResults:Record<string,{label:string;detail:string}>={
 EVIDENCE_FOUND:{label:'인용 근거 확인',detail:'원문 인용 근거를 확보했습니다. 개별 사건에 대한 법률 적용이 확정되었다는 의미는 아닙니다.'},
 SOURCE_GAP:{label:'저장 근거 없음',detail:'현재 저장 범위에서 질문과 연결할 원문을 찾지 못했습니다. 필요한 자료가 수집되어 있는지와 검색 표현을 확인해 주세요.'},
 RELEVANCE_GAP:{label:'관련 근거 미확인',detail:'검색 후보는 있었지만 질문 관련성 검토를 통과한 인용이 없습니다. 원문 범위와 평가 사례를 확인해 주세요.'},
 DOCUMENT_GAP:{label:'첨부 근거 미확인',detail:'선택한 첨부자료에서 질문과 직접 관련된 인용을 확보하지 못했습니다. 운영 화면에서는 첨부 본문을 열람할 수 없습니다.'},
 AI_NOT_READY:{label:'AI 미준비 · 원문 후보',detail:'로컬 AI 준비 상태를 확인하지 못해 원문 후보만 제공했습니다. 질문 관련성 검토를 마친 답변으로 해석하지 않습니다. AI 서버와 모델 설정을 확인해 주세요.'},
 FACTS_UNCONFIRMED:{label:'사실관계 확인 필요',detail:'필요한 사실을 확정할 수 없어 확인을 요청하거나 답변을 보류했습니다. 사실을 추정한 결과가 아닙니다.'},
 SOURCE_CHANGED:{label:'원문 변경 · 답변 보류',detail:'원문을 대조하지 못했거나 답변 저장 전에 원문 상태가 변경되었습니다. 최신 원문과 수집·정정 상태를 확인해 주세요.'},
 GUIDANCE:{label:'일반 안내',detail:'인용 근거를 사용하지 않는 안내 응답입니다. 법률 근거가 검증된 답변으로 해석하지 않습니다.'},
 NONE:{label:'결과 분류 없음',detail:'진행 중이거나 결과 분류 도입 이전의 작업일 수 있습니다. 저장된 상태만 표시하며 대화 본문으로 결과를 추정하지 않습니다.'},
 OTHER:{label:'기타 결과',detail:'현재 운영 화면에서 분류하지 않은 결과입니다. 원문을 표시하지 않고 허용된 코드만 노출합니다.'},
};
