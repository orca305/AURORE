import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DocumentInput, PreparedCitation } from './answer.service.js';
import { cosine, embedTexts, fuseRanks, searchVectorsMulti, topWithin, vectorEnabled } from './vector-search.js';
import { searchLawTitles } from './law-titles.js';
import { EvidenceCache, PINNED_LAWS, isPinnedLaw } from './evidence-cache.js';
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
// 파싱된 법령 원문 캐시: 개수가 아니라 용량(AURORE_EVIDENCE_CACHE_MB, 기본 64MB 어림)으로 관리하고,
// 자주 쓰는 법령(PINNED_LAWS)은 밀어내지 않고 상시 유지한다(AURORE_EVIDENCE_PIN=0 으로 끔). 자세한 규칙은 evidence-cache.ts.
const evidenceCache = new EvidenceCache<CachedSnapshot>();
type SnapshotTools = { collectEvidence: (payload: unknown, hash: string) => Chunk[] };
type SnapshotRow = { id: bigint; srcCd: string; srcUrl: string; srcCont: string; contHash: string };
/** 스냅샷 한 개를 해시 검증하고 조각으로 만든다. 검증 실패나 형식 오류면 null. */
function buildEntry(snap: SnapshotRow, tools: SnapshotTools): CachedSnapshot | null {
  if (snap.srcCd !== 'MOLEG' || createHash('sha256').update(snap.srcCont).digest('hex') !== snap.contHash) return null;
  try {
    const payload = JSON.parse(snap.srcCont) as { 법령?: { 법령키?: string }; PrecService?: { 사건번호?: string } };
    return { id: snap.id, srcUrl: snap.srcUrl, edition: payload.법령?.법령키 ?? payload.PrecService?.사건번호, chunks: tools.collectEvidence(payload, snap.contHash) };
  } catch {
    return null;
  }
}
const lawNameOf = (title: string) => title.replace(/\s제\d+조.*$/u, '').trim();
let warmed: Promise<void> | null = null;
/** 상시 유지 법령의 현행 원문을 한 번만 미리 불러 둔다(백그라운드). 실패해도 질문 처리에는 영향이 없다. */
export function warmPinnedEvidence(db: PrismaService): Promise<void> {
  if (process.env.AURORE_EVIDENCE_PIN === '0') return Promise.resolve();
  return (warmed ??= (async () => {
    const tools = (await import(new URL('../../tools/law-evidence.mjs', import.meta.url).href)) as SnapshotTools;
    const rows = await db.$queryRaw<{ name: string; sid: bigint }[]>(Prisma.sql`SELECT l.legal_nm AS name, r.src_snapshot_id AS sid
      FROM legal l JOIN legal_ver v ON v.legal_id=l.id JOIN legal_ver_rev r ON r.legal_ver_id=v.id
      WHERE r.current_yn AND r.src_snapshot_id IS NOT NULL AND NOT v.del_yn AND NOT l.del_yn AND l.src_cd='MOLEG' AND l.legal_nm = ANY(${[...PINNED_LAWS]}::text[])
      AND NOT EXISTS(SELECT 1 FROM legal_ver newer WHERE newer.legal_id=v.legal_id AND NOT newer.del_yn AND newer.enfc_dt>v.enfc_dt AND newer.enfc_dt<=CURRENT_DATE)`);
    for (const row of rows) {
      if (evidenceCache.has(String(row.sid))) continue;
      const snap = await db.srcSnapshot.findFirst({ where: { id: row.sid } });
      const entry = snap ? buildEntry(snap, tools) : null;
      if (entry && snap) evidenceCache.set(String(snap.id), entry, snap.srcCont.length, true);
    }
  })().catch(() => { warmed = null; }));
}

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

/**
 * 검토 대상(상위 limit개)에 보장할 후보를 넣는다. 보장 후보가 이미 상위 limit 안에 있으면 그대로 두고,
 * 없으면 앞쪽 4개를 지킨 채 그 뒤에 끼워 넣고 맨 뒤쪽의 일반 후보를 밀어낸다. 나머지 순서는 유지한다.
 */
