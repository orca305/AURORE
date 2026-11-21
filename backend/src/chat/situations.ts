// 일상 상황 → 핵심 조문 사전. 질문이 어떤 상황에 해당하면 그 조문을 검색 후보에 반드시 포함시킨다.
// 후보일 뿐이며 인용은 여전히 AI 관련성 검토와 원문 글자 일치 검증을 거친다. 조문은 DB에 있는 현행 조문명 기준이다.
// needs: 모든 그룹에서 하나 이상의 표현이 있어야 한다(공백 제거 후 비교). not: 이 표현이 있으면 제외.
// articles: "법령명|조문" 형식, 앞쪽일수록 우선한다. AURORE_SITUATION_MAP=0 으로 끈다.
export type Situation = { id: string; needs: string[][]; not?: string[]; articles: string[] };

const HOME_SHOP = ['상가', '가게', '점포', '음식점', '카페', '매장'];
const GIVE_BACK = ['돌려', '반환', '못받', '안줘', '안주', '미반환', '회수', '안내줘', '떼먹'];
const NOT_PAID = ['안줘', '안주', '못받', '체불', '밀렸', '밀려', '미지급', '안나와', '안들어'];

export const SITUATIONS: Situation[] = [
  // 임대차·부동산
  { id: 'deposit-return-home', needs: [['보증금', '전세금', '전세'], GIVE_BACK], not: HOME_SHOP,
    articles: ['주택임대차보호법|제3조의3', '주택임대차보호법|제3조의2', '주택임대차보호법|제3조'] },
  { id: 'deposit-return-shop', needs: [HOME_SHOP, ['보증금'], GIVE_BACK],
    articles: ['상가건물 임대차보호법|제6조', '상가건물 임대차보호법|제5조'] },
  { id: 'rent-increase-home', needs: [['월세', '차임', '보증금', '전세금'], ['올리', '올려', '인상', '증액', '올릴']], not: HOME_SHOP,
    articles: ['주택임대차보호법|제7조'] },
  { id: 'rent-increase-shop', needs: [HOME_SHOP, ['월세', '차임', '보증금'], ['올리', '올려', '인상', '증액', '올릴']],
    articles: ['상가건물 임대차보호법|제11조'] },
  { id: 'renewal-home', needs: [['갱신', '연장'], ['전세', '월세', '임대차', '집주인', '임대인']], not: HOME_SHOP,
    articles: ['주택임대차보호법|제6조의3', '주택임대차보호법|제6조'] },
  { id: 'renewal-shop', needs: [HOME_SHOP, ['갱신', '연장']],
    articles: ['상가건물 임대차보호법|제10조'] },
  { id: 'rent-arrears', needs: [['월세', '차임'], ['연체', '밀렸', '밀려', '못냈', '못내']],
    articles: ['민법|제640조', '상가건물 임대차보호법|제10조의8'] },
  { id: 'small-deposit-priority', needs: [['최우선', '소액임차', '소액보증금']],
    articles: ['주택임대차보호법|제8조'] },
  { id: 'move-in-fixed-date', needs: [['전입신고', '확정일자', '대항력', '우선변제']],
    articles: ['주택임대차보호법|제3조', '주택임대차보호법|제3조의2'] },
  { id: 'broker-fee', needs: [['중개수수료', '중개보수', '복비']],
    articles: ['공인중개사법|제32조'] },
  { id: 'earnest-money', needs: [['계약금'], ['포기', '돌려', '해약', '파기', '취소', '배액', '날려']],
    articles: ['민법|제565조'] },
  { id: 'ownership-registration', needs: [['등기'], ['신청', '소유권', '이전', '어떻게']],
    articles: ['부동산등기법|제24조', '부동산등기법|제23조'] },
  { id: 'real-estate-report', needs: [['실거래', '거래신고', '매매신고', '거래가신고'], ['신고']],
    articles: ['부동산 거래신고 등에 관한 법률|제3조'] },
  { id: 'jeonse-fraud', needs: [['전세사기']],
    articles: ['전세사기피해자 지원 및 주거안정에 관한 특별법|제3조', '주택임대차보호법|제3조의3'] },
  { id: 'building-permit', needs: [['증축', '신축', '건축허가', '개축', '불법건축', '무허가', '허가없이'], ['집', '건물', '건축', '증축', '신축']],
    articles: ['건축법|제11조', '건축법|제79조'] },
  // 근로
  { id: 'wage-unpaid', needs: [['월급', '임금', '급여', '품삯', '알바비'], NOT_PAID],
    articles: ['근로기준법|제43조', '근로기준법|제36조'] },
  { id: 'wage-guarantee', needs: [['회사'], ['망했', '도산', '폐업', '파산', '문닫'], ['월급', '임금', '퇴직금', '체불']],
    articles: ['임금채권보장법|제7조'] },
  { id: 'severance', needs: [['퇴직금']],
    articles: ['근로자퇴직급여 보장법|제9조', '근로자퇴직급여 보장법|제8조'] },
  { id: 'dismissal', needs: [['해고', '잘렸', '잘려', '잘리', '나오지말라', '나오지마', '짤렸', '짤려', '권고사직']],
    articles: ['근로기준법|제23조', '근로기준법|제26조', '근로기준법|제27조', '근로기준법|제28조'] },
  { id: 'annual-leave', needs: [['연차']], articles: ['근로기준법|제60조'] },
  { id: 'weekly-holiday', needs: [['주휴']], articles: ['근로기준법|제55조'] },
  { id: 'overtime-pay', needs: [['야근', '연장근로', '연장근무', '야간근로', '야간근무', '휴일근로', '휴일근무', '초과근무', '초과근로'], ['수당', '안줘', '안주', '가산', '못받', '돈']],
    articles: ['근로기준법|제56조'] },
  { id: 'break-time', needs: [['휴게시간', '쉬는시간', '점심시간', '휴게']], articles: ['근로기준법|제54조'] },
  { id: 'minimum-wage', needs: [['최저임금', '최저시급']], articles: ['최저임금법|제6조'] },
  { id: 'parental-leave', needs: [['육아휴직']], articles: ['남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률|제19조'] },
  { id: 'maternity', needs: [['출산휴가', '산전후', '임산부', '임신중', '임신해서']], articles: ['근로기준법|제74조'] },
  { id: 'workplace-bullying', needs: [['괴롭힘', '갑질', '왕따', '폭언'], ['직장', '회사', '상사', '동료', '사장', '팀장']],
    articles: ['근로기준법|제76조의2', '근로기준법|제76조의3'] },
  { id: 'industrial-accident', needs: [['산재', '업무상재해', '일하다다쳤', '일하다가다쳤', '근무중다쳤', '출근길']],
    articles: ['산업재해보상보험법|제37조'] },
  { id: 'unemployment', needs: [['실업급여', '구직급여']],
    articles: ['고용보험법|제40조', '고용보험법|제45조'] },
  // 소비·금융
  { id: 'online-refund', needs: [['환불', '청약철회', '반품', '교환'], ['인터넷', '온라인', '쇼핑', '택배', '구매', '샀', '주문', '쇼핑몰']],
    articles: ['전자상거래 등에서의 소비자보호에 관한 법률|제17조'] },
  { id: 'door-to-door', needs: [['방문판매', '전화권유', '다단계', '찾아와서', '방문해서']],
    articles: ['방문판매 등에 관한 법률|제8조'] },
  { id: 'installment-cancel', needs: [['할부'], ['철회', '취소', '해지']],
    articles: ['할부거래에 관한 법률|제8조'] },
  { id: 'consumer-damage', needs: [['소비자피해', '피해보상', '피해구제', '소비자원']],
    articles: ['소비자기본법|제55조', '소비자기본법|제16조'] },
  { id: 'interest-limit', needs: [['이자', '이율'], ['연', '퍼센트', '%', '높', '몇', '얼마', '받아도']],
    articles: ['이자제한법|제2조'] },
  { id: 'lender-interest', needs: [['대부업', '대출업체', '사채', '대부업체'], ['이자', '이율']],
    articles: ['대부업 등의 등록 및 금융이용자 보호에 관한 법률|제8조'] },
  { id: 'debt-collection', needs: [['추심', '독촉', '빚독촉', '채권추심', '빚쟁이', '협박하듯']],
    articles: ['채권의 공정한 추심에 관한 법률|제9조'] },
  { id: 'personal-rehabilitation', needs: [['개인회생']], articles: ['채무자 회생 및 파산에 관한 법률|제589조'] },
  { id: 'bankruptcy', needs: [['파산', '면책']], articles: ['채무자 회생 및 파산에 관한 법률|제566조'] },
  { id: 'small-claims', needs: [['소액소송', '소액사건']], articles: ['소액사건심판법|제2조'] },
  { id: 'payment-order', needs: [['지급명령']], articles: ['민사소송법|제462조'] },
  { id: 'provisional-seizure', needs: [['가압류']], articles: ['민사집행법|제276조'] },
  // 형사
  { id: 'defamation', needs: [['명예훼손', '험담', '악플', '허위사실', '소문을퍼', '비방']],
    articles: ['형법|제307조'] },
  { id: 'insult', needs: [['모욕', '욕설', '욕했', '욕을', '욕먹']], articles: ['형법|제311조'] },
  { id: 'fraud', needs: [['사기', '속았', '속여', '먹튀', '떼먹고']], articles: ['형법|제347조'] },
  { id: 'assault', needs: [['폭행', '때렸', '맞았', '구타', '주먹']], not: ['가정폭력'], articles: ['형법|제260조'] },
  { id: 'threat', needs: [['협박', '죽이겠', '해치겠']], articles: ['형법|제283조'] },
  { id: 'theft', needs: [['훔쳤', '절도', '도둑', '훔쳐']], articles: ['형법|제329조'] },
  { id: 'embezzlement', needs: [['횡령', '배임', '빼돌', '돈을가져']], articles: ['형법|제355조'] },
  { id: 'stalking', needs: [['스토킹', '계속찾아', '계속연락', '따라다', '집앞에찾아']],
    articles: ['스토킹범죄의 처벌 등에 관한 법률|제2조', '스토킹범죄의 처벌 등에 관한 법률|제18조'] },
  { id: 'domestic-violence', needs: [['가정폭력', '배우자', '남편', '아내', '시댁', '부부'], ['폭력', '때려', '맞았', '폭행', '접근금지']],
    articles: ['가정폭력범죄의 처벌 등에 관한 특례법|제29조'] },
  { id: 'whistleblower', needs: [['공익신고', '내부고발', '제보', '불법행위를신고', '신고했다가']],
    articles: ['공익신고자 보호법|제15조', '공익신고자 보호법|제14조'] },
  // 교통
  { id: 'traffic-accident', needs: [['교통사고', '접촉사고', '차사고', '추돌', '차에치', '차에부딪']],
    articles: ['자동차손해배상 보장법|제3조', '교통사고처리 특례법|제3조', '교통사고처리 특례법|제4조'] },
  { id: 'drunk-driving', needs: [['음주운전', '술마시고운전', '술먹고운전', '혈중알코올', '음주단속', '술마시고운전']],
    articles: ['도로교통법|제44조', '도로교통법|제148조의2'] },
  { id: 'phone-driving', needs: [['운전중', '운전하면서', '운전하다', '운전할때'], ['휴대전화', '핸드폰', '스마트폰', '통화', '문자', '전화']],
    articles: ['도로교통법|제49조'] },
  { id: 'car-transfer', needs: [['이전등록', '명의이전', '중고차', '자동차등록']],
    articles: ['자동차관리법|제12조', '자동차등록령|제26조'] },
  // 가족
  { id: 'divorce', needs: [['이혼']], articles: ['민법|제834조', '민법|제840조'] },
  { id: 'child-support', needs: [['양육비', '양육권', '친권']], articles: ['민법|제837조'] },
  { id: 'property-division', needs: [['재산분할', '이혼위자료', '이혼재산'], ['이혼', '분할']], articles: ['민법|제839조의2'] },
  { id: 'marriage-report', needs: [['혼인신고', '결혼신고', '혼인등록']], articles: ['가족관계의 등록 등에 관한 법률|제71조'] },
  { id: 'birth-report', needs: [['출생신고']], articles: ['가족관계의 등록 등에 관한 법률|제44조'] },
  { id: 'inheritance-order', needs: [['상속']], articles: ['민법|제1000조'] },
  { id: 'inheritance-renounce', needs: [['상속'], ['포기', '한정승인', '빚이많', '빚이더많', '채무가많']],
    articles: ['민법|제1019조', '민법|제1041조', '민법|제1028조'] },
  { id: 'forced-heirship', needs: [['유류분']], articles: ['민법|제1112조'] },
  // 개인정보·저작권
  { id: 'privacy-provision', needs: [['개인정보'], ['동의', '넘겨', '넘기', '제공', '수집', '이용']],
    articles: ['개인정보 보호법|제17조', '개인정보 보호법|제15조'] },
  { id: 'privacy-leak', needs: [['개인정보', '정보'], ['유출', '해킹', '털렸']], articles: ['개인정보 보호법|제39조'] },
  { id: 'copyright-infringement', needs: [['저작권', '무단사용', '도용', '베꼈', '표절'], ['침해', '허락', '무단', '주장', '처벌']],
    articles: ['저작권법|제136조'] },
  // 세금·사회보험
  { id: 'income-tax-filing', needs: [['종합소득세', '프리랜서', '사업소득', '부업'], ['신고', '언제', '기한']],
    articles: ['소득세법|제70조'] },
  { id: 'capital-gains-tax', needs: [['양도소득세', '양도세', '집팔']], articles: ['소득세법|제105조'] },
  { id: 'gift-tax', needs: [['증여']], articles: ['상속세 및 증여세법|제4조', '상속세 및 증여세법|제68조'] },
  { id: 'national-pension', needs: [['국민연금'], ['언제', '몇살', '수령', '받을', '나이', '노령']], articles: ['국민연금법|제61조'] },
  { id: 'health-insurance-arrears', needs: [['건강보험'], ['미납', '못냈', '연체', '체납', '밀렸', '못내']], articles: ['국민건강보험법|제53조'] },
  // 식품
  { id: 'food-hygiene', needs: [['유통기한', '식중독', '위생'], ['식당', '음식', '영업', '팔', '판매', '처벌']],
    articles: ['식품위생법|제44조', '식품위생법|제94조'] },
];

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s/gu, '');

/** 질문(과 검색어 힌트)에 해당하는 상황의 조문 키("법령명|조문")를 우선순위 순으로, 중복 없이 돌려준다. */
export function matchSituations(text: string, limit = 5): string[] {
  const haystack = normalize(text);
  if (!haystack) return [];
  const keys: string[] = [];
  for (const situation of SITUATIONS) {
    if (situation.not?.some((word) => haystack.includes(normalize(word)))) continue;
    if (!situation.needs.every((group) => group.some((word) => haystack.includes(normalize(word))))) continue;
    for (const article of situation.articles) if (!keys.includes(article)) keys.push(article);
  }
  return keys.slice(0, limit);
}

/** "제3조의3" → "3의3" (legal_provi.norm_no 형식). 형식이 다르면 null. */
export function toNormNo(article: string) {
  const m = /^제\s*(\d+)조(?:의\s*(\d+))?$/u.exec(article.trim());
  return m ? String(Number(m[1])) + (m[2] ? '의' + Number(m[2]) : '') : null;
}
