/**
 * "도움 받을 곳": 인용한 법령에 따라 붙이는 공공 상담·신고 연락처. AI가 만든 문장이 아니라 사람이 확인한 고정 표에서 가져온다.
 * 번호는 바뀔 수 있으므로 주기적으로 공식 안내와 대조해야 한다(마지막 확인: 2026-11-21, 사람 검수 필요).
 * AURORE_HELP_CONTACTS=0 으로 끈다.
 */
type Contact = { name: string; number: string; note: string };
const CONTACTS: { laws: RegExp; contacts: Contact[] }[] = [
  { laws: /^학교폭력예방 및 대책에 관한 법률/u, contacts: [{ name: '학교폭력 신고·상담', number: '117', note: '24시간, 문자 #0117' }] },
  { laws: /^(가정폭력|성폭력|스토킹|성매매)/u, contacts: [{ name: '여성긴급전화', number: '1366', note: '24시간' }, { name: '긴급 신고', number: '112', note: '위험할 때' }] },
  { laws: /^(아동복지법|아동학대)/u, contacts: [{ name: '아동학대 신고', number: '112', note: '24시간' }] },
  { laws: /^청소년 보호법/u, contacts: [{ name: '청소년상담', number: '1388', note: '24시간' }] },
  { laws: /^(근로기준법|최저임금법|근로자퇴직급여 보장법|남녀고용평등|기간제 및 단시간근로자|파견근로자|임금채권보장법|고용보험법|노동조합 및 노동관계조정법)/u, contacts: [{ name: '고용노동부 고객상담센터', number: '1350', note: '임금체불·부당해고 등 상담' }] },
  { laws: /^산업재해보상보험법/u, contacts: [{ name: '근로복지공단', number: '1588-0075', note: '산재 신청·상담' }] },
  { laws: /^(소비자기본법|전자상거래 등에서의 소비자보호|할부거래|방문판매|약관의 규제)/u, contacts: [{ name: '소비자상담센터', number: '1372', note: '피해 상담·구제 안내' }] },
  { laws: /^(주택임대차보호법|상가건물 임대차보호법)/u, contacts: [{ name: '대한법률구조공단(임대차 상담·분쟁조정)', number: '132', note: '' }] },
  { laws: /^(개인정보 보호법|정보통신망 이용촉진)/u, contacts: [{ name: '개인정보침해 신고센터', number: '118', note: '' }] },
  { laws: /^국민연금법/u, contacts: [{ name: '국민연금공단', number: '1355', note: '' }] },
  { laws: /^(국민건강보험법|노인장기요양보험법)/u, contacts: [{ name: '국민건강보험공단', number: '1577-1000', note: '' }] },
  { laws: /^(소득세법|부가가치세법|법인세법|상속세 및 증여세법|국세기본법|국세징수법|조세특례제한법)/u, contacts: [{ name: '국세상담센터', number: '126', note: '' }] },
  { laws: /^(금융소비자 보호|신용정보의 이용|채권의 공정한 추심|대부업)/u, contacts: [{ name: '금융감독원', number: '1332', note: '불법추심·금융 민원' }] },
  { laws: /^(형법|폭력행위 등 처벌|도로교통법|교통사고처리 특례법)/u, contacts: [{ name: '사고·범죄 신고', number: '112', note: '' }] },
];
const LEGAL_AID: Contact = { name: '대한법률구조공단 법률상담', number: '132', note: '' };

/** 인용 법령(라벨 앞부분)에 맞는 연락처 줄. 법률 상담(132)은 항상 마지막에 한 번 붙인다. */
export function helpContactLines(label: string): string[] {
  if (process.env.AURORE_HELP_CONTACTS === '0') return [];
  const law = label.replace(/\s제\d+조.*$/u, '').replace(/\s*(시행령|시행규칙)$/u, '').trim();
  const picked = CONTACTS.filter((row) => row.laws.test(law)).flatMap((row) => row.contacts);
  if (!picked.some((contact) => contact.number === LEGAL_AID.number)) picked.push(LEGAL_AID);
  return picked.map((contact) => '· ' + contact.name + ': ' + contact.number + (contact.note ? ' (' + contact.note + ')' : ''));
}