export function ensureLawSlots<T>(rows: T[], reserved: T[], limit: number, keyOf: (row: T) => string): T[] {
  if (!reserved.length) return rows;
  const reservedKeys = new Set(reserved.map(keyOf));
  const top = rows.slice(0, limit);
  const topKeys = new Set(top.map(keyOf));
  const missing = reserved.filter((row, at) => !topKeys.has(keyOf(row)) && reserved.findIndex((x) => keyOf(x) === keyOf(row)) === at);
  if (!missing.length) return rows;
  const missingKeys = new Set(missing.map(keyOf));
  // 밀어낼 후보: 앞 4개와 보장 후보를 제외한 맨 뒤쪽 것부터.
  const dropAt: number[] = [];
  for (let at = top.length - 1; at >= 4 && dropAt.length < missing.length; at--) if (!reservedKeys.has(keyOf(top[at]))) dropAt.push(at);
  const droppedAt = new Set(dropAt);
  const kept = top.filter((_, at) => !droppedAt.has(at));
  const head = kept.slice(0, 4);
  const tail = kept.slice(4);
  // 밀려난 후보는 버리지 않고 상위 limit 바로 뒤로 보낸다.
  const rest = [...top.filter((_, at) => droppedAt.has(at)), ...rows.slice(limit).filter((row) => !missingKeys.has(keyOf(row)))];
  return [...head, ...missing, ...tail, ...rest];
}

