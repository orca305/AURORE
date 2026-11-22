/** 법규 이름에서 종류를 읽어 색 배지로 보여 준다. */
export function legalKind(name: string): { label: string; tone: 1 | 2 | 3 } {
  if (/시행규칙$/.test(name.trim())) return { label: "시행규칙", tone: 3 };
  if (/시행령$/.test(name.trim())) return { label: "시행령", tone: 2 };
  return { label: "법률", tone: 1 };
}

/** 사건번호의 사건부호로 민사·형사·행정을 나눈다. 모르는 부호는 배지를 달지 않는다. */
export function caseKind(caseNo: string): { label: string; tone: 4 | 5 | 6 } | null {
  const mark = /\d+([가-힣]+)\d+/.exec(caseNo)?.[1];
  if (!mark) return null;
  if (/^(도|고|노|오|초|전|감|로|모)/.test(mark)) return { label: "형사", tone: 5 };
  if (/^(두|누|구|아|루)/.test(mark)) return { label: "행정", tone: 6 };
  if (/^(다|가|나|라|마|카|타|파|하|머|허|바|사|자|차)/.test(mark)) return { label: "민사", tone: 4 };
  return null;
}

export function KindBadge({ label, tone }: { label: string; tone: number }) {
  return <span className="kind-badge" data-tone={tone}>{label}</span>;
}
