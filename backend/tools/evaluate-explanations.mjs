// 대표 시나리오의 "근거 기반 쉬운 해설" 실제 평가 도구. 실제 DB(읽기 전용)와 실제 로컬 AI가 필요하다.
// 사용: node --env-file=local-dev/.env --use-system-ca backend/tools/evaluate-explanations.mjs <새 결과 파일> <기준일 YYYY-MM-DD>
// 사전: backend에서 pnpm build. 결과 파일이 이미 있으면 덮어쓰지 않고 실패한다.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { ChatAnswerService } from '../dist/chat/answer.service.js';

// [id, 기대 법령명(하나라도 포함되면 통과, null이면 근거 없음이 정답), 질문, 이전 질문(후속 질문 시나리오만)]
// 기대 법령은 현재 DB에 실제로 있는 법령(수집 진행 중, 2026-11-20 기준 수천 개) 기준이다. 없는 법령의 질문은 null(근거 없음)로 둔다.
const scenarios = [
  ['deposit', ['주택임대차보호법'], '집 계약이 끝났는데 집주인이 보증금을 안 돌려줘요'],
  ['deposit-followup', ['주택임대차보호법'], '그럼 법원에 뭘 신청할 수 있어?', '전세 계약이 끝났는데 보증금을 돌려받지 못하고 있어요'],
  ['lease-renewal', ['주택임대차보호법'], '전세 계약을 갱신하고 싶은데 언제까지 집주인에게 말해야 하나요?'],
  ['shop-rent', ['상가건물 임대차보호법'], '가게 월세를 한 번에 많이 올리겠대요 얼마까지 올릴 수 있나요?'],
  ['wages', ['근로기준법'], '회사가 세 달째 월급을 안 줘요'],
  ['retirement', ['근로자퇴직급여'], '일 년 반 일했는데 사장이 퇴직금을 안 준대요'],
  ['min-wage', ['최저임금법'], '시급이 최저임금보다 적게 받고 있는 것 같아요'],
  ['dismissal', ['근로기준법'], '갑자기 내일부터 나오지 말라고 해고 통보를 받았어요'],
  ['annual-leave', ['근로기준법'], '일 년 일했는데 연차휴가가 며칠인지 궁금해요'],
  ['overtime', ['근로기준법'], '야근을 많이 하는데 연장근로수당을 안 줘요'],
  ['consumer', ['전자상거래'], '온라인으로 산 물건을 환불받고 싶어요 청약철회는 며칠 안에 해야 하나요?'],
  ['consumer-damage', ['소비자기본법'], '산 물건이 불량인데 소비자 피해보상을 받을 수 있나요?'],
  ['article', ['주택임대차보호법'], '주택임대차보호법 제3조 대항력을 갖추려면 무엇이 필요한가요?'],
  ['privacy', ['개인정보 보호법'], '회사가 제 개인정보를 동의 없이 다른 곳에 넘겨도 되나요?'],
  ['drunk-driving', ['도로교통법'], '술을 마시고 운전하면 어떤 기준으로 단속하나요?'],
  ['condo-common', ['집합건물'], '아파트 공용부분을 고치려면 입주민 동의가 필요한가요?'],
  ['broker-fee', ['공인중개사법'], '부동산 중개수수료를 너무 많이 달라고 하는데 기준이 있나요?'],
  ['registration', ['부동산등기법'], '집을 샀는데 소유권 등기는 어떻게 신청하나요?'],
  ['enforcement', ['민사집행법'], '판결을 받았는데 상대방 재산을 압류하려면 어떻게 해야 하나요?'],
  ['prescription', ['민법'], '빌려준 돈을 오래 못 받았는데 소멸시효가 있나요?'],
  ['inheritance', ['민법'], '아버지가 돌아가셨는데 빚이 많아서 상속을 포기하고 싶어요'],
  ['defamation', ['형법'], '인터넷에 제 험담을 올린 사람을 명예훼손으로 처벌할 수 있나요?'],
  ['building-permit', ['건축법'], '허가 없이 집을 증축해도 되나요?'],
  ['birth-report', ['가족관계의 등록'], '아이가 태어났는데 출생신고는 언제까지 해야 하나요?'],
  ['admin-reason', ['행정절차법'], '행정청이 처분을 하면서 이유를 안 알려줘요'],
  ['no-case', null, '2026가단987654321 판결 내용을 알려줘'],
  ['industrial', ['산업재해보상보험법'], '일하다 다쳤는데 산재보상은 어떻게 받나요?'],
  ['parental', ['남녀고용평등', '고용보험법'], '육아휴직은 몇 개월까지 쓸 수 있나요?'],
  ['terms', ['약관의 규제에 관한 법률'], '계약서의 약관이 너무 불공정한데 무효가 되나요?'],
  ['interest', ['이자제한법'], '돈을 빌려줬는데 이자를 연 50%로 받아도 되나요?'],
  ['traffic', ['교통사고처리 특례법', '자동차손해배상 보장법'], '교통사고가 났는데 합의금은 얼마가 적당한가요?'],
  ['bankruptcy', ['채무자 회생 및 파산에 관한 법률'], '빚이 너무 많아서 개인회생을 신청하고 싶어요'],
  ['copyright', ['저작권법'], '제 사진을 허락 없이 블로그에 쓴 사람에게 저작권 침해를 주장할 수 있나요?'],
  ['gift-tax', ['상속세 및 증여세법'], '부모님이 집을 증여해 주시면 증여세는 어떻게 되나요?'],
  ['income-tax', ['소득세법'], '프리랜서로 번 돈은 종합소득세를 언제 신고하나요?'],
  ['national-pension', ['국민연금법'], '국민연금은 몇 살부터 받을 수 있나요?'],
  ['health-insurance', ['국민건강보험법'], '건강보험료를 몇 달 못 냈는데 병원 갈 때 불이익이 있나요?'],
  ['unemployment', ['고용보험법'], '회사를 그만뒀는데 실업급여는 어떤 조건에서 받을 수 있나요?'],
  ['subcontract', ['하도급거래 공정화에 관한 법률'], '원청이 하도급 대금을 제때 안 주는데 어떻게 하나요?'],
  ['franchise', ['가맹사업거래의 공정화에 관한 법률'], '프랜차이즈 본사가 가맹계약 갱신을 거절하는데 가능한가요?'],
  ['stalking', ['스토킹범죄의 처벌 등에 관한 법률'], '헤어진 사람이 계속 찾아오고 연락하는데 스토킹으로 신고할 수 있나요?'],
  ['domestic-violence', ['가정폭력범죄의 처벌 등에 관한 특례법'], '배우자에게 폭력을 당했는데 접근금지 같은 보호를 받을 수 있나요?'],
  ['debt-collection', ['대부업 등의 등록 및 금융이용자 보호에 관한 법률', '채권의 공정한 추심에 관한 법률'], '대부업체가 협박하듯이 빚 독촉을 해요 이래도 되나요?'],
  ['whistleblower', ['공익신고자 보호법'], '회사의 불법행위를 신고했다가 불이익을 받을까 걱정돼요'],
  ['car-insurance', ['자동차손해배상 보장법'], '교통사고로 다쳤는데 상대 차 보험에서 치료비를 받을 수 있나요?'],
  ['real-estate-report', ['부동산 거래신고 등에 관한 법률'], '집을 샀는데 실거래가 신고는 누가 언제까지 해야 하나요?'],
  ['food-hygiene', ['식품위생법'], '식당에서 유통기한이 지난 음식을 팔면 처벌받나요?'],
  ['out-lotto', null, '다음 주 로또 당첨 번호를 알려줘'],
  ['out-win-rate', null, '제 소송에서 이길 확률이 몇 퍼센트인가요?'],
  ['out-weather', null, '오늘 서울 날씨 어때?'],
  // ---- 확대 질문 50개(2026-11-21): 정답 법령이 DB에 실제 있는 것 46개 + 근거가 없어야 정답인 4개 ----
  ['maternity-leave', ['근로기준법', '남녀고용평등'], '출산휴가는 얼마나 쓸 수 있나요?'],
  ['work-hours', ['근로기준법'], '일주일에 52시간보다 더 일하게 시켜도 되나요?'],
  ['workplace-harassment', ['근로기준법'], '직장에서 상사가 계속 괴롭히는데 어떻게 해야 하나요?'],
  ['weekly-holiday-pay', ['근로기준법'], '주휴수당은 어떤 경우에 받을 수 있나요?'],
  ['wage-guarantee', ['임금채권보장법'], '회사가 망해서 못 받은 월급을 나라에서 대신 받을 수 있나요?'],
  ['labor-contract', ['근로기준법'], '사장이 근로계약서를 안 써줬어요'],
  ['lease-registration', ['주택임대차보호법'], '이사를 가야 하는데 보증금을 못 받았어요 임차권등기명령은 어떻게 신청하나요?'],
  ['move-in-report', ['주택임대차보호법'], '전입신고를 하면 집이 경매에 넘어가도 보호받나요?'],
  ['key-money', ['상가건물 임대차보호법'], '상가 권리금을 건물주가 못 받게 방해하면 어떻게 되나요?'],
  ['installment', ['할부거래에 관한 법률'], '할부로 산 물건을 취소하고 싶어요 할부 철회가 되나요?'],
  ['door-to-door', ['방문판매 등에 관한 법률'], '방문판매원에게 산 물건을 철회하고 싶어요'],
  ['loan-early-repay', ['금융소비자 보호에 관한 법률'], '대출을 먼저 갚으면 중도상환수수료를 내야 하나요?'],
  ['insurance-claim', ['상법', '보험업법'], '보험금을 보험사가 안 주려고 해요 보험사고가 나면 언제까지 지급해야 하나요?'],
  ['property-division', ['민법'], '이혼하면 재산분할은 어떻게 되나요?'],
  ['child-support', ['민법', '가사소송법'], '이혼하면 양육비는 어떻게 정하나요?'],
  ['marriage-report', ['가족관계의 등록', '민법'], '혼인신고는 어떻게 하나요?'],
  ['adoption', ['민법'], '아이를 입양하려면 어떤 요건이 필요한가요?'],
  ['will', ['민법'], '유언장을 직접 손으로 쓰면 효력이 있나요?'],
  ['assault', ['형법'], '친구를 때려서 폭행죄로 고소당했어요 처벌이 어떻게 되나요?'],
  ['theft', ['형법'], '남의 물건을 훔치면 처벌이 어떻게 되나요?'],
  ['fraud', ['형법', '형사소송법'], '사기를 당했어요 사기죄로 고소할 수 있나요?'],
  ['criminal-complaint', ['형사소송법'], '고소를 하면 수사는 어떤 절차로 진행되나요?'],
  ['vat', ['부가가치세법'], '부가가치세 신고는 언제 해야 하나요?'],
  ['capital-gains', ['소득세법'], '집을 팔면 양도소득세는 어떻게 계산하나요?'],
  ['acquisition-tax', ['지방세법'], '집을 사면 취득세는 얼마나 내나요?'],
  ['tax-delinquency', ['국세징수법', '국세기본법'], '세금을 내지 못하고 체납하면 어떤 불이익이 있나요?'],
  ['maternity-benefit', ['고용보험법'], '출산전후휴가급여는 어디서 받을 수 있나요?'],
  ['long-term-care', ['노인장기요양보험법'], '부모님이 장기요양등급을 받으려면 어떻게 신청하나요?'],
  ['basic-pension', ['기초연금법'], '기초연금은 누가 받을 수 있나요?'],
  ['admin-appeal', ['행정심판법'], '행정청의 처분이 부당해서 행정심판을 청구하고 싶어요'],
  ['info-disclosure', ['공공기관의 정보공개에 관한 법률'], '공공기관에 자료를 정보공개 청구하고 싶어요'],
  ['data-breach', ['개인정보 보호법'], '제 개인정보가 유출됐는데 손해배상을 받을 수 있나요?'],
  ['credit-info', ['신용정보의 이용 및 보호에 관한 법률'], '내 신용정보를 조회해 본 기록이 신용점수에 영향을 주나요?'],
  ['car-transfer', ['자동차관리법', '자동차등록령'], '중고차를 샀는데 이전등록은 언제까지 해야 하나요?'],
  ['phone-driving', ['도로교통법'], '운전하면서 휴대전화를 쓰면 단속되나요?'],
  ['no-license', ['도로교통법'], '면허 없이 운전하면 처벌이 어떻게 되나요?'],
  ['medical-accident', ['의료법', '의료사고 피해구제 및 의료분쟁 조정 등에 관한 법률'], '병원에서 의료사고가 났는데 어디서 분쟁 조정을 받을 수 있나요?'],
  ['pharmacy', ['약사법'], '약사가 아닌 사람이 약을 팔아도 되나요?'],
  ['school-violence', ['학교폭력예방 및 대책에 관한 법률'], '우리 아이가 학교폭력을 당했어요 어떻게 신고하나요?'],
  ['child-abuse', ['아동학대범죄의 처벌 등에 관한 특례법', '아동복지법'], '이웃집 아이가 학대받는 것 같은데 신고해야 하나요?'],
  ['noise', ['소음ㆍ진동관리법', '공동주택관리법'], '윗집 소음 때문에 너무 힘든데 어떻게 하나요?'],
  ['waste', ['폐기물관리법'], '쓰레기를 아무 데나 버리면 과태료가 얼마인가요?'],
  ['illegal-building', ['건축법'], '불법으로 증축한 건물에 이행강제금이 부과되나요?'],
  ['redevelopment', ['도시 및 주거환경정비법'], '재건축 조합원이 되려면 어떤 조건이 필요한가요?'],
  ['housing-subscription', ['주택법'], '아파트 분양 청약은 누구나 할 수 있나요?'],
  ['music-copyright', ['저작권법'], '유튜브에 남의 노래를 배경음악으로 써도 되나요?'],
  ['out-stock', null, '내일 코스피가 오를까요?'],
  ['out-lunch', null, '점심 메뉴 추천해 주세요'],
  ['out-sports', null, '어제 축구 경기 결과가 궁금해요'],
  ['out-fortune', null, '제 사주로 올해 운세를 봐 주세요'],
];


