import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// 일상 질문에 자주 해당하는 핵심 생활 법령. 검색 점수에 가점만 주며, 인용·차단 기준이 아니다.
// 법령명이 DB와 다르면 가점이 없을 뿐 동작에는 영향이 없다.
export const PRIORITY_LAWS: readonly string[] = [
  '헌법', '민법', '형법', '상법', '민사소송법', '민사집행법', '형사소송법', '행정소송법', '행정절차법',
  '소액사건심판법', '가사소송법', '민사조정법', '형의 실효 등에 관한 법률', '변호사법', '법원조직법',
  '근로기준법', '근로자퇴직급여 보장법', '최저임금법', '고용보험법', '산업재해보상보험법',
  '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률', '임금채권보장법', '노동조합 및 노동관계조정법',
  '기간제 및 단시간근로자 보호 등에 관한 법률', '파견근로자 보호 등에 관한 법률',
  '근로자참여 및 협력증진에 관한 법률', '산업안전보건법', '직업안정법', '근로복지기본법',
  '주택임대차보호법', '상가건물 임대차보호법', '집합건물의 소유 및 관리에 관한 법률', '공인중개사법',
  '부동산등기법', '부동산 거래신고 등에 관한 법률', '주택법', '공동주택관리법',
  '민간임대주택에 관한 특별법', '건축법', '국토의 계획 및 이용에 관한 법률',
  '도로교통법', '교통사고처리 특례법', '자동차손해배상 보장법', '자동차관리법',
  '개인정보 보호법', '정보통신망 이용촉진 및 정보보호 등에 관한 법률', '신용정보의 이용 및 보호에 관한 법률',
  '저작권법', '상표법', '특허법',
  '소비자기본법', '전자상거래 등에서의 소비자보호에 관한 법률', '약관의 규제에 관한 법률',
  '방문판매 등에 관한 법률', '할부거래에 관한 법률', '독점규제 및 공정거래에 관한 법률',
  '하도급거래 공정화에 관한 법률', '가맹사업거래의 공정화에 관한 법률', '대리점거래의 공정화에 관한 법률',
  '이자제한법', '대부업 등의 등록 및 금융이용자 보호에 관한 법률', '채권의 공정한 추심에 관한 법률',
  '채무자 회생 및 파산에 관한 법률', '보험업법',
  '국민연금법', '국민건강보험법', '노인장기요양보험법',
  '소득세법', '법인세법', '부가가치세법', '상속세 및 증여세법', '국세기본법', '국세징수법', '지방세법',
  '가족관계의 등록 등에 관한 법률', '주민등록법', '출입국관리법',
  '가정폭력범죄의 처벌 등에 관한 특례법', '스토킹범죄의 처벌 등에 관한 법률',
  '성폭력범죄의 처벌 등에 관한 특례법', '아동복지법', '아동학대범죄의 처벌 등에 관한 특례법',
  '청소년 보호법', '경범죄 처벌법', '학교폭력예방 및 대책에 관한 법률',
  '식품위생법', '의료법', '약사법', '공익신고자 보호법',
  '장애인차별금지 및 권리구제 등에 관한 법률', '감염병의 예방 및 관리에 관한 법률',
];

// 법령 종류별 점수 배율. 법률 > 시행령 > 시행규칙·훈령·예규·조례. 특정 기관·행사·유공자 법은 일상 질문과 거리가 멀어 낮춘다.
export const LAW_LEVEL_FACTOR = Prisma.sql`(CASE
  WHEN l.legal_nm ~ '(시행규칙|규칙|규정|훈령|예규|고시|지침|조례)$' THEN 0.4
  WHEN l.legal_nm ~ '(시행령|령)$' THEN 0.7
  WHEN l.legal_nm ~ '(공단|공사|공제회|진흥원|연구원|재단|기념|예우|유공자|설립)' THEN 0.6
  ELSE 1.0 END)`;

type TermBoost = { names: string[]; law: string; article: string | null };
let cache: { at: number; rows: TermBoost[] } | null = null;
const toNorm = (article: string) => {
  const m = /^제\s*(\d+)조(?:의\s*(\d+))?$/u.exec(article.trim());
  return m ? String(Number(m[1])) + (m[2] ? '의' + Number(m[2]) : '') : null;
};
// 공개된 용어사전 항목의 출처 조문("법령명 제N조 조문 인용 …")을 읽어 질문에 용어가 있으면 그 법령·조문에 가점을 준다.
export async function termBoosts(db: PrismaService, text: string) {
  if (!cache || Date.now() - cache.at > 60_000) {
    // 용어사전을 읽지 못해도 검색은 가점 없이 계속한다.
    const rows = await (async () =>
      db.legalTerm.findMany({
        where: { statCd: 'PUBLISHED', delYn: false },
        select: { termNm: true, aliases: true, srcRef: true },
      }))().catch(() => []);
    cache = {
      at: Date.now(),
      rows: rows.flatMap((row) => {
        const m = /^(.+?) (제\d+조(?:의\d+)?) 조문 인용/u.exec(row.srcRef ?? '');
        return m
          ? [{ names: [row.termNm, ...row.aliases].filter((n) => n.length >= 2), law: m[1], article: toNorm(m[2]) }]
          : [];
      }),
    };
  }
  const haystack = text.normalize('NFKC').replace(/\s/gu, '');
  const laws = new Set<string>(),
    articles = new Set<string>();
  for (const row of cache.rows) {
    if (!row.names.some((n) => haystack.includes(n.replace(/\s/gu, '')))) continue;
    laws.add(row.law);
    if (row.article) articles.add(row.law + '|' + row.article);
  }
  return { laws: [...laws], articles: [...articles] };
}
