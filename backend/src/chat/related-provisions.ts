import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PreparedCitation } from './answer.service.js';

/**
 * 해설에 함께 줄 관련 조문(모두 공식 원문). 인용한 한 항만으로는 "그래서 어떻게 되는지"를 말하기 어려워서
 * 같은 조문 전체, 그 조문이 가리키는 같은 법의 조문, 그 조문을 위반했을 때의 벌칙·과태료 조문,
 * 시행령·시행규칙에서 이 조문을 구체화한 조문을 모은다. 해설은 이 원문들 안에서만 근거를 댈 수 있다.
 * AURORE_RELATED_PROVISIONS=0 으로 끈다.
 */
export type RelatedProvision = { label: string; text: string };

const MAX_RELATED = 5;
const TEXT_LIMIT = 700;

/** "제7조의2" → "7의2". 숫자가 아니면 null. */
export function articleNorm(label: string): string | null {
  const found = /제(\d+)조(?:의(\d+))?/u.exec(label);
  return found ? found[1] + (found[2] ? '의' + found[2] : '') : null;
}

/**
 * 조문 본문이 가리키는 같은 법의 조문 번호. 다른 법(「…」 제N조, 같은 법 제N조, 법 제N조)을 가리키는 것은 뺀다.
 * 자기 자신은 뺀다. 순서는 처음 나온 순서.
 */
export function referencedArticles(text: string, self: string | null): string[] {
  const seen = new Set<string>();
  const pattern = /(」\s*|같은\s*법\s*|법\s+|령\s+)?제(\d+)조(?:의(\d+))?/gu;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) continue;
    const norm = match[2] + (match[3] ? '의' + match[3] : '');
    if (norm !== self) seen.add(norm);
  }
  return [...seen];
}

/** 긴 원문은 줄 단위로 잘라 앞부분만 쓴다(인용·근거는 원문 그대로여야 하므로 문장을 고쳐 쓰지 않는다). */
export function clip(text: string, limit = TEXT_LIMIT): string {
  const body = text.trim();
  if (body.length <= limit) return body;
  const lines = body.split('\n');
  let out = '';
  for (const line of lines) {
    if ((out + '\n' + line).length > limit) break;
    out = out ? out + '\n' + line : line;
  }
  return out || body.slice(0, limit);
}

type Row = { law: string; disp: string; heading: string | null; cont: string | null; seq?: number | null };

/** 후보 인용들의 조문 전문(현행). 키는 인용 라벨. 판례·번호 없는 것은 건너뛴다. */
export async function fullArticleTexts(db: PrismaService, citations: PreparedCitation[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    citations.map(async (citation) => {
      const norm = articleNorm(citation.label);
      if (citation.citeTypeCd !== 'LEGAL' || !citation.legalVerId || !norm) return;
      const rows = await db.$queryRaw<{ cont: string | null }[]>(Prisma.sql`SELECT p.provi_cont AS cont FROM legal_provi p JOIN legal_ver_rev r ON r.id=p.legal_ver_rev_id
        WHERE r.legal_ver_id=${citation.legalVerId} AND r.current_yn AND p.norm_no=${norm} AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL AND NOT p.del_yn LIMIT 1`);
      if (rows[0]?.cont?.trim()) out.set(citation.label, rows[0].cont.trim());
    }),
  );
  return out;
}
const labelOf = (row: Row) => row.law + ' ' + row.disp + (row.heading ? '(' + row.heading + ')' : '');