export async function retrieveStoredEvidence(
  db: PrismaService,
  question: string,
  asOf = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }),
  contextText = '',
  candidateLimit = 3,
  lawHints: string[] = [],
  options: { pool?: number; legalTerms?: string[]; vectorQuery?: string; termQuery?: string; hintedLaws?: Set<string>; priorityArticles?: string[] | Promise<string[]> } = {},
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
  void warmPinnedEvidence(db);
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
  // 조문 id 목록으로 후보 행을 가져온다(의미 검색 결과, 법령별 보장 후보에 공통).
  const rowsByProviIds = (provIds: string[]) =>
    db.$queryRaw<Candidate[]>(Prisma.sql`
 SELECT 'LEGAL' AS kind,r.src_snapshot_id AS "snapshotId",v.id AS "targetId",l.id AS "legalId",l.src_key AS "sourceKey",v.ver_key AS edition,to_char(v.enfc_dt,'YYYYMMDD') AS date,p.norm_no AS article,concat(l.legal_nm,' ',p.disp_no) AS title,p.provi_nm AS "proviNm",p.id::text AS "proviId",TRUE AS vector,0::float8 AS score
 FROM legal_provi p JOIN legal_ver_rev r ON r.id=p.legal_ver_rev_id JOIN legal_ver v ON v.id=r.legal_ver_id JOIN legal l ON l.id=v.legal_id
 WHERE p.id = ANY(${provIds}::bigint[]) AND NOT p.del_yn AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL AND r.current_yn AND r.src_snapshot_id IS NOT NULL AND NOT v.del_yn AND NOT l.del_yn AND l.src_cd='MOLEG'
 AND v.enfc_dt<=${asOf}::date AND (p.enfc_dt IS NULL OR p.enfc_dt<=${asOf}::date)
 AND NOT EXISTS(SELECT 1 FROM legal_ver newer WHERE newer.legal_id=v.legal_id AND NOT newer.del_yn AND newer.enfc_dt<=${asOf}::date AND newer.enfc_dt>v.enfc_dt)`);
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
      const vectorRows = await rowsByProviIds(hits.map((hit) => hit.id));
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
  // 모델이 직접 짚은 조문(법령명|정규화 조문번호)과 상황 사전의 핵심 조문을 후보 맨 앞에 넣는다(모델이 짚은 것이 먼저).
  // 법령명은 띄어쓰기 차이를 무시하고 대조한다. 검토·원문 검증은 그대로 거친다.
  {
    const situationKeys =
      process.env.AURORE_SITUATION_MAP !== '0' && !selectors.article && !selectors.caseNumber
        ? matchSituations(question + ' ' + contextText).flatMap((key) => {
            const [law, article] = key.split('|');
            const normNo = toNormNo(article);
            return normNo ? [law + '|' + normNo] : [];
          })
        : [];
    // 모델이 짚은 조문은 검색(어휘·의미)과 동시에 기다리던 것이라, 여기서 받는다(실패하면 빈 목록).
    const priority = (await options.priorityArticles) ?? [];
    const keys = [...new Set([...priority, ...situationKeys].map((key) => key.replace(/\s/gu, '')))];
    if (keys.length) {
      const curated = await db.$queryRaw<Candidate[]>(Prisma.sql`
 SELECT 'LEGAL' AS kind,r.src_snapshot_id AS "snapshotId",v.id AS "targetId",l.id AS "legalId",l.src_key AS "sourceKey",v.ver_key AS edition,to_char(v.enfc_dt,'YYYYMMDD') AS date,p.norm_no AS article,concat(l.legal_nm,' ',p.disp_no) AS title,p.provi_nm AS "proviNm",p.id::text AS "proviId",TRUE AS vector,concat(regexp_replace(l.legal_nm,'[[:space:]]','','g'),'|',p.norm_no) AS "lawKey",0::float8 AS score
 FROM legal_provi p JOIN legal_ver_rev r ON r.id=p.legal_ver_rev_id JOIN legal_ver v ON v.id=r.legal_ver_id JOIN legal l ON l.id=v.legal_id
 WHERE concat(regexp_replace(l.legal_nm,'[[:space:]]','','g'),'|',p.norm_no) = ANY(${keys}::text[]) AND NOT p.del_yn AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL AND r.current_yn AND r.src_snapshot_id IS NOT NULL AND NOT v.del_yn AND NOT l.del_yn AND l.src_cd='MOLEG'
 AND v.enfc_dt<=${asOf}::date AND (p.enfc_dt IS NULL OR p.enfc_dt<=${asOf}::date)
 AND NOT EXISTS(SELECT 1 FROM legal_ver newer WHERE newer.legal_id=v.legal_id AND NOT newer.del_yn AND newer.enfc_dt<=${asOf}::date AND newer.enfc_dt>v.enfc_dt)`);
      curated.sort((a, b) => keys.indexOf(a.lawKey ?? '') - keys.indexOf(b.lawKey ?? ''));
      // 모델이 짚은 조문 번호가 DB에 없으면(번호를 틀렸거나 개정으로 바뀐 경우) 그 법 안에서 질문과 뜻이 가장 가까운 조문을 대신 넣는다.
      const found = new Set(curated.map((row) => row.lawKey));
      const missingLaws = [...new Set(priority.map((key) => key.replace(/\s/gu, '')).filter((key) => !found.has(key)).map((key) => key.split('|')[0]))].slice(0, 3);
      if (missingLaws.length && queryVector) {
        try {
          const own = await db.$queryRaw<{ id: string; law: string }[]>(Prisma.sql`
 SELECT p.id::text AS id, regexp_replace(l.legal_nm,'[[:space:]]','','g') AS law
 FROM legal_provi p JOIN legal_ver_rev r ON r.id=p.legal_ver_rev_id JOIN legal_ver v ON v.id=r.legal_ver_id JOIN legal l ON l.id=v.legal_id
 WHERE regexp_replace(l.legal_nm,'[[:space:]]','','g') = ANY(${missingLaws}::text[]) AND NOT p.del_yn AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL AND r.current_yn AND r.src_snapshot_id IS NOT NULL AND NOT v.del_yn AND NOT l.del_yn AND l.src_cd='MOLEG'
 AND v.enfc_dt<=${asOf}::date AND (p.enfc_dt IS NULL OR p.enfc_dt<=${asOf}::date)
 AND NOT EXISTS(SELECT 1 FROM legal_ver newer WHERE newer.legal_id=v.legal_id AND NOT newer.del_yn AND newer.enfc_dt<=${asOf}::date AND newer.enfc_dt>v.enfc_dt)`);
          const have = new Set(curated.map((row) => row.proviId));
          const picked: string[] = [];
          for (const law of missingLaws) {
            const best = await topWithin(queryVector, own.filter((row) => row.law === law).map((row) => row.id), 2);
            picked.push(...best.map((hit) => hit.id).filter((id) => !have.has(id)).slice(0, 1));
          }
          if (picked.length) curated.push(...(await rowsByProviIds(picked)));
        } catch {
          // 대체 조문 찾기는 보조 수단이다.
        }
      }
      const known = new Set(curated.map(rowKey));
      rows = [...curated, ...ranked0.filter((row) => !known.has(rowKey(row)))];
    }
  }
  // 법령별 최소 후보 보장: 질문 분석이 짚은 법령과, 질문과 뜻이 가까운 법령(법령 중심 벡터)에서 각각 질문과 가장 가까운 조문을
  // 최소 2개씩 검토 대상에 넣는다. 분석이 법령을 못 짚었거나 한 법령(민법·채무자회생법 등)이 후보를 채울 때의 누락을 줄인다.
  // AURORE_LAW_SLOTS=0 으로 끄고, 법령 중심 벡터만 AURORE_LAW_TITLES=0 으로 끈다.
  // 호출자가 인용 법령 일치 검사에 쓸 수 있게, 분석이 짚은 법령과 질문과 뜻이 가까운 법령을 알려 준다.
  for (const law of lawHints) options.hintedLaws?.add(law);
  if (process.env.AURORE_LAW_SLOTS !== '0' && queryVector && !selectors.article && !selectors.caseNumber) {
    try {
      // 1위 법령은 항상, 2위는 1위와 점수 차가 0.01 미만일 때만 쓴다(122문항 실측: 격차가 크면 2위는 대개 무관한 법령).
      const found = await searchLawTitles(queryVector, 2);
      const titleLaws = found.filter((hit, at) => at === 0 || found[0].score - hit.score < 0.01).map((hit) => hit.name);
      for (const law of titleLaws) options.hintedLaws?.add(law);
      const interleaved = [titleLaws[0], lawHints[0], titleLaws[1], lawHints[1]].filter((name): name is string => Boolean(name));
      const hinted = [...new Set(interleaved)].slice(0, 3);
      const lawOf = (row: Candidate) => row.title.replace(/\s제\d+조.*$/u, '');
      const topNow = rows.slice(0, candidateLimit);
      const need = hinted.filter((law) => topNow.filter((row) => row.kind === 'LEGAL' && lawOf(row) === law).length < 2);
      if (need.length) {
        const own = await db.$queryRaw<{ id: string; law: string }[]>(Prisma.sql`
 SELECT p.id::text AS id,l.legal_nm AS law
 FROM legal_provi p JOIN legal_ver_rev r ON r.id=p.legal_ver_rev_id JOIN legal_ver v ON v.id=r.legal_ver_id JOIN legal l ON l.id=v.legal_id
 WHERE l.legal_nm = ANY(${need}::text[]) AND NOT p.del_yn AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL AND r.current_yn AND r.src_snapshot_id IS NOT NULL AND NOT v.del_yn AND NOT l.del_yn AND l.src_cd='MOLEG'
 AND v.enfc_dt<=${asOf}::date AND (p.enfc_dt IS NULL OR p.enfc_dt<=${asOf}::date)
 AND NOT EXISTS(SELECT 1 FROM legal_ver newer WHERE newer.legal_id=v.legal_id AND NOT newer.del_yn AND newer.enfc_dt<=${asOf}::date AND newer.enfc_dt>v.enfc_dt)`);
        const present = new Set(topNow.map((row) => row.proviId).filter(Boolean));
        const chosen: string[] = [];
        for (const law of need) {
          const have = topNow.filter((row) => row.kind === 'LEGAL' && lawOf(row) === law).length;
          const best = await topWithin(queryVector, own.filter((row) => row.law === law).map((row) => row.id), 4);
          chosen.push(...best.filter((hit) => !present.has(hit.id)).slice(0, 2 - have).map((hit) => hit.id));
        }
        if (chosen.length) {
          const fetched = await rowsByProviIds(chosen);
          const reserved = chosen.flatMap((id) => fetched.filter((row) => row.proviId === id));
          rows = ensureLawSlots(rows, reserved, candidateLimit, rowKey);
        }
      }
    } catch {
      // 보장 후보는 보조 수단이다. 실패하면 기존 후보를 그대로 쓴다.
    }
  }
  stage.slots = performance.now() - profileStart;
  const tools = (await import(
    new URL('../../tools/law-evidence.mjs', import.meta.url).href
  )) as { collectEvidence: (payload: unknown, hash: string) => Chunk[] };
  // 스냅샷은 내용 해시로 식별되어 바뀌지 않으므로 id로 캐시해도 안전하다. 캐시에 넣을 때 해시를 검증한다.
  const wanted = [...new Set(rows.map((row) => row.snapshotId))];
  // 이번 질문에 필요한 원문은 처리 시작 시점에 따로 잡아 둔다. 캐시(크기 제한)는 이후 다른 원문을 불러오는 동안
  // 오래된 항목을 밀어내므로, 캐시만 다시 조회하면 방금 있던 원문(예: 민법)의 후보가 통째로 빠질 수 있다.
  const local = new Map<string, CachedSnapshot>();
  for (const id of wanted) {
    const hit = evidenceCache.get(String(id));
    if (hit) local.set(String(id), hit);
  }
  // 상시 유지 법령인지 알기 위한 스냅샷별 법령명(후보 제목에서).
  const lawOfSnapshot = new Map(rows.filter((row) => row.kind === 'LEGAL').map((row) => [String(row.snapshotId), lawNameOf(row.title)]));
  const missing = wanted.filter((id) => !local.has(String(id)));
  if (missing.length) {
    const fetched = await db.srcSnapshot.findMany({ where: { id: { in: missing } } });
    for (const snap of fetched) {
      const entry = buildEntry(snap, tools);
      if (!entry) continue;
      local.set(String(snap.id), entry);
      evidenceCache.set(String(snap.id), entry, snap.srcCont.length, isPinnedLaw(lawOfSnapshot.get(String(snap.id)) ?? ''));
    }
  }
  const snapshots = new Map<bigint, CachedSnapshot>();
  for (const id of wanted) {
    const hit = local.get(String(id));
    if (!hit) continue;
    snapshots.set(id, hit);
  }
  // 이번 질문에 쓴 원문을 최근 사용으로 표시한다(오래 안 쓴 것부터 밀려나도록).
  for (const key of local.keys()) evidenceCache.touch(key);
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