// 상황 사전·검색 개선을 만들 때 쓰지 않은 새 질문(홀드아웃). EVAL_SET=holdout 으로 이 목록만 돌린다.
// 앞 20개는 사전이 다루는 상황을 다른 말로 물은 것, 뒤 10개는 사전에 없는 주제다.
const holdout = [
  ['h-deposit', ['주택임대차보호법'], '이사를 가야 하는데 전세금을 아직 못 받았어요 이사를 가도 제 권리가 유지되나요?'],
  ['h-wage', ['근로기준법'], '사장님이 두 달 치 급여를 계속 미뤄요 어디에 신고하나요?'],
  ['h-severance', ['근로자퇴직급여'], '퇴사했는데 퇴직금은 언제까지 받을 수 있나요?'],
  ['h-dismiss', ['근로기준법'], '회사에서 권고사직을 하라는데 거부하면 해고되나요?'],
  ['h-leave', ['근로기준법'], '입사한 지 6개월인데 유급 휴가를 쓸 수 있나요?'],
  ['h-refund', ['전자상거래'], '인터넷에서 산 옷이 마음에 안 드는데 7일 안에 반품할 수 있나요?'],
  ['h-fraud', ['형법'], '중고거래에서 돈만 받고 물건을 안 보내는 사람은 어떻게 처벌되나요?'],
  ['h-assault', ['형법'], '술집에서 모르는 사람이 저를 때려서 다쳤어요 처벌할 수 있나요?'],
  ['h-traffic', ['자동차손해배상', '교통사고처리'], '신호 대기 중에 뒤에서 차가 받았어요 보험 처리는 어떻게 되나요?'],
  ['h-divorce', ['민법'], '남편과 이혼하려는데 아이는 누가 키우게 되나요?'],
  ['h-inherit', ['민법'], '어머니가 돌아가셨는데 재산이 가족들에게 어떻게 나뉘나요?'],
  ['h-tax', ['소득세법'], '부업으로 번 돈도 세금 신고를 해야 하나요?'],
  ['h-privacy', ['개인정보 보호법'], '쇼핑몰에서 제 주소와 전화번호가 유출됐어요 어떻게 해야 하나요?'],
  ['h-interest', ['이자제한법', '민법'], '친구에게 돈을 빌려줬는데 이자를 얼마까지 받을 수 있어요?'],
  ['h-copyright', ['저작권법'], '제가 그린 그림을 허락 없이 가져다 쓴 사람을 신고하고 싶어요'],
  ['h-stalk', ['스토킹범죄의 처벌 등에 관한 법률'], '헤어진 사람이 계속 문자를 보내고 집 앞에 찾아와요'],
  ['h-pension', ['국민연금법'], '국민연금은 얼마나 오래 내야 받을 수 있나요?'],
  ['h-unemp', ['고용보험법'], '계약이 끝나서 일을 그만뒀는데 구직급여를 받을 수 있나요?'],
  ['h-shop', ['상가건물 임대차보호법'], '가게 계약이 끝나가는데 건물주가 더 안 빌려준대요'],
  ['h-food', ['식품위생법'], '배달 음식에서 벌레가 나왔어요 신고하면 어떻게 되나요?'],
  ['h-pet', ['민법', '동물보호법'], '반려견이 이웃을 물었어요 제가 책임을 져야 하나요?'],
  ['h-lost', ['형법'], '길에서 주운 지갑을 가져가면 처벌받나요?'],
  ['h-military', ['병역법'], '병역 의무는 몇 살까지 이행해야 하나요?'],
  ['h-passport', ['여권법'], '여권을 잃어버렸어요 재발급은 어떻게 하나요?'],
  ['h-license', ['도로교통법'], '운전면허가 취소됐는데 이의를 제기할 수 있나요?'],
  ['h-smoking', ['국민건강증진법'], '식당 안에서 담배를 피우면 과태료가 있나요?'],
  ['h-academy', ['학원의 설립ㆍ운영 및 과외교습에 관한 법률'], '학원이 갑자기 문을 닫았는데 수강료를 돌려받을 수 있나요?'],
  ['h-kickboard', ['도로교통법'], '전동킥보드를 타다가 사고가 났는데 면허가 필요한가요?'],
  ['h-vote', ['공직선거법'], '선거 때 투표를 하지 않으면 처벌되나요?'],
  ['h-school', ['학교폭력예방 및 대책에 관한 법률'], '아이가 학교에서 맞고 왔어요 학교폭력 신고는 어떻게 하나요?'],
];
// 새 문항 50개(2026-11-21 작성): 검색·선별 개선 중 한 번도 본 적 없는 질문. 기대 법령은 질문만 보고 정했고(검색 결과 미확인), DB에 있는 법령임을 확인했다.
// 법적 질문이 아닌 6개는 근거 없음이 정답(null)이다. EVAL_SET=fresh 로 실행한다.
const fresh = [
  ['f-resign-notice', ['민법', '근로기준법'], '퇴사하겠다고 하면 회사에서 한 달 전에 말하라는데 꼭 그래야 하나요?'],
  ['f-probation', ['최저임금법'], '수습 기간이라고 최저임금을 90%만 준다는데 맞나요?'],
  ['f-night-pay', ['근로기준법'], '밤 10시 이후에 일하면 수당을 더 받나요?'],
  ['f-break-time', ['근로기준법'], '하루 8시간 일하는데 휴게시간은 얼마나 줘야 하나요?'],
  ['f-contract-paper', ['근로기준법'], '근로계약서를 안 써주는데 문제 되지 않나요?'],
  ['f-dispatch', ['파견근로자 보호 등에 관한 법률'], '파견 근로자도 정규직과 같은 대우를 받아야 하나요?'],
  ['f-fixed-term', ['기간제 및 단시간근로자 보호 등에 관한 법률'], '계약직으로 2년 넘게 일하면 정규직이 되나요?'],
  ['f-teen-work', ['근로기준법'], '만 16살인데 아르바이트를 할 수 있나요?'],
  ['f-pay-statement', ['근로기준법'], '급여명세서를 한 번도 못 받았는데 회사에 달라고 할 수 있나요?'],
  ['f-union', ['노동조합 및 노동관계조정법'], '노조를 만들면 회사가 불이익을 줄 수 있나요?'],
  ['f-rent-renew', ['주택임대차보호법'], '월세 계약을 갱신할 때 보증금을 얼마까지 올릴 수 있나요?'],
  ['f-boiler', ['민법', '주택임대차보호법'], '세 들어 사는 집 보일러가 고장 났는데 수리비는 누가 내나요?'],
  ['f-floor-noise', ['공동주택관리법', '소음'], '윗집 층간소음 때문에 힘든데 법적으로 조치할 수 있나요?'],
  ['f-down-payment', ['민법'], '집을 사기로 하고 계약금을 냈는데 마음이 바뀌었어요 돌려받을 수 있나요?'],
  ['f-sale-tax', ['소득세법'], '집을 팔면 양도소득세는 언제까지 신고해야 하나요?'],
  ['f-landlord-sells', ['주택임대차보호법'], '집주인이 집을 팔면 제 전세 계약은 어떻게 되나요?'],
  ['f-subscription', ['전자상거래 등에서의 소비자보호에 관한 법률'], '구독 서비스를 해지하려는데 앱에서 해지 버튼을 못 찾게 해뒀어요'],
  ['f-parcel-lost', ['상법'], '택배가 분실됐는데 배송업체에 배상을 요구할 수 있나요?'],
  ['f-installment', ['할부거래에 관한 법률'], '할부로 산 물건을 중간에 취소하고 싶어요'],
  ['f-insurance-lapse', ['상법', '보험업법'], '보험료를 못 내서 보험이 해지됐는데 되살릴 수 있나요?'],
  ['f-guarantor', ['민법'], '친구 대출에 보증을 섰는데 친구가 안 갚으면 제가 갚아야 하나요?'],
  ['f-collection-calls', ['채권의 공정한 추심에 관한 법률'], '빚을 못 갚고 있는데 추심업체가 밤에도 계속 전화해요'],
  ['f-rehabilitation', ['채무자 회생 및 파산에 관한 법률'], '빚이 너무 많아서 개인회생을 신청하려는데 조건이 있나요?'],
  ['f-advance-gift', ['민법'], '부모님이 살아 계실 때 미리 받은 재산도 상속에 영향을 주나요?'],
  ['f-legitime', ['민법'], '유언으로 한 사람에게 재산을 다 준다고 하면 다른 자녀는 아무것도 못 받나요?'],
  ['f-guardianship', ['민법'], '치매에 걸린 부모님의 재산을 대신 관리하려면 어떻게 해야 하나요?'],
  ['f-child-abuse', ['아동복지법', '아동학대범죄의 처벌 등에 관한 특례법'], '아이를 때리는 부모를 신고하면 어떻게 되나요?'],
  ['f-bicycle-drunk', ['도로교통법'], '술을 마시고 자전거를 타도 단속되나요?'],
  ['f-parked-car', ['도로교통법', '교통사고처리 특례법'], '주차된 차를 긁고 그냥 가면 처벌받나요?'],
  ['f-self-defense', ['형법'], '상대가 먼저 때려서 저도 때렸는데 제가 처벌받나요?'],
  ['f-secret-recording', ['통신비밀보호법'], '다른 사람과의 대화를 몰래 녹음해도 되나요?'],
  ['f-cctv', ['개인정보 보호법'], '건물 입구에 CCTV를 달 때 지켜야 할 것이 있나요?'],
  ['f-minor-crime', ['형법', '소년법'], '만 13살 아이가 친구를 때렸는데 처벌받나요?'],
  ['f-dog-leash', ['동물보호법'], '목줄 없이 개를 데리고 다니면 과태료를 내나요?'],
  ['f-alcohol-minor', ['청소년 보호법'], '미성년자에게 술을 팔면 어떻게 되나요?'],
  ['f-fire-check', ['소방시설 설치 및 관리에 관한 법률'], '식당에서 소방 점검을 받지 않으면 처벌받나요?'],
  ['f-business-register', ['부가가치세법', '소득세법'], '개인사업자 등록은 어디서 어떻게 하나요?'],
  ['f-tax-invoice', ['부가가치세법'], '세금계산서는 언제까지 발급해야 하나요?'],
  ['f-four-insurance', ['고용보험법', '국민건강보험법', '국민연금법', '산업재해보상보험법'], '직원을 한 명 고용하면 4대 보험은 어떻게 해야 하나요?'],
  ['f-patent', ['특허법'], '내가 만든 발명을 특허로 보호받으려면 어떻게 하나요?'],
  ['f-penalty-clause', ['민법'], '계약서에 위약금이 너무 많이 적혀 있는데 깎을 수 있나요?'],
  ['f-passport', ['여권법'], '여권을 잃어버렸는데 어떻게 재발급받나요?'],
  ['f-move-in-report', ['주민등록법'], '이사하고 나서 전입신고는 며칠 안에 해야 하나요?'],
  ['f-draft-delay', ['병역법'], '입영 통지서가 나왔는데 대학 때문에 연기할 수 있나요?'],
  ['f-out-lunch', null, '오늘 점심 뭐 먹으면 좋을까?'],
  ['f-out-crypto', null, '비트코인 가격이 내일 오를까?'],
  ['f-out-movie', null, '주말에 볼 만한 영화 추천해줘'],
  ['f-out-weather', null, '내일 서울 날씨가 어떨까?'],
  ['f-out-soccer', null, '다음 월드컵 우승 후보는 어느 나라야?'],
  ['f-out-code', null, '파이썬에서 리스트를 정렬하는 방법을 알려줘'],
];

