import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 조문 임베딩(bge-m3, int8 정규화 벡터)을 파일에서 읽어 코사인 유사도 상위 조문 id를 구한다.
 * 임베딩은 후보 순위용일 뿐이며 인용 근거는 항상 DB의 공식 원문을 글자 그대로 검증해 쓴다.
 * 파일이 없거나 임베딩 호출이 실패하면 빈 목록을 돌려주어 호출자가 어휘 검색만 쓰게 한다.
 * AURORE_VECTOR_SEARCH=0 으로 끈다.
 */
type Index = { ids: string[]; vectors: Int8Array; dims: number };
let loading: Promise<Index | null> | null = null;

export const vectorEnabled = () => process.env.AURORE_VECTOR_SEARCH !== '0';
const directory = () => process.env.AURORE_VECTOR_DIR ?? 'D:/DATA/embeddings/bge-m3';

async function loadIndex(): Promise<Index | null> {
  const dir = directory();
  try {
    if (!existsSync(join(dir, 'manifest.json'))) return null;
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as {
      model: string; dims: number; count: number; chunks: number; chunkSize: number;
    };
    if (manifest.model !== 'bge-m3' || manifest.dims !== 1024) return null;
    const ids = (JSON.parse(await readFile(join(dir, 'ids.json'), 'utf8')) as string[]).slice(0, manifest.count);
    const vectors = new Int8Array(manifest.count * manifest.dims);
    for (let chunk = 0; chunk < manifest.chunks; chunk++) {
      const bytes = await readFile(join(dir, 'chunk-' + String(chunk).padStart(5, '0') + '.bin'));
      const offset = chunk * manifest.chunkSize * manifest.dims;
      if (offset + bytes.length > vectors.length) return null;
      vectors.set(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length), offset);
    }
    return { ids, vectors, dims: manifest.dims };
  } catch {
    return null;
  }
}
const index = () => (loading ??= loadIndex().then((value) => { if (!value) loading = null; return value; }));

/** 조문 임베딩 인덱스(약 200MB)를 미리 읽어 둔다. 첫 질문이 이 시간을 기다리지 않게 하려는 것이다. */
export const warmVectorIndex = () => index().then(() => undefined);

export async function embedQuery(text: string, timeoutMs = 10_000): Promise<Int8Array | null> {
  try {
    const host = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
    const response = await fetch(host + '/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'bge-m3', input: text.slice(0, 700), truncate: true, keep_alive: '30m' }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) return null;
    const { embeddings } = (await response.json()) as { embeddings?: number[][] };
    const vector = embeddings?.[0];
    if (!vector || vector.length !== 1024) return null;
    return quantize(vector);
  } catch {
    return null;
  }
}
/** 여러 문장을 한 번에 임베딩한다(첫 문장은 보통 질문). 하나라도 실패하면 null. */
export async function embedTexts(texts: string[], timeoutMs = 20_000): Promise<Int8Array[] | null> {
  try {
    const host = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
    const response = await fetch(host + '/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'bge-m3', input: texts.map((text) => text.slice(0, 700)), truncate: true, keep_alive: '30m' }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) return null;
    const { embeddings } = (await response.json()) as { embeddings?: number[][] };
    if (!embeddings || embeddings.length !== texts.length || embeddings.some((vector) => vector.length !== 1024)) return null;
    return embeddings.map(quantize);
  } catch {
    return null;
  }
}
export function cosine(a: Int8Array, b: Int8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum / (127 * 127);
}
export function quantize(vector: ArrayLike<number>): Int8Array {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  return Int8Array.from(vector as ArrayLike<number>, (x) => Math.round((x / norm) * 127));
}

/** 질문 벡터와 내적이 큰 상위 n개 조문 id(내림차순). 질문 벡터도 함께 돌려줘 다른 단계가 다시 임베딩하지 않게 한다. */
export async function searchVectorsDetailed(
  query: string,
  n = 40,
): Promise<{ hits: { id: string; score: number }[]; query: Int8Array } | null> {
  if (!vectorEnabled() || !query.trim()) return null;
  // 인덱스 읽기와 질문 임베딩을 동시에 시작한다.
  const [data, q] = await Promise.all([index(), embedQuery(query)]);
  if (!data || !q) return null;
  return { hits: topByDot(data, q, n), query: q };
}
/**
 * 여러 질의(예: 질문 전체, 법률용어·법령 후보만)를 한 번에 임베딩해 각각 검색한 뒤 순위를 융합한다.
 * 첫 질의의 벡터를 함께 돌려준다. 질의가 하나면 searchVectorsDetailed 와 같다.
 */
export async function searchVectorsMulti(
  queries: string[],
  n = 40,
): Promise<{ hits: { id: string; score: number }[]; query: Int8Array } | null> {
  const unique = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  if (!vectorEnabled() || !unique.length) return null;
  if (unique.length === 1) return searchVectorsDetailed(unique[0], n);
  const [data, vectors] = await Promise.all([index(), embedTexts(unique)]);
  if (!data || !vectors) return null;
  const lists = vectors.map((vector) => topByDot(data, vector, n));
  const fused = fuseRanks(lists.map((list) => list.map((hit) => hit.id)));
  const best = new Map<string, number>();
  for (const hit of lists.flat()) best.set(hit.id, Math.max(best.get(hit.id) ?? -1, hit.score));
  const hits = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => ({ id, score: best.get(id) ?? 0 }));
  return { hits, query: vectors[0] };
}
let positions: Map<string, number> | null = null;
/** 주어진 조문 id 집합 안에서만 질문 벡터와 가까운 상위 n개를 구한다(법령 하나 안에서 가장 알맞은 조문 찾기). */
export async function topWithin(query: Int8Array, ids: string[], n: number): Promise<{ id: string; score: number }[]> {
  const data = await index();
  if (!data || !ids.length) return [];
  positions ??= new Map(data.ids.map((id, at) => [id, at]));
  const scored: { id: string; score: number }[] = [];
  for (const id of ids) {
    const at = positions.get(id);
    if (at === undefined) continue;
    let s = 0;
    for (let k = 0, base = at * data.dims; k < data.dims; k++) s += data.vectors[base + k] * query[k];
    scored.push({ id, score: s / (127 * 127) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, n);
}
/** 질문 벡터와 내적이 큰 상위 n개 조문 id(내림차순). 임베딩 파일이 없으면 빈 목록. */
export async function searchVectors(query: string, n = 40): Promise<{ id: string; score: number }[]> {
  return (await searchVectorsDetailed(query, n))?.hits ?? [];
}
export function topByDot(data: Index, q: Int8Array, n: number) {
  const { vectors, dims, ids } = data;
  const best: { i: number; s: number }[] = [];
  let floor = -Infinity;
  for (let i = 0, base = 0; i < ids.length; i++, base += dims) {
    let s = 0;
    for (let k = 0; k < dims; k++) s += vectors[base + k] * q[k];
    if (best.length < n || s > floor) {
      best.push({ i, s });
      best.sort((a, b) => b.s - a.s);
      if (best.length > n) best.pop();
      floor = best.length === n ? best[n - 1].s : -Infinity;
    }
  }
  return best.map(({ i, s }) => ({ id: ids[i], score: s / (127 * 127) }));
}

/** 순위 융합(RRF). 목록마다 앞쪽일수록 큰 값을 받아 합친다. */
export function fuseRanks(lists: string[][], k = 60): Map<string, number> {
  const fused = new Map<string, number>();
  for (const list of lists)
    list.forEach((key, position) => fused.set(key, (fused.get(key) ?? 0) + 1 / (k + position + 1)));
  return fused;
}