export async function relatedProvisions(db: PrismaService, citation: PreparedCitation): Promise<RelatedProvision[]> {
  if (process.env.AURORE_RELATED_PROVISIONS === '0' || citation.citeTypeCd !== 'LEGAL' || !citation.legalVerId) return [];
  const law = citation.label.replace(/\s제\d+조.*$/u, '').trim();
  const norm = articleNorm(citation.label);
  if (!norm || !law) return [];
  const current = Prisma.sql`p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL AND NOT p.del_yn AND r.current_yn AND NOT v.del_yn AND NOT l.del_yn`;
  const from = Prisma.sql`FROM legal_provi p JOIN legal_ver_rev r ON r.id=p.legal_ver_rev_id JOIN legal_ver v ON v.id=r.legal_ver_id JOIN legal l ON l.id=v.legal_id`;
  const select = Prisma.sql`SELECT l.legal_nm AS law, p.disp_no AS disp, p.provi_nm AS heading, p.provi_cont AS cont`;
  // 조문 번호는 숫자와 '의'만 있으므로 정규식에 그대로 넣어도 안전하다. "제7조" 가 "제7조의2" 에 걸리지 않게 뒤를 막는다.
  const [num, sub] = norm.split('의');
  const mention = '제' + num + '조' + (sub ? '의' + sub : '') + '([^의0-9]|$)';
  const self = await db.$queryRaw<Row[]>(Prisma.sql`${select}, p.sort_seq::float8 AS seq ${from} WHERE v.id=${citation.legalVerId} AND p.norm_no=${norm} AND ${current} LIMIT 1`);
  const own = self[0]?.cont ?? '';
  const refs = referencedArticles(own, norm).slice(0, 3);
  const seq = self[0]?.seq ?? null;
  const [referenced, penalties, decrees, neighbors] = await Promise.all([
    refs.length
      ? db.$queryRaw<Row[]>(Prisma.sql`${select} ${from} WHERE v.id=${citation.legalVerId} AND p.norm_no = ANY(${refs}::text[]) AND ${current}`)
      : Promise.resolve([] as Row[]),
    // 이 조문을 위반했을 때의 벌칙·과태료(같은 법 안에서 이 조문을 가리키는 조문 중 제목이 벌칙류인 것).
    db.$queryRaw<Row[]>(Prisma.sql`${select} ${from} WHERE v.id=${citation.legalVerId} AND p.norm_no<>${norm} AND ${current}
      AND p.provi_cont ~ ${mention} AND p.provi_nm ~ '(벌칙|과태료|벌금|양벌)' ORDER BY p.sort_seq LIMIT 2`),
    // 시행령·시행규칙에서 이 조문을 구체화한 조문("법 제N조").
    db.$queryRaw<Row[]>(Prisma.sql`${select} ${from} WHERE l.legal_nm = ANY(${[law + ' 시행령', law + ' 시행규칙']}::text[]) AND ${current}
      AND p.provi_cont ~ ${'법\\s*' + mention} ORDER BY l.legal_nm, p.sort_seq LIMIT 2`),
    // 바로 앞 1개·뒤 2개 조문(같은 주제의 요건·예외·청구 방법이 이어지는 경우가 많다). 남는 자리에만 넣는다.
    seq === null
      ? Promise.resolve([] as Row[])
      : db.$queryRaw<Row[]>(Prisma.sql`${select}, p.sort_seq::float8 AS seq ${from} WHERE v.id=${citation.legalVerId} AND p.norm_no<>${norm} AND ${current}
      AND p.sort_seq BETWEEN ${seq - 1} AND ${seq + 2} ORDER BY p.sort_seq`),
  ]);
  const out: RelatedProvision[] = [];
  const quote = citation.citeCont.replace(/\s+/gu, '');
  // 인용한 항이 조문 전체가 아니면 조문 전체를 먼저 준다(다른 항의 요건·예외·절차가 답에 필요할 때가 많다).
  if (self[0] && own.replace(/\s+/gu, '') !== quote) out.push({ label: labelOf(self[0]) + ' 전체', text: clip(own, 1100) });
  referenced.sort((a, b) => refs.indexOf(articleNorm(a.disp) ?? '') - refs.indexOf(articleNorm(b.disp) ?? ''));
  // 뒤 조문을 앞 조문보다 먼저 본다.
  const before = (row: Row) => Number((row.seq ?? 0) < (seq ?? 0));
  neighbors.sort((a, b) => before(a) - before(b) || (a.seq ?? 0) - (b.seq ?? 0));
  const seen = new Set<string>();
  for (const row of [...decrees, ...penalties, ...referenced, ...neighbors]) {
    const key = row.law + ' ' + row.disp;
    // 삭제된 조문("제5조 삭제")은 쓸 내용이 없으므로 뺀다.
    if (!row.cont?.trim() || out.length >= MAX_RELATED || seen.has(key) || /^제\d+조(의\d+)?\s*삭제/u.test(row.cont.trim())) continue;
    seen.add(key);
    out.push({ label: labelOf(row), text: clip(row.cont) });
  }
  return out;
}