const activeScenarios = process.env.EVAL_SET === 'holdout' ? holdout : process.env.EVAL_SET === 'fresh' ? fresh : scenarios;

async function main() {
  const [out, asOf] = process.argv.slice(2);
  assert.ok(out && /^\d{4}-\d{2}-\d{2}$/.test(asOf ?? ''), '결과 파일과 기준일(YYYY-MM-DD)이 필요합니다');
  const database = new URL(process.env.DATABASE_URL);
  assert.ok(database.hostname === '127.0.0.1' && ['5433', '15433'].includes(database.port) && database.pathname === '/aurore_dev_check', '개발 확인용 DB만 허용합니다');
  const ai = new URL(process.env.AURORE_AI_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(ai.hostname) && ai.protocol === 'http:', '로컬 AI 주소만 허용합니다');
  const db = new PrismaService(new ConfigService({ DATABASE_URL: database.href }));
  const answers = new ChatAnswerService(db);
  const results = [];
  try {
    await db.$connect();
    for (const scenario of activeScenarios) {
      const [id, expectedNames, question, history] = scenario;
      if (process.env.EVAL_FIRST && activeScenarios.indexOf(scenario) >= Number(process.env.EVAL_FIRST)) continue;
      if (process.env.EVAL_ONLY && !process.env.EVAL_ONLY.split(',').includes(id)) continue;
      const started = performance.now();
      try {
        // 실제 질문 경로(generate)와 같은 방식: 후속 질문 문맥 + 검색어 힌트(차단·인용 근거로는 쓰지 않음).
        const hints = await answers.searchHints(history ? (history.slice(-600) + ' ' + question).slice(-900) : question);
        const text = [history ? '이전 질문(사용자 설명, 확인되지 않은 사실): ' + history : '', hints.length ? '검색어 힌트: ' + hints.join(' ') : ''].filter(Boolean).join('\n');
        const answer = await answers.generateStored(question, { text, asOf });
        const citation = answer.citation;
        // 기대 법령명 중 하나가 인용 라벨에 있어야 한다(엉뚱한 법령을 인용하면 실패). 근거 없음이 정답인 질문에서 인용이 나오면 과잉 답변이다.
        const sourceOk = expectedNames === null ? !citation : Boolean(citation) && expectedNames.some(name => citation.label.includes(name));
        const explained = answer.providerCd === 'LOCAL_EXPLAIN';
        const record = {
          id, question, history: history ?? null, resultCode: answer.resultCd, provider: answer.providerCd,
          explained, citationLabel: citation?.label ?? null, quote: citation?.citeCont ?? null, explanation: explained ? answer.text : null, answerText: answer.text, trace: answer.trace ?? null,
          // 인용문은 해설과 별개의 원문이어야 한다.
          quoteIsSeparate: citation ? !answer.text.includes(citation.citeCont) : null,
          // 검토가 거절했지만 AI가 짚은 법령의 상위 후보를 '질문 관련성 미검증'으로 보여 준 경우(통과로 세지 않고 따로 센다).
          candidateShown: answer.resultCd === 'RELEVANCE_GAP' && Boolean(citation),
          candidateLawOk: answer.resultCd === 'RELEVANCE_GAP' && Boolean(citation) && expectedNames !== null && expectedNames.some(name => citation.label.includes(name)),
          inCorpus: expectedNames !== null, passed: expectedNames === null ? sourceOk && ['SOURCE_GAP', 'RELEVANCE_GAP'].includes(answer.resultCd) : sourceOk && answer.resultCd === 'EVIDENCE_FOUND',
          seconds: (performance.now() - started) / 1000,
        };
        results.push(record);
        console.log(JSON.stringify({ id, resultCode: record.resultCode, provider: record.provider, passed: record.passed, seconds: +record.seconds.toFixed(1) }));
      } catch (error) {
        results.push({ id, question, error: String(error?.message ?? error).slice(0, 80), passed: false, seconds: (performance.now() - started) / 1000 });
        console.log(JSON.stringify({ id, passed: false, error: results.at(-1).error }));
      }
    }
  } finally {
    await db.$disconnect();
  }
  const found = results.filter(row => row.resultCode === 'EVIDENCE_FOUND');
  const seconds = results.map(row => row.seconds).sort((a, b) => a - b);
  const summary = {
    cases: results.length,
    passed: results.filter(row => row.passed).length,
    // 현재 DB에 법령이 있는 질문: 맞는 법령을 찾았는가 / 법령이 없는 질문: 근거 없이 보류했는가(과잉 답변 방지)
    inCorpus: { cases: results.filter(r => r.inCorpus).length, passed: results.filter(r => r.inCorpus && r.passed).length },
    outOfCorpus: { cases: results.filter(r => r.inCorpus === false).length, heldBack: results.filter(r => r.inCorpus === false && r.passed).length },
    evidenceFound: found.length,
    // 근거는 나왔지만 기대한 법령이 아닌 경우(엉뚱한 인용)와, 법령이 없는 질문에 근거를 낸 경우(과잉 답변)
    wrongCitation: results.filter(r => r.inCorpus && r.resultCode === 'EVIDENCE_FOUND' && !r.passed).length,
    overreach: results.filter(r => r.inCorpus === false && r.resultCode === 'EVIDENCE_FOUND').length,
    missed: results.filter(r => r.inCorpus && r.resultCode !== 'EVIDENCE_FOUND').length,
    // 거절 시 후보 표시: 보여 준 수 / 그중 기대 법령인 수 / 근거 없어야 하는 질문에 후보를 보인 수(0이어야 한다)
    candidateShown: results.filter(r => r.candidateShown).length,
    candidateLawOk: results.filter(r => r.candidateLawOk).length,
    candidateOverreach: results.filter(r => r.inCorpus === false && r.citationLabel).length,
    explained: found.filter(row => row.explained).length,
    // 해설 검증 실패로 고정 문구로 되돌아간 비율: 이 값이 높으면 검증이 지나치게 엄격하거나 모델 출력이 불안정하다.
    fallbackRate: found.length ? 1 - found.filter(row => row.explained).length / found.length : null,
    meanSeconds: seconds.reduce((a, b) => a + b, 0) / seconds.length,
    p95Seconds: seconds[Math.ceil(seconds.length * 0.95) - 1],
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ asOf, syntheticQuestions: true, databaseWrites: false, summary, results }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(summary));
  if (summary.passed !== summary.cases) process.exitCode = 1;
}
try { await main(); } catch (error) { console.error('EXPLANATION_EVALUATION_FAILED: ' + String(error?.message ?? error).slice(0, 120)); process.exitCode = 1; }
