import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PreparedCitation } from './answer.service.js';
import { articleNorm } from './related-provisions.js';

/**
 * 답변 근거로 고른 조문을 인용한 판례 후보. 판례 원문의 "참조조문"에서 만든 역인덱스(legal_prec_ref)로 찾는다.
 * 조문마다 판례를 먼저 몇 건씩 보장해서 뽑은 뒤(많이 인용된 조문이 자리를 독차지하지 않게) 합친다.
 * AURORE_PRECEDENT_CANDIDATES=0 으로 끈다.
 */
export type PrecedentCandidate = {
  legalPrecId: string;
  caseNo: string;
  caseNm: string;
  courtNm: string;
  decisionDt: string;
  issue: string | null;
  summary: string | null;
  /** 이 판례가 인용한 조문 중 후보 조문과 겹치는 것(라벨, 예: "민법 제750조"). */
  matched: string[];
  /** 질문의 내용어가 판시사항·판결요지에 몇 개 들어 있는지(관련도). */
  score?: number;
};

const PER_PROVISION = 3;
// 조문마다 후보를 넉넉히(40건) 가져와 질문과 말이 겹치는 순으로 다시 정렬한 뒤 3건만 쓴다(조문 번호가 같다는 것만으로는 주제가 맞지 않는 경우가 많다).
const POOL_PER_PROVISION = 40;
// 겹치는 말이 이 수 미만인 판례는 후보에서 뺀다. 기본은 0(빼지 않고 관련도 순으로만 정렬). 2로 해 보니 맞는 판례까지 빠져 판례 항목이 오히려 줄었다(2026-11-22 측정).
const minScore = () => Number(process.env.AURORE_PRECEDENT_MIN_SCORE ?? 0) || 0;
const MAX_TOTAL = 6;
const EXCERPT = 500;

type Row = {
  idx: number;
  prec_id: bigint;
  case_no: string;
  case_nm: string;
  court_nm: string;
  decision_dt: Date;
  issue_cont: string | null;
  summary_cont: string | null;
  old_yn: boolean;
};

/** 법제처 본문의 줄바꿈 태그·앞뒤 공백을 정리하고 길이를 줄인다(판결 요지를 고쳐 쓰는 것이 아니라 앞부분만 쓴다). */
export function excerpt(value: string | null | undefined, limit = EXCERPT): string | null {
  const text = (value ?? '').replace(/<br\s*\/?>/giu, '\n').replace(/[ \t]+/gu, ' ').replace(/\n\s*\n+/gu, '\n').trim();
  if (!text) return null;
  return text.length <= limit ? text : text.slice(0, limit).trimEnd() + '…';
}

const GENERIC = new Set(['어떻게', '어떤', '있나', '없나', '되나', '하나', '경우', '때문', '정도', '대한', '관련', '가능', '그리고', '그런데', '제가', '저도', '있는데', '했는데', '인데']);

/** 질문의 내용어(조사를 뗀 앞 3글자). 서술어("~나요", "~해요")와 흔한 말은 뺀다. */
export function contentStems(text: string): string[] {
  const out = new Set<string>();
  for (const token of text.match(/[가-힣]{2,}/gu) ?? []) {
    if (GENERIC.has(token) || /(요|까|다|죠)$/u.test(token)) continue;
    const bare = token.length >= 3 && '을를은는이가에도의와과로'.includes(token.slice(-1)) ? token.slice(0, -1) : token;
    out.add(bare.length > 3 ? bare.slice(0, 3) : bare);
  }
  return [...out];
}

/** 판시사항·판결요지에 질문 내용어가 몇 개 들어 있는지. */
export function overlapScore(stems: string[], ...texts: (string | null | undefined)[]): number {
  const body = texts.filter(Boolean).join(' ');
  return stems.reduce((n, stem) => n + (body.includes(stem) ? 1 : 0), 0);
}

/**
 * 후보 인용(법령 조문)마다 그 조문을 인용한 판례를 최대 3건 뽑는다.
 * 우선순위: 현행 법령 인용(구 법령 아님) → 판결요지가 있는 것 → 최신 선고. 판례가 여러 후보 조문과 겹치면 앞으로 올린다.
 */
