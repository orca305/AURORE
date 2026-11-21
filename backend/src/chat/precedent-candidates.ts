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
};

const PER_PROVISION = 3;
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

/**
 * 후보 인용(법령 조문)마다 그 조문을 인용한 판례를 최대 3건 뽑는다.
 * 우선순위: 현행 법령 인용(구 법령 아님) → 판결요지가 있는 것 → 최신 선고. 판례가 여러 후보 조문과 겹치면 앞으로 올린다.
 */
export async function precedentCandidates(
  db: PrismaService,
  citations: PreparedCitation[],
  limit = MAX_TOTAL,
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
               rev.issue_cont, rev.summary_cont, ref.old_yn
          FROM legal_prec_ref ref
          JOIN legal_prec p ON p.id = ref.legal_prec_id AND NOT p.del_yn
          JOIN legal_prec_rev rev ON rev.legal_prec_id = p.id AND rev.current_yn
         WHERE ref.legal_id = v.legal_id AND ref.art_key = t.art_key
         ORDER BY ref.old_yn, (btrim(coalesce(rev.summary_cont, '')) <> '') DESC, rev.decision_dt DESC, rev.legal_prec_id
         LIMIT ${PER_PROVISION}
      ) x
     ORDER BY t.idx, x.old_yn, x.decision_dt DESC`);

  const byPrec = new Map<string, PrecedentCandidate & { rank: number; old: boolean }>();
  for (const row of rows) {
    const key = String(row.prec_id);
    const label = targets[row.idx - 1].citation.label.replace(/\s·\s.*$/u, '').replace(/\(.*$/u, '').trim();
    const existing = byPrec.get(key);
    if (existing) {
      if (!existing.matched.includes(label)) existing.matched.push(label);
      existing.old = existing.old && row.old_yn;
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
      rank: row.idx,
      old: row.old_yn,
    });
  }
  // 여러 후보 조문과 겹치는 판례를 먼저, 그다음 앞선 후보 조문 순서. 조문마다 최소 1건은 남도록 먼저 한 건씩 담고 나머지를 채운다.
  const all = [...byPrec.values()].sort((a, b) => b.matched.length - a.matched.length || Number(a.old) - Number(b.old) || a.rank - b.rank);
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
