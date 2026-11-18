import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DocumentInput, PreparedCitation } from './answer.service.js';

type Candidate = {
  kind: string;
  snapshotId: bigint;
  targetId: bigint;
  legalId: bigint | null;
  sourceKey: string;
  edition: string;
  date: string;
  article: string | null;
  title: string;
  score: number;
};
type Chunk = {
  kind: string;
  sourceKey: string;
  date: string;
  article?: string;
  effectiveDate?: string;
  text: string;
  path: (string | number)[];
};
export type StoredEvidence = DocumentInput & { citation: PreparedCitation };

export function searchSelectors(question: string) {
  const text = question.normalize('NFKC');
  const article = text.match(/제\s*(\d{1,5})\s*조(?:\s*의\s*(\d{1,5}))?/u);
  const cases = [
    ...text.matchAll(/(\d{4})\s*([가-힣]{1,4})\s*(\d{1,10})(?!\d)/gu),
  ];
  const ruling = cases.find((match) => !/[년월일]/u.test(match[2]));
  return {
    article: article
      ? String(Number(article[1])) +
        (article[2] ? '의' + Number(article[2]) : '')
      : null,
    caseNumber: ruling ? ruling[1] + ruling[2] + ruling[3] : null,
    includeRelatedCases: /판례|판결/u.test(text),
    namedLaw: Boolean(
      article &&
      /(?:법률|시행령|시행규칙|조례|[가-힣a-zA-Z0-9]{1,}법)(?:의|상|에서)?[\s「」"']*$/u.test(
        text.slice(0, article.index),
      ),
    ),
  };
}
export function searchTerms(question: string) {
  const stop = new Set([
    '알려줘',
    '알려주세요',
    '궁금해요',
    '어떻게',
    '무엇인가요',
    '언제인가요',
    '있나요',
    '해주세요',
    '관련',
    '법령',
    '판례',
    '검색',
    '조건',
    '신청',
    '대해서',
    '내용',
    '설명',
    '확인',
    '싶어요',
    '대한',
    '어떤',
  ]);
  const aliases: Record<string, string> = {
    월급: '임금',
    급여: '임금',
    집주인: '임대인',
    세입자: '임차인',
    전세금: '보증금',
  };
  const words =
    question
      .normalize('NFKC')
      .toLowerCase()
      .match(/[가-힣a-z0-9]{2,30}/gu) ?? [];
  const terms: string[] = [];
  for (const word of words) {
    const stem = word.replace(
      /(?:에서는|에서|으로|에게|[은는이가을를의에와과도])$/u,
      '',
    );
    const term = stem.length >= 2 ? stem : word;
    if (stop.has(word) || stop.has(term)) continue;
    terms.push(aliases[term] ?? term);
    if (term !== word && !aliases[term] && !stop.has(word)) terms.push(word);
  }
  return [...new Set(terms)].slice(0, 16);
}
export function evidenceWindow(text: string, terms: string[], limit = 1200) {
  const lower = text.toLowerCase(),
    starts = new Set([0]);
  // ponytail: at most 128 occurrences per term bound work on long ruling texts.
  for (const term of terms) {
    let from = 0;
    for (let n = 0; n < 128; n++) {
      const at = lower.indexOf(term, from);
      if (at < 0) break;
      starts.add(Math.max(0, at - 160));
      from = at + Math.max(1, term.length);
    }
  }
  let start = 0,
    best = -1;
  for (const candidate of starts) {
    const part = lower.slice(candidate, candidate + limit);
    const score = terms.reduce((n, term) => n + Number(part.includes(term)), 0);
    if (score > best) {
      best = score;
      start = candidate;
    }
  }
  return text.slice(start, start + limit);
}