export async function precedentCandidates(
  db: PrismaService,
  citations: PreparedCitation[],
  limit = MAX_TOTAL,
  hint = '',
): Promise<PrecedentCandidate[]> {
  if (process.env.AURORE_PRECEDENT_CANDIDATES === '0') return [];
  const targets = citations
    .map((citation) => ({ citation, norm: articleNorm(citation.label) }))
    .filter((t) => t.citation.citeTypeCd === 'LEGAL' && t.citation.legalVerId && t.norm);
  if (!targets.length) return [];

  const versionIds = targets.map((t) => t.citation.legalVerId as bigint);
  const norms = targets.map((t) => t.norm as string);
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT t.idx::int AS idx, x.prec_id, x.case_no, x.case_nm, x.court_nm, x.decision_dt, x.issue_cont, x.summary_cont, x.old_yn
      FROM unnest(${versionIds}::bigint[], ${norms}::text[]) WITH ORDINALITY AS t(ver_id, art_key, idx)
      JOIN legal_ver v ON v.id = t.ver_id
      CROSS JOIN LATERAL (
        SELECT rev.legal_prec_id AS prec_id, rev.case_no, rev.case_nm, rev.court_nm, rev.decision_dt,
               left(rev.issue_cont, 700) AS issue_cont, left(rev.summary_cont, 1800) AS summary_cont, ref.old_yn
          FROM legal_prec_ref ref
          JOIN legal_prec p ON p.id = ref.legal_prec_id AND NOT p.del_yn
          JOIN legal_prec_rev rev ON rev.legal_prec_id = p.id AND rev.current_yn
         WHERE ref.legal_id = v.legal_id AND ref.art_key = t.art_key
         ORDER BY ref.old_yn, (btrim(coalesce(rev.summary_cont, '')) <> '') DESC, rev.decision_dt DESC, rev.legal_prec_id
         LIMIT ${POOL_PER_PROVISION}
      ) x
     ORDER BY t.idx`);
  // 조문별로 질문과 겹치는 말이 많은 순(같으면 현행 법령 인용, 최신 선고)으로 3건씩 고른다.
  // AURORE_PRECEDENT_RERANK=0 이면 다시 정렬하지 않는다(전후 비교용).
  const stems = process.env.AURORE_PRECEDENT_RERANK === '0' ? [] : contentStems(hint);
  const scored = rows.map((row, at) => ({ row, at, score: overlapScore(stems, row.issue_cont, row.summary_cont) }));
  const kept: { row: Row; score: number }[] = [];
  for (const idx of new Set(rows.map((row) => row.idx))) {
    scored
      .filter((x) => x.row.idx === idx)
      .sort((a, b) => b.score - a.score || Number(a.row.old_yn) - Number(b.row.old_yn) || a.at - b.at)
      .slice(0, PER_PROVISION)
      .forEach((x) => kept.push({ row: x.row, score: x.score }));
  }

  const byPrec = new Map<string, PrecedentCandidate & { rank: number; old: boolean }>();
  for (const { row, score } of kept) {
    const key = String(row.prec_id);
    const label = targets[row.idx - 1].citation.label.replace(/\s·\s.*$/u, '').replace(/\(.*$/u, '').trim();
    const existing = byPrec.get(key);
    if (existing) {
      if (!existing.matched.includes(label)) existing.matched.push(label);
      existing.old = existing.old && row.old_yn;
      existing.score = Math.max(existing.score ?? 0, score);
      continue;
    }
    byPrec.set(key, {
      legalPrecId: key,
      caseNo: row.case_no,
      caseNm: row.case_nm,
      courtNm: row.court_nm,
      decisionDt: row.decision_dt.toISOString().slice(0, 10),
      issue: excerpt(row.issue_cont),
      summary: excerpt(row.summary_cont),
      matched: [label],
      score,
      rank: row.idx,
      old: row.old_yn,
    });
  }
  // 여러 후보 조문과 겹치는 판례를 먼저, 그다음 앞선 후보 조문 순서. 조문마다 최소 1건은 남도록 먼저 한 건씩 담고 나머지를 채운다.
  // 관련도 점수를 쓰면(기본) 질문과 겹치는 말이 많은 판례를 먼저 둔다(기준 미만 제외는 AURORE_PRECEDENT_MIN_SCORE). AURORE_PRECEDENT_SCORE=0 이면 예전 순서(전후 비교용).
  const useScore = process.env.AURORE_PRECEDENT_SCORE !== '0' && stems.length >= 3;
  const key = (item: { matched: string[]; score?: number }) => (useScore ? (item.score ?? 0) + 2 * (item.matched.length - 1) : item.matched.length);
  const all = [...byPrec.values()]
    .filter((item) => !useScore || (item.score ?? 0) >= minScore())
    .sort((a, b) => key(b) - key(a) || Number(a.old) - Number(b.old) || a.rank - b.rank);
  const picked: typeof all = [];
  const covered = new Set<number>();
  for (const item of all) {
    if (picked.length >= limit) break;
    if (covered.has(item.rank)) continue;
    covered.add(item.rank);
    picked.push(item);
  }
  for (const item of all) {
    if (picked.length >= limit) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return picked.map(({ rank: _rank, old: _old, ...rest }) => rest);
}
