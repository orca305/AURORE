import styles from "./conversation.module.css";

/**
 * 이용 고지: 대화창 아래에 항상 보이는 짧은 안내와, 펼치면 보이는 자세한 설명.
 * 법률 자문이 아니라는 점, AI가 틀릴 수 있다는 점, 질문이 외부 AI(Claude)로 전송될 수 있다는 점, 입력하면 안 되는 정보를 알린다.
 * (약관·개인정보 처리방침을 대신하지 않는다. 법무 검토를 거친 문구로 교체해야 한다.)
 */
export function UsageNotice() {
  return (
    <aside className={styles.usageNotice} aria-label="이용 안내">
      <svg className={styles.noticeIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
      <div className={styles.noticeText}>
        <p>오로르는 법령 원문을 찾아 쉽게 설명하는 <strong>정보 제공 서비스</strong>예요.</p>
        <p>법률 자문이 아니고, AI가 만든 설명은 <strong>틀릴 수 있어요.</strong> 중요한 결정은 원문과 시행일을 확인하고 전문가와 상담해 주세요.</p>
      </div>
      <details>
        <summary>질문이 어떻게 처리되나요?</summary>
        <ul>
          <li>답변은 AI(Anthropic Claude)가 만들어요. 질문은 전화번호·이메일 같은 개인정보 패턴을 가린 뒤 AI로 전송될 수 있고, 연결이 어려우면 이 컴퓨터의 로컬 AI가 대신 처리해요.</li>
          <li>이름, 주민등록번호, 계좌번호, 주소 같은 개인정보는 질문에 적지 말아 주세요. 완전히 가려지지 않을 수 있어요.</li>
          <li>&ldquo;근거: ○○법 제○조&rdquo;가 붙은 내용만 저장된 법령 원문으로 확인한 것이에요. 근거 표시가 없는 내용은 일반적인 설명이라 틀릴 수 있어요.</li>
          <li>&ldquo;관련 판례&rdquo;는 대법원 판결의 판시사항·판결요지에서 가져온 내용이에요. 사건번호를 누르면 판결문 원문과 인용한 조문 대조 결과를 볼 수 있어요. 요지만으로는 사건마다 다른 사정을 알 수 없으니 원문을 확인해 주세요.</li>
          <li>비회원 대화는 만든 날부터 1개월 뒤에 삭제돼요. 회원 대화는 내 대화 목록에서 직접 삭제할 수 있어요.</li>
        </ul>
      </details>
    </aside>
  );
}
