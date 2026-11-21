import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DocumentInput, PreparedCitation } from './answer.service.js';
import { cosine, embedTexts, fuseRanks, searchVectorsMulti, vectorEnabled } from './vector-search.js';
import { matchSituations, toNormNo } from './situations.js';
import { LAW_LEVEL_FACTOR, PRIORITY_LAWS, termBoosts } from './law-priority.js';

export type Candidate = {
  kind: string;
  snapshotId: bigint;
  targetId: bigint;
  legalId: bigint | null;
  sourceKey: string;
  edition: string;
  date: string;
  article: string | null;
  title: string;
  proviNm?: string | null;
  proviId?: string;
  vector?: boolean;
  lawKey?: string;
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
type CachedSnapshot = { id: bigint; srcUrl: string; edition: string | undefined; chunks: Chunk[] };
// 파싱된 법령 원문은 크기가 커서 보관 개수를 제한한다(메모리 압박 방지). AURORE_EVIDENCE_CACHE 로 조정한다.
const EVIDENCE_CACHE_SIZE = Math.max(4, Number(process.env.AURORE_EVIDENCE_CACHE ?? 24) || 24);
const evidenceCache = new Map<string, CachedSnapshot>();

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
    // 문맥 안내 문구가 검색어로 섞이지 않게 한다.
    '이전',
    '질문',
    '사용자',
    '확인되지',
    '않은',
    '사실',
    '검색어',
    '힌트',
    '보완',
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
// 어느 법에나 흔한 단어는 가중치를 낮춘다(처벌·계약처럼 법령 이름에 자주 들어가는 단어가 순위를 밀어내는 것을 막는다).
const GENERIC_TERMS = new Set([
  '법원', '청구', '소송', '재판', '절차', '사건',
  '처벌', '계약', '기준', '방법', '경우', '요건', '규정', '가능', '허용', '법적', '반환', '조건', '신청',
]);
// 의도 분석 힌트 단어는 우선순위를 높이고, 어느 법에나 나오는 법원 관련 단어는 낮춘다(개수만 세면 흔한 단어가 순위를 밀어낸다).
export function weightedTerms(question: string, contextText = '') {
  const priority = new Set(
    searchTerms(contextText.match(/검색어 힌트:[^\n]*/u)?.[0] ?? ''),
  );
  const terms = [
    ...new Set([...priority, ...searchTerms(question + ' ' + contextText)]),
  ].slice(0, 16);
  const weight = (term: string) =>
    GENERIC_TERMS.has(term) ? 1 : priority.has(term) ? 4 : 2;
  return { terms, weight };
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

const rowKey = (row: Candidate) => row.kind + ':' + row.targetId + ':' + row.article;
/** law-priority.ts 의 LAW_LEVEL_FACTOR(SQL)와 같은 배율. 법령명(제목의 조문 번호 앞부분)으로 계산한다. */
export function levelFactor(title: string) {
  const name = title.replace(/\s제\d+조.*$/u, '');
  if (/(시행규칙|규칙|규정|훈령|예규|고시|지침|조례)$/u.test(name)) return 0.4;
  if (/(시행령|령)$/u.test(name)) return 0.7;
  if (/(공단|공사|공제회|진흥원|연구원|재단|기념|예우|유공자|설립)/u.test(name)) return 0.6;
  return 1;
}
/** 어휘 순위와 의미(벡터) 순위를 RRF로 융합한다. 융합 점수(×1000×법령 종류 배율)를 새 score로 쓴다. */
export function fuseCandidates(lexical: Candidate[], vectorRows: Candidate[], vectorOrder: string[]): Candidate[] {
  const byProvi = new Map(vectorRows.map((row) => [row.proviId!, row]));
  const vectorKeys = vectorOrder.flatMap((id) => (byProvi.has(id) ? [rowKey(byProvi.get(id)!)] : []));
  const fused = fuseRanks([lexical.map(rowKey), vectorKeys]);
  const merged = new Map<string, Candidate>();
  for (const row of [...lexical, ...vectorRows]) {
    const key = rowKey(row);
    const known = merged.get(key);
    merged.set(key, known ? { ...known, vector: known.vector || row.vector } : row);
  }
  return [...merged.entries()]
    .map(([key, row]) => ({ ...row, score: (fused.get(key) ?? 0) * 1000 * (row.kind === 'LEGAL' ? levelFactor(row.title) : 1) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 어휘 검색 후보의 결정적 재순위. 질문의 법률용어가 조문 제목에 있으면 가점을 주고,
 * 한 법령이 상위를 독차지하지 않도록 법령당 최대 개수를 제한한다(근거로 쓰이는 원문은 바꾸지 않는다).
 */
export function rerankRows<T extends { kind: string; sourceKey: string; title: string; proviNm?: string | null; score: number }>(
  rows: T[],
  { legalTerms, limit, perLawCap = 8 }: { legalTerms: string[]; limit: number; perLawCap?: number },
): T[] {
  const terms = legalTerms.map((term) => term.replace(/\s/gu, '').toLowerCase()).filter((term) => term.length >= 2);
  const adjusted = rows.map((row, index) => {
    const heading = (row.proviNm ?? '').replace(/\s/gu, '').toLowerCase();
    const hits = terms.filter((term) => heading.includes(term) || term.includes(heading) && heading.length >= 3).length;
    return { row, index, score: row.score + (row.kind === 'LEGAL' ? hits * 6 : 0) };
  });
  adjusted.sort((a, b) => b.score - a.score || a.index - b.index);
  const perLaw = new Map<string, number>(),
    kept: T[] = [];
  for (const { row } of adjusted) {
    const key = row.kind + ':' + row.sourceKey;
    const count = perLaw.get(key) ?? 0;
    if (count >= perLawCap) continue;
    perLaw.set(key, count + 1);
    kept.push(row);
    if (kept.length === limit) break;
  }
  return kept;
}

export async function retrieveStoredEvidence(
  db: PrismaService,
  question: string,
  asOf = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }),
  contextText = '',
  candidateLimit = 3,
  lawHints: string[] = [],
  options: { pool?: number; legalTerms?: string[]; vectorQuery?: string; termQuery?: string } = {},
): Promise<StoredEvidence[]> {
  if (
    !Number.isInteger(candidateLimit) ||
    candidateLimit < 1 ||
    candidateLimit > 12
  )
    throw new Error('Invalid evidence candidate limit');
  const pool = Math.min(60, Math.max(candidateLimit, options.pool ?? candidateLimit));
  const profileStart = performance.now();
  const stage: Record<string, number> = {};
  const selectors = searchSelectors(question);
  const { terms, weight } = weightedTerms(question, contextText);
  if (!terms.length && !selectors.article && !selectors.caseNumber) return [];
  // 한글에는 대소문자가 없으므로 영문이 들어간 용어만 lower()를 거친다(전체 조문 스캔 비용의 대부분이었다).
  const rank = (text: Prisma.Sql) =>
    terms.length
      ? Prisma.sql`(${Prisma.join(
          terms.map(
            (term) =>
              Prisma.sql`CASE WHEN position(${term} in ${/[a-z]/u.test(term) ? Prisma.sql`lower(${text})` : text})>0 THEN ${Prisma.raw(String(weight(term)))} ELSE 0 END`,
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
  // 법령 종류 배율, 핵심 생활법령·용어사전 출처 법령 가점. 가점은 질문 단어가 실제로 맞은 조문(base>0)에만 붙는다.
  const boosts = await termBoosts(db, question + ' ' + contextText);
  const lawBonus = Prisma.sql`(CASE WHEN l.legal_nm = ANY(${[...PRIORITY_LAWS]}::text[]) THEN 2 ELSE 0 END
    + CASE WHEN l.legal_nm = ANY(${boosts.laws}::text[]) THEN 8 ELSE 0 END
    + CASE WHEN l.legal_nm = ANY(${lawHints}::text[]) THEN 10 ELSE 0 END
    + CASE WHEN concat(l.legal_nm,'|',p.norm_no) = ANY(${boosts.articles}::text[]) THEN 16 ELSE 0 END)`;
  const vectorEligible = Boolean(options.vectorQuery) && vectorEnabled() && !selectors.article && !selectors.caseNumber;
  // 질문 전체와, 법률용어·법령 후보만으로 만든 두 번째 질의를 함께 검색해 순위를 융합한다(AURORE_MULTI_QUERY=0 이면 첫 질의만).
  const vectorQueries = [options.vectorQuery ?? '', process.env.AURORE_MULTI_QUERY === '0' ? '' : (options.termQuery ?? '')];
  const vectorPromise = vectorEligible ? searchVectorsMulti(vectorQueries, 40).catch(() => null) : Promise.resolve(null);
  const lexicalRows = await db.$queryRaw<Candidate[]>(Prisma.sql`
 WITH legal_scored AS (
 SELECT 'LEGAL' AS kind,r.src_snapshot_id AS "snapshotId",v.id AS "targetId",l.id AS "legalId",l.src_key AS "sourceKey",v.ver_key AS edition,to_char(v.enfc_dt,'YYYYMMDD') AS date,p.norm_no AS article,concat(l.legal_nm,' ',p.disp_no) AS title,p.provi_nm AS "proviNm",${lawRank} AS base,${LAW_LEVEL_FACTOR} AS factor,${lawBonus} AS bonus
 FROM legal_provi p JOIN legal_ver_rev r ON r.id=p.legal_ver_rev_id JOIN legal_ver v ON v.id=r.legal_ver_id JOIN legal l ON l.id=v.legal_id
 WHERE NOT p.del_yn AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL AND r.current_yn AND r.src_snapshot_id IS NOT NULL AND NOT v.del_yn AND NOT l.del_yn AND l.src_cd='MOLEG' AND ${lawSelector}
 AND v.enfc_dt<=${asOf}::date AND (p.enfc_dt IS NULL OR p.enfc_dt<=${asOf}::date)
 AND NOT EXISTS(SELECT 1 FROM legal_ver newer WHERE newer.legal_id=v.legal_id AND NOT newer.del_yn AND newer.enfc_dt<=${asOf}::date AND newer.enfc_dt>v.enfc_dt)
 ), candidates AS (
 SELECT kind,"snapshotId","targetId","legalId","sourceKey",edition,date,article,title,"proviNm",(base*factor + CASE WHEN base>0 THEN bonus ELSE 0 END)::float8 AS score FROM legal_scored
 UNION ALL
 SELECT 'PREC',r.src_snapshot_id,r.legal_prec_id,NULL::bigint,p.src_key,r.case_no,to_char(r.decision_dt,'YYYYMMDD'),NULL::text,concat(r.court_nm,' ',r.case_no,' ',r.case_nm),NULL::text,(${caseRank})::float8
 FROM legal_prec_rev r JOIN legal_prec p ON p.id=r.legal_prec_id WHERE r.current_yn AND NOT p.del_yn AND p.src_cd='MOLEG' AND ${caseSelector} AND r.decision_dt<=${asOf}::date
 ) SELECT * FROM candidates WHERE score>0 OR (kind='LEGAL' AND ${Boolean(selectors.article)}) OR (kind='PREC' AND ${Boolean(selectors.caseNumber)}) ORDER BY score DESC,kind,"targetId","snapshotId",article LIMIT ${pool}`);
  stage.lexicalSql = performance.now() - profileStart;
  // 넓게 가져온 후보를 합치고 결정적으로 재순위해 검토 대상 상위만 남긴다.
  // 의미 검색(임베딩)은 후보를 넓히는 용도이며, 명시적 조문·사건번호 질문에는 쓰지 않는다. 실패하면 어휘 검색만 쓴다.
  let pooled: Candidate[] = lexicalRows;
  const vectorFound = await vectorPromise;
  const queryVector = vectorFound?.query ?? null;
  {
    const hits = vectorFound?.hits ?? [];
    if (hits.length) {
      const vectorRows = await db.$queryRaw<Candidate[]>(Prisma.sql`
 SELECT 'LEGAL' AS kind,r.src_snapshot_id AS "snapshotId",v.id AS "targetId",l.id AS "legalId",l.src_key AS "sourceKey",v.ver_key AS edition,to_char(v.enfc_dt,'YYYYMMDD') AS date,p.norm_no AS article,concat(l.legal_nm,' ',p.disp_no) AS title,p.provi_nm AS "proviNm",p.id::text AS "proviId",TRUE AS vector,0::float8 AS score
 FROM legal_provi p JOIN legal_ver_rev r ON r.id=p.legal_ver_rev_id JOIN legal_ver v ON v.id=r.legal_ver_id JOIN legal l ON l.id=v.legal_id
 WHERE p.id = ANY(${hits.map((hit) => hit.id)}::bigint[]) AND NOT p.del_yn AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL AND r.current_yn AND r.src_snapshot_id IS NOT NULL AND NOT v.del_yn AND NOT l.del_yn AND l.src_cd='MOLEG'
 AND v.enfc_dt<=${asOf}::date AND (p.enfc_dt IS NULL OR p.enfc_dt<=${asOf}::date)
 AND NOT EXISTS(SELECT 1 FROM legal_ver newer WHERE newer.legal_id=v.legal_id AND NOT newer.del_yn AND newer.enfc_dt<=${asOf}::date AND newer.enfc_dt>v.enfc_dt)`);
      pooled = fuseCandidates(lexicalRows, vectorRows, hits.map((hit) => hit.id));
    }
  }
  stage.vector = performance.now() - profileStart;
  // 후보 풀을 넓히지 않고 의미 검색도 쓰지 않으면(AURORE_RETRIEVAL_POOL=12) 기존 어휘 순서를 그대로 쓴다.
  const ranked0 =
    pooled === lexicalRows && pool <= candidateLimit
      ? lexicalRows
      : rerankRows(pooled, { legalTerms: options.legalTerms ?? [], limit: Math.max(candidateLimit, Math.min(pool, candidateLimit * 2)) });
  // 상황 사전: 질문이 알려진 일상 상황에 해당하면 그 핵심 조문을 후보 맨 앞에 넣는다(검토와 원문 검증은 그대로 거친다).
  // 조문·사건번호를 직접 말한 질문에는 쓰지 않는다. AURORE_SITUATION_MAP=0 으로 끈다.
  let rows = ranked0;
  if (process.env.AURORE_SITUATION_MAP !== '0' && !selectors.article && !selectors.caseNumber) {
    const keys = matchSituations(question + ' ' + contextText).flatMap((key) => {
      const [law, article] = key.split('|');
      const normNo = toNormNo(article);
      return normNo ? [law + '|' + normNo] : [];
    });
    if (keys.length) {
      const curated = await db.$queryRaw<Candidate[]>(Prisma.sql`
 SELECT 'LEGAL' AS kind,r.src_snapshot_id AS "snapshotId",v.id AS "targetId",l.id AS "legalId",l.src_key AS "sourceKey",v.ver_key AS edition,to_char(v.enfc_dt,'YYYYMMDD') AS date,p.norm_no AS article,concat(l.legal_nm,' ',p.disp_no) AS title,p.provi_nm AS "proviNm",p.id::text AS "proviId",TRUE AS vector,concat(l.legal_nm,'|',p.norm_no) AS "lawKey",0::float8 AS score
 FROM legal_provi p JOIN legal_ver_rev r ON r.id=p.legal_ver_rev_id JOIN legal_ver v ON v.id=r.legal_ver_id JOIN legal l ON l.id=v.legal_id
 WHERE concat(l.legal_nm,'|',p.norm_no) = ANY(${keys}::text[]) AND NOT p.del_yn AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL AND r.current_yn AND r.src_snapshot_id IS NOT NULL AND NOT v.del_yn AND NOT l.del_yn AND l.src_cd='MOLEG'
 AND v.enfc_dt<=${asOf}::date AND (p.enfc_dt IS NULL OR p.enfc_dt<=${asOf}::date)
 AND NOT EXISTS(SELECT 1 FROM legal_ver newer WHERE newer.legal_id=v.legal_id AND NOT newer.del_yn AND newer.enfc_dt<=${asOf}::date AND newer.enfc_dt>v.enfc_dt)`);
      curated.sort((a, b) => keys.indexOf(a.lawKey ?? '') - keys.indexOf(b.lawKey ?? ''));
      const known = new Set(curated.map(rowKey));
      rows = [...curated, ...ranked0.filter((row) => !known.has(rowKey(row)))];
    }
  }
  const tools = (await import(
    new URL('../../tools/law-evidence.mjs', import.meta.url).href
  )) as { collectEvidence: (payload: unknown, hash: string) => Chunk[] };
  // 스냅샷은 내용 해시로 식별되어 바뀌지 않으므로 id로 캐시해도 안전하다. 캐시에 넣을 때 해시를 검증한다.
  const wanted = [...new Set(rows.map((row) => row.snapshotId))];
  const missing = wanted.filter((id) => !evidenceCache.has(String(id)));
  if (missing.length) {
    const fetched = await db.srcSnapshot.findMany({ where: { id: { in: missing } } });
    for (const snap of fetched) {
      if (
        snap.srcCd !== 'MOLEG' ||
        createHash('sha256').update(snap.srcCont).digest('hex') !== snap.contHash
      )
        continue;
      try {
        const payload = JSON.parse(snap.srcCont) as {
          법령?: { 법령키?: string };
          PrecService?: { 사건번호?: string };
        };
        const entry: CachedSnapshot = {
          id: snap.id,
          srcUrl: snap.srcUrl,
          edition: payload.법령?.법령키 ?? payload.PrecService?.사건번호,
          chunks: tools.collectEvidence(payload, snap.contHash),
        };
        evidenceCache.set(String(snap.id), entry);
        while (evidenceCache.size > EVIDENCE_CACHE_SIZE)
          evidenceCache.delete(evidenceCache.keys().next().value!);
      } catch {
        continue;
      }
    }
  }
  const snapshots = new Map<bigint, CachedSnapshot>();
  for (const id of wanted) {
    const hit = evidenceCache.get(String(id));
    if (!hit) continue;
    // 최근 사용 순서로 옮겨 오래 안 쓴 법령부터 밀어낸다.
    evidenceCache.delete(String(id));
    evidenceCache.set(String(id), hit);
    snapshots.set(id, hit);
  }
  stage.snapshotFetch = performance.now() - profileStart;
  const result: StoredEvidence[] = [],
    seen = new Set<string>();
  const prepare = (row: Candidate) => {
    const snapshot = snapshots.get(row.snapshotId);
    if (!snapshot || snapshot.edition !== row.edition) return null;
    const chunks = snapshot.chunks;
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
      // 의미 검색으로만 올라온 조문은 질문 단어가 본문에 없을 수 있어 첫 본문 필드를 쓴다.
      .filter((item) => item.score > 0 || row.vector)
      .sort((a, b) => b.score - a.score);
    return { snapshot, ranked };
  };
  const prepared = rows.map(prepare);
  // 의미 검색이 켜져 있으면 각 조문 안에서 질문과 가장 뜻이 가까운 항(원문 필드)을 먼저 고른다. 실패하면 단어 일치 순서를 그대로 쓴다.
  if (options.vectorQuery && vectorEnabled() && !selectors.article && !selectors.caseNumber && process.env.AURORE_SEMANTIC_CHUNK !== '0') {
    const picks = prepared.map((item) => (item && item.ranked.length > 1 ? item.ranked.slice(0, 6) : null));
    const chunkTexts = picks.flatMap((list) => (list ?? []).map((entry) => entry.chunk.text.slice(0, 500)));
    // 질문 벡터는 의미 검색에서 이미 구했으면 재사용한다(없을 때만 한 번에 함께 임베딩).
    const embedded = chunkTexts.length
      ? queryVector
        ? await embedTexts(chunkTexts)
        : await embedTexts([options.vectorQuery, ...chunkTexts])
      : null;
    const vectors = embedded ? (queryVector ? [queryVector, ...embedded] : embedded) : null;
    if (vectors) {
      let at = 1;
      picks.forEach((list, index) => {
        if (!list) return;
        const scored = list.map((entry, order) => ({ entry, order, sim: cosine(vectors[0], vectors[at + order]) }));
        at += list.length;
        scored.sort((x, y) => y.sim - x.sim || x.order - y.order);
        prepared[index]!.ranked = [...scored.map((x) => x.entry), ...prepared[index]!.ranked.slice(list.length)];
      });
    }
  }
  for (const [rowIndex, row] of rows.entries()) {
    const prep = prepared[rowIndex];
    if (!prep) continue;
    const { snapshot, ranked } = prep;
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
  stage.total = performance.now() - profileStart;
  if (process.env.AURORE_PROFILE) console.error("PROFILE " + JSON.stringify(Object.fromEntries(Object.entries(stage).map(([k, v]) => [k, Math.round(v)]))));
  return result;
}
