import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * 모델이 말한 법령 이름을 DB의 정식 법령명으로 맞춘다(약칭·띄어쓰기·가운뎃점 차이·비슷한 이름).
 * 정식 명칭과 정확히 같으면 그대로, 약칭이면 별칭 표로, 아니면 글자 묶음(2글자) 유사도가 가장 높은 이름을 쓴다.
 * 유사도가 낮으면(0.6 미만) 맞추지 않는다. DB 법령명 목록은 10분 동안 캐시한다.
 */
const ALIASES: Record<string, string> = {
  주임법: '주택임대차보호법',
  상임법: '상가건물 임대차보호법',
  근기법: '근로기준법',
  학폭법: '학교폭력예방 및 대책에 관한 법률',
  학교폭력예방법: '학교폭력예방 및 대책에 관한 법률',
  개인정보보호법: '개인정보 보호법',
  정보통신망법: '정보통신망 이용촉진 및 정보보호 등에 관한 법률',
  특가법: '특정범죄 가중처벌 등에 관한 법률',
  특정범죄가중법: '특정범죄 가중처벌 등에 관한 법률',
  성폭력처벌법: '성폭력범죄의 처벌 등에 관한 특례법',
  아동학대처벌법: '아동학대범죄의 처벌 등에 관한 특례법',
  가정폭력처벌법: '가정폭력범죄의 처벌 등에 관한 특례법',
  스토킹처벌법: '스토킹범죄의 처벌 등에 관한 법률',
  전자상거래법: '전자상거래 등에서의 소비자보호에 관한 법률',
  할부거래법: '할부거래에 관한 법률',
  방문판매법: '방문판매 등에 관한 법률',
  채권추심법: '채권의 공정한 추심에 관한 법률',
  파견법: '파견근로자 보호 등에 관한 법률',
  기간제법: '기간제 및 단시간근로자 보호 등에 관한 법률',
  퇴직급여법: '근로자퇴직급여 보장법',
  남녀고용평등법: '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률',
  노조법: '노동조합 및 노동관계조정법',
  집합건물법: '집합건물의 소유 및 관리에 관한 법률',
  교특법: '교통사고처리 특례법',
  교통사고처리법: '교통사고처리 특례법',
  자배법: '자동차손해배상 보장법',
  자동차손해배상법: '자동차손해배상 보장법',
  신용정보법: '신용정보의 이용 및 보호에 관한 법률',
  금소법: '금융소비자 보호에 관한 법률',
  채무자회생법: '채무자 회생 및 파산에 관한 법률',
  학원법: '학원의 설립ㆍ운영 및 과외교습에 관한 법률',
  청소년보호법: '청소년 보호법',
  산재보험법: '산업재해보상보험법',
  국민건강보험법: '국민건강보험법',
  임금채권보장법: '임금채권보장법',
  최저임금법: '최저임금법',
};

/** 비교용 정규화: 띄어쓰기·가운뎃점·괄호·따옴표를 지운다. */
export const normalizeLawName = (name: string) => name.normalize('NFKC').replace(/[\s·ㆍ‧∙・()「」『』"']/gu, '');

const bigrams = (text: string) => {
  const out = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) out.add(text.slice(i, i + 2));
  return out;
};
export function similarity(a: string, b: string): number {
  const x = bigrams(a), y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const gram of x) if (y.has(gram)) shared++;
  return (2 * shared) / (x.size + y.size);
}

/** 이름 목록에서 정식 법령명을 고른다(순수 함수: 시험용). 맞출 수 없으면 null. */
export function matchLawName(name: string, names: string[]): string | null {
  const wanted = normalizeLawName(name);
  if (!wanted) return null;
  const byNorm = new Map(names.map((item) => [normalizeLawName(item), item]));
  const exact = byNorm.get(wanted);
  if (exact) return exact;
  const alias = ALIASES[wanted];
  if (alias && byNorm.has(normalizeLawName(alias))) return byNorm.get(normalizeLawName(alias))!;
  // 시행령·시행규칙은 본법 이름을 맞춘 뒤 붙여 본다(예: '주임법 시행령').
  const decree = /(시행령|시행규칙)$/u.exec(wanted)?.[1];
  if (decree) {
    const base = matchLawName(wanted.slice(0, -decree.length), names.filter((item) => !/(시행령|시행규칙)$/u.test(item)));
    const full = base ? byNorm.get(normalizeLawName(base + decree)) : undefined;
    if (full) return full;
  }
  let best: string | null = null, score = 0;
  for (const [norm, original] of byNorm) {
    if (decree ? !norm.endsWith(decree) : /(시행령|시행규칙)$/u.test(norm)) continue;
    const value = similarity(wanted, norm);
    if (value > score) [best, score] = [original, value];
  }
  return score >= 0.6 ? best : null;
}

let cache: { at: number; names: Promise<string[]> } | null = null;
export async function currentLawNames(db: PrismaService): Promise<string[]> {
  if (!cache || Date.now() - cache.at > 600_000) {
    const names = db
      .$queryRaw<{ name: string }[]>`SELECT DISTINCT legal_nm AS name FROM legal WHERE NOT del_yn AND src_cd='MOLEG'`
      .then((rows) => rows.map((row) => row.name));
    cache = { at: Date.now(), names };
    names.catch(() => { cache = null; });
  }
  return cache.names;
}