export async function retrieveStoredEvidence(
  db: PrismaService,
  question: string,
  asOf = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }),
  contextText = '',
  candidateLimit = 3,
): Promise<StoredEvidence[]> {
  if (
    !Number.isInteger(candidateLimit) ||
    candidateLimit < 1 ||
    candidateLimit > 12
  )
    throw new Error('Invalid evidence candidate limit');
  const selectors = searchSelectors(question);
  const terms = searchTerms(question + ' ' + contextText);
  if (!terms.length && !selectors.article && !selectors.caseNumber) return [];
  const rank = (text: Prisma.Sql) =>
    terms.length
      ? Prisma.sql`(${Prisma.join(
          terms.map(
            (term) =>
              Prisma.sql`CASE WHEN position(${term} in lower(${text}))>0 THEN 1 ELSE 0 END`,
          ),
          ' + ',
        )})`
      : Prisma.sql`0`;
  // ponytail: bounded lexical retrieval for the beta corpus; index/search service when corpus measurements require it.
  const lawRank = Prisma.sql`(${rank(Prisma.sql`concat(l.legal_nm,' ',p.provi_nm)`)}*3 + ${rank(Prisma.sql`p.provi_cont`)})`;
  const caseRank = Prisma.sql`(${rank(Prisma.sql`concat(r.case_no,' ',r.case_nm)`)}*3 + ${rank(Prisma.sql`concat(r.issue_cont,' ',r.summary_cont,' ',r.decision_cont)`)})`;
  const namedLawSelector = selectors.namedLaw
    ? Prisma.sql`position(regexp_replace(l.legal_nm,'[[:space:]]','','g') in ${question.normalize('NFKC').replace(/\s/gu, '')})>0`
    : Prisma.sql`TRUE`;
  const lawSelector = selectors.caseNumber
    ? Prisma.sql`FALSE`
    : selectors.article
      ? Prisma.sql`p.norm_no=${selectors.article} AND ${namedLawSelector}`
      : Prisma.sql`TRUE`;
  const caseSelector = selectors.caseNumber
    ? Prisma.sql`regexp_replace(r.case_no,'[[:space:]]','','g')=${selectors.caseNumber}`
    : selectors.article && !selectors.includeRelatedCases
      ? Prisma.sql`FALSE`
      : Prisma.sql`TRUE`;
  const rows = await db.$queryRaw<Candidate[]>(Prisma.sql`
 WITH candidates AS (
 SELECT 'LEGAL' AS kind,r.src_snapshot_id AS "snapshotId",v.id AS "targetId",l.id AS "legalId",l.src_key AS "sourceKey",v.ver_key AS edition,to_char(v.enfc_dt,'YYYYMMDD') AS date,p.norm_no AS article,concat(l.legal_nm,' ',p.disp_no) AS title,${lawRank} AS score
 FROM legal_provi p JOIN legal_ver_rev r ON r.id=p.legal_ver_rev_id JOIN legal_ver v ON v.id=r.legal_ver_id JOIN legal l ON l.id=v.legal_id
 WHERE NOT p.del_yn AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL AND r.current_yn AND r.src_snapshot_id IS NOT NULL AND NOT v.del_yn AND NOT l.del_yn AND l.src_cd='MOLEG' AND ${lawSelector}
 AND v.enfc_dt<=${asOf}::date AND (p.enfc_dt IS NULL OR p.enfc_dt<=${asOf}::date)
 AND NOT EXISTS(SELECT 1 FROM legal_ver newer WHERE newer.legal_id=v.legal_id AND NOT newer.del_yn AND newer.enfc_dt<=${asOf}::date AND newer.enfc_dt>v.enfc_dt)
 UNION ALL
 SELECT 'PREC',r.src_snapshot_id,r.legal_prec_id,NULL::bigint,p.src_key,r.case_no,to_char(r.decision_dt,'YYYYMMDD'),NULL::text,concat(r.court_nm,' ',r.case_no,' ',r.case_nm),${caseRank}
 FROM legal_prec_rev r JOIN legal_prec p ON p.id=r.legal_prec_id WHERE r.current_yn AND NOT p.del_yn AND p.src_cd='MOLEG' AND ${caseSelector} AND r.decision_dt<=${asOf}::date
 ) SELECT * FROM candidates WHERE score>0 OR (kind='LEGAL' AND ${Boolean(selectors.article)}) OR (kind='PREC' AND ${Boolean(selectors.caseNumber)}) ORDER BY score DESC,kind,"targetId","snapshotId",article LIMIT 12`);
  const snapshots = await db.srcSnapshot.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.snapshotId))] } },
  });
  const tools = (await import(
    new URL('../../tools/law-evidence.mjs', import.meta.url).href
  )) as { collectEvidence: (payload: unknown, hash: string) => Chunk[] };
  const result: StoredEvidence[] = [],
    seen = new Set<string>();
  for (const row of rows) {
    const snapshot = snapshots.find((s) => s.id === row.snapshotId);
    if (
      !snapshot ||
      snapshot.srcCd !== 'MOLEG' ||
      createHash('sha256').update(snapshot.srcCont).digest('hex') !==
        snapshot.contHash
    )
      continue;
    let chunks: Chunk[];
    try {
      const payload = JSON.parse(snapshot.srcCont) as {
        법령?: { 법령키?: string };
        PrecService?: { 사건번호?: string };
      };
      if (
        (row.kind === 'LEGAL'
          ? payload.법령?.법령키
          : payload.PrecService?.사건번호) !== row.edition
      )
        continue;
      chunks = tools.collectEvidence(payload, snapshot.contHash);
    } catch {
      continue;
    }
    const matching = chunks.filter(
      (chunk) =>
        chunk.sourceKey === row.sourceKey &&
        chunk.date === row.date &&
        (row.kind === 'PREC' || chunk.article === row.article) &&
        (!chunk.effectiveDate ||
          chunk.effectiveDate <= asOf.replaceAll('-', '')),
    );
    const headingScore =
      Number(
        Boolean(
          row.kind === 'LEGAL' ? selectors.article : selectors.caseNumber,
        ),
      ) + terms.filter((term) => row.title.toLowerCase().includes(term)).length;
    // Some sources put only the article heading in 조문내용; the actual rule is in 항내용.
    // Keep quotations within one original source field rather than inventing joined text.
    const bodyFields = matching.filter(
      (chunk) =>
        !/^제\s*\d+\s*조(?:의\s*\d+)?\s*\([^)]*\)\s*$/u.test(chunk.text.trim()),
    );
    const ranked = (bodyFields.length ? bodyFields : matching)
      .map((chunk) => ({
        chunk,
        score: terms.reduce(
          (n, term) => n + Number(chunk.text.toLowerCase().includes(term)),
          headingScore,
        ),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    // ponytail: at most three original fields for an explicit article; full text stays in its source link.
    for (const { chunk } of ranked.slice(0, selectors.article ? 3 : 1)) {
      const identity = snapshot.id + ':' + JSON.stringify(chunk.path);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const markdown = evidenceWindow(chunk.text, terms);
      if (markdown.trim().length < 8) continue;
      const hex = createHash('sha256').update(identity).digest('hex');
      const id =
        hex.slice(0, 8) +
        '-' +
        hex.slice(8, 12) +
        '-4' +
        hex.slice(13, 16) +
        '-8' +
        hex.slice(17, 20) +
        '-' +
        hex.slice(20, 32);
      const date = row.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
      result.push({
        id,
        name: row.title.slice(0, 80),
        markdown,
        mdHash: createHash('sha256').update(markdown).digest('hex'),
        citation: {
          srcSnapshotId: snapshot.id,
          legalVerId: row.kind === 'LEGAL' ? row.targetId : null,
          legalPrecId: row.kind === 'PREC' ? row.targetId : null,
          citeTypeCd: row.kind,
          citeCont: markdown,
          label:
            row.title +
            (row.kind === 'LEGAL'
              ? ' · ' + date + ' 시행본'
              : ' · ' + date + ' 선고'),
          srcUrl: snapshot.srcUrl,
          viewHref:
            row.kind === 'LEGAL'
              ? '/legals/' +
                row.legalId +
                '/versions/' +
                row.targetId +
                '?' +
                new URLSearchParams({
                  q:
                    '제' +
                    row.article?.replace('의', '조의') +
                    (row.article?.includes('의') ? '' : '조'),
                  asOf: date,
                })
              : '/precedents?' +
                new URLSearchParams({ q: row.edition }) +
                '#case-' +
                row.sourceKey,
          quoteVerifyCd: 'MATCHED',
          supportVerifyCd: 'UNREVIEWED',
        },
      });
      if (result.length === candidateLimit) break;
    }
    if (result.length === candidateLimit) break;
  }
  return result;
}
