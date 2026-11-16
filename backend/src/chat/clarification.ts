import type { PreparedAnswer } from './answer.service.js';
export type ClarifyCode = 'SOURCE_GAP' | 'RELEVANCE_GAP';
export function missingEvidence(
  code: ClarifyCode,
  supplement = false,
): PreparedAnswer {
  return {
    phase: 'start',
    resultCd: code,
    providerCd: code === 'SOURCE_GAP' ? 'STORED_SEARCH' : 'LOCAL_RAG',
    ...(!supplement ? { clarifyCd: code } : {}),
    text: supplement
      ? '추가 설명을 포함해도 현재 저장된 원문에서 뒷받침할 근거를 확인하지 못했습니다. 사실이나 법적 결론을 추정하지 않겠습니다. 법령·판례의 추가 확보 또는 별도 확인이 필요합니다.'
      : (code === 'SOURCE_GAP'
          ? '현재 저장된 법령·판례에서 연결할 원문을 찾지 못했습니다.'
          : '검색한 원문에서 질문과 직접 관련된 근거를 확인하지 못했습니다.') +
        ' 먼저 문제가 된 행동이나 상대방의 요구를 한 문장으로 알려 주세요. 알고 있다면 발생 시점도 덧붙여 주세요. 이름·연락처는 필요하지 않습니다. 저장 자료가 부족한 경우에는 추가 설명으로도 근거를 찾지 못할 수 있습니다.',
  };
}
export function isUncertainSupplement(text: string) {
  return /^(?:잘)?(?:모르겠(?:어(?:요)?|습니다)|모릅니다|몰라(?:요)?|기억(?:이)?안나(?:요)?|확인(?:을)?못했(?:어(?:요)?|습니다)|정보(?:가)?없(?:어(?:요)?|습니다))[.!?。！？]*$/u.test(
    text.replace(/\s/gu, ''),
  );
}
